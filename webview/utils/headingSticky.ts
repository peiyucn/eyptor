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
 *
 * **尾部不接管是刻意的（owner 2026-09-13 确认「符合直觉」）**：文档尾部章节不足一屏时，
 * 它的标题永远碰不到吸顶行，吸顶条就继续显示上一节——「标题碰到线才接管」正是吸顶的语义。
 * 别给它加尾部分支：那条「逐级下滑的阅读线」只服务「当前章节」判据（TOC 高亮要能走到尾部
 * 几项，见 `effectiveReadingLineY`），两者用途不同。
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

/**
 * 「当前章节」的标题下标：**最后一个顶边已划过阅读线的标题**（无则 -1）。
 *
 * 为什么不复用 `computeStickyRows` 的最内层：吸顶行栈在**两节交替**的那几帧会退化成父级
 * ——当前章节被下一节推挤出局、而下一节的标题还没接管，此时最内层是它的父标题（位置在
 * 上面、早已过去）。TOC 高亮跟着它就会「跳回上一个章节再跳回来」，表现为抖动（手测反馈
 * 2026-09-12：「toc 高亮跟随，会出现往上面已经过去的章节高亮抖动」）。
 *
 * 本判据只看「标题顶边是否已划过阅读线」，与推挤过程无关，因此随滚动**单调前进**
 * （标题按文档顺序传入，扫描在第一个未划过的标题处提前结束）。
 *
 * 阅读线一般就是吸顶线（顶栏底），由调用方传入；文档尾部要用 `effectiveReadingLineY`
 * 逐级下滑的线，末尾那几节才会**按顺序**依次接管（详见该函数）。
 */
export function currentHeadingIndex(
    headings: StickyHeadingRect[],
    readingLineY: number,
): number {
    let hit = -1;
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].top < readingLineY) { hit = i; } else { break; }
    }
    return hit;
}

/**
 * 阅读线的视口 y：正常 = 吸顶线（顶栏底）；**进入「够不到的尾部」后随剩余可滚动量下滑**，
 * 滚到文档底部时正好落到视口底。
 *
 * 为什么需要（手测反馈 2026-09-13）：内容坐标系里**最后 `viewportHeight - topbarBottom`
 * 像素**是「够不到的尾部」——落在这段里的标题永远爬不到吸顶线（下面没内容了）。判据一直用
 * 吸顶线的话，末尾那几节全都轮不到，高亮卡在尾部之前那一节，直到滚到底才「跳」到最后一项；
 * 而且末尾有多个标题时会**跳过中间几个**。
 *
 * 口径：距底部还有 `band = viewportHeight - topbarBottom` 以上的可滚动量时，用吸顶线
 * （与老判据逐像素一致）；再往下，线随「距底部还剩多少」线性下滑，到底时 = 视口底。于是
 * 尾部每节标题都会在各自的位置**依次**划过线：既不会一次跳到最后，也不会提前接管——线
 * 始终在标题真正进入视野之后才经过它。
 *
 * 退化情形：视口不比顶栏高、或文档不足一屏（无可滚动量）时，直接返回吸顶线（尾部兜底不生效，
 * 短文档首屏不该把高亮打到最后一项；jsdom 里 `scrollHeight` 恒为 0，也走这条路）。
 */
export function effectiveReadingLineY(
    topbarBottom: number,
    viewportHeight: number,
    scrollY: number,
    contentHeight: number,
): number {
    const band = viewportHeight - topbarBottom;
    const maxScroll = contentHeight - viewportHeight;
    if (band <= 0 || maxScroll <= 0) { return topbarBottom; }
    const fromBottom = Math.max(0, maxScroll - scrollY);
    if (fromBottom >= band) { return topbarBottom; }
    return Math.min(viewportHeight, topbarBottom + (band - fromBottom));
}
