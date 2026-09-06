/**
 * Mermaid 预览缩放增强：DOM 层 SVG 百分比宽度缩放 + 控制条（＋/−/×）。
 * 不触碰文档内容；主题重绘后由宿主重新调用以重挂控制条。
 */
import "./mermaidZoom.css";
import { clampZoom, MERMAID_ZOOM_STEP } from "@/utils/mermaidZoom";
import { t } from "@/i18n";

let _seq = 0;

/** 为已渲染的 mermaid 预览容器注入控制条与缩放交互；返回当前倍率读取器 */
export function enhanceMermaidPreview(container: HTMLElement, svg: SVGElement): void {
    const key = `mz-${++_seq}`;
    let zoom = 1;

    const bar = document.createElement("div");
    bar.className = "epytor-mermaid-zoom-bar";

    const mkBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "epytor-mermaid-zoom-btn";
        btn.textContent = label;
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.addEventListener("click", onClick);
        return btn;
    };

    const apply = (): void => {
        svg.style.width = `${zoom * 100}%`;
        bar.setAttribute("data-zoom", String(zoom));
    };

    const zoomIn = mkBtn("＋", t("Zoom In"), () => { zoom = clampZoom(zoom, MERMAID_ZOOM_STEP); apply(); });
    const zoomOut = mkBtn("－", t("Zoom Out"), () => { zoom = clampZoom(zoom, -MERMAID_ZOOM_STEP); apply(); });
    const zoomReset = mkBtn("×", t("Reset Zoom"), () => { zoom = 1; apply(); });

    bar.append(zoomIn, zoomOut, zoomReset);
    container.classList.add("epytor-mermaid-zoom-container");
    container.dataset.mermaidZoomKey = key;
    container.appendChild(bar);
    apply();
}
