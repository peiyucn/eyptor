// ─── 吸顶条激活标题计算（纯函数，jsdom 可测） ─────────────────

export interface StickyHeadingRect {
    top: number;
    bottom: number;
}

/**
 * 计算吸顶条应显示的标题下标；-1 = 隐藏。
 *
 * 语义：吸顶「当前章节」= 最后一个已完全滚出顶栏的标题。
 * 边界（回归：点击吸顶条跳回目标标题后，目标完整可见却被前一个标题的
 * 吸顶条遮挡）——仅当目标标题自身被顶栏遮挡（top < topbarBottom）时，
 * 前一个标题的吸顶才有意义；跳转后目标完整可见时返回 -1 隐藏。
 */
export function computeStickyActiveIndex(
    headings: StickyHeadingRect[],
    topbarBottom: number,
): number {
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].bottom > topbarBottom) {
            // 第一个尚未完全滚出顶栏的标题
            if (
                i > 0 &&
                headings[i - 1].bottom <= topbarBottom &&
                headings[i].top < topbarBottom
            ) {
                return i - 1;
            }
            return -1;
        }
    }
    // 循环无 break = 所有标题均已滚出：吸顶最后一个（文档底部）
    return headings.length - 1;
}
