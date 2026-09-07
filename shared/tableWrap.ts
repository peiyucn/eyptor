// ─── 表格换行三档映射（Extension 与 WebView 共用） ──────────
// Extension 端（Node）和 WebView 端（Browser）均可 import

export type TableWrapMode = "normal" | "aggressive" | "none";

export interface TableWrapVars {
    /** th/td 的 word-break */
    wordBreak: "keep-all" | "break-all";
    /** th/td 的 white-space */
    whiteSpace: "normal" | "nowrap";
    /** 表格外层 .milkdown-table-block 的 overflow-x */
    overflowX: "visible" | "auto";
    /** table 元素宽度：none 档 max-content 让 nowrap 内容撑开表格触发横向滚动 */
    tableWidth: "auto" | "max-content";
}

/**
 * 三档语义：
 * - normal：CJK 不拆词、长词折行（word-break: keep-all + overflow-wrap）
 * - aggressive：任意字符断行（word-break: break-all）
 * - none：不换行 + 横向滚动（white-space: nowrap + table max-content + overflow-x: auto）
 * 未知值安全回退到 normal。
 */
export function resolveTableWrapVars(mode: string): TableWrapVars {
    switch (mode) {
        case "aggressive":
            return { wordBreak: "break-all", whiteSpace: "normal", overflowX: "visible", tableWidth: "auto" };
        case "none":
            return { wordBreak: "keep-all", whiteSpace: "nowrap", overflowX: "auto", tableWidth: "max-content" };
        default:
            return { wordBreak: "keep-all", whiteSpace: "normal", overflowX: "visible", tableWidth: "auto" };
    }
}
