import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { MarkdownDocument } from "./MarkdownDocument";
import { getNonce } from "./utils/getNonce";
import { ZH_CN_WEBVIEW } from "./i18n/webviewTranslations";
import { saveImageLocally, uploadImageToServer } from "./utils/imageService";
import { computeLineMap } from "./utils/lineMap";
import { extractFrontmatter, restoreContentForSave, convertTableBrForDisplay, buildContentWithFrontmatter, normalizeImageDestination, rewriteImageSources } from "./utils/contentTransform";
import { ContentRequestCoordinator } from "./utils/contentRequestCoordinator";
import { decideExternalChange } from "./utils/externalChangeDecision";
import { sanitizeBasename } from "./utils/safeBasename";
import { isPathWithinBase } from "./utils/pathGuard";
import { OPEN_URL_SCHEMES, extractUrlScheme } from "../shared/constants";
import {
    DEFAULT_CODE_BLOCK_MAX_HEIGHT,
    DEFAULT_EDITOR_MAX_WIDTH,
    DEFAULT_IMAGE_SELECTION_COLOR,
    sanitizeCssColor,
    sanitizeCssNumber,
    sanitizeFontFamily,
    sanitizeSerializationMode,
} from "./utils/webviewConfigSanitize";
import type { ToExtensionMessage, ToWebviewMessage } from "../shared/messages";
import { resolveTableWrapVars } from "../shared/tableWrap";

// ─── 常量 ────────────────────────────────────────────────────
const GLOBAL_REVEAL_LINE_TTL_MS = 10_000;
const PENDING_NAVIGATION_TTL_MS = 5000;
const SAVE_COOLDOWN_MS = 1500;
const FS_WATCH_DEBOUNCE_MS = 200;
/** 保存时拉取内容（requestContent → contentResponse）的超时兜底：超时用内存内容 */
const CONTENT_REQUEST_TIMEOUT_MS = 3000;
/** 单张图片上传载荷大小上限（20MB） */
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

