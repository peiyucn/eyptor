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
 * 标题结构签名（pos:level:size:text;... + 可选折叠状态）。
 * 用于判断折叠装饰 / TOC 是否需要重建：输入正文（最常见）签名不变，
 * 可完全跳过 O(n) 重建（根源级性能优化，替代"防抖延时"式的开销推迟）。
 * 只枚举**顶层**标题——折叠装饰只作用于顶层（与 buildHeadingIndex 的 topLevel 口径一致）；
 * 需要覆盖嵌套标题的场景用 computeAllHeadingSignature。
 */
export function computeHeadingSignature(
    doc: ProseNode,
    folded?: ReadonlySet<number>,
): string {
    let sig = "";
    doc.forEach((node, offset) => {
        if (!isHeadingNode(node)) return;
        sig += `${offset}:${getHeadingLevel(node)}:${node.nodeSize}:${node.textContent};`;
    });
    if (folded) {
        sig += "|fold:";
        for (const pos of Array.from(folded).sort((a, b) => a - b)) sig += `${pos},`;
    }
    return sig;
}

/** 标题索引项（P1：折叠 / 吸顶 / TOC 共用同一枚举与身份口径） */
export interface HeadingIndexEntry {
    /** 节点起始位置（= 折叠状态键 = doc.forEach 的 offset） */
    pos: number;
    level: number;
    text: string;
    /** 节点大小（折叠范围与装饰区间用） */
    size: number;
    /** 顶层标题（父节点为 doc）：折叠与吸顶只处理顶层 */
    topLevel: boolean;
    /** 折叠范围（仅顶层标题；无后续块/无内容为 null） */
    foldRange: HeadingFoldRange | null;
}

/**
 * 单遍构建标题索引：一趟遍历产出全部标题（含嵌套），顶层标题附带折叠范围。
 *
 * 口径：pos 一律是「节点起始位置」；顶层判定用 `resolve(pos + 1)`（位置落在节点内部，
 * 顶层标题的 depth 恒为 1）——回归：直接用 pos 判定得到 depth 0，与吸顶的
 * `posAtDOM(元素, 0)`（= 元素起始 + 1）语义差 1，历史上已因此出过两次回归。
 */
export function buildHeadingIndex(doc: ProseNode): HeadingIndexEntry[] {
    const ranges = computeAllHeadingFoldRanges(doc);
    const entries: HeadingIndexEntry[] = [];
    doc.descendants((node, pos) => {
        if (!isHeadingNode(node)) return;
        const topLevel = doc.resolve(pos + 1).depth === 1;
        entries.push({
            pos,
            level: getHeadingLevel(node),
            text: node.textContent,
            size: node.nodeSize,
            topLevel,
            foldRange: topLevel ? (ranges.get(pos) ?? null) : null,
        });
    });
    return entries;
}

/**
 * 全部标题（含嵌套）签名：TOC 刷新判据。
 * 回归 P1：此前 TOC 复用只覆盖顶层标题的 computeHeadingSignature——只改嵌套标题
 * （引用/列表内的标题）时签名不变，TOC 静默不刷新。
 */
export function computeAllHeadingSignature(doc: ProseNode): string {
    let sig = "";
    doc.descendants((node, pos) => {
        if (!isHeadingNode(node)) return;
        sig += `${pos}:${getHeadingLevel(node)}:${node.nodeSize}:${node.textContent};`;
    });
    return sig;
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
