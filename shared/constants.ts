// ─── 跨文件共享常量 ──────────────────────────────────────────
// Extension 端（Node）和 WebView 端（Browser）均可 import

/** 编辑器顶部工具栏默认高度（px），与 Crepe topbar 默认高度一致 */
export const DEFAULT_TOPBAR_HEIGHT = 40;

/** 视口边界留白（px），用于滚动定位时的上下边距 */
export const VIEWPORT_PADDING = 8;

/** openUrl 协议白名单（仅 http/https/mailto；file:/javascript:/自定义协议一律拒绝打开） */
export const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/** 从 URL 提取小写协议名（如 "https"）；非 scheme 形态返回空串 */
export function extractUrlScheme(url: string): string {
    return url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1].toLowerCase() ?? "";
}
