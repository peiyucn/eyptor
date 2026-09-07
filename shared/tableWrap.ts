// ─── 表格换行两档映射（Extension 与 WebView 共用） ──────────
// Extension 端（Node）和 WebView 端（Browser）均可 import

export type TableWrapMode = "wrap" | "nowrap";

export interface TableWrapVars {
    /** th/td 的 word-break */
    wordBreak: "keep-all" | "break-all";
    /** th/td 的 white-space */
    whiteSpace: "normal" | "nowrap";
    /** 表格外层滚动容器（.ProseMirror:has(>table)）的 overflow-x */
    overflowX: "visible" | "auto";
    /** table 元素宽度：nowrap 档 max-content 让内容撑开表格触发横向滚动 */
    tableWidth: "auto" | "max-content";
}

/**
 * 两档语义（2026-09-07 用户决策：三档简化为两档）：
 * - wrap（默认）：任意字符处断行（word-break: break-all），适合长 URL/代码
 * - nowrap：不换行 + 横向滚动（white-space: nowrap + table max-content + overflow-x: auto）
 *
 * 旧档位迁移：aggressive/normal/未知值 → wrap；none → nowrap
 * （旧配置无需手动改，行为自动落到两档）。
 */
export function resolveTableWrapVars(mode: string): TableWrapVars {
    switch (mode) {
        case "nowrap":
        case "none":
            return { wordBreak: "keep-all", whiteSpace: "nowrap", overflowX: "auto", tableWidth: "max-content" };
        default:
            return { wordBreak: "break-all", whiteSpace: "normal", overflowX: "visible", tableWidth: "auto" };
    }
}
