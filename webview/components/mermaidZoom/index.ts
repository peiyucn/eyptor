/**
 * Mermaid 预览缩放增强：DOM 层 SVG 百分比宽度缩放 + 控制条（＋/−/×）。
 * 不触碰文档内容；主题重绘后由宿主重新调用以重挂控制条。
 */
import "./mermaidZoom.css";
import { clampZoom, MERMAID_ZOOM_STEP } from "@/utils/mermaidZoom";
import { t } from "@/i18n";
import { IconResetZoom } from "@/ui/icons";

const DEFAULT_ZOOM = 0.8;

/**
 * SVG 原始渲染宽度（px）。
 * 回归：此前 zoom 直接写容器百分比（如 80%），与 SVG 原始尺寸无关——
 * 宽容器下 80% 可能比原始渲染（受 mermaid 内联 max-width 限制）还大，
 * 导致「默认放大、缩到最小才接近原始」的错位。
 */
function measureSvgBaseWidth(svg: SVGElement): number {
    const rect = svg.getBoundingClientRect();
    if (Number.isFinite(rect.width) && rect.width > 0) return rect.width;
    const attr = Number.parseFloat(svg.getAttribute("width") ?? "");
    if (Number.isFinite(attr) && attr > 0) return attr;
    return 0;
}

/** 为已渲染的 mermaid 预览容器注入控制条与缩放交互；倍率存于容器 dataset，主题重绘后保持 */
export function enhanceMermaidPreview(container: HTMLElement, svg: SVGElement): void {
    // 防重复挂载（主题重绘重入时旧条未清理则直接跳过）
    if (container.querySelector(".epytor-mermaid-zoom-bar")) return;
    const savedZoom = Number(container.dataset["epytorMermaidZoom"]);
    // 默认 0.8×（mermaid 原始尺寸偏大）；未保存过倍率时用默认值
    let zoom = Number.isFinite(savedZoom) && savedZoom > 0 ? savedZoom : DEFAULT_ZOOM;
    // 基准 = 增强时的原始渲染宽度（px）
    const baseWidth = measureSvgBaseWidth(svg);

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
        if (baseWidth > 0) {
            // 以原始渲染宽度为基准的像素缩放：倍数语义与用户直觉一致（1× = 原始大小）
            svg.style.width = `${baseWidth * zoom}px`;
            // mermaid SVG 自带内联 max-width（useMaxWidth 默认），放大时必须解除才能生效
            svg.style.maxWidth = "none";
        } else {
            // jsdom/极端环境无布局：回退容器百分比（旧行为）
            svg.style.width = `${zoom * 100}%`;
            svg.style.maxWidth = `${zoom * 100}%`;
        }
        container.dataset["epytorMermaidZoom"] = String(zoom);
        bar.setAttribute("data-zoom", String(zoom));
    };

    const zoomIn = mkBtn("＋", t("Zoom In"), () => { zoom = clampZoom(zoom, MERMAID_ZOOM_STEP); apply(); });
    const zoomOut = mkBtn("－", t("Zoom Out"), () => { zoom = clampZoom(zoom, -MERMAID_ZOOM_STEP); apply(); });
    const zoomReset = mkBtn(IconResetZoom, t("Reset Zoom"), () => { zoom = DEFAULT_ZOOM; apply(); });

    bar.append(zoomIn, zoomOut, zoomReset);
    container.classList.add("epytor-mermaid-zoom-container");
    container.appendChild(bar);
    apply();
}
