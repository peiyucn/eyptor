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
/** 与 package.json contributes.configuration 的 minimum 对齐（out-of-range 一律回退默认值） */
export const MIN_CODE_BLOCK_MAX_HEIGHT = 100;
export const MIN_EDITOR_MAX_WIDTH = 400;
/** 与 schema 的 maximum 对齐 */
export const MAX_CSS_NUMBER = 10_000;

/**
 * CSS 数值：必须是有限数且落在 [min, max] 内（防 `0;}</style><script>` 类注入与离谱值），
 * 否则回退。min/max 与配置 schema 的 minimum/maximum 保持同一口径。
 */
export function sanitizeCssNumber(
    value: unknown,
    fallback: number,
    min = 1,
    max = MAX_CSS_NUMBER,
): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        return fallback;
    }
    return Math.round(value);
}

/** 序列化模式白名单（值进入内联脚本 JSON 前必须收敛到枚举，防 `</script>` 逃逸） */
export function sanitizeSerializationMode(value: unknown): "clean" | "compatible" {
    return value === "compatible" ? "compatible" : "clean";
}
