/**
 * 表格软换行插件：单元格内 Shift+Enter 插入 hardbreak（序列化为 <br>）。
 *
 * 背景（2026-09-04 实证）：官方 tableKeymap 将单元格内 Enter/Shift-Enter
 * 均绑定 goToNextCell（跳转下一单元格），无软换行能力；table_cell schema
 * 支持 hardbreak 节点。本插件在单元格内拦截 Shift-Enter。
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
