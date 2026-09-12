import { $prose } from "@milkdown/kit/utils";
import { schemaCtx } from "@milkdown/kit/core";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { Transaction } from "@milkdown/kit/prose/state";
import { Plugin } from "@milkdown/kit/prose/state";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import type { NodeType, ResolvedPos } from "@milkdown/kit/prose/model";

/**
 * 列表项行首 Backspace：**断开列表，把该项变成普通行**（不是并入上一项，也不是删掉整行）。
 *
 * 手测反馈（2026-09-12，两轮）：
 * ① 「退格键退到删除行的时候，光标上移错位比较严重，上下位置不能动」——Crepe 的 `list_item`
 *    schema 允许一项内含多段（`paragraph block*`），ProseMirror 默认的 `joinBackward` 因此在
 *    列表里按「项」合并：空项变成上一项里的第二个空段落，光标停在那一段上（PM 自己还会报
 *    「TextSelection endpoint not pointing into a node with inline content」）；
 * ② 「列表退格不应该是直接删除标号并回到上一行，而是应该断开列表变成正常行」。
 *
 * 所以走官方 `liftListItem`：顶层项 → 升为普通段落（列表就此断开），嵌套项 → 上升一级。
 *
 * **断出来的后半段要补起始编号**：`liftListItem` 分裂列表时把原 `order` 原样复制给后半段，
 * 于是「1. a / b / 1. c」——这正是此前撤掉自定义 lift 的原因（用户反馈「中间删除一行后编号
 * 重新开始」）。这里按被提升项原本的序号 +1 写回后半段的 `order`，编号得以延续。
 */

/** 从光标位置向上找到 list_item 所在深度（找不到返回 -1） */
function listItemDepth($from: ResolvedPos, listItem: NodeType): number {
    for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type === listItem) { return depth; }
    }
    return -1;
}

/**
 * 提升之后：若紧接着出现的有序列表是本次分裂产生的后半段，把它的起始编号写成 `order`。
 * 位置直接取自提升后光标所在段落的下一个兄弟——不依赖任何位置映射。
 */
function withContinuationOrder(tr: Transaction, order: number): Transaction {
    const { $from } = tr.selection;
    if (!$from.parent.isTextblock || $from.depth < 1) { return tr; }
    const parentDepth = $from.depth - 1;
    const parent = $from.node(parentDepth);
    const nextIndex = $from.index(parentDepth) + 1;
    if (nextIndex >= parent.childCount) { return tr; }
    const next = parent.child(nextIndex);
    if (next.type.name !== "ordered_list") { return tr; }
    return tr.setNodeMarkup($from.after($from.depth), undefined, { ...next.attrs, order });
}

export const listBackspacePlugin = $prose((ctx) => {
    const listItem = ctx.get(schemaCtx).nodes["list_item"];
    if (!listItem) { return new Plugin({}); }
    const lift = liftListItem(listItem);

    return keymap({
        Backspace: (state, dispatch) => {
            const { selection } = state;
            if (!selection.empty) { return false; }
            const { $from } = selection;
            if ($from.parentOffset !== 0 || !$from.parent.isTextblock) { return false; }
            const itemDepth = listItemDepth($from, listItem);
            if (itemDepth < 0) { return false; }
            // 只在项内第一个文本块的行首介入（项内多块时交回默认行为）
            if ($from.index(itemDepth) !== 0) { return false; }

            const listNode = $from.node(itemDepth - 1);
            const itemIndex = $from.index(itemDepth - 1);
            const continues = listNode.type.name === "ordered_list" && itemIndex + 1 < listNode.childCount;
            const order = Number(listNode.attrs.order ?? 1) + itemIndex + 1;

            return lift(
                state,
                dispatch
                    ? (tr) => { dispatch(continues ? withContinuationOrder(tr, order) : tr); }
                    : undefined,
            );
        },
    });
});
