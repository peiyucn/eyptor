import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { MarkdownDocument } from "./MarkdownDocument";
import { getNonce } from "./utils/getNonce";
import { ZH_CN_WEBVIEW } from "./i18n/webviewTranslations";
import { saveImageLocally, uploadImageToServer } from "./utils/imageService";
import { computeLineMap } from "./utils/lineMap";
import { extractFrontmatter, restoreContentForSave, convertTableBrForDisplay, buildContentWithFrontmatter } from "./utils/contentTransform";
import type { ToExtensionMessage, ToWebviewMessage } from "../shared/messages";
import { resolveTableWrapVars } from "../shared/tableWrap";

// ─── 常量 ────────────────────────────────────────────────────
const GLOBAL_REVEAL_LINE_TTL_MS = 10_000;
const NAV_SUPPRESS_DURATION_MS = 1500;
const PENDING_NAVIGATION_TTL_MS = 5000;
const REVEAL_LINE_DELAYED_CHECK_MS = 1000;
const AUTO_SWITCH_SUPPRESS_DURATION_MS = 2000;
const SAVE_COOLDOWN_MS = 1500;
const FS_WATCH_DEBOUNCE_MS = 200;
/** 保存时拉取内容（requestContent → contentResponse）的超时兜底：超时用内存内容 */
const CONTENT_REQUEST_TIMEOUT_MS = 3000;

