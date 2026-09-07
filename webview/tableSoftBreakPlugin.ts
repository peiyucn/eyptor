/**
 * 表格换行解析/序列化闭环说明（2026-09-07 实证）：
 * - remark-gfm 在解析层丢弃表格单元格内的 `<br>`（mdast 信息已丢失，无法恢复）；
 *   未发布的 Milkdown #2463 正在修此问题。
 * - epytor 闭环方案（源码形态 `<br>`）：Extension 加载时把表格内 `<br>` 转为
 *   `&#10;` 实体再进解析器（convertTableBrForDisplay）→ 渲染换行；序列化侧把
 *   表格内 break 输出回 `<br>`（withTableBreakHandler）——源码 `<br>` 往返一致，
 *   GitHub 渲染同为换行。旧文件中已有的 `&#10;` 实体同样正常渲染，保存时归一为 `<br>`。
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
