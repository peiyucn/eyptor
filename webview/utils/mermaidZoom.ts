/**
 * Mermaid 预览缩放纯逻辑（无 DOM 依赖，可单元测试）。
 */
export const MERMAID_ZOOM_MIN = 0.2;
export const MERMAID_ZOOM_MAX = 3;
export const MERMAID_ZOOM_STEP = 0.2;

/** 步进缩放并钳制到 [MIN, MAX]；返回两位小数以内的浮点 */
export function clampZoom(current: number, delta: number): number {
    const next = Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, current + delta));
    return Math.round(next * 100) / 100;
}
