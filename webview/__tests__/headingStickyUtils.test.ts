import { describe, expect, it } from "vitest";
import { computeStickyActiveIndex } from "../utils/headingSticky";

const TOP = 36;

describe("computeStickyActiveIndex", () => {
    it("前一个标题滚出、目标标题完整可见 应该 吸顶前一个（正常滚动语义；跳转遮挡由 suppress 机制处理）", () => {
        const headings = [
            { top: -20, bottom: 10 }, // 前一章节：完全在顶栏上方
            { top: 44, bottom: 80 }, // 目标标题：完整可见
        ];
        expect(computeStickyActiveIndex(headings, TOP)).toBe(0);
    });

    it("前一个标题滚出且目标标题被顶栏遮挡 应该 吸顶前一个", () => {
        const headings = [
            { top: -60, bottom: -20 }, // 已滚出
            { top: 20, bottom: 60 }, // 目标标题顶部被顶栏遮住
        ];
        expect(computeStickyActiveIndex(headings, TOP)).toBe(0);
    });

    it("第一个标题部分可见 应该 隐藏（没有前一个可吸顶）", () => {
        const headings = [{ top: 20, bottom: 60 }];
        expect(computeStickyActiveIndex(headings, TOP)).toBe(-1);
    });

    it("所有标题均已滚出 应该 吸顶最后一个（文档底部）", () => {
        const headings = [
            { top: -200, bottom: -160 },
            { top: -100, bottom: -60 },
        ];
        expect(computeStickyActiveIndex(headings, TOP)).toBe(1);
    });

    it("空列表 应该 返回 -1", () => {
        expect(computeStickyActiveIndex([], TOP)).toBe(-1);
    });

    it("前一个标题尚未完全滚出 应该 隐藏", () => {
        const headings = [
            { top: 10, bottom: 50 }, // 前一章节仍部分可见（bottom > 顶栏底）
            { top: 50, bottom: 90 },
        ];
        expect(computeStickyActiveIndex(headings, TOP)).toBe(-1);
    });
});
