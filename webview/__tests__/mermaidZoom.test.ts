import { afterEach, describe, expect, it } from "vitest";
import { clampZoom, MERMAID_ZOOM_MAX, MERMAID_ZOOM_MIN } from "../utils/mermaidZoom";
import { enhanceMermaidPreview } from "../components/mermaidZoom";

afterEach(() => {
    document.body.innerHTML = "";
});

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

describe("enhanceMermaidPreview 倍率保持", () => {
    it("缩放倍率 应该 存容器 dataset 并在主题重绘后保持", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        container.appendChild(svg);

        enhanceMermaidPreview(container, svg);
        const zoomIn = container.querySelector<HTMLButtonElement>(".epytor-mermaid-zoom-btn");
        expect(zoomIn).not.toBeNull();
        zoomIn!.dispatchEvent(new MouseEvent("click"));

        expect(container.dataset["epytorMermaidZoom"]).toBe("1.2");
        expect(svg.style.width).toBe("120%");

        // 模拟主题重绘：innerHTML 清空子节点（dataset 保留），重新 enhance
        container.innerHTML = "";
        const svg2 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        container.appendChild(svg2);
        enhanceMermaidPreview(container, svg2);

        expect(svg2.style.width).toBe("120%");
    });

    it("reset 按钮 应该 恢复 100% 并重置 dataset", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        container.appendChild(svg);

        enhanceMermaidPreview(container, svg);
        const buttons = container.querySelectorAll<HTMLButtonElement>(".epytor-mermaid-zoom-btn");
        const zoomIn = buttons[0];
        const reset = buttons[2];
        zoomIn.dispatchEvent(new MouseEvent("click"));
        reset.dispatchEvent(new MouseEvent("click"));

        expect(svg.style.width).toBe("100%");
        expect(container.dataset["epytorMermaidZoom"]).toBe("1");
    });
});
