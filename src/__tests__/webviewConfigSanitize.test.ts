import { describe, expect, it } from "vitest";
import {
    DEFAULT_CODE_BLOCK_MAX_HEIGHT,
    DEFAULT_EDITOR_MAX_WIDTH,
    DEFAULT_IMAGE_SELECTION_COLOR,
    sanitizeCssColor,
    sanitizeCssNumber,
    sanitizeFontFamily,
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
    });

    describe("sanitizeCssColor", () => {
        it("合法颜色值 应该 原样返回", () => {
            expect(sanitizeCssColor("rgba(52, 211, 153, 0.6)", DEFAULT_IMAGE_SELECTION_COLOR))
                .toBe("rgba(52, 211, 153, 0.6)");
            expect(sanitizeCssColor("#aabbcc", DEFAULT_IMAGE_SELECTION_COLOR)).toBe("#aabbcc");
            expect(sanitizeCssColor("hsl(120, 50%, 50%)", DEFAULT_IMAGE_SELECTION_COLOR))
                .toBe("hsl(120, 50%, 50%)");
        });

        it("注入载荷（;{}<>引号等） 应该 回退默认", () => {
            expect(sanitizeCssColor("red;}</style><img src=x>", DEFAULT_IMAGE_SELECTION_COLOR))
                .toBe(DEFAULT_IMAGE_SELECTION_COLOR);
            expect(sanitizeCssColor("url(https://attacker/x)", DEFAULT_IMAGE_SELECTION_COLOR))
                .toBe(DEFAULT_IMAGE_SELECTION_COLOR);
            expect(sanitizeCssColor("", DEFAULT_IMAGE_SELECTION_COLOR)).toBe(DEFAULT_IMAGE_SELECTION_COLOR);
            expect(sanitizeCssColor(123 as unknown as string, DEFAULT_IMAGE_SELECTION_COLOR))
                .toBe(DEFAULT_IMAGE_SELECTION_COLOR);
        });
    });

    describe("sanitizeFontFamily", () => {
        it("合法字体名（含引号/逗号/CJK） 应该 原样返回", () => {
            expect(sanitizeFontFamily("'Fira Code', monospace")).toBe("'Fira Code', monospace");
            expect(sanitizeFontFamily("思源黑体, sans-serif")).toBe("思源黑体, sans-serif");
            expect(sanitizeFontFamily("")).toBe("");
        });

        it("注入载荷（标签/分号/大括号） 应该 回退空", () => {
            expect(sanitizeFontFamily("monospace;}</style><script>alert(1)</script>")).toBe("");
            expect(sanitizeFontFamily("a { color: red }")).toBe("");
            expect(sanitizeFontFamily(123 as unknown as string)).toBe("");
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
