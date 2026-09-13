import { describe, expect, it } from "vitest";
import { findMatches, MAX_MATCHES } from "../utils/findMatches";

describe("findMatches：普通模式", () => {
    it("存在多个匹配时 应该 返回全部区间", () => {
        const r = findMatches("foo bar foo", "foo", { caseSensitive: false, useRegex: false });
        expect(r.invalidRegex).toBe(false);
        expect(r.matches).toEqual([
            { start: 0, end: 3 },
            { start: 8, end: 11 },
        ]);
    });

    it("大小写不敏感时 应该 匹配不同大小写", () => {
        const r = findMatches("Foo FOO", "foo", { caseSensitive: false, useRegex: false });
        expect(r.matches).toHaveLength(2);
    });

    it("区分大小写时 应该 只匹配精确大小写", () => {
        const r = findMatches("Foo foo", "foo", { caseSensitive: true, useRegex: false });
        expect(r.matches).toEqual([{ start: 4, end: 7 }]);
    });

    it("空查询 应该 返回空结果", () => {
        const r = findMatches("abc", "", { caseSensitive: false, useRegex: false });
        expect(r.matches).toEqual([]);
        expect(r.truncated).toBe(false);
    });

    it("匹配数超上限（MAX_MATCHES）应该 截断并标记 truncated（回归：病态查询无上限冻结主线程）", () => {
        const text = "a".repeat(MAX_MATCHES + 1000);
        const r = findMatches(text, "a", { caseSensitive: false, useRegex: false });
        expect(r.matches).toHaveLength(MAX_MATCHES);
        expect(r.truncated).toBe(true);
    });

    it("匹配数未达上限 应该 truncated 为 false", () => {
        const r = findMatches("foo foo", "foo", { caseSensitive: false, useRegex: false });
        expect(r.truncated).toBe(false);
    });
});

describe("findMatches：正则模式", () => {
    it("数字正则 应该 匹配全部数字", () => {
        const r = findMatches("v1.2 and v33", "\\d+", { caseSensitive: false, useRegex: true });
        expect(r.invalidRegex).toBe(false);
        expect(r.matches).toEqual([
            { start: 1, end: 2 },
            { start: 3, end: 4 },
            { start: 10, end: 12 },
        ]);
    });

    it("i flag 应该 由大小写开关控制", () => {
        const ci = findMatches("Foo FOO", "foo", { caseSensitive: false, useRegex: true });
        expect(ci.matches).toHaveLength(2);
        const cs = findMatches("Foo FOO", "foo", { caseSensitive: true, useRegex: true });
        expect(cs.matches).toEqual([]);
    });

    it("无效正则 应该 返回 invalidRegex 且不抛异常", () => {
        const r = findMatches("abc", "(", { caseSensitive: false, useRegex: true });
        expect(r.invalidRegex).toBe(true);
        expect(r.matches).toEqual([]);
    });

    it("零宽正则（.*）应该 快速返回且不死循环", () => {
        // 挂钟断言对机器负载与覆盖率插桩敏感：改为「多轮取最小值 + 宽松上限」。
        // 真回归（零宽匹配死循环）会让 vitest 自身超时，仍会被抓住。
        const text = "a\n".repeat(500);
        findMatches(text, ".*", { caseSensitive: false, useRegex: true }); // 预热
        let best = Number.POSITIVE_INFINITY;
        for (let round = 0; round < 3; round++) {
            const start = performance.now();
            const r = findMatches(text, ".*", { caseSensitive: false, useRegex: true });
            best = Math.min(best, performance.now() - start);
            expect(r.invalidRegex).toBe(false);
            expect(r.matches.length).toBeGreaterThan(0);
        }
        expect(best).toBeLessThan(2_000);
    });

    it("正则匹配数超上限 应该 截断并标记 truncated", () => {
        const r = findMatches("a".repeat(MAX_MATCHES + 500), "a", { caseSensitive: false, useRegex: true });
        expect(r.matches).toHaveLength(MAX_MATCHES);
        expect(r.truncated).toBe(true);
    });
});
