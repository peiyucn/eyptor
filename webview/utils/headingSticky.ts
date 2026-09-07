// ─── 吸顶条激活标题计算（纯函数，jsdom 可测） ─────────────────

export interface StickyHeadingRect {
    top: number;
    bottom: number;
}

/**
 * 计算吸顶条应显示的标题下标；-1 = 隐藏。
 *
 * 语义：吸顶「最后一个已完全滚出顶栏的标题」（当前章节标题滚出视口后提示读者）。
 * 跳转后目标标题完整可见的场景由 headingStickyPlugin 的 suppress 机制处理
 * （点击吸顶条跳转后抑制显示，用户主动滚动才恢复），几何层保持简单语义。
 */
export function computeStickyActiveIndex(
    headings: StickyHeadingRect[],
    topbarBottom: number,
): number {
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].bottom > topbarBottom) {
            // 第一个尚未完全滚出顶栏的标题：吸顶它的前一个（已滚出的）
            return i > 0 && headings[i - 1].bottom <= topbarBottom ? i - 1 : -1;
        }
    }
    // 循环无 break = 所有标题均已滚出：吸顶最后一个（文档底部）
    return headings.length - 1;
}
