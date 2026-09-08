import { describe, expect, it } from "vitest";
import { ExpiryWindowMap } from "../utils/expiryWindowMap";

const TTL = 1500;

describe("ExpiryWindowMap 抑制窗口表", () => {
    it("mark 后窗口内 应该 isActive 为 true，过期后为 false", () => {
        const w = new ExpiryWindowMap(TTL);
        w.mark("a", 1000);
        expect(w.isActive("a", 1000)).toBe(true);
        expect(w.isActive("a", 2499)).toBe(true);
        expect(w.isActive("a", 2500)).toBe(false);
    });

    it("过期访问 应该 惰性删除条目（表不无界增长）", () => {
        const w = new ExpiryWindowMap(TTL);
        w.mark("a", 1000);
        expect(w.size).toBe(1);
        expect(w.isActive("a", 9999)).toBe(false);
        expect(w.size).toBe(0);
    });

    it("重复 mark 应该 延长窗口（幂等，无交叉定时器提前复位问题）", () => {
        const w = new ExpiryWindowMap(TTL);
        w.mark("a", 1000);
        w.mark("a", 2000); // 第二次触发：窗口延到 3500
        expect(w.isActive("a", 3000)).toBe(true);
        expect(w.isActive("a", 3500)).toBe(false);
    });

    it("不同 key 应该 互不影响（回归：全局单布尔曾跨文档误伤）", () => {
        const w = new ExpiryWindowMap(TTL);
        w.mark("docA", 1000);
        expect(w.isActive("docB", 1500)).toBe(false); // 文档 B 不受 A 的抑制影响
        expect(w.isActive("docA", 1500)).toBe(true);
    });

    it("delete 应该 立即清除", () => {
        const w = new ExpiryWindowMap(TTL);
        w.mark("a", 1000);
        w.delete("a");
        expect(w.isActive("a", 1000)).toBe(false);
        expect(w.size).toBe(0);
    });
});
