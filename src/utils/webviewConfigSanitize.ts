/**
 * WebView HTML 注入前的配置值净化（纯函数，可单测）。
 *
 * 背景（安全）：workspace 级配置随克隆仓库生效，恶意 .vscode/settings.json 可注入
 * 任意值；未经净化的字符串直接拼入 <style> / 内联 <script> 可逃逸标签注入任意
 * HTML/CSS（钓鱼 UI、属性选择器信标外传等）。此处统一做边界校验，非法值回退安全
 * 默认值——净化后的值再进模板插值。
 */

export const DEFAULT_CODE_BLOCK_MAX_HEIGHT = 600;
export const DEFAULT_EDITOR_MAX_WIDTH = 900;

/** CSS 数值：必须是有限正数且不超上限（防 `0;}</style><script>` 类注入与离谱值），否则回退 */
export function sanitizeCssNumber(value: unknown, fallback: number, max = 10000): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
        return fallback;
    }
    return Math.round(value);
}

/** 序列化模式白名单（值进入内联脚本 JSON 前必须收敛到枚举，防 `</script>` 逃逸） */
export function sanitizeSerializationMode(value: unknown): "clean" | "compatible" {
    return value === "compatible" ? "compatible" : "clean";
}