export class MarkdownEditorProvider
    implements vscode.CustomEditorProvider<MarkdownDocument> {
    public static readonly viewType = "epytor.editor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<MarkdownDocument>
    >();
    public readonly onDidChangeCustomDocument =
        this._onDidChangeCustomDocument.event;

    // 保存时拉取的内容请求协调器（单飞 + 等待队列，杜绝单槽覆盖导致保存悬挂，见 ContentRequestCoordinator）
    private readonly _contentRequests: ContentRequestCoordinator;

    // 记录每个 document 对应的 webviewPanel（用于 revert 时推送新内容）
    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();

    // 记录最近一次我们自己写盘的时间，用于避免自身保存触发文件监听 revert
    private readonly _lastSaveTimes = new Map<string, number>();

    // 图片 webviewUri → relPath 映射（key: docUri.toString()）
    private readonly _imageUriMaps = new Map<string, Map<string, string>>();
    private readonly _frontmatterMap = new Map<string, string>(); // uriKey → raw frontmatter string
    // 最近一次已知的盘上内容快照（外部写盘回退决策的基准，key: docUri.toString()）
    private readonly _lastDiskContents = new Map<string, string>();

    // 待跳转行号（全局搜索点击 / 切换编辑器时临时存储）key: fsPath
    private readonly _pendingNavigations = new Map<string, { line: number; ts: number }>();

    // 全局兜底跳转行号（revealLine 触发但 active tab 未切换时存储）
    private _pendingRevealLine: { line: number; ts: number } | undefined;

    // 已完成 WebView 初始化（发送过 ready 消息）的面板 key: uriKey
    private readonly _initializedPanels = new Set<string>();

    public static current: MarkdownEditorProvider | null = null;

    /** 从 extension.ts 调用：revealLine 触发但 active tab 未切换时，存全局兜底 */
    public setGlobalRevealLine(line: number): void {
        this._pendingRevealLine = { line, ts: Date.now() };
    }

    /** 消费全局兜底跳转行号（10 秒内有效，大文件 Milkdown 初始化较慢） */
    private _consumeGlobalRevealLine(): number | undefined {
        const p = this._pendingRevealLine;
        if (!p) { return undefined; }
        this._pendingRevealLine = undefined;
        if (Date.now() - p.ts > GLOBAL_REVEAL_LINE_TTL_MS) { return undefined; }
        return p.line;
    }

    /**
     * 从 extension.ts 调用：暂存待跳转行号；如果面板可见且已就绪则直接发送。
     * @param opts.directOnly 「目标就是当前激活面板」场景：即时投递成功则不暂存
     *   （避免 5s 陈旧条目污染后续激活）；未即时投递（面板尚未可见/未就绪）时仍
     *   暂存，由后续 ready / viewState 消费——不丢导航。
     */
    public setPendingNavigation(fsPath: string, line: number, opts?: { directOnly?: boolean }): void {
        const uriKey = vscode.Uri.file(fsPath).toString();
        const initialized = this._initializedPanels.has(uriKey);
        const panel = this._webviewPanels.get(uriKey);
        const delivered = initialized && panel !== undefined && panel.visible;
        if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[setPendingNav] file:', path.basename(fsPath), 'line:', line, '| initialized:', initialized, 'delivered:', delivered);
        if (delivered) {
            panel.webview.postMessage({ type: 'scrollToLine', line });
        }
        // 常规调用始终暂存（面板重建时 ready 可复用，TTL 5s）；directOnly 仅在
        // 未即时投递时暂存（保证不丢，同时不留陈旧条目）
        if (!opts?.directOnly || !delivered) {
            this._pendingNavigations.set(fsPath, { line, ts: Date.now() });
        }
    }

    /** 向指定 URI 的面板发送任意消息（供 extension.ts 调用） */
    public postToPanel(uri: vscode.Uri, msg: ToWebviewMessage): void {
        const panel = this._webviewPanels.get(uri.toString());
        if (panel) { panel.webview.postMessage(msg); }
    }

    /** 该文档当前是否有打开的 WYSIWYG 面板（命令兜底判据，回归 E6：此前靠 provider 非空判定，恒真） */
    public hasPanel(uri: vscode.Uri): boolean {
        return this._webviewPanels.has(uri.toString());
    }

    private _consumePendingNavigation(fsPath: string): number | undefined {
        const pending = this._pendingNavigations.get(fsPath);
        if (!pending) { return undefined; }
        this._pendingNavigations.delete(fsPath);
        // 超过 5 秒视为过期，不应用
        if (Date.now() - pending.ts > PENDING_NAVIGATION_TTL_MS) { return undefined; }
        return pending.line;
    }

    public postToAll(msg: ToWebviewMessage): void {
        for (const panel of this._webviewPanels.values()) {
            panel.webview.postMessage(msg);
        }
    }

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new MarkdownEditorProvider(context);
        MarkdownEditorProvider.current = provider;
        const disposable = vscode.window.registerCustomEditorProvider(
            MarkdownEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            },
        );
        // 配置广播统一在 extension.ts 的 CONFIG_BROADCASTS 表处理（回归 E10：
        // 此前 tableWrapMode 在此另设一份同构监听）
        return disposable;
    }

    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _wordCounts = new Map<string, { lines: number; words: number; charsNoSpace: number; charsWithSpace: number }>();

    constructor(
        private readonly context: vscode.ExtensionContext,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._statusBarItem.hide();
        this._contentRequests = new ContentRequestCoordinator(
            (uriKey) => {
                this._webviewPanels.get(uriKey)?.webview.postMessage({ type: "requestContent" });
            },
            CONTENT_REQUEST_TIMEOUT_MS,
            (uriKey) => this._warnContentFallback(uriKey),
        );
    }

    /** 已弹过「编辑器未响应、内容可能过期」警告的文档（每文档每会话一次，防每次保存重复骚扰） */
    private readonly _fallbackWarnedUris = new Set<string>();

    /**
     * 拉取超时兜底触发：保存仍以内存内容完成，但必须告知用户内容可能过期
     * （回归：此前静默写入过期内存，无任何信号）。
     */
    private _warnContentFallback(uriKey: string): void {
        if (this._fallbackWarnedUris.has(uriKey)) return;
        this._fallbackWarnedUris.add(uriKey);
        void vscode.window.showWarningMessage(
            vscode.l10n.t("The editor is not responding; the file was saved with possibly outdated content"),
        );
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<MarkdownDocument> {
        // 调试：记录 URI fragment/query，排查全局搜索是否传递行号
        if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[openCustomDocument] uri:', uri.toString(), '| fragment:', uri.fragment, '| query:', uri.query);
        return MarkdownDocument.create(uri);
    }

    async resolveCustomEditor(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        // 非本地文件（git diff、虚拟 URI 等）：渲染空白页，不 dispose
        // dispose 会导致 diff 引擎的 claimWebview 崩溃（OverlayWebview has been disposed）
        if (document.uri.scheme !== 'file') {
            webviewPanel.webview.html = '<!DOCTYPE html><html><body></body></html>';
            return;
        }

        // 保存 panel 引用（revert 时推送内容用）
        const uriKey = document.uri.toString();
        this._webviewPanels.set(uriKey, webviewPanel);

        this._registerPanelDisposeCleanup(document, uriKey, webviewPanel);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "dist"),
                // 允许访问 workspace 文件夹（本地图片显示）
                ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? []),
                // 允许访问 .md 文件所在目录（workspace 外或 untitled）
                vscode.Uri.joinPath(document.uri, '..'),
            ],
        };
        webviewPanel.webview.html = this._getHtmlForWebview(
            webviewPanel.webview,
        );

        this._registerViewStateHandler(document, webviewPanel, uriKey);

        webviewPanel.webview.onDidReceiveMessage(
            async (message: ToExtensionMessage) => {
                await this._handleWebviewMessage(document, webviewPanel, uriKey, message);
            },
        );

        this._registerFileWatcher(document, webviewPanel, uriKey);
    }

    /** 面板销毁时清理 per-uri 状态、定时器与状态栏 */
    private _registerPanelDisposeCleanup(
        document: MarkdownDocument,
        uriKey: string,
        webviewPanel: vscode.WebviewPanel,
    ): void {
        webviewPanel.onDidDispose(() => {
            this._webviewPanels.delete(uriKey);
            this._imageUriMaps.delete(uriKey);
            this._initializedPanels.delete(uriKey);
            this._wordCounts.delete(uriKey);
            this._lastDiskContents.delete(uriKey);
            this._fallbackWarnedUris.delete(uriKey);
            // 兜底结算未完成的拉取（面板已销毁，用内存内容）
            this._contentRequests.settleAll(uriKey);
            // 状态栏跟随剩余活跃面板（无则隐藏）
            this._refreshStatusBar();
        });
    }

    /** 面板激活/失活：字数统计恢复与待跳转行号消费（含延迟兜底检查） */
    private _registerViewStateHandler(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        uriKey: string,
    ): void {
        webviewPanel.onDidChangeViewState(({ webviewPanel: p }) => {
            // 焦点真相同步：面板激活态变化推送给 webview（多 webview 焦点互抢的
            // 根因修复——webview 内 window.focus()/view.focus() 无法判断自己是否
            // 当前激活文档，后台 webview 迟到的 focus 会抢走焦点致当前文档无法输入）
            try {
                p.webview.postMessage({ type: "panelActiveState", active: p.active });
            } catch {
                // panel 已销毁（切换/关闭竞态），忽略
            }
            if (!p.active) {
                // 状态栏跟随激活面板（回归 E9：此前用 setTimeout(0) 延迟判定，
                // 现在统一由 _refreshStatusBar 按「任一 active 面板」取数，
                // 同期另一面板的激活事件会随后再次刷新，事件循环内自洽）
                this._refreshStatusBar();
                return;
            }
            this._refreshStatusBar();
            if (!this._initializedPanels.has(uriKey)) { return; }
            const line = this._consumePendingNavigation(document.uri.fsPath)
                ?? this._consumeGlobalRevealLine();
            if (line !== undefined) {
                if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[viewState] immediate scrollToLine:', line);
                p.webview.postMessage({ type: "scrollToLine", line });
            }
            // 回归（E5）：此处原有 1s 延迟复查定时器（「revealLine 可能在 viewState
            // 之后才触发」）——E1 之后该场景由 revealLine 对「当前激活 md 面板」的
            // 即时投递覆盖（未即时投递时 setPendingNavigation 仍暂存，由 ready 消费），
            // 复查定时器已冗余，删除。
        });
    }

    /** 处理「打开文件/路径链接」：解析行号 fragment，md 走 WYSIWYG、其他走文本编辑器定位 */
    private async _handleOpenFileMessage(
        document: MarkdownDocument,
        message: { path: string },
    ): Promise<void> {
        const hashIdx = message.path.indexOf("#");
        const filePath = hashIdx >= 0 ? message.path.slice(0, hashIdx) : message.path;
        const fragment = hashIdx >= 0 ? message.path.slice(hashIdx + 1) : undefined;
        const lineMatch = fragment?.match(/^(\d+)(-\d+)?$/);
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

        // 工作区边界：文档属于某 workspace 时，路径链接不得越出 workspace 根
        // （回归：绝对路径与 ../ 逃逸可打开任意本地文件，恶意仓库的 .md 是钓鱼/隐私边界）
        const docFsPath = document.uri.fsPath;
        const containingFolder = vscode.workspace.workspaceFolders?.find(
            f => docFsPath.startsWith(f.uri.fsPath + path.sep),
        );

        let absPath: string;
        if (filePath.startsWith("@/")) {
            // @/ 表示 workspace 根目录：找包含当前文档的 workspace folder
            const workspaceRoot =
                containingFolder?.uri.fsPath ??
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            absPath = workspaceRoot
                ? path.join(workspaceRoot, filePath.slice(2))
                : path.resolve(path.dirname(docFsPath), "..", filePath.slice(2));
        } else {
            const docDir = path.dirname(docFsPath);
            absPath = path.resolve(docDir, filePath);
        }

        // 归一化后再校验（path.join/.. 段在此处收敛）；独立文件（无工作区）保持现状
        if (containingFolder && !isPathWithinBase(absPath, containingFolder.uri.fsPath)) {
            return;
        }

        const targetUri = vscode.Uri.file(absPath);
        if (/\.(md|markdown)$/i.test(absPath)) {
            // .md 文件：用 WYSIWYG 预览打开，行号通过 setPendingNavigation 传递
            if (lineNumber !== undefined) {
                this.setPendingNavigation(absPath, lineNumber);
            }
            await vscode.commands.executeCommand(
                "vscode.openWith",
                targetUri,
                MarkdownEditorProvider.viewType,
                { preview: true },
            );
        } else if (lineNumber !== undefined) {
            // 非 .md 有行号：用 showTextDocument 定位到指定行
            const doc = await vscode.workspace.openTextDocument(targetUri);
            await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
                preview: true,
            });
        } else {
            vscode.commands.executeCommand("vscode.open", targetUri);
        }
    }

    /** 监听外部文件变化（含 AI 工具写入），防抖后 revert 并推送 WebView；panel 关闭时销毁 watcher */
    private _registerFileWatcher(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        uriKey: string,
    ): void {
        // 注意：vscode.workspace.createFileSystemWatcher 不会感知同一 Extension Host 写入的文件
        // 因此改用 Node.js fs.watch，直接监听 OS 级别事件
        // 播种「已知盘内容」快照（面板打开时内存 = 盘上内容，外部写盘回退决策的基准）
        this._lastDiskContents.set(uriKey, document.getText());
        import("fs").then(({ watch: fsWatch }) => {
            let debounceTimer: ReturnType<typeof setTimeout> | undefined;
            const targetFile = path.basename(document.uri.fsPath);
            const fsWatcher = fsWatch(path.dirname(document.uri.fsPath), async (_event, filename) => {
                if (filename !== targetFile) { return; }
                // 防抖：短时间内多次触发只处理最后一次
                if (debounceTimer !== undefined) { clearTimeout(debounceTimer); }
                debounceTimer = setTimeout(async () => {
                    debounceTimer = undefined;
                    // 如果是我们自己的自动保存导致的变化（1.5 秒内），跳过
                    const lastSave = this._lastSaveTimes.get(uriKey) ?? 0;
                    if (Date.now() - lastSave < SAVE_COOLDOWN_MS) { return; }
                    const cts = new vscode.CancellationTokenSource();
                    try {
                        // 外部写盘回退判定（纯函数 decideExternalChange，见其背景注释）：
                        // 「webview 最新内容 vs 上次已知盘内容快照」判定用户是否有未落盘编辑。
                        // 回归：旧逻辑比较 latest 与「新盘内容」，外部修改后二者必然不同，
                        // 外部写盘永远进不了打开中的编辑器，后续保存还会覆盖它（数据丢失）。
                        const memoryBefore = document.getText();
                        const latest = await this._requestContent(document, uriKey);
                        await document.revert(cts.token);
                        const diskContent = document.getText();
                        const decision = decideExternalChange({
                            latest,
                            diskContent,
                            lastDisk: this._lastDiskContents.get(uriKey),
                            memoryBefore,
                        });
                        this._lastDiskContents.set(uriKey, decision.nextLastDisk);
                        if (decision.keepUserContent) {
                            // 用户有未落盘编辑：保留用户内容，并通知 VS Code 脏状态
                            // （回归：此前静默置脏，VS Code 认为干净，关窗不提示丢编辑）
                            document.update(latest);
                            this._markDirty(document);
                            return;
                        }
                        const panel = this._webviewPanels.get(uriKey);
                        if (panel) {
                            const revertContent = document.getText();
                            const displayContent = this._prepareContentForDisplay(revertContent, document, panel, uriKey);
                            panel.webview.postMessage({
                                type: "revert",
                                ...this._lifecyclePayload(uriKey, displayContent, computeLineMap(revertContent)),
                            });
                        }
                    } finally {
                        cts.dispose();
                    }
                }, FS_WATCH_DEBOUNCE_MS);
            });
            // panel 关闭时同步销毁 watcher
            webviewPanel.onDidDispose(() => { fsWatcher.close(); });
        });
    }

    /** WebView 消息路由（从 resolveCustomEditor 提取） */
    private async _handleWebviewMessage(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        uriKey: string,
        message: ToExtensionMessage,
    ): Promise<void> {
        const panel = webviewPanel;
        switch (message.type) {
            case "ready": {
                // 标记面板已初始化，onDidChangeViewState 此后才会处理 pending navigation
                this._initializedPanels.add(uriKey);
                const initContent = document.getText();
                const displayContent = this._prepareContentForDisplay(initContent, document, webviewPanel, uriKey);
                // 消费 pending navigation（切换预览 / 全局搜索首次打开时设置）
                const scrollToLine = this._consumePendingNavigation(document.uri.fsPath)
                    ?? this._consumeGlobalRevealLine();
                if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[ready] scrollToLine:', scrollToLine);
                // 重置稳定化基准（新的 init 意味着内容将重新从磁盘加载）
                const cfg = vscode.workspace.getConfiguration("epytor");
                webviewPanel.webview.postMessage({
                    type: "init",
                    ...this._lifecyclePayload(uriKey, displayContent, computeLineMap(initContent)),
                    // 发送时的面板激活态（webview 侧焦点守卫用；后续变化由
                    // panelActiveState 消息实时同步）
                    active: webviewPanel.active,
                    // 运行期配置随 init 下发（回归 F1：webview 不再用启动快照重置，
                    // revert 不会把用户中途改的配置静默回滚）
                    serializationMode: sanitizeSerializationMode(cfg.get("markdown.serializationMode", "clean")),
                    debugMode: cfg.get<boolean>("debugMode", false) === true,
                    ...(scrollToLine !== undefined ? { scrollToLine } : {}),
                });
                break;
            }
            case "markDirty": {
                // 轻量脏标记：内容已变（序列化改为保存时拉取）。保存入口统一为
                // saveCustomDocument（Cmd+S / VS Code 原生 files.autoSave / 关窗）
                this._markDirty(document);
                break;
            }
            case "contentResponse": {
                // 保存时拉取的响应：结算该文档的全部等待者
                if (this._contentRequests.has(uriKey)) {
                    this._contentRequests.resolve(
                        uriKey,
                        this._prepareContentForSave(message.content, uriKey),
                    );
                }
                break;
            }
            case "frontmatterUpdate": {
                // Frontmatter 面板编辑：更新缓存并重组保存
                const frontmatter = message.frontmatter ?? "";
                this._frontmatterMap.set(uriKey, frontmatter);
                // 拉取最新正文（拉取式：内存正文可能落后于 webview 未落盘的编辑，
                // 直接重组会把未落盘编辑覆盖掉）
                const body = await this._requestContent(document, uriKey);
                const newContent = buildContentWithFrontmatter(
                    body,
                    frontmatter,
                    this._imageUriMaps.get(uriKey) ?? new Map(),
                );
                if (newContent === null) { break; }
                document.update(newContent);
                // 立即写盘：面板编辑后用户往往立刻切到文本编辑器核对源码
                const cts = new vscode.CancellationTokenSource();
                try {
                    await this._saveNow(document, uriKey, cts.token);
                } finally {
                    cts.dispose();
                }
                break;
            }
            case "openUrl":
                // 协议白名单（回归：任意 URI 直接 openExternal，file:/javascript:/自定义协议无防护）
                if (message.url && OPEN_URL_SCHEMES.has(extractUrlScheme(message.url))) {
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                break;
            case "openFile": {
                if (!message.path) break;
                await this._handleOpenFileMessage(document, message);
                break;
            }
            case "switchToTextEditor": {
                // 切换前落盘：文本编辑器直接读磁盘，必须先把 webview 最新内容写盘
                // （拉取式架构下内存可能落后，不 flush 会导致切过去看到旧内容）
                const latest = await this._requestContent(document, uriKey);
                document.update(latest);
                const flushCts = new vscode.CancellationTokenSource();
                try {
                    const saved = await this._saveNow(document, uriKey, flushCts.token);
                    // 写盘失败：中止切换并保留面板（回归：此前静默继续，交互失效无提示）
                    if (!saved) break;
                } finally {
                    flushCts.dispose();
                }
                const textDoc = await vscode.workspace.openTextDocument(document.uri);
                const viewCol = webviewPanel.viewColumn;

                // 读取当前 WYSIWYG tab 的 preview 状态（斜体 = isPreview: true）
                let isPreview = false;
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (
                            tab.input instanceof vscode.TabInputCustom &&
                            (tab.input as vscode.TabInputCustom).uri.toString() === document.uri.toString()
                        ) {
                            isPreview = tab.isPreview;
                            break;
                        }
                    }
                }

                const opts: vscode.TextDocumentShowOptions = {
                    viewColumn: viewCol,
                    preview: isPreview,   // 保持原 tab 的斜体/正体状态
                    preserveFocus: false,
                };
                if (message.line && message.line > 0) {
                    const pos = new vscode.Position(message.line - 1, 0);
                    opts.selection = new vscode.Range(pos, pos);
                }

                // 先关 WYSIWYG tab，再开文本编辑器，避免两个 tab 并存的闪烁
                webviewPanel.dispose();
                await vscode.window.showTextDocument(textDoc, opts);
                break;
            }
            case "openSettings":
                vscode.commands.executeCommand('workbench.action.openSettings', 'epytor');
                break;
            case "uploadImage":
                if (message.id && message.data) {
                    // 载荷大小上限（回归：无上限，超大图片整块 postMessage 可造成内存峰值）
                    if (message.data.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
                        panel.webview.postMessage({
                            type: "imageUploadError",
                            id: message.id,
                            error: vscode.l10n.t(
                                "Image too large: maximum size is {0} MB",
                                Math.round(MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024),
                            ),
                        });
                        break;
                    }
                    this._handleImageUpload(
                        document, panel,
                        message.id,
                        message.data,
                        message.mimeType ?? 'image/png',
                        message.altText ?? '',
                    ).catch(() => {});
                }
                break;
            case "getProjectImages":
                if (message.id) {
                    this._handleGetProjectImages(document, panel, uriKey, message.id).catch(() => {});
                }
                break;
            case "renameImage":
                if (message.id && message.webviewUri && message.newBasename) {
                    this._handleImageRename(
                        document, panel, uriKey,
                        message.id,
                        message.webviewUri,
                        message.newBasename,
                    ).catch(() => {});
                }
                break;
            case "getPathSuggestions":
                if (message.id && message.query !== undefined) {
                    this._handleGetPathSuggestions(document, panel, message.id, message.query).catch(() => {});
                }
                break;
            case "resolveImagePath":
                if (message.id && message.relPath) {
                    this._handleResolveImagePath(document, panel, uriKey, message.id, message.relPath);
                }
                break;
            case "wordCount":
                this._wordCounts.set(uriKey, {
                    lines: message.lines,
                    words: message.words,
                    charsNoSpace: message.charsNoSpace,
                    charsWithSpace: message.charsWithSpace,
                });
                this._refreshStatusBar();
                break;
        }
    }

    /** 状态栏字数统一刷新出口（回归 E9：此前四处各自 show/hide 判据不一致） */
    private _refreshStatusBar(): void {
        let activeKey: string | undefined;
        for (const [key, panel] of this._webviewPanels) {
            try {
                if (panel.active) { activeKey = key; break; }
            } catch {
                // panel 已销毁，跳过
            }
        }
        const wc = activeKey ? this._wordCounts.get(activeKey) : undefined;
        if (!wc) {
            this._statusBarItem.hide();
            return;
        }
        this._statusBarItem.text = vscode.l10n.t('Lines(src): {0}  Words: {1}  Chars: {2}', wc.lines, wc.words.toLocaleString(), wc.charsNoSpace.toLocaleString());
        this._statusBarItem.tooltip = vscode.l10n.t('Chars (with spaces): {0}', wc.charsWithSpace.toLocaleString());
        this._statusBarItem.show();
    }

    /** 标记 dirty（webview 轻量脏标记到达时调用）；保存由 Cmd+S / VS Code 原生 files.autoSave 触发 */
    private _markDirty(document: MarkdownDocument): void {
        this._onDidChangeCustomDocument.fire({
            document,
            label: "Edit",
            undo: () => { /* TODO */ },
            redo: () => { /* TODO */ },
        });
    }

    /**
     * 唯一保存原语（三条路径共用：saveCustomDocument / frontmatterUpdate /
     * 切文本编辑器前的 flush）：写盘 + 时间戳/盘快照记账 + 行号广播。
     * 失败时标记 dirty（VS Code 才会提示保存，关窗不丢编辑）并弹出用户可见错误，
     * 返回 false 由调用方决定是否中止后续动作。
     * 回归 E4：此前 saveCustomDocument 无 catch、_saveWithFeedback 有 catch + 提示、
     * frontmatterUpdate 自建一串记账——同一关注点三套行为，记账重复两份。
     */
    private async _saveNow(
        document: MarkdownDocument,
        uriKey: string,
        token: vscode.CancellationToken,
    ): Promise<boolean> {
        try {
            await document.save(token);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) {
                console.error("[epytor] save failed:", message);
            }
            // 内存已 ≠ 盘上内容：通知 VS Code 脏状态，避免关窗静默丢编辑
            this._markDirty(document);
            void vscode.window.showErrorMessage(
                vscode.l10n.t("Failed to save file: {0}", message),
            );
            return false;
        }
        this._lastSaveTimes.set(uriKey, Date.now());
        this._lastDiskContents.set(uriKey, document.getText());
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            panel.webview.postMessage({ type: "lineMapUpdate", lineMap: computeLineMap(document.getText()) });
        }
        return true;
    }

    /**
     * 保存时拉取（拉取式架构核心）：请求 webview 序列化当前内容并等待回传。
     * webview 未就绪 / 超时（CONTENT_REQUEST_TIMEOUT_MS）时回退内存内容。
     * 并发调用（Cmd+S / autoSave / watcher / frontmatter / 切文本编辑器）经
     * ContentRequestCoordinator 单飞排队，共享同一次回包，无一悬挂。
     */
    private _requestContent(document: MarkdownDocument, uriKey: string): Promise<string> {
        const panel = this._webviewPanels.get(uriKey);
        if (!panel) {
            return Promise.resolve(document.getText());
        }
        return this._contentRequests.request(uriKey, document.getText());
    }

    async saveCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        const uriKey = document.uri.toString();
        // 拉取 webview 最新内容（无未落盘变更时与内存一致，更新为幂等）
        const content = await this._requestContent(document, uriKey);
        document.update(content);
        await this._saveNow(document, uriKey, cancellation);
    }

    async saveCustomDocumentAs(
        document: MarkdownDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        // 拉取式架构：内存可能落后于 webview 未落盘编辑，先拉最新内容再另存
        // （回归：直接 saveAs 会写出缺最近编辑的文件）
        const uriKey = document.uri.toString();
        const content = await this._requestContent(document, uriKey);
        document.update(content);
        await document.saveAs(destination, cancellation);
    }

    async revertCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.revert(cancellation);
        // 推送新内容给 WebView，触发编辑器重建
        const uriKey = document.uri.toString();
        this._lastDiskContents.set(uriKey, document.getText());
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            const revertContent = document.getText();
            const displayContent = this._prepareContentForDisplay(revertContent, document, panel, uriKey);
            panel.webview.postMessage({
                type: "revert",
                ...this._lifecyclePayload(uriKey, displayContent, computeLineMap(revertContent)),
            });
        }
    }

    /**
     * 生命周期消息（init/revert）共享载荷工厂（回归 C3：同构 payload 曾在三处
     * 逐字重复——watcher revert / ready→init / revertCustomDocument）
     */
    private _lifecyclePayload(
        uriKey: string,
        content: string,
        lineMap: number[],
    ): { content: string; lineMap: number[]; frontmatter: string | undefined; imageUriMap: Record<string, string> } {
        return {
            content,
            lineMap,
            frontmatter: this._frontmatterMap.get(uriKey) || undefined,
            imageUriMap: Object.fromEntries(this._imageUriMaps.get(uriKey) ?? []),
        };
    }

    async backupCustomDocument(
        document: MarkdownDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        // 热退出备份同样先拉最新内容（回归：备份缺最近编辑，热退出恢复丢内容）
        const uriKey = document.uri.toString();
        const content = await this._requestContent(document, uriKey);
        document.update(content);
        return document.backup(context.destination, cancellation);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const cfg = vscode.workspace.getConfiguration("epytor");
        // 配置值注入 HTML 前一律净化（恶意 workspace 设置不得逃逸 <style>/<script>，见 webviewConfigSanitize）
        const maxHeight = sanitizeCssNumber(cfg.get("codeBlockMaxHeight", DEFAULT_CODE_BLOCK_MAX_HEIGHT), DEFAULT_CODE_BLOCK_MAX_HEIGHT);
        const editorMaxWidth = sanitizeCssNumber(cfg.get("editorMaxWidth", DEFAULT_EDITOR_MAX_WIDTH), DEFAULT_EDITOR_MAX_WIDTH);
        const fontFamily = sanitizeFontFamily(cfg.get("fontFamily", ""));
        const imageSelectionColor = sanitizeCssColor(cfg.get("imageSelectionColor", DEFAULT_IMAGE_SELECTION_COLOR), DEFAULT_IMAGE_SELECTION_COLOR);
        const tableWrapMode = cfg.get<string>("tableWrapMode", "wrap");
        const tableWrapVars = resolveTableWrapVars(tableWrapMode);
        const tableWordBreak = tableWrapVars.wordBreak;
        const tableWhiteSpace = tableWrapVars.whiteSpace;
        const tableOverflowX = tableWrapVars.overflowX;
        const tableWidth = tableWrapVars.tableWidth;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "dist",
                "webview.js",
            ),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "dist",
                "webview.css",
            ),
        );
        const nonce = getNonce();

        const lang = vscode.env.language.toLowerCase();
        const isMac = process.platform === 'darwin';
        const translations = lang.startsWith('zh') ? ZH_CN_WEBVIEW : {};
        const debugMode = cfg.get<boolean>("debugMode", false) === true;
        const serializationMode = sanitizeSerializationMode(cfg.get("markdown.serializationMode", "clean"));
        const i18nScript = `window.__i18n=${JSON.stringify({ translations, isMac, debugMode, serializationMode })};`;

        return `<!DOCTYPE html>
<html lang="${vscode.env.language}" style="background-color: var(--vscode-editor-background);">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             img-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Editor</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>:root { --code-block-max-height: ${maxHeight}px; --editor-max-width: ${editorMaxWidth}px;${fontFamily ? ` --custom-font-family: ${fontFamily};` : ''} --image-selection-color: ${imageSelectionColor}; --epytor-table-word-break: ${tableWordBreak}; --epytor-table-white-space: ${tableWhiteSpace}; --epytor-table-overflow-x: ${tableOverflowX}; --epytor-table-width: ${tableWidth}; }</style>
</head>
<body style="margin: 0; background-color: var(--vscode-editor-background);">
  <div class="editor-topbar"></div>
  <div id="editor"></div>
  <script nonce="${nonce}">${i18nScript}</script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _prepareContentForDisplay(
        content: string,
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        uriKey: string,
    ): string {
        const { frontmatter, body } = extractFrontmatter(content);
        this._frontmatterMap.set(uriKey, frontmatter);
        // 表格内 <br> 兼容转换：remark-gfm 解析层丢弃 <br>，转 &#10; 保证渲染往返（见 convertTableBrForDisplay）
        content = convertTableBrForDisplay(body);

        if (document.uri.scheme !== 'file') { return content; }
        const mdDir = path.dirname(document.uri.fsPath);
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        // 逐图替换：rewriteImageSources 的 src 捕获支持空格与嵌套括号、title 单独捕获
        // （回归①：旧正则 [^)\s"]+ 在空格/括号处截断，显示破裂且保存往返改写畸形内容；
        //  回归②：src 吞 title 致带引号路径 404 图片不显示，只换 src 保 title）
        // 归一化：文件里 `<...>` 包裹或 `\(` 转义的目标按可解析路径处理，uriMap 仍存原始写法
        return rewriteImageSources(content, (rawSrc) => {
            if (/^(https?:|data:|vscode-resource:|vscode-webview-)/.test(rawSrc)) { return undefined; }
            const src = normalizeImageDestination(rawSrc);
            try {
                let absPath: string;
                if (src.startsWith('@/')) {
                    // @/ 是 workspace root 别名，解析到工作区根目录
                    const root = workspaceRoot ?? mdDir;
                    absPath = path.join(root, src.slice(2));
                } else {
                    absPath = path.resolve(mdDir, src);
                }
                const webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
                this._registerImageMapping(uriKey, webviewUri, rawSrc);
                return webviewUri;
            } catch {
                // 解析失败：原样保留（不登记 uriMap）
                return undefined;
            }
        });
    }

    /**
     * 登记图片映射（本文件 uriMap 的唯一写入入口）：webviewUri → 文档里的显示写法。
     * 各调用方的 displayPath 语义不同但都必须是「写进文档的那个字符串」——显示预处理
     * 存文件原文（含 `<...>`/转义），上传/图库/补全/解析存待插入的相对路径。
     */
    private _registerImageMapping(uriKey: string, webviewUri: string, displayPath: string): void {
        let uriMap = this._imageUriMaps.get(uriKey);
        if (!uriMap) {
            uriMap = new Map<string, string>();
            this._imageUriMaps.set(uriKey, uriMap);
        }
        uriMap.set(webviewUri, displayPath);
    }

    private _prepareContentForSave(content: string, uriKey: string): string {        const frontmatter = this._frontmatterMap.get(uriKey) ?? "";
        const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
        return restoreContentForSave(content, frontmatter, uriMap);
    }

    private async _handleImageUpload(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        data: Uint8Array,
        mimeType: string,
        altText: string,
    ): Promise<void> {
        const uriKey = document.uri.toString();
        const cfg = vscode.workspace.getConfiguration('epytor', document.uri);
        const storage = cfg.get<string>('imageStorage', 'local');
        try {
            let url: string;
            if (storage === 'server') {
                url = await uploadImageToServer(cfg, data, mimeType, altText);
            } else {
                const { relPath, absUri } = await saveImageLocally(document.uri, cfg, data, mimeType, altText);
                const webviewUri = panel.webview.asWebviewUri(absUri);
                url = webviewUri.toString();
                // 存储映射，供保存时将 webviewUri 替换回 relPath
                this._registerImageMapping(uriKey, url, relPath);
            }
            panel.webview.postMessage({ type: 'imageUploaded', id, url });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            panel.webview.postMessage({ type: 'imageUploadError', id, error: errMsg });
            vscode.window.showErrorMessage(vscode.l10n.t('Image upload failed: {0}', errMsg));
        }
    }

    private async _handleGetProjectImages(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        uriKey: string,
        id: string,
    ): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('epytor', document.uri);
        const customPath = cfg.get<string>('imageLocalPath', '').trim();
        const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico']);
        const CANDIDATE_DIRS = ['images', 'imgs', 'assets/images', 'assets'];

        let targetDir: vscode.Uri | null = null;

        if (customPath) {
            if (path.isAbsolute(customPath)) {
                targetDir = vscode.Uri.file(customPath);
            } else {
                const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                targetDir = wsFolder
                    ? vscode.Uri.joinPath(wsFolder.uri, customPath)
                    : vscode.Uri.joinPath(document.uri, '..', customPath);
            }
        } else if (document.uri.scheme === 'file') {
            const mdDir = vscode.Uri.joinPath(document.uri, '..');
            const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            const searchRoots = wsFolder ? [wsFolder.uri, mdDir] : [mdDir];
            outer: for (const root of searchRoots) {
                for (const candidate of CANDIDATE_DIRS) {
                    const candidateUri = vscode.Uri.joinPath(root, candidate);
                    try {
                        const stat = await vscode.workspace.fs.stat(candidateUri);
                        if (stat.type === vscode.FileType.Directory) {
                            targetDir = candidateUri;
                            break outer;
                        }
                    } catch { /* not found */ }
                }
            }
        }

        const images: Array<{ relPath: string; webviewUri: string; name: string }> = [];

        if (targetDir) {
            const mdDir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : '';
            try {
                const entries = await vscode.workspace.fs.readDirectory(targetDir);
                for (const [name, type] of entries) {
                    if (type !== vscode.FileType.File) { continue; }
                    const ext = path.extname(name).toLowerCase();
                    if (!IMAGE_EXTS.has(ext)) { continue; }
                    const fileUri = vscode.Uri.joinPath(targetDir, name);
                    const wvUri = panel.webview.asWebviewUri(fileUri).toString();
                    let relPath = name;
                    if (mdDir) {
                        const rel = path.relative(mdDir, fileUri.fsPath).replace(/\\/g, '/');
                        relPath = rel.startsWith('.') ? rel : './' + rel;
                    }
                    this._registerImageMapping(uriKey, wvUri, relPath);
                    images.push({ relPath, webviewUri: wvUri, name });
                }
            } catch { /* directory not accessible */ }
        }

        panel.webview.postMessage({ type: 'projectImagesList', id, images });
    }

    private async _handleImageRename(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        uriKey: string,
        id: string,
        webviewUri: string,
        newBasename: string,
    ): Promise<void> {
        const uriMap = this._imageUriMaps.get(uriKey);
        if (!uriMap) {
            panel.webview.postMessage({ type: 'imageRenameError', id, error: 'URI map not found' });
            return;
        }

        const oldRelPath = uriMap.get(webviewUri);
        if (!oldRelPath) {
            panel.webview.postMessage({ type: 'imageRenameError', id, error: 'Image not found in URI map' });
            return;
        }

        try {
            const mdDir = path.dirname(document.uri.fsPath);
            const oldAbsPath = path.resolve(mdDir, oldRelPath);
            const oldUri = vscode.Uri.file(oldAbsPath);

            // 验证文件存在
            await vscode.workspace.fs.stat(oldUri);

            // 安全化新文件名：过滤非法字符 + 拦截 Windows 保留设备名（sanitizeBasename 纯函数）
            const oldExt = path.extname(oldAbsPath);
            const safeBasename = sanitizeBasename(newBasename);
            if (!safeBasename) {
                panel.webview.postMessage({ type: 'imageRenameError', id, error: 'Invalid filename' });
                return;
            }

            const dir = path.dirname(oldAbsPath);
            let targetUri = vscode.Uri.file(path.join(dir, safeBasename + oldExt));

            // 检查目标文件是否已存在，若存在则提示用户，不自动覆盖
            try {
                await vscode.workspace.fs.stat(targetUri);
                // stat 成功说明文件已存在
                const errMsg = vscode.l10n.t('A file named "{0}" already exists.', safeBasename + oldExt);
                panel.webview.postMessage({ type: 'imageRenameError', id, error: errMsg });
                vscode.window.showErrorMessage(errMsg);
                return;
            } catch { /* 文件不存在，正常继续 */ }

            await vscode.workspace.fs.rename(oldUri, targetUri);

            // 更新 URI 映射
            const rel = path.relative(mdDir, targetUri.fsPath).replace(/\\/g, '/');
            const newRelPath = rel.startsWith('.') ? rel : './' + rel;
            const newWebviewUri = panel.webview.asWebviewUri(targetUri).toString();

            uriMap.delete(webviewUri);
            this._registerImageMapping(uriKey, newWebviewUri, newRelPath);

            panel.webview.postMessage({ type: 'imageRenamed', id, oldWebviewUri: webviewUri, newWebviewUri });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            panel.webview.postMessage({ type: 'imageRenameError', id, error: errMsg });
            vscode.window.showErrorMessage(vscode.l10n.t('Image rename failed: {0}', errMsg));
        }
    }

    private async _handleGetPathSuggestions(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        query: string,
    ): Promise<void> {
        const q = query.trim();
        if (!q) {
            panel.webview.postMessage({ type: 'pathSuggestions', id, items: [] });
            return;
        }

        const docFsPath = document.uri.fsPath;
        const docDir = path.dirname(docFsPath);
        const sep = path.sep;
        const workspaceFolder = vscode.workspace.workspaceFolders?.find(
            f => docFsPath.startsWith(f.uri.fsPath + sep),
        ) ?? vscode.workspace.workspaceFolders?.[0];
        const workspaceRoot = workspaceFolder?.uri.fsPath;

        // 按最后一个 "/" 分割为目录部分和名称前缀
        const lastSlash = q.lastIndexOf('/');
        const dirPart = lastSlash >= 0 ? q.slice(0, lastSlash + 1) : '';
        const namePart = lastSlash >= 0 ? q.slice(lastSlash + 1) : q;

        // 解析 dirPart 为绝对路径
        let absDir: string;
        if (dirPart.startsWith('@/')) {
            absDir = workspaceRoot
                ? path.join(workspaceRoot, dirPart.slice(2))
                : docDir;
        } else if (dirPart === '' || dirPart.startsWith('./') || dirPart.startsWith('../')) {
            absDir = path.resolve(docDir, dirPart || '.');
        } else {
            absDir = path.resolve(docDir, dirPart);
        }

        // readDirectory 列出直接子项（含文件类型）
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(absDir));
        } catch {
            panel.webview.postMessage({ type: 'pathSuggestions', id, items: [] });
            return;
        }

        const IGNORE = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'out', '.vscode-test']);
        const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico']);
        const uriKey = document.uri.toString();
        const items = entries
            .filter(([name, type]) =>
                !IGNORE.has(name) &&
                name.toLowerCase().startsWith(namePart.toLowerCase()) &&
                (type === vscode.FileType.File || type === vscode.FileType.Directory) &&
                // 排除与 namePart 完全匹配的文件（路径已完整，无需提示）
                !(type === vscode.FileType.File && name.toLowerCase() === namePart.toLowerCase()),
            )
            // 目录排在文件前面，同类型按字母排序
            .sort(([an, at], [bn, bt]) => {
                if (at !== bt) { return bt === vscode.FileType.Directory ? 1 : -1; }
                return an.localeCompare(bn);
            })
            .slice(0, 15)
            .map(([name, type]) => {
                const fullPath = dirPart + name + (type === vscode.FileType.Directory ? '/' : '');
                let webviewUri: string | undefined;
                if (type === vscode.FileType.File) {
                    const ext = path.extname(name).toLowerCase();
                    if (IMAGE_EXTS.has(ext)) {
                        const absFilePath = path.join(absDir, name);
                        webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absFilePath)).toString();
                        // 登记映射，供 _prepareContentForSave 在保存时转换回相对路径
                        this._registerImageMapping(uriKey, webviewUri, fullPath);
                    }
                }
                return { path: fullPath, isDir: type === vscode.FileType.Directory, webviewUri };
            });

        panel.webview.postMessage({ type: 'pathSuggestions', id, items });
    }

    private _handleResolveImagePath(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        uriKey: string,
        id: string,
        relPath: string,
    ): void {
        if (document.uri.scheme !== 'file') { return; }
        const mdDir = path.dirname(document.uri.fsPath);
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        try {
            let absPath: string;
            if (relPath.startsWith('@/')) {
                const root = workspaceRoot ?? mdDir;
                absPath = path.join(root, relPath.slice(2));
            } else {
                absPath = path.resolve(mdDir, relPath);
            }
            // 文件不存在时不生成 webviewUri，让 WebView 端超时回退使用原始 relPath
            if (!fs.existsSync(absPath)) { return; }
            const webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
            // 登记映射供保存时还原
            this._registerImageMapping(uriKey, webviewUri, relPath);
            panel.webview.postMessage({ type: 'imagePathResolved', id, webviewUri });
        } catch { /* 路径非法，不响应 */ }
    }
}
