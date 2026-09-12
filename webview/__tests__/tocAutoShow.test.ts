/**
 * TOC 非固定态自动展开判据（手测反馈 2026-09-12：「判定宽度太宽，应该更早自动出现」）。
 *
 * 回归：原判据要求左侧空白 ≥ 整个面板宽度（200px），窗口稍窄就永远不出现。
 * 现判据 = 空白 ≥ 面板宽度 × 55%，且自动展开时面板会收窄到空白内（不遮正文）。
 */
import { describe, expect, it } from "vitest";
import { shouldAutoShowToc } from "../components/toc/index";

describe("TOC 自动展开判据", () => {
    it("左侧空白达到面板宽度的 55% 就应该 自动展开（原先要求 100%）", () => {
        // 200 × 0.55 = 110
        expect(shouldAutoShowToc(110, 200)).toBe(true);
        expect(shouldAutoShowToc(120, 200)).toBe(true);
        expect(shouldAutoShowToc(199, 200)).toBe(true);
    });

    it("空白不足阈值时 应该 不展开", () => {
        expect(shouldAutoShowToc(109, 200)).toBe(false);
        expect(shouldAutoShowToc(80, 200)).toBe(false);
        expect(shouldAutoShowToc(0, 200)).toBe(false);
    });

    it("阈值随用户拖宽的面板一起放大", () => {
        // 300 × 0.55 = 165
        expect(shouldAutoShowToc(164, 300)).toBe(false);
        expect(shouldAutoShowToc(170, 300)).toBe(true);
    });
});
