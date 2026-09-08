import * as vscode from "vscode";
import { MarkdownEditorProvider } from "./MarkdownEditorProvider";
import { sanitizeSerializationMode } from "./utils/webviewConfigSanitize";
import type { ToWebviewMessage } from "../shared/messages";

function debugLog(...args: unknown[]): void {
    if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) {
        console.log(...args);
    }
}

/**
 * 配置变更 → WebView 广播表（表驱动，新增配置项只加一行）：
 * 每项 = 配置全限定键 + 把配置值映射为消息的函数。
 */
const CONFIG_BROADCASTS: ReadonlyArray<{
    section: string;
    message: (value: unknown) => ToWebviewMessage;
}> = [
    {
        section: "epytor.debugMode",
        message: (value) => ({ type: "setDebugMode", enabled: value === true }),
    },
    {
        section: "epytor.markdown.serializationMode",
        message: (value) => ({ type: "setSerializationMode", mode: sanitizeSerializationMode(value) }),
    },
    {
        section: "epytor.tableWrapMode",
        message: (value) => ({ type: "tableWrapModeChanged", mode: typeof value === "string" ? value : "wrap" }),
    },
];

/** 记录「workbench.editorAssociations 的 md 条目由本扩展注入」的标记（globalState） */
const INJECTED_ASSOC_KEY = "epytor.injectedEditorAssociations";
const MD_ASSOC_KEYS = ["*.md", "*.markdown"] as const;

/**
 * 根据 defaultMode 同步 workbench.editorAssociations：
 * - "source"  → 注入 "*.md"/"*.markdown": "default"（文本编辑器直接打开）
 * - "wysiwyg" → 仅删除「本扩展注入过且值仍为 default」的条目（priority:default 自动生效）
 *
 * 回归（E2）：此前 wysiwyg 分支无条件 delete 用户全局配置里的 md 条目——既无法区分
 * 「本扩展上次注入的残留」与「用户经 Reopen Editor With 主动设置的关联」，每次激活
 * 都静默抹掉用户设置。现用 globalState 标记追踪注入来源：只清理自己写的值，
 * 用户自定义关联一律不动（source 注入覆盖用户自定义时在 debug 日志留痕）。
 */
