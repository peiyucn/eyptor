/**
 * 列表 spread 规范化（纯逻辑，供 editor.ts 的插件调用）。
 *
 * 单独成文件的理由：区间换算这条路径出过一次严重回归（中文输入法提交后撤销整体失效），
 * 而它当时只能通过「起一个完整编辑器 + 敲键 + 撤销」间接覆盖。换算与规范化都是纯函数，
 * 拆出来后可以直测边界（多步事务、越界、空变更）。
 */
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import type { StepMap } from "@milkdown/kit/prose/transform";
import type { Transaction } from "@milkdown/kit/prose/state";

/** 把位置依次穿过 maps[start..] 映射到最终文档坐标 */
function mapThrough(maps: readonly StepMap[], start: number, pos: number, assoc: number): number {
    let result = pos;
    for (let i = start; i < maps.length; i++) { result = maps[i].map(result, assoc); }
    return result;
}

/**
 * 把事务里所有变更区间换算到**最终文档**坐标。
 *
 * 为什么需要换算：每步 StepMap 给出的 newStart/newEnd 是「该步之后」的坐标；多步事务里
 * 中间步骤可能让文档先变长再变短（中文输入法提交就是典型：先插入拼音、再替换成候选词），
 * 直接把这些位置用在最终文档上会越过文档末尾。
 *
 * 返回值已钳制到 `[0, docSize]`；无变更或区间不可用时返回 null。
 */
export function changeRangeInFinalDoc(
    transactions: readonly Transaction[],
    docSize: number,
): { from: number; to: number } | null {
    const maps: StepMap[] = [];
    for (const tr of transactions) {
        if (!tr.docChanged) { continue; }
        for (const step of tr.steps) { maps.push(step.getMap()); }
    }
    if (!maps.length) { return null; }

    let from = docSize;
    let to = 0;
    maps.forEach((map, i) => {
        map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const mappedFrom = mapThrough(maps, i + 1, newStart, 1);
            const mappedTo = mapThrough(maps, i + 1, newEnd, -1);
            if (mappedFrom < from) { from = mappedFrom; }
            if (mappedTo > to) { to = mappedTo; }
        });
    });

    // 兜底钳制：换算已是精确的，这里只是防线——越界会让 nodesBetween 读到 undefined
    from = Math.max(0, Math.min(from, docSize));
    to = Math.max(0, Math.min(to, docSize));
    return from > to ? null : { from, to };
}

/**
 * 把区间内「只含单个块级子节点」的列表项与列表的 spread 收回 false。
 * 返回是否有改动（调用方据此决定要不要 dispatch 那个 tr）；异常一律吞掉——
 * 属性整理是 best-effort，绝不能因此打掉用户事务（历史教训：撤销「没反应」）。
 */
export function normalizeListSpread(
    doc: ProseNode,
    schema: Schema,
    tr: Transaction,
    range: { from: number; to: number },
): boolean {
    let changed = false;
    try {
        doc.nodesBetween(range.from, range.to, (node, pos) => {
            if (node.type !== schema.nodes.bullet_list && node.type !== schema.nodes.ordered_list) {
                return;
            }
            let listNeedsSpread = false;
            let offset = 1;
            node.forEach((item) => {
                const itemNeedsSpread = item.childCount > 1;
                if (item.attrs.spread !== itemNeedsSpread) {
                    tr.setNodeMarkup(pos + offset, undefined, { ...item.attrs, spread: itemNeedsSpread });
                    changed = true;
                }
                if (itemNeedsSpread) { listNeedsSpread = true; }
                offset += item.nodeSize;
            });
            if (node.attrs.spread !== listNeedsSpread) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, spread: listNeedsSpread });
                changed = true;
            }
        });
    } catch {
        return false;
    }
    return changed;
}
