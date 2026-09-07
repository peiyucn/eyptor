// ─── 表格换行 CSS 变量应用（WebView 侧，jsdom 可测） ─────────
import type { TableWrapVars } from "../../shared/tableWrap";

const VAR_NAMES = {
    wordBreak: "--epytor-table-word-break",
    whiteSpace: "--epytor-table-white-space",
    overflowX: "--epytor-table-overflow-x",
    tableWidth: "--epytor-table-width",
} as const;

/** 将三档映射结果写到 :root（documentElement）CSS 变量，即时生效无需重载 */
export function applyTableWrapVars(vars: TableWrapVars): void {
    const root = document.documentElement;
    root.style.setProperty(VAR_NAMES.wordBreak, vars.wordBreak);
    root.style.setProperty(VAR_NAMES.whiteSpace, vars.whiteSpace);
    root.style.setProperty(VAR_NAMES.overflowX, vars.overflowX);
    root.style.setProperty(VAR_NAMES.tableWidth, vars.tableWidth);
}
