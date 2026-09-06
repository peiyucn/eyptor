/**
 * Mermaid 预览缩放增强：DOM 层 SVG 百分比宽度缩放 + 控制条（＋/−/×）。
 * 不触碰文档内容；主题重绘后由宿主重新调用以重挂控制条。
 */
import "./mermaidZoom.css";
import { clampZoom, MERMAID_ZOOM_STEP } from "@/utils/mermaidZoom";
import { t } from "@/i18n";
import { IconResetZoom } from "@/ui/icons";

const DEFAULT_ZOOM = 0.8;

let _seq = 0;

/** 为已渲染的 mermaid 预览容器注入控制条与缩放交互；倍率存于容器 dataset，主题重绘后保持 */
export function enhanceMermaidPreview(container: HTMLElement, svg: SVGElement): void {
    const key = `mz-${++_seq}`;
    const savedZoom = Number(container.dataset["epytorMermaidZoom"]);
    // 默认 0.8×（mermaid 原始尺寸偏大）；未保存过倍率时用默认值
    let zoom = Number.isFinite(savedZoom) && savedZoom > 0 ? savedZoom : DEFAULT_ZOOM;

    const bar = document.createElement("div");
    bar.className = "epytor-mermaid-zoom-bar";

    const mkBtn = (
        content: string,
        title: string,
        onClick: () => void,
    ): HTMLButtonElement => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "epytor-mermaid-zoom-btn";
        btn.innerHTML = content;
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.addEventListener("click", onClick);
        return btn;
    };

    const apply = (): void => {
        svg.style.width = `${zoom * 100}%`;
        // mermaid SVG 自带内联 max-width（useMaxWidth 默认），仅改 width 会被压回，
        // 必须同步缩放 max-width 才能产生视觉效果
        svg.style.maxWidth = `${zoom * 100}%`;
        container.dataset["epytorMermaidZoom"] = String(zoom);
        bar.setAttribute("data-zoom", String(zoom));
    };

    const zoomIn = mkBtn("＋", t("Zoom In"), () => { zoom = clampZoom(zoom, MERMAID_ZOOM_STEP); apply(); });
    const zoomOut = mkBtn("－", t("Zoom Out"), () => { zoom = clampZoom(zoom, -MERMAID_ZOOM_STEP); apply(); });
    const zoomReset = mkBtn(IconResetZoom, t("Reset Zoom"), () => { zoom = DEFAULT_ZOOM; apply(); });

    bar.append(zoomIn, zoomOut, zoomReset);
    container.classList.add("epytor-mermaid-zoom-container");
    container.dataset.mermaidZoomKey = key;
    container.appendChild(bar);
    apply();
}
