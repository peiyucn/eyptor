/**
 * 外部写盘回退决策（纯函数，无 VSCode 依赖，可单测）。
 *
 * 背景（回归）：旧逻辑比较「webview 最新内容」与「新盘内容」——外部修改发生后二者
 * 几乎必然不同，于是永远走「保留用户内容」分支：外部写盘（AI 工具/其他编辑器）在
 * 面板打开期间永远无法被采纳，且内存被静默置脏（VS Code 不知情），用户下一次保存
 * 会用旧内容覆盖外部写入（数据丢失）。
 *
 * 正确判定「用户是否有未落盘编辑」：webview 最新内容 vs「上次已知盘内容」快照
 * （外部写盘前的盘上内容）。快照未播种时（watcher 注册即播种，理论不可达）回退为
 * revert 前内存比较，宁可保守保留用户内容。
 */

export interface ExternalChangeContext {
    /**
     * webview 是否有未落盘编辑（由 webview 的 markDirty 轻量标记维护，保存/采纳后清零）。
     * **不要**改用内容比较：webview 交回的是**序列化结果**，会做 Markdown 规范化
     * （如 `~` → `\~`），与盘上原文不可能逐字节相同。
     */
    webviewDirty: boolean;
}

export interface ExternalChangeDecision {
    /** true = 用户有未落盘编辑，保留 webview 内容并标记 dirty */
    keepUserContent: boolean;
}

export function decideExternalChange(ctx: ExternalChangeContext): ExternalChangeDecision {
    return { keepUserContent: ctx.webviewDirty };
}
