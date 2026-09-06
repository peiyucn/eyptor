import { describe, expect, it } from "vitest";
import { clampZoom, MERMAID_ZOOM_MAX, MERMAID_ZOOM_MIN } from "../utils/mermaidZoom";

describe("clampZoom", () => {
    it("正常步进 应该 按步长缩放", () => {
        expect(clampZoom(1, 0.2)).toBe(1.2);
        expect(clampZoom(1.2, -0.2)).toBe(1);
    });

    it("超出上限 应该 钳制到最大值", () => {
        expect(clampZoom(2.9, 0.2)).toBe(MERMAID_ZOOM_MAX);
        expect(clampZoom(5, 0.2)).toBe(MERMAID_ZOOM_MAX);
    });

    it("低于下限 应该 钳制到最小值", () => {
        expect(clampZoom(0.5, -0.2)).toBe(MERMAID_ZOOM_MIN);
        expect(clampZoom(0.1, -0.2)).toBe(MERMAID_ZOOM_MIN);
    });

    it("浮点累计 应该 不产生长尾误差", () => {
        let z = 1;
        for (let i = 0; i < 10; i++) z = clampZoom(z, 0.2);
        expect(z).toBe(MERMAID_ZOOM_MAX);
    });
});
