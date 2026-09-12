/**
 * Word 式多级列表标记（见 docs/specs/2026-09-12-word-style-multilevel-markers.md）。
 *
 * 只算「显示成什么」，不改文档：Markdown 源码仍是 `1.` / `-`，序列化与往返不受影响。
 * 层级按 3 档循环（Word 默认）：有序 1./a)/i.，无序 ●/■/◆。
 *
 * 为什么由 JS 算而不是纯 CSS：CSS 没有「层级」选择器（后代选择器只能表达"至少这么深"，
 * 拿到第 4 层就分不出回绕），而编号还要尊重列表的起始号（`order`，例如列表被退格断开后
 * 从 3 续号）。所以层级与序号在这里算好，CSS 只负责画。
 */

/** 3 档循环：第 n 层用第 ((n-1) % 3) 档 */
export const MARKER_LEVEL_CYCLE = 3;

export type MarkerKind = "ordered" | "bullet";

export interface ListMarker {
    /** 1..3，对应 ●/■/◆ 与 1./a)/i. */
    level: number;
    /** 有序列表的显示文本（含分隔符），如 `3.`、`a)`、`iv.`；无序为 null */
    text: string | null;
    /** 无序标记的 CSS 形状（写进自定义属性，见下） */
    bullet: { size: string; radius: string; rotate: string };
}

/**
 * 无序标记的三档形状（画成 CSS 图形，不依赖字体字形）。
 *
 * 写成 CSS 自定义属性的值而不是"层级 class + 层级选择器"：层级选择器只能表达
 * "某层及其后代"，第四层项会连带命中祖先层的规则，回绕就失效（实测：第 4 层仍显示
 * 第 3 层的 ◆）。自定义属性由**最近的祖先**决定，天然只作用于该项本身。
 */
const BULLET_SHAPES: Record<number, { size: string; radius: string; rotate: string }> = {
    1: { size: "6px", radius: "50%", rotate: "0deg" },   // ● 实心圆
    2: { size: "5px", radius: "1px", rotate: "0deg" },   // ■ 实心方块
    3: { size: "5px", radius: "1px", rotate: "45deg" },  // ◆ 实心菱形
};

/** 小写罗马数字（1..3999；超出范围退回十进制，不抛错） */
export function toLowerRoman(value: number): string {
    if (!Number.isFinite(value) || value < 1 || value > 3999) { return String(value); }
    const table: Array<[number, string]> = [
        [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
        [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
    ];
    let rest = Math.floor(value);
    let out = "";
    for (const [n, s] of table) {
        while (rest >= n) { out += s; rest -= n; }
    }
    return out;
}

/** 小写字母序号（1 → a，26 → z，27 → aa） */
export function toLowerAlpha(value: number): string {
    if (!Number.isFinite(value) || value < 1) { return String(value); }
    let rest = Math.floor(value);
    let out = "";
    while (rest > 0) {
        const rem = (rest - 1) % 26;
        out = String.fromCharCode(97 + rem) + out;
        rest = Math.floor((rest - 1) / 26);
    }
    return out;
}

/**
 * 计算某项应显示的标记。
 *
 * @param kind  列表类型（任务项由调用方排除，不在此处理）
 * @param depth 嵌套层级，从 1 开始
 * @param index 项在本列表内的序号，从 0 开始
 * @param order 列表起始号（Markdown 的首项编号，缺省 1）
 */
export function computeListMarker(kind: MarkerKind, depth: number, index: number, order = 1): ListMarker {
    const level = ((Math.max(1, Math.floor(depth)) - 1) % MARKER_LEVEL_CYCLE) + 1;
    const bullet = BULLET_SHAPES[level];
    if (kind === "bullet") { return { level, text: null, bullet }; }
    const ordinal = Math.max(1, Math.floor(order)) + Math.max(0, Math.floor(index));
    if (level === 1) { return { level, text: `${ordinal}.`, bullet }; }
    if (level === 2) { return { level, text: `${toLowerAlpha(ordinal)})`, bullet }; }
    return { level, text: `${toLowerRoman(ordinal)}.`, bullet };
}
