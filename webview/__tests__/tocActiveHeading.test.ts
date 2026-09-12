/**
 * 「当前章节」判据（TOC 高亮跟随）：
 * 手测反馈 2026-09-12「toc 高亮跟随，会出现往上面已经过去的章节高亮抖动」——
 * 根因是复用吸顶行栈的最内层：两节交替的那几帧它会退化成父标题（在上面、早已过去）。
 */
import { describe, expect, it } from "vitest";
import { currentHeadingIndex, computeStickyRows, effectiveReadingLineY, type StickyHeadingRect } from "../utils/headingSticky";

/** 构造：depth/top/sectionBottom（视口坐标，顺序即文档顺序） */
const h = (depth: number, top: number, sectionBottom: number): StickyHeadingRect => ({ depth, top, sectionBottom });

describe("当前章节判据", () => {
    const headings = [h(1, -300, 100), h(2, -200, 40), h(3, -60, 10), h(2, 30, 300)];

    it("应该 取最后一个划过吸顶线的标题", () => {
        expect(currentHeadingIndex(headings, 0)).toBe(2); // h3 顶边 -60 < 0
    });

    it("两节交替（当前节被推挤出局）时 不应该 退回父章节", () => {
        // 这一帧：h2(-200) 的章节底边已过线（40 > 0 时仍在，模拟推挤中的临界读数），
        // 但下一个 h2 顶边还没到线（30 > 0）——吸顶行栈此时会退化成父级 h1，
        // 而「当前章节」必须仍是 h3。
        const transiting = [h(1, -300, 100), h(2, -200, 5), h(3, -60, 4), h(2, 30, 300)];
        expect(currentHeadingIndex(transiting, 0)).toBe(2);

        // 吸顶行栈在同样输入下的确会退化（对照：这正是不能复用它的原因）
        const rows = computeStickyRows(transiting, 0);
        expect(rows[rows.length - 1]).toBe(0); // 最内层 = h1（父章节，早已过去）
    });

    it("还没滚到第一个标题时 应该 返回 -1", () => {
        expect(currentHeadingIndex([h(1, 40, 200), h(2, 90, 200)], 0)).toBe(-1);
    });

    it("划过最后一个标题后 应该 停在它上面（单调前进）", () => {
        const scrolled = [h(1, -900, -400), h(2, -500, -100), h(3, -90, -20)];
        expect(currentHeadingIndex(scrolled, 0)).toBe(2);
    });

    it("文档为空 / 没有标题时 应该 返回 -1", () => {
        expect(currentHeadingIndex([], 0)).toBe(-1);
    });
});

describe("effectiveReadingLineY（尾部逐级下滑的阅读线）", () => {
    // 内容 2000、视口 800、吸顶线 36 → 够不到的尾部 band = 764、maxScroll = 1200
    const BOTTOM = 36;
    const VIEW = 800;
    const CONTENT = 2000;

    it("远离尾部 应该 就是吸顶线（与老判据逐像素一致）", () => {
        expect(effectiveReadingLineY(BOTTOM, VIEW, 0, CONTENT)).toBe(BOTTOM);
        expect(effectiveReadingLineY(BOTTOM, VIEW, 1200 - 764, CONTENT)).toBe(BOTTOM);
    });

    it("进入尾部后 应该 随「距底部还剩多少」线性下滑", () => {
        // 距底部 382（= band/2）→ 线滑到 36 + 382 = 418
        expect(effectiveReadingLineY(BOTTOM, VIEW, 1200 - 382, CONTENT)).toBe(418);
    });

    it("滚到文档底部 应该 落到视口底", () => {
        expect(effectiveReadingLineY(BOTTOM, VIEW, 1200, CONTENT)).toBe(VIEW);
    });

    it("过滚（scrollY 超过最大可滚动量）应该 钳制在视口底", () => {
        expect(effectiveReadingLineY(BOTTOM, VIEW, 1400, CONTENT)).toBe(VIEW);
    });

    it("文档不足一屏 / 视口比顶栏还矮 应该 回退吸顶线（尾部兜底不生效）", () => {
        expect(effectiveReadingLineY(BOTTOM, VIEW, 0, 700)).toBe(BOTTOM);
        expect(effectiveReadingLineY(BOTTOM, 30, 100, 2000)).toBe(BOTTOM);
    });

    it("尾部多个标题 应该 按顺序依次接管（回归：此前滚到底一次跳到最后一项）", () => {
        // 文档：A(long)@60 → T1@1300 → T2@1600 → T3@1900（后三个都在够不到的尾部里）
        const docTops = [60, 1300, 1600, 1900];
        const activeAt = (scrollY: number) => currentHeadingIndex(
            docTops.map((docTop) => h(1, docTop - scrollY, 0)),
            effectiveReadingLineY(BOTTOM, VIEW, scrollY, CONTENT),
        );

        // 从上往下滚：A → T1 → T2 → T3，每一步只前进一格，没有跳跃
        expect([800, 900, 1000, 1050, 1150, 1200].map(activeAt)).toEqual([0, 1, 1, 2, 2, 3]);
    });
});