export class MarkdownEditorProvider
    implements vscode.CustomEditorProvider<MarkdownDocument> {
    public static readonly viewType = "epytor.editor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<MarkdownDocument>
    >();
    public readonly onDidChangeCustomDocument =
        this._onDidChangeCustomDocument.event;

    // 保存时拉取的等待者（key: document uri string → resolve(content)）
    private readonly _pendingContentResolvers = new Map<string, (content: string) => void>();

    // 记录每个 document 对应的 webviewPanel（用于 revert 时推送新内容）
    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();

    // 已执行过 keepEditor（pin tab）的 uri，避免重复执行
    private readonly _pinnedDocuments = new Set<string>();

    // 记录最近一次我们自己写盘的时间，用于避免自身保存触发文件监听 revert
    private readonly _lastSaveTimes = new Map<string, number>();

    // 图片 webviewUri → relPath 映射（key: docUri.toString()）
    private readonly _imageUriMaps = new Map<string, Map<string, string>>();
    private readonly _frontmatterMap = new Map<string, string>(); // uriKey → raw frontmatter string
    /** switchToTextEditor 进行中时，抑制 onDidChangeTabs 把文本 tab 再切回 WYSIWYG */
    public static readonly suppressAutoSwitch = new Set<string>();

    // 待跳转行号（全局搜索点击 / 切换编辑器时临时存储）key: fsPath
    private readonly _pendingNavigations = new Map<string, { line: number; ts: number }>();

    // 全局兜底跳转行号（revealLine 触发但 active tab 未切换时存储）
    private _pendingRevealLine: { line: number; ts: number } | undefined;

    // 已完成 WebView 初始化（发送过 ready 消息）的面板 key: uriKey
    private readonly _initializedPanels = new Set<string>();

    // 切换到文本编辑器期间，抑制 onDidChangeActiveTextEditor 的行号回传
    // 避免文本编辑器打开后，行号被错误地反馈给 WebView 触发多余的 scrollToLine
    private _suppressNavFromTextEditor = false;

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

    /** 返回当前所有已注册（open）的 .md 面板的 fsPath 列表 */
    public getAllMdFsPaths(): string[] {
        const paths: string[] = [];
        for (const uriKey of this._webviewPanels.keys()) {
            try {
                const uri = vscode.Uri.parse(uriKey);
                if (uri.fsPath.endsWith('.md') || uri.fsPath.endsWith('.markdown')) {
                    paths.push(uri.fsPath);
                }
            } catch {
                // 忽略无效 URI
            }
        }
        return paths;
    }

    /** 切换到文本编辑器时调用：1.5 秒内屏蔽来自文本编辑器的行号回传 */
    public suppressNavFromTextEditor(): void {
        this._suppressNavFromTextEditor = true;
        setTimeout(() => { this._suppressNavFromTextEditor = false; }, NAV_SUPPRESS_DURATION_MS);
    }

    /** extension.ts 检查是否需要跳过 onDidChangeActiveTextEditor 的行号回传 */
    public get isNavFromTextEditorSuppressed(): boolean {
        return this._suppressNavFromTextEditor;
    }

    /** 从 extension.ts 调用：暂存待跳转行号；如果面板可见且已就绪则直接发送 */
    public setPendingNavigation(fsPath: string, line: number): void {
        this._pendingNavigations.set(fsPath, { line, ts: Date.now() });
        // 面板已存在且已初始化 → 直接发送，无需等待 onDidChangeViewState
        const uriKey = vscode.Uri.file(fsPath).toString();
        const initialized = this._initializedPanels.has(uriKey);
        if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[setPendingNav] fsPath:', fsPath, 'line:', line, '| initialized:', initialized);
        if (initialized) {
            const panel = this._webviewPanels.get(uriKey);
            // 只在面板当前可见时立即发送（面板已隐藏说明用户刚切换走，不应回传行号）
            if (panel && panel.visible) {
                panel.webview.postMessage({ type: 'scrollToLine', line });
                // 不删除 _pendingNavigations，作为面板重建时 ready 的备用（TTL 5s 内有效）
            }
        }
    }

    /** 向指定 URI 的面板发送任意消息（供 extension.ts 调用） */
    public postToPanel(uri: vscode.Uri, msg: ToWebviewMessage): void {
        const panel = this._webviewPanels.get(uri.toString());
        if (panel) { panel.webview.postMessage(msg); }
    }

    /** 从 extension.ts（revealLine 命令）调用：直接向面板发送滚动消息 */
    public scrollPanelToLine(uri: vscode.Uri, line: number): void {
        const uriKey = uri.toString();
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            panel.webview.postMessage({ type: 'scrollToLine', line });
        }
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
        // 表格换行档位变更：广播给所有打开的 WebView 即时更新 CSS 变量（无需重开文档）
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (!e.affectsConfiguration("epytor.tableWrapMode")) return;
                const mode = vscode.workspace.getConfiguration("epytor").get<string>("tableWrapMode", "wrap");
                provider.postToAll({ type: "tableWrapModeChanged", mode });
            }),
        );
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
            this._pinnedDocuments.delete(uriKey);
            this._imageUriMaps.delete(uriKey);
            this._initializedPanels.delete(uriKey);
            this._wordCounts.delete(uriKey);
            // 兜底 resolve 未完成的拉取（面板已销毁，用内存内容）
            const resolver = this._pendingContentResolvers.get(uriKey);
            if (resolver) {
                this._pendingContentResolvers.delete(uriKey);
                resolver(document.getText());
            }
            // 面板关闭（含预览被替换、切文本编辑器）时隐藏状态栏
            // 若有其他活跃 MD 面板，其 wordCount / onDidChangeViewState 会重新显示
            this._statusBarItem.hide();
        });
    }

    /** 面板激活/失活：字数统计恢复与待跳转行号消费（含延迟兜底检查） */
    private _registerViewStateHandler(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        uriKey: string,
    ): void {
        webviewPanel.onDidChangeViewState(({ webviewPanel: p }) => {
            if (!p.active) {
                // 延迟检查：切换出 md 面板后若无活跃面板则隐藏状态栏
                setTimeout(() => {
                    const anyActive = Array.from(this._webviewPanels.values()).some(
                        (panel) => {
                            try { return panel.active; } catch { /* panel 可能已销毁，忽略 */ return false; }
                        },
                    );
                    if (!anyActive) this._statusBarItem.hide();
                }, 0);
                return;
            }
            // 恢复字数统计
            const wc = this._wordCounts.get(uriKey);
            if (wc) {
                this._statusBarItem.text = vscode.l10n.t('Lines(src): {0}  Words: {1}  Chars: {2}', wc.lines, wc.words.toLocaleString(), wc.charsNoSpace.toLocaleString());
                this._statusBarItem.tooltip = vscode.l10n.t('Chars (with spaces): {0}', wc.charsWithSpace.toLocaleString());
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
            if (!this._initializedPanels.has(uriKey)) { return; }
            const line = this._consumePendingNavigation(document.uri.fsPath)
                ?? this._consumeGlobalRevealLine();
            if (line !== undefined) {
                if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[viewState] immediate scrollToLine:', line);
                p.webview.postMessage({ type: "scrollToLine", line });
                return;
            }
            // revealLine 可能在 viewState 变化之后才触发（全局搜索时序不确定）
            // 延迟 1000ms 再检查一次全局兜底行号或 pending navigation
            setTimeout(() => {
                try {
                    if (!p.active) { return; }
                } catch {
                    return; // 面板已销毁（如 preview tab 被替换），忽略
                }
                const delayedLine = this._consumePendingNavigation(document.uri.fsPath)
                    ?? this._consumeGlobalRevealLine();
                if (delayedLine !== undefined) {
                    if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) console.log('[viewState] delayed scrollToLine:', delayedLine);
                    p.webview.postMessage({ type: "scrollToLine", line: delayedLine });
                }
            }, REVEAL_LINE_DELAYED_CHECK_MS);
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

        let absPath: string;
        if (filePath.startsWith("@/")) {
            // @/ 表示 workspace 根目录：找包含当前文档的 workspace folder
            const docFsPath = document.uri.fsPath;
            const sep = path.sep;
            const containingFolder = vscode.workspace.workspaceFolders?.find(
                f => docFsPath.startsWith(f.uri.fsPath + sep),
            );
            const workspaceRoot =
                containingFolder?.uri.fsPath ??
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            absPath = workspaceRoot
                ? path.join(workspaceRoot, filePath.slice(2))
                : path.resolve(path.dirname(docFsPath), "..", filePath.slice(2));
        } else {
            const docDir = path.dirname(document.uri.fsPath);
            absPath = path.resolve(docDir, filePath);
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
                        // 拉取式：revert 前先取 webview 最新内容，与磁盘比较；
                        // 若用户有未落盘编辑（内容不同），保留用户内容不 revert
                        const latest = await this._requestContent(document, uriKey);
                        await document.revert(cts.token);
                        const diskContent = document.getText();
                        if (latest !== diskContent) {
                            document.update(latest);
                            return;
                        }
                        const panel = this._webviewPanels.get(uriKey);
                        if (panel) {
                            const revertContent = document.getText();
                            const displayContent = this._prepareContentForDisplay(revertContent, document, panel, uriKey);
                            panel.webview.postMessage({ type: "revert", content: displayContent, lineMap: computeLineMap(revertContent), frontmatter: this._frontmatterMap.get(uriKey) || undefined, imageUriMap: Object.fromEntries(this._imageUriMaps.get(uriKey) ?? []) });
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
                webviewPanel.webview.postMessage({
                    type: "init",
                    content: displayContent,
                    lineMap: computeLineMap(initContent),
                    frontmatter: this._frontmatterMap.get(uriKey) || undefined,
                    imageUriMap: Object.fromEntries(this._imageUriMaps.get(uriKey) ?? []),
                    ...(scrollToLine !== undefined ? { scrollToLine } : {}),
                });
                break;
            }
            case "update":
                // 兼容旧路径：webview 已改为轻量 markDirty 通知，此 case 不再有常规调用方
                if (message.content !== undefined) {
                    const newContent = this._prepareContentForSave(message.content, uriKey);
                    if (newContent === document.getText()) { break; }
                    document.update(newContent);
                    if (!this._pinnedDocuments.has(uriKey)) {
                        this._pinnedDocuments.add(uriKey);
                        vscode.commands.executeCommand('workbench.action.keepEditor');
                    }
                    this._markDirty(document);
                }
                break;
            case "markDirty": {
                // 轻量脏标记：内容已变（序列化改为保存时拉取）。保存入口统一为
                // saveCustomDocument（Cmd+S / VS Code 原生 files.autoSave / 关窗）
                this._markDirty(document);
                break;
            }
            case "contentResponse": {
                // 保存时拉取的响应：resolve 对应等待者
                const resolver = this._pendingContentResolvers.get(uriKey);
                if (resolver) {
                    this._pendingContentResolvers.delete(uriKey);
                    resolver(this._prepareContentForSave(message.content, uriKey));
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
                // 立即写盘：面板编辑后用户往往立刻切到文本编辑器核对源码。
                // 不经过 saveCustomDocument（其内部会再次拉取 webview 正文并覆盖 frontmatter）
                this._lastSaveTimes.set(uriKey, Date.now());
                const cts = new vscode.CancellationTokenSource();
                try {
                    await document.save(cts.token);
                    const panel = this._webviewPanels.get(uriKey);
                    if (panel) {
                        panel.webview.postMessage({ type: "lineMapUpdate", lineMap: computeLineMap(document.getText()) });
                    }
                } finally {
                    cts.dispose();
                }
                break;
            }
            case "openUrl":
                if (message.url) {
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
                this._lastSaveTimes.set(uriKey, Date.now());
                const flushCts = new vscode.CancellationTokenSource();
                try {
                    await document.save(flushCts.token);
                } finally {
                    flushCts.dispose();
                }
                // 抑制接下来 onDidChangeActiveTextEditor 的行号回传（1.5s 内）
                this.suppressNavFromTextEditor();
                // 抑制 onDidChangeTabs 的自动 WYSIWYG 切换（防止切回去）
                MarkdownEditorProvider.suppressAutoSwitch.add(document.uri.toString());
                setTimeout(() => MarkdownEditorProvider.suppressAutoSwitch.delete(document.uri.toString()), AUTO_SWITCH_SUPPRESS_DURATION_MS);
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
                if (panel.active) {
                    this._statusBarItem.text = vscode.l10n.t('Lines(src): {0}  Words: {1}  Chars: {2}', message.lines, message.words.toLocaleString(), message.charsNoSpace.toLocaleString());
                    this._statusBarItem.tooltip = vscode.l10n.t('Chars (with spaces): {0}', message.charsWithSpace.toLocaleString());
                    this._statusBarItem.show();
                }
                break;
        }
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
     * 保存时拉取（拉取式架构核心）：请求 webview 序列化当前内容并等待回传。
     * webview 未就绪 / 超时（CONTENT_REQUEST_TIMEOUT_MS）时回退内存内容。
     */
    private _requestContent(document: MarkdownDocument, uriKey: string): Promise<string> {
        const panel = this._webviewPanels.get(uriKey);
        if (!panel) {
            return Promise.resolve(document.getText());
        }
        return new Promise((resolve) => {
            this._pendingContentResolvers.set(uriKey, resolve);
            panel.webview.postMessage({ type: "requestContent" });
            setTimeout(() => {
                if (this._pendingContentResolvers.delete(uriKey)) {
                    resolve(document.getText());
                }
            }, CONTENT_REQUEST_TIMEOUT_MS);
        });
    }

    async saveCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        const uriKey = document.uri.toString();
        // 拉取 webview 最新内容（无未落盘变更时与内存一致，更新为幂等）
        const content = await this._requestContent(document, uriKey);
        document.update(content);
        this._lastSaveTimes.set(uriKey, Date.now());
        await document.save(cancellation);
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            panel.webview.postMessage({ type: "lineMapUpdate", lineMap: computeLineMap(document.getText()) });
        }
    }

    async saveCustomDocumentAs(
        document: MarkdownDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    async revertCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.revert(cancellation);
        // 推送新内容给 WebView，触发编辑器重建
        const uriKey = document.uri.toString();
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            const revertContent = document.getText();
            const displayContent = this._prepareContentForDisplay(revertContent, document, panel, uriKey);
            panel.webview.postMessage({
                type: "revert",
                content: displayContent,
                lineMap: computeLineMap(revertContent),
                frontmatter: this._frontmatterMap.get(uriKey) || undefined,
                imageUriMap: Object.fromEntries(this._imageUriMaps.get(uriKey) ?? []),
            });
        }
    }

    async backupCustomDocument(
        document: MarkdownDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const cfg = vscode.workspace.getConfiguration("epytor");
        const maxHeight = cfg.get<number>("codeBlockMaxHeight", 500);
        const editorMaxWidth = cfg.get<number>("editorMaxWidth", 900);
        const fontFamily = cfg.get<string>("fontFamily", "");
        const imageSelectionColor = cfg.get<string>("imageSelectionColor", "rgba(52, 211, 153, 0.6)");
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
        const debugMode = cfg.get<boolean>("debugMode", false);
        const serializationMode = cfg.get<"clean" | "compatible">("markdown.serializationMode", "clean");
        const i18nScript = `window.__i18n=${JSON.stringify({ translations, isMac, debugMode, serializationMode })};`;

        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
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
<body>
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
        const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
        this._imageUriMaps.set(uriKey, uriMap);
        return content.replace(/!\[([^\]]*)\]\(([^)\s"]+)/g, (match, alt, src) => {
            if (/^(https?:|data:|vscode-resource:|vscode-webview-)/.test(src)) { return match; }
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
                uriMap.set(webviewUri, src);
                return `![${alt}](${webviewUri}`;
            } catch {
                return match;
            }
        });
    }

    private _prepareContentForSave(content: string, uriKey: string): string {
        const frontmatter = this._frontmatterMap.get(uriKey) ?? "";
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
                const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
                this._imageUriMaps.set(uriKey, uriMap);
                uriMap.set(url, relPath);
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
            const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
            this._imageUriMaps.set(uriKey, uriMap);
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
                    uriMap.set(wvUri, relPath);
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

            // 安全化新文件名：去除非法字符，保留原扩展名
            const oldExt = path.extname(oldAbsPath);
            const safeBasename = newBasename
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
                .replace(/\.+$/, '')
                .trim();
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
            uriMap.set(newWebviewUri, newRelPath);

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
        const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
        this._imageUriMaps.set(uriKey, uriMap);
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
                        uriMap.set(webviewUri, fullPath);
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
            const uriMap = this._imageUriMaps.get(uriKey) ?? new Map<string, string>();
            this._imageUriMaps.set(uriKey, uriMap);
            uriMap.set(webviewUri, relPath);
            panel.webview.postMessage({ type: 'imagePathResolved', id, webviewUri });
        } catch { /* 路径非法，不响应 */ }
    }
}
