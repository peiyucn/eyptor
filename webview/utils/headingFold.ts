/**
 * 标题折叠纯逻辑（无 DOM 依赖，可单元测试）。
 */
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

export interface HeadingFoldRange {
    from: number;
    to: number;
}

export function isHeadingNode(
    node: ProseNode | null | undefined,
): node is ProseNode {
    return node?.type.name === "heading";
}

export function getHeadingLevel(node: { attrs?: Record<string, unknown> }): number {
    const level = node.attrs?.["level"];
    return typeof level === "number" ? level : 1;
}

/**
 * 计算标题的折叠范围：标题之后到下一个「层级 ≤ 当前」的标题之前；
 * 无后续同级/更高级标题则到文档尾；标题无内容时返回 null（不可折叠）。
 */
export function findHeadingFoldRange(
    doc: ProseNode,
    headingPos: number,
    headingLevel: number,
): HeadingFoldRange | null {
    const headingNode = doc.nodeAt(headingPos);
    if (!isHeadingNode(headingNode)) return null;

    const from = headingPos + headingNode.nodeSize;
    let to = doc.content.size;
    doc.forEach((node, offset) => {
        if (offset <= headingPos || !isHeadingNode(node)) return;
        if (getHeadingLevel(node) <= headingLevel && to === doc.content.size) {
            to = offset;
        }
    });

    return from < to ? { from, to } : null;
}

/**
 * 单遍计算所有标题的折叠范围（O(n)）。
 * 回归：buildFoldDecorations 曾对每个标题调用 findHeadingFoldRange（内部全量扫描），
 * 1 万行文档 O(n²) 实测 315ms/次（jsdom），每键输入重建 decorations 即输入卡顿主因。
 * 栈式算法：遍历块，当前标题截断栈中所有层级 ≥ 自身的等待标题（与
 * findHeadingFoldRange 语义完全一致：下一个 level ≤ 当前的标题为截断点）。
 */
export function computeAllHeadingFoldRanges(
    doc: ProseNode,
): Map<number, HeadingFoldRange | null> {
    const ranges = new Map<number, HeadingFoldRange | null>();
    const stack: { pos: number; level: number; size: number }[] = [];

    doc.forEach((node, offset) => {
        if (!isHeadingNode(node)) return;
        const level = getHeadingLevel(node);
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            const top = stack.pop()!;
            const from = top.pos + top.size;
            ranges.set(top.pos, from < offset ? { from, to: offset } : null);
        }
        stack.push({ pos: offset, level, size: node.nodeSize });
    });

    for (const top of stack) {
        const to = doc.content.size;
        const from = top.pos + top.size;
        ranges.set(top.pos, from < to ? { from, to } : null);
    }
    return ranges;
}
