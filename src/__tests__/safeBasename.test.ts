import { describe, expect, it } from "vitest";
import { sanitizeBasename } from "../utils/safeBasename";

describe("sanitizeBasename 文件名安全化", () => {
    it("合法文件名 应该 原样保留（含空格/中文/连字符）", () => {
        expect(sanitizeBasename("my image")).toBe("my image");
        expect(sanitizeBasename("图片-02")).toBe("图片-02");
        expect(sanitizeBasename("a.b.c")).toBe("a.b.c");
    });

    it("Windows 非法字符与控制字符 应该 被过滤", () => {
        expect(sanitizeBasename('a<b>:c"d/e\\f|g?h*i')).toBe("abcdefghi");
        expect(sanitizeBasename("a\u0000b")).toBe("ab");
    });

    it("尾部点号 应该 被去除", () => {
        expect(sanitizeBasename("name...")).toBe("name");
    });

    it("清空后为空 应该 返回空串（调用方拒绝）", () => {
        expect(sanitizeBasename("")).toBe("");
        expect(sanitizeBasename("   ")).toBe("");
        expect(sanitizeBasename("<>:\\")).toBe("");
    });

    it("Windows 保留设备名 应该 返回空串（回归：此前 CON.png 等 rename 失败仅无差别报错）", () => {
        for (const reserved of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"]) {
            expect(sanitizeBasename(reserved)).toBe("");
            // 带扩展名同样非法
            expect(sanitizeBasename(`${reserved}.png`)).toBe("");
        }
    });

    it("非保留的相似名 应该 放行", () => {
        expect(sanitizeBasename("COM10")).toBe("COM10");
        expect(sanitizeBasename("CONSOLE")).toBe("CONSOLE");
        expect(sanitizeBasename("console.md")).toBe("console.md");
    });
});
