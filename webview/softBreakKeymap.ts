/**
 * 软换行键位（Shift+Enter → hardbreak）。
 *
 * 回归（用户实测反馈）：改用上游 hardbreakKeymap + hardbreakFilterNodes 配置后，
 * 「行尾已有 hardbreak 再按 Shift+Enter」会被上游 insertHardbreakCommand 替换为
 * 段落（转段落）——在表格单元格内反直觉，用户预期再按一次就是再换一行。
 * 本键位始终插入 hardbreak；代码块内返回 false 放行上游默认（上游过滤器拦截）。
 *
 * 与上游的差异仅「行尾已有 hardbreak 时」这一点；表格内允许 hardbreak 由
 * editor.ts 的 hardbreakFilterNodes 配置负责（本键位不设 "hardbreak" meta，
 * 不受该过滤器影响）。
 */
import { schemaCtx } from "@milkdown/kit/core";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";

export const softBreakKeymap = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return keymap({
        "Shift-Enter": (state, dispatch) => {
            const { $from } = state.selection;
            for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type.name === "code_block") return false;
            }
            const hardbreak = schema.nodes["hardbreak"];
            if (!hardbreak) return false;
            if (dispatch) {
                dispatch(state.tr.replaceSelectionWith(hardbreak.create()).scrollIntoView());
            }
            return true;
        },
    });
});
