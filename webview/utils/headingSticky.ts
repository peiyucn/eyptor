// ─── 吸顶行计算（纯函数，jsdom 可测） ─────────────────

export interface StickyHeadingRect {
    /** 嵌套深度（1 = 顶层标题，2 = 其子标题……） */
    depth: number;
    /** 视口坐标：标题顶边 */
    top: number;
    /** 视口坐标：本标题「章节」的底边（下一个 level ≤ 本标题 的标题顶边；文档末尾取内容底边） */
    sectionBottom: number;
}

/** 吸顶行高（px）——与 CSS 的 --epytor-sticky-row-height 同源 */
export const STICKY_ROW_HEIGHT_PX = 22;
/** 最多显示几级（超过会挤占阅读空间） */
export const STICKY_MAX_ROWS = 3;

/**
 * 计算吸顶行应显示的标题下标（外层 → 内层），空数组 = 不吸顶。
 *
 * 几何口径对齐 VS Code 内置编辑器的吸顶滚动（stickyScrollController.findScrollWidgetState）：
 * 第 d 层的吸顶行画在 `topbarBottom + (d-1) * rowHeight`，当且仅当
 * **「标题顶边 < 该行 y ≤ 本章节底边」** 时该标题占这一行。同层章节区间互不相交，
 * 所以每层至多命中一个标题。
 *
 * 直观语义（用户口径）：**标题顶边碰到它那一行就进入固定状态**，本章节末尾划过该行时
 * 让位给下一个标题——下一章节的标题刚滑到吸顶区就接管，不会「等新章节整个滑出可见范围
 * 才切换」。
 *
 * 回归：旧实现取「最后一个 bottom ≤ 顶栏底」的标题（要求标题**整体**滚出顶栏），
 * 比内置编辑器晚一个标题高度；且只能单级。
 */
export function computeStickyRows(
    headings: StickyHeadingRect[],
    topbarBottom: number,
    rowHeight: number = STICKY_ROW_HEIGHT_PX,
    maxRows: number = STICKY_MAX_ROWS,
): number[] {
    const rows: number[] = [];
    for (let depth = 1; depth <= maxRows; depth++) {
        const rowY = topbarBottom + (depth - 1) * rowHeight;
        let hit = -1;
        for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
            if (h.depth !== depth) continue;
            if (h.top < rowY && rowY <= h.sectionBottom) { hit = i; }
        }
        if (hit >= 0) { rows.push(hit); }
    }
    return rows;
}
