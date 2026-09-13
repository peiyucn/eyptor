import { describe, expect, it } from "vitest";
import { computeStickyRows, STICKY_ROW_HEIGHT_PX } from "../utils/headingSticky";

const TOP = 36;
const ROW = STICKY_ROW_HEIGHT_PX;

/** 构造一个顶层标题（章节延伸到文档底） */
const h1 = (top: number, sectionBottom = 10000) => ({ depth: 1, top, sectionBottom });
/** 构造一个二级标题 */
const h2 = (top: number, sectionBottom = 10000) => ({ depth: 2, top, sectionBottom });

describe("computeStickyRows", () => {
    it("标题顶边尚未碰到吸顶行 应该 不吸顶", () => {
        expect(computeStickyRows([h1(40)], TOP)).toEqual([]);
    });

    it("标题顶边刚碰到吸顶行（top === 行 y） 应该 仍不吸顶（严格小于）", () => {
        expect(computeStickyRows([h1(TOP)], TOP)).toEqual([]);
    });

    it("标题顶边越过吸顶行 1px 应该 立即吸顶（回归：旧实现要等整体滚出，晚一个标题高度）", () => {
        expect(computeStickyRows([h1(TOP - 1)], TOP)).toEqual([0]);
    });

    it("标题部分被顶栏遮挡 应该 已经吸顶（用户口径：碰到了就进入固定状态）", () => {
        // 标题 top = 20（在顶栏 36 下方 16px 处？不——视口坐标 20 已在顶栏内），
        // 高 30 → 底部 50 仍可见：旧实现此时显示的是「上一个」标题
        expect(computeStickyRows([h1(-10, 200)], TOP)).toEqual([0]);
    });

    it("章节末尾划过吸顶行 应该 让位给下一个标题（切换发生在下一标题碰到该行时）", () => {
        // h1 章节在 y=30 结束，下一个 h1 从 y=30 开始：行 y=36 已不在前者区间
        const rows = computeStickyRows([h1(-100, 30), h1(30)], TOP);
        expect(rows).toEqual([1]);
    });

    it("下一个标题尚未碰到吸顶行 应该 保持上一个标题（不提前切换）", () => {
        const rows = computeStickyRows([h1(-100, 60), h1(60)], TOP);
        expect(rows).toEqual([0]);
    });

    it("多级：父标题与当前子标题 应该 各占一行（外层在上）", () => {
        const rows = computeStickyRows([h1(-500), h2(-60)], TOP);
        expect(rows).toEqual([0, 1]);
    });

    it("多级：子标题尚未碰到自己的行 应该 只显示父标题", () => {
        // 第二行 y = 36 + 22 = 58；子标题 top = 70 还没到
        expect(computeStickyRows([h1(-500), h2(70)], TOP)).toEqual([0]);
    });

    it("多级：子标题顶边到达第二行 应该 进入固定状态", () => {
        expect(computeStickyRows([h1(-500), h2(TOP + ROW - 1)], TOP)).toEqual([0, 1]);
    });

    it("多级：子标题章节结束 应该 让位给同层下一个子标题（父标题保留）", () => {
        const rows = computeStickyRows([h1(-500), h2(-200, 40), h2(40)], TOP);
        expect(rows).toEqual([0, 2]);
    });

    it("跨级标题（h1 → h3） 应该 按嵌套深度占行（中间层空缺不占位）", () => {
        const rows = computeStickyRows([h1(-500), { depth: 2, top: -60, sectionBottom: 10000 }], TOP);
        expect(rows).toEqual([0, 1]);
    });

    it("maxRows 限制 应该 只返回前几层", () => {
        const headings = [h1(-500), h2(-400), { depth: 3, top: -300, sectionBottom: 10000 }];
        expect(computeStickyRows(headings, TOP, ROW, 2)).toEqual([0, 1]);
    });

    it("滚动到文档末尾（所有标题都在上方） 应该 仍显示最深路径", () => {
        const rows = computeStickyRows([h1(-2000, 500), h2(-1500)], TOP);
        expect(rows).toEqual([0, 1]);
    });

    it("空列表 应该 返回空数组", () => {
        expect(computeStickyRows([], TOP)).toEqual([]);
    });
});
