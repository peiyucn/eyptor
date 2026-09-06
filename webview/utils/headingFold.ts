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
