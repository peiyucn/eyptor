/**
 * 表格换行解析/序列化闭环说明（2026-09-07 实证）：
 * - remark-gfm 在解析层丢弃表格单元格内的 `<br>`（mdast 信息已丢失，无法恢复）；
 *   未发布的 Milkdown #2463 正在修此问题。
 * - epytor 闭环方案：序列化侧把表格内 break 输出为 `&#10;` 实体（withTableBreakHandler），
 *   GFM 合法、GitHub 渲染为换行、remark 解析为含 `\n` 的 text、ProseMirror 渲染换行——
 *   往返一致。旧文件中已有的 `<br>` 加载丢失仍为上游限制（升级后解决）。
 */
import { keymap } from "@milkdown/kit/prose/keymap";
import { schemaCtx } from "@milkdown/kit/core";
import { $prose } from "@milkdown/kit/utils";

export const tableSoftBreakPlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return keymap({
        "Shift-Enter": (state, dispatch) => {
            const { $from } = state.selection;
            let inCell = false;
            for (let d = $from.depth; d >= 0; d--) {
                const name = $from.node(d).type.name;
                if (name === "table_cell" || name === "table_header") {
                    inCell = true;
                    break;
                }
            }
            if (!inCell) return false; // 放行默认 splitBlock

            const hardbreak = schema.nodes["hardbreak"];
            if (!hardbreak) return false;
            if (dispatch) {
                dispatch(state.tr.replaceSelectionWith(hardbreak.create()).scrollIntoView());
            }
            return true;
        },
    });
});
