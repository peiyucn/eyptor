/**
 * isPathWithinBase 路径边界判断。
 *
 * 平台无关写法（回归 2026-09-13）：原用例写死 `C:\ws\...`，CI 在 ubuntu 上把这类字符串当
 * 相对路径，2 个用例假红、`dev` 的 CI 红了 8 天。现在三组：
 * - 当前平台语义：用 `path.resolve` 造真实绝对路径（两个平台都成立）；
 * - Windows 语义：注入 `path.win32`（盘符、反斜杠、大小写不敏感）——在 Linux CI 上也执行；
 * - POSIX 语义：注入 `path.posix`。
 */
import * as path from "path";
import { describe, expect, it } from "vitest";
import { isPathWithinBase } from "../utils/pathGuard";

describe("isPathWithinBase（当前平台语义）", () => {
    const base = path.resolve(path.sep + "ws");
    const inside = path.join(base, "docs", "a.md");
    const outside = path.resolve(path.sep + "other", "a.md");

    it("base 内路径 应该 放行", () => {
        expect(isPathWithinBase(inside, base)).toBe(true);
        expect(isPathWithinBase(path.join(base, "docs", "sub", "b.png"), base)).toBe(true);
    });

    it("base 本身 应该 放行", () => {
        expect(isPathWithinBase(base, base)).toBe(true);
    });

    it("base 内绕一圈再回来（含 .. 但没出去） 应该 放行", () => {
        expect(isPathWithinBase(path.join(base, "docs", "..", "a.md"), base)).toBe(true);
    });

    it("../ 逃逸 应该 拦截", () => {
        expect(isPathWithinBase(path.join(base, "..", "outside", "a.md"), base)).toBe(false);
        expect(isPathWithinBase(outside, base)).toBe(false);
    });

    it("同前缀的兄弟目录 应该 拦截（不能只看字符串前缀）", () => {
        expect(isPathWithinBase(base + "-sibling" + path.sep + "a.md", base)).toBe(false);
    });
});

/** Windows 与 POSIX 两套语义都显式覆盖：CI 是 Linux，但用户主要在 Windows */
const WIN = path.win32;
const POSIX = path.posix;

describe("isPathWithinBase（Windows 语义，注入 path.win32）", () => {
    it("盘符路径在 base 内 应该 放行", () => {
        expect(isPathWithinBase("C:\\ws\\docs\\a.md", "C:\\ws", WIN)).toBe(true);
        expect(isPathWithinBase("C:\\ws\\docs\\sub\\b.png", "C:\\ws", WIN)).toBe(true);
        expect(isPathWithinBase("C:\\ws\\assets\\img.png", "C:\\ws", WIN)).toBe(true);
    });

    it("base 本身 应该 放行", () => {
        expect(isPathWithinBase("C:\\ws", "C:\\ws", WIN)).toBe(true);
    });

    it("大小写不同 应该 仍算在 base 内（Windows 不区分大小写）", () => {
        expect(isPathWithinBase("c:\\WS\\docs\\a.md", "C:\\ws", WIN)).toBe(true);
    });

    it("../ 逃逸 与盘符外路径 应该 拦截", () => {
        expect(isPathWithinBase("C:\\ws\\..\\outside\\a.md", "C:\\ws", WIN)).toBe(false);
        expect(isPathWithinBase("C:\\other\\a.md", "C:\\ws", WIN)).toBe(false);
        expect(isPathWithinBase("C:\\Users\\x\\.ssh\\id_rsa", "C:\\ws", WIN)).toBe(false);
    });

    it("别的盘符 应该 拦截", () => {
        expect(isPathWithinBase("D:\\ws\\a.md", "C:\\ws", WIN)).toBe(false);
    });
});

describe("isPathWithinBase（POSIX 语义，注入 path.posix）", () => {
    it("base 内 应该 放行、越界 应该 拦截", () => {
        expect(isPathWithinBase("/ws/docs/a.md", "/ws", POSIX)).toBe(true);
        expect(isPathWithinBase("/ws", "/ws", POSIX)).toBe(true);
        expect(isPathWithinBase("/ws/../outside/a.md", "/ws", POSIX)).toBe(false);
        expect(isPathWithinBase("/other/a.md", "/ws", POSIX)).toBe(false);
        expect(isPathWithinBase("/ws-sibling/a.md", "/ws", POSIX)).toBe(false);
    });
});
