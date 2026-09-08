import { describe, expect, it } from "vitest";
import { isPathWithinBase } from "../utils/pathGuard";

describe("isPathWithinBase 路径边界判断", () => {
    it("base 内路径 应该 放行", () => {
        expect(isPathWithinBase("C:\\ws\\docs\\a.md", "C:\\ws")).toBe(true);
        expect(isPathWithinBase("C:\\ws\\docs\\sub\\b.png", "C:\\ws")).toBe(true);
    });

    it("base 本身 应该 放行", () => {
        expect(isPathWithinBase("C:\\ws", "C:\\ws")).toBe(true);
    });

    it("../ 逃逸 应该 拦截", () => {
        expect(isPathWithinBase("C:\\ws\\..\\outside\\a.md", "C:\\ws")).toBe(false);
        expect(isPathWithinBase("C:\\other\\a.md", "C:\\ws")).toBe(false);
    });

    it("绝对路径指向外部 应该 拦截", () => {
        expect(isPathWithinBase("C:\\Users\\x\\.ssh\\id_rsa", "C:\\ws")).toBe(false);
    });

    it("工作区内绝对路径 应该 放行", () => {
        expect(isPathWithinBase("C:\\ws\\assets\\img.png", "C:\\ws")).toBe(true);
    });
});