function syncEditorAssociation(mode: string, context: vscode.ExtensionContext): void {
    const wbConfig = vscode.workspace.getConfiguration("workbench");
    const current: Record<string, string> = {
        ...(wbConfig.get<Record<string, string>>("editorAssociations") ?? {}),
    };
    const injected = context.globalState.get<boolean>(INJECTED_ASSOC_KEY, false);

    if (mode === "source") {
        const overwritten = MD_ASSOC_KEYS.filter((k) => current[k] !== undefined && current[k] !== "default");
        for (const k of MD_ASSOC_KEYS) { current[k] = "default"; }
        void wbConfig.update("editorAssociations", current, vscode.ConfigurationTarget.Global);
        void context.globalState.update(INJECTED_ASSOC_KEY, true);
        if (overwritten.length > 0) {
            debugLog("[syncEditorAssociation] source 模式覆盖了用户自定义 md 关联:", overwritten.join(", "));
        }
        return;
    }

    // wysiwyg：只清理本扩展注入的条目；未注入过说明是用户自己的设置，绝不触碰
    if (!injected) { return; }
    let changed = false;
    for (const k of MD_ASSOC_KEYS) {
        if (current[k] === "default") {
            delete current[k];
            changed = true;
        }
    }
    if (changed) {
        void wbConfig.update("editorAssociations", current, vscode.ConfigurationTarget.Global);
    }
    void context.globalState.update(INJECTED_ASSOC_KEY, false);
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        MarkdownEditorProvider.register(context),
    );

    // 激活时同步一次 editorAssociations（非破坏性：只清理本扩展自己注入的值）
    const initialMode = vscode.workspace
        .getConfiguration("epytor")
        .get<string>("defaultMode", "wysiwyg");
    syncEditorAssociation(initialMode, context);

    // priority:default 下 md 直接以 WYSIWYG 打开（无「文本 tab → 转换」中间态——
    // 该转换机制曾是打开闪动/双 tab/焦点互抢的根源，见 2026-09-08 简化设计）；
    // defaultMode:"source" 由 syncEditorAssociation 注入 editorAssociations 实现。
    // 全局搜索行号由 revealLine 命令拦截 + pendingNavigation 处理（见下）。
    // 回归（E3/C2）：此处原有 onDidChangeActiveTextEditor 行号回传监听器 + 配套
    // ExpiryWindowMap 抑制窗口——监听器的存在理由是 priority:option 时代「文本 tab
    // 先开再转换」的中间态，根治后已消失；其唯一触发流程 switchToTextEditor 又被
    // 抑制窗口屏蔽，且 switchToPreview 已显式捕获当前行号（数据完全冗余），两者已删。

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
                // 目标就是当前激活的 md 面板（同文档搜索结果）→ 直接投递，立即可见；
                // directOnly 不暂存：即便此刻还是即将被替换的旧文档，也不会留下
                // 5s 陈旧条目污染后续激活
                const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
                if (activeTab?.input instanceof vscode.TabInputCustom
                    && activeTab.input.viewType === MarkdownEditorProvider.viewType) {
                    MarkdownEditorProvider.current?.setPendingNavigation(
                        activeTab.input.uri.fsPath, targetLine, { directOnly: true });
                }
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

    // 调试模式开关命令：单命令，仅写配置——状态同步（postToAll 广播）统一由下方
    // onDidChangeConfiguration 监听器处理（回归 B3：此前命令处理器与监听器双写，
    // cfg.update 触发监听后同一动作执行两遍、每个面板收到两条相同消息）
    const toggleDebugMode = () => {
        const cfg = vscode.workspace.getConfiguration("epytor");
        cfg.update(
            "debugMode",
            !cfg.get<boolean>("debugMode", false),
            vscode.ConfigurationTarget.Global,
        );
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("epytor.toggleDebugMode", toggleDebugMode),
    );

    // 监听设置手动变更（从 VSCode 设置 UI 修改时同步）
    // 简单广播项用表驱动（回归 E10：此前每项一段同构分支，新增配置要复制第四份；
    // tableWrapMode 原在 Provider.register 内另设一份监听，现统一到此处）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("epytor.defaultMode")) {
                const mode = vscode.workspace
                    .getConfiguration("epytor")
                    .get<string>("defaultMode", "wysiwyg");
                syncEditorAssociation(mode, context);
            }
            for (const item of CONFIG_BROADCASTS) {
                if (!e.affectsConfiguration(item.section)) { continue; }
                const value = vscode.workspace.getConfiguration().get(item.section);
                MarkdownEditorProvider.current?.postToAll(item.message(value));
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
                // 回归 E6：此前判据是 `if (provider)`（激活后恒真）——该文档没有打开的面板时
                // 命令静默空转；改为真实面板检查，无面板时走下面的兜底
                if (provider?.hasPanel(target)) {
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
                // 读取文本编辑器 tab 的 preview 状态和所在列（兜底路径用）
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
                // 原地替换编辑器类型（与 VS Code 内置 markdown.togglePreview 同一机制：
                // `reopenActiveEditorWith`）——标签不重建、不新增，切换零闪动。
                // 回归（用户实测：切回预览会闪、还闪出同名标签再消失、标签跳到末尾）：
                // 此前「关文本 tab 再 openWith」= 重建整个 webview，冷启动必闪。
                try {
                    await vscode.commands.executeCommand(
                        "reopenActiveEditorWith",
                        MarkdownEditorProvider.viewType,
                    );
                } catch {
                    // 兜底（旧版 VS Code 无该命令）：关文本 tab 再打开预览
                    if (textTab) {
                        await vscode.window.tabGroups.close(textTab);
                    }
                    await vscode.commands.executeCommand(
                        "vscode.openWith",
                        target,
                        MarkdownEditorProvider.viewType,
                        { viewColumn: viewCol, preview: isPreview },
                    );
                }
            },
        ),
    );
}

export function deactivate() {}
