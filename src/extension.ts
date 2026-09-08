import * as vscode from "vscode";
import { MarkdownEditorProvider } from "./MarkdownEditorProvider";

function debugLog(...args: unknown[]): void {
    if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) {
        console.log(...args);
    }
}

/**
 * 根据 defaultMode 同步 workbench.editorAssociations：
 * - "source"  → 注入 "*.md"/"*.markdown": "default"，让文本编辑器直接打开，不触发自定义编辑器
 * - "wysiwyg" → 删除上述条目，恢复 package.json 中 priority:default 生效
 */
function syncEditorAssociation(mode: string): void {
    const wbConfig = vscode.workspace.getConfiguration("workbench");
    const current: Record<string, string> = {
        ...(wbConfig.get<Record<string, string>>("editorAssociations") ?? {}),
    };
    if (mode === "source") {
        current["*.md"] = "default";
        current["*.markdown"] = "default";
    } else {
        // preview 模式：删除 association，依赖 package.json 的 priority:default 自动生效
        delete current["*.md"];
        delete current["*.markdown"];
    }
    wbConfig.update("editorAssociations", current, vscode.ConfigurationTarget.Global);
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        MarkdownEditorProvider.register(context),
    );

    // 激活时同步一次 editorAssociations
    const initialMode = vscode.workspace
        .getConfiguration("epytor")
        .get<string>("defaultMode", "wysiwyg");
    syncEditorAssociation(initialMode);

    // priority:default 下 md 直接以 WYSIWYG 打开（无「文本 tab → 转换」中间态——
    // 该转换机制曾是打开闪动/双 tab/焦点互抢的根源，见 2026-09-08 简化设计）；
    // defaultMode:"source" 由 syncEditorAssociation 注入 editorAssociations 实现。
    // 全局搜索行号由 revealLine 命令拦截 + pendingNavigation 处理（见下）。

    // 监听文本编辑器激活事件：捕获全局搜索导航时短暂出现的 .md 文本编辑器光标位置
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) { return; }
            const { uri } = editor.document;
            if (!uri.fsPath.endsWith('.md')) { return; }
            // 切换到文本编辑器期间（按文档抑制窗口），跳过行号回传
            // 避免主动切走时行号被反馈给 WebView 触发多余的 scrollToLine
            if (MarkdownEditorProvider.current?.isNavFromTextEditorSuppressed(uri.toString())) { return; }
            const line = editor.selection.active.line + 1; // 转为 1-indexed
            if (line >= 1) {
                MarkdownEditorProvider.current?.setPendingNavigation(uri.fsPath, line);
            }
        }),
    );

    // 拦截 revealLine 命令：全局搜索点击结果时 VS Code 会调此命令导航到指定行。
    // 归属由「谁持有 activeTextEditor」自然区分：
    //   - md 自定义编辑器结果 → activeTextEditor 为 undefined → 行号经全局兜底槽由
    //     面板 ready / viewState 激活时消费（下方 revealRange 分支天然 no-op）
    //   - 文本编辑器结果（含 source 模式 md、.ts/.js 等）→ revealRange 直接定位
    // 回归（E1）：此前只要存在任一 md 面板就把行号广播给全部面板并提前 return，
    // 导致非 md 搜索跳转被吞（落到文件头）且其它 md 文档被错误滚动到该行号。
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'revealLine',
            (args: { lineNumber: number; at?: string }) => {
                debugLog('[revealLine] 触发，lineNumber:', args.lineNumber, 'at:', args.at);
                const targetLine = args.lineNumber + 1; // 转为 1-indexed
                // 全局兜底槽：md 面板 ready / viewState 激活时消费（10s TTL）
                MarkdownEditorProvider.current?.setGlobalRevealLine(targetLine);
                // 文本编辑器兜底：无条件执行（custom md tab 激活时 activeTextEditor 为 undefined，天然 no-op）
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pos = new vscode.Position(args.lineNumber, 0);
                    const revealType =
                        args.at === 'top' ? vscode.TextEditorRevealType.AtTop
                        : args.at === 'center' ? vscode.TextEditorRevealType.InCenter
                        : vscode.TextEditorRevealType.Default;
                    editor.revealRange(new vscode.Range(pos, pos), revealType);
                }
            },
        ),
    );

    // 调试模式：初始化 context 变量
    const initialDebug = vscode.workspace
        .getConfiguration("epytor")
        .get<boolean>("debugMode", false);
    vscode.commands.executeCommand(
        "setContext",
        "epytor.debugModeActive",
        initialDebug,
    );

    // 调试模式开关命令（两个互斥命令，通过 when 条件切换显示，实现 ✓ 前缀效果）
    const toggleDebugMode = () => {
        const cfg = vscode.workspace.getConfiguration("epytor");
        const next = !cfg.get<boolean>("debugMode", false);
        cfg.update("debugMode", next, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand(
            "setContext",
            "epytor.debugModeActive",
            next,
        );
        MarkdownEditorProvider.current?.postToAll({
            type: "setDebugMode",
            enabled: next,
        });
    };
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.debugModeEnable",
            toggleDebugMode,
        ),
        vscode.commands.registerCommand(
            "epytor.debugModeDisable",
            toggleDebugMode,
        ),
    );

    // 监听设置手动变更（从 VSCode 设置 UI 修改时同步）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("epytor.defaultMode")) {
                const mode = vscode.workspace
                    .getConfiguration("epytor")
                    .get<string>("defaultMode", "wysiwyg");
                syncEditorAssociation(mode);
            }
            if (e.affectsConfiguration("epytor.debugMode")) {
                const v = vscode.workspace
                    .getConfiguration("epytor")
                    .get<boolean>("debugMode", false);
                vscode.commands.executeCommand(
                    "setContext",
                    "epytor.debugModeActive",
                    v,
                );
                MarkdownEditorProvider.current?.postToAll({
                    type: "setDebugMode",
                    enabled: v,
                });
            }
            if (e.affectsConfiguration("epytor.markdown.serializationMode")) {
                const mode = vscode.workspace
                    .getConfiguration("epytor")
                    .get<"clean" | "compatible">("markdown.serializationMode", "clean");
                MarkdownEditorProvider.current?.postToAll({
                    type: "setSerializationMode",
                    mode,
                });
            }
        }),
    );

    // 关闭预览：WYSIWYG → 文本编辑器
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.switchToTextEditor",
            async (uri?: vscode.Uri) => {
                let target =
                    uri ?? vscode.window.activeTextEditor?.document.uri;
                if (!target) {
                    // Custom Editor 激活时 activeTextEditor 为 undefined，从 tab 组找活跃的 CustomEditor tab
                    for (const group of vscode.window.tabGroups.all) {
                        const activeTab = group.activeTab;
                        if (activeTab?.input instanceof vscode.TabInputCustom) {
                            target = (activeTab.input as vscode.TabInputCustom).uri;
                            break;
                        }
                    }
                }
                if (!target) { return; }

                const provider = MarkdownEditorProvider.current;
                // 向 WebView 请求当前滚动行号：WebView 上报位置后回发 switchToTextEditor 消息，
                // 由 Provider 落盘最新内容、关闭 WYSIWYG tab、再以文本编辑器打开并定位到该行
                // （携带行号 + 拉取式架构下必须先落盘；与 Cmd+Shift+M 快捷键行为一致）
                if (provider) {
                    provider.postToPanel(target, { type: "requestSwitchToTextEditor" });
                    return;
                }

                // 兜底：面板不存在时，直接打开文本编辑器（不携带行号）
                await vscode.commands.executeCommand("vscode.openWith", target, "default");
            },
        ),
    );

    // 打开预览：文本编辑器 → WYSIWYG
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.switchToPreview",
            async (uri?: vscode.Uri) => {
                const activeEditor = vscode.window.activeTextEditor;
                const target = uri ?? activeEditor?.document.uri;
                if (!target) {
                    return;
                }
                // 切换前保存当前光标行号，供 WYSIWYG 面板激活时定位
                const currentLine = activeEditor?.selection.active.line ?? -1;
                if (currentLine >= 0) {
                    MarkdownEditorProvider.current?.setPendingNavigation(target.fsPath, currentLine + 1);
                }
                // 读取文本编辑器 tab 的 preview 状态和所在列，关闭前保存
                let isPreview = false;
                let viewCol: vscode.ViewColumn = vscode.ViewColumn.Active;
                let textTab: vscode.Tab | undefined;
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (
                            tab.input instanceof vscode.TabInputText &&
                            (tab.input as vscode.TabInputText).uri.toString() === target.toString()
                        ) {
                            isPreview = tab.isPreview;
                            viewCol = group.viewColumn;
                            textTab = tab;
                            break;
                        }
                    }
                }
                // 先关文本编辑器 tab，再开 WYSIWYG，避免两个 tab 并存的闪烁
                if (textTab) {
                    await vscode.window.tabGroups.close(textTab);
                }
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    target,
                    MarkdownEditorProvider.viewType,
                    { viewColumn: viewCol, preview: isPreview },
                );
            },
        ),
    );
}

export function deactivate() {}
