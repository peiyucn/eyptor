/**
 * 项目统一图标库（Lucide 风格内联 SVG）
 * 规范：viewBox="0 0 24 24" width="16" height="16" fill="none"
 *       stroke="currentColor" stroke-width="2"
 *       stroke-linecap="round" stroke-linejoin="round"
 */

const attrs = `width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${content}</svg>`;

/** Crepe 工具栏按钮专用：24×24 + 88% 缩放，对齐原生图标视觉重量 */
const tbAttrs = `width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="fill:none!important"`;
const tbIcon = (d: string) => `<svg xmlns=\"http://www.w3.org/2000/svg\" ${tbAttrs}><g transform=\"matrix(0.88 0 0 0.88 1.5 1.5)\">${d}</g></svg>`;

// ── 通用操作 ──────────────────────────────────────────────
export const IconCheck = svg(`<polyline points="20 6 9 17 4 12"/>`);
export const IconX = svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`);
export const IconChevronDown  = svg(`<polyline points="6 9 12 15 18 9"/>`);
export const IconChevronUp    = svg(`<polyline points="18 15 12 9 6 15"/>`);
export const IconChevronRight = svg(`<polyline points="9 18 15 12 9 6"/>`);
export const IconTrash2      = svg(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`);
export const IconPencil      = svg(`<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>`);
export const IconZoomIn      = svg(`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>`);
export const IconImageOff    = svg(`<line x1="2" y1="2" x2="22" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><path d="M13.5 6H5a2 2 0 0 0-2 2v10"/><path d="M14.528 14.528 19 19"/><path d="M21 15V8a2 2 0 0 0-2-2h-1"/><path d="m7 21 3.43-3.43"/>`);
export const IconMaximize2   = svg(`<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`);
export const IconResetZoom   = svg(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`);
export const IconPin = svg(`<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>`);
export const IconChevronsUp   = svg(`<path d="m7 11 5-5 5 5"/><path d="m7 18 5-5 5 5"/>`);
export const IconChevronsDown = svg(`<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>`);

// ── 工具栏版（24×24 + 88%，供 Crepe buildTopBar 使用）────────
export const TbUndo  = tbIcon(`<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>`);
export const TbRedo  = tbIcon(`<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>`);
export const TbToc = tbIcon(`<line x1="3" y1="5" x2="21" y2="5"/><line x1="7" y1="10" x2="21" y2="10"/><line x1="11" y1="15" x2="21" y2="15"/><line x1="7" y1="20" x2="17" y2="20"/>`);
export const TbImage  = tbIcon(`<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`);
export const TbEraser = tbIcon(`<path d=\"m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c.9.9.9 2.5 0 3.4L13 21\"/><path d=\"M22 21H7\"/><path d=\"m5 11 9 9\"/>`);
export const TbGear   = tbIcon(`<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>`);
