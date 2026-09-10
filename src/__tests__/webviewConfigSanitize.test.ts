import { describe, expect, it } from "vitest";
import {
    DEFAULT_CODE_BLOCK_MAX_HEIGHT,
    DEFAULT_EDITOR_MAX_WIDTH,
    MIN_CODE_BLOCK_MAX_HEIGHT,
    MIN_EDITOR_MAX_WIDTH,
    sanitizeCssNumber,
    sanitizeSerializationMode,
} from "../utils/webviewConfigSanitize";

describe("webviewConfigSanitize 配置值净化（防恶意 workspace 设置注入 HTML/CSS）", () => {
    describe("sanitizeCssNumber", () => {
        it("合法正数 应该 原样返回（四舍五入）", () => {
            expect(sanitizeCssNumber(600, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(600);
            expect(sanitizeCssNumber(899.6, DEFAULT_EDITOR_MAX_WIDTH)).toBe(900);
        });

        it("非数字/负数/零/超上限 应该 回退默认", () => {
            expect(sanitizeCssNumber("600", DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(NaN, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(Infinity, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(-5, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(0, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(99999, DEFAULT_CODE_BLOCK_MAX_HEIGHT)).toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
        });

        it("低于 schema minimum 的值 应该 回退默认（运行时下限与配置项对齐）", () => {
            expect(sanitizeCssNumber(99, DEFAULT_CODE_BLOCK_MAX_HEIGHT, MIN_CODE_BLOCK_MAX_HEIGHT))
                .toBe(DEFAULT_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(399, DEFAULT_EDITOR_MAX_WIDTH, MIN_EDITOR_MAX_WIDTH))
                .toBe(DEFAULT_EDITOR_MAX_WIDTH);
        });

        it("恰好等于上下限的值 应该 通过（闭区间）", () => {
            expect(sanitizeCssNumber(MIN_CODE_BLOCK_MAX_HEIGHT, DEFAULT_CODE_BLOCK_MAX_HEIGHT, MIN_CODE_BLOCK_MAX_HEIGHT))
                .toBe(MIN_CODE_BLOCK_MAX_HEIGHT);
            expect(sanitizeCssNumber(10000, DEFAULT_CODE_BLOCK_MAX_HEIGHT, MIN_CODE_BLOCK_MAX_HEIGHT)).toBe(10000);
        });
    });

    describe("sanitizeSerializationMode", () => {
        it("白名单值 应该 通过", () => {
            expect(sanitizeSerializationMode("clean")).toBe("clean");
            expect(sanitizeSerializationMode("compatible")).toBe("compatible");
        });

        it("注入载荷 应该 回退 clean（防 </script> 逃逸）", () => {
            expect(sanitizeSerializationMode("</script><script>alert(1)</script>")).toBe("clean");
            expect(sanitizeSerializationMode(undefined)).toBe("clean");
            expect(sanitizeSerializationMode({})).toBe("clean");
        });
    });
});
