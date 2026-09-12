import { $prose } from "@milkdown/kit/utils";
import { schemaCtx } from "@milkdown/kit/core";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { NodeType, ResolvedPos } from "@milkdown/kit/prose/model";

/**
 * 列表项行首 Backspace 的落点修正。
 *
 * 背景（手测反馈 2026-09-12：「退格键退到删除行时，光标上移错位比较严重，上下位置不能动」）：
 * Crepe 的 `list_item` schema 允许一项内含多段（`paragraph block*`），于是 ProseMirror 默认的
 * `joinBackward` 在列表里是**按项合并**——空项不会被删除，而是变成上一项里的第二个空段落，
 * 光标随即停在那个空段落上（视觉上像上移，且 PM 自己会报
 * 「TextSelection endpoint not pointing into a node with inline content」）；任务列表还会把
 * 标记漏进正文。
 *
 * 规则（与常见编辑器一致；编号仍由 Crepe 依项序重算，本插件不碰编号）：
 * - **空项**：删除该项，光标落到上一项文字的末尾；
 * - **非空项**：把它的文字并进上一项（同一行接续），光标落在接缝处；
 * - **已是第一项**：不拦截，交回默认命令（提升为普通段落 / 与前一块合并）；
 * - **光标不在项内第一个文本块、项内含多块、上一项末尾不是文字**：不拦截，交回默认行为。
 */

/** 任务标记字面量：上游解析器对「复选框后无内容」的项不识别复选框，把标记留成了正文文本
 * （详见 docs/upstream-limits.md 第 5 项）。这类项在退格语义上等同于空项。 */
const TASK_MARKER_ONLY = /^\[[ xX]\]$/;

/** 段落是否「实质为空」（真空段，或只剩上游留下的任务标记） */
function isEffectivelyEmpty(text: string): boolean {
    return text.length === 0 || TASK_MARKER_ONLY.test(text.trim());
}

/** 从光标位置向上找到 list_item 所在深度（找不到返回 -1） */
function listItemDepth($from: ResolvedPos, listItem: NodeType): number {
    for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type === listItem) { return depth; }
    }
    return -1;
}

export const listBackspacePlugin = $prose((ctx) => {
    const listItem = ctx.get(schemaCtx).nodes["list_item"];
    if (!listItem) { return new Plugin({}); }

    return keymap({
        Backspace: (state, dispatch) => {
            const { selection } = state;
            if (!selection.empty) { return false; }
            const { $from } = selection;
            if ($from.parentOffset !== 0 || !$from.parent.isTextblock) { return false; }

            const itemDepth = listItemDepth($from, listItem);
            if (itemDepth < 0) { return false; }
            // 光标必须在项内第一个文本块，且该项只含这一个块（松列表/多项交回默认行为）
            if ($from.index(itemDepth) !== 0) { return false; }
            if ($from.node(itemDepth).childCount !== 1) { return false; }

            const itemIndex = $from.index(itemDepth - 1);
            // 第一项：默认命令负责（提升为普通段落 / 与前一块合并）
            if (itemIndex === 0) { return false; }
            // 上一项末尾必须是文字，接缝才落得进去（代码块、嵌套列表等交回默认行为）
            if (!$from.node(itemDepth - 1).child(itemIndex - 1).lastChild?.isTextblock) { return false; }

            const itemStart = $from.before(itemDepth);
            const itemEnd = $from.after(itemDepth);
            // 上一项最后一个文本块的文字末尾（项内容末尾的前一位）
            const joinPos = itemStart - 2;
            if (!state.doc.resolve(joinPos).parent.isTextblock) { return false; }

            const isEmpty = isEffectivelyEmpty($from.parent.textContent);
            if (!dispatch) { return true; }

            const content = $from.parent.content;
            const tr = state.tr.delete(itemStart, itemEnd);
            // 非空项：把文字并进上一项同一行（接缝即 joinPos，光标落在接缝处）
            if (!isEmpty) { tr.insert(joinPos, content); }
            tr.setSelection(TextSelection.create(tr.doc, joinPos));
            dispatch(tr.scrollIntoView());
            return true;
        },
    });
});
