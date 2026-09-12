/**
 * Word 式多级列表标记（见 docs/specs/2026-09-12-word-style-multilevel-markers.md）。
 * 纯计算部分：层级 3 档循环，有序 1./a)/i.，无序 ●/■/◆。
 */
import { describe, expect, it } from "vitest";
import { computeListMarker, toLowerAlpha, toLowerRoman } from "../utils/listMarker";

describe("多级列表标记：序号格式", () => {
    it("小写罗马数字 应该 覆盖常见值", () => {
        expect(toLowerRoman(1)).toBe("i");
        expect(toLowerRoman(4)).toBe("iv");
        expect(toLowerRoman(9)).toBe("ix");
        expect(toLowerRoman(14)).toBe("xiv");
        expect(toLowerRoman(40)).toBe("xl");
        expect(toLowerRoman(3999)).toBe("mmmcmxcix");
    });

    it("小写字母序号 应该 支持进位（z → aa）", () => {
        expect(toLowerAlpha(1)).toBe("a");
        expect(toLowerAlpha(26)).toBe("z");
        expect(toLowerAlpha(27)).toBe("aa");
        expect(toLowerAlpha(28)).toBe("ab");
    });
});

describe("多级列表标记：层级循环", () => {
    it("有序列表 应该 按 1. / a) / i. 三档循环", () => {
        const text = (depth: number, index = 0, order = 1) => computeListMarker("ordered", depth, index, order).text;
        expect(text(1)).toBe("1.");
        expect(text(2)).toBe("a)");
        expect(text(3)).toBe("i.");
        expect(text(4)).toBe("1.");   // 第 4 层回到十进制
        expect(text(5)).toBe("a)");
        expect(text(6)).toBe("i.");
    });

    it("层级 应该 带出 1..3 的档位（CSS 据此换形状）", () => {
        expect(computeListMarker("ordered", 1, 0).level).toBe(1);
        expect(computeListMarker("ordered", 4, 0).level).toBe(1);
        expect(computeListMarker("bullet", 3, 0).level).toBe(3);
        expect(computeListMarker("bullet", 7, 0).level).toBe(1);
    });

    it("同层第 n 项 应该 接续序号（按列表起始号 order）", () => {
        expect(computeListMarker("ordered", 1, 0, 1).text).toBe("1.");
        expect(computeListMarker("ordered", 1, 2, 1).text).toBe("3.");
        // 退格断开列表后从 3 续号（order=3）：第 3 项 = 3 + 2 = 5
        expect(computeListMarker("ordered", 1, 0, 3).text).toBe("3.");
        expect(computeListMarker("ordered", 1, 2, 3).text).toBe("5.");
        expect(computeListMarker("ordered", 2, 2, 3).text).toBe("e)");
        expect(computeListMarker("ordered", 3, 2, 3).text).toBe("v.");
    });

    it("无序列表 应该 只给档位与形状、不给文本", () => {
        const marker = computeListMarker("bullet", 2, 0);
        expect(marker.level).toBe(2);
        expect(marker.text).toBeNull();
        expect(marker.bullet).toEqual({ size: "5px", radius: "1px", rotate: "0deg" });
    });

    it("无序形状 应该 按三档循环（圆 / 方 / 菱形）", () => {
        expect(computeListMarker("bullet", 1, 0).bullet.radius).toBe("50%");
        expect(computeListMarker("bullet", 3, 0).bullet.rotate).toBe("45deg");
        expect(computeListMarker("bullet", 4, 0).bullet).toEqual(computeListMarker("bullet", 1, 0).bullet);
        expect(computeListMarker("bullet", 5, 0).bullet).toEqual(computeListMarker("bullet", 2, 0).bullet);
    });
});
