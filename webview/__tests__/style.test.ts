import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_COLLAPSED_ATTRIBUTE, TINY_REAL_ATTRIBUTE } from "../utils/viewportLedger";

const styleCss = readFileSync(
    path.resolve(process.cwd(), "webview/style.css"),
    "utf-8",
);
const topBarOverflowCss = readFileSync(
    path.resolve(process.cwd(), "webview/components/topBarOverflow/topBarOverflow.css"),
    "utf-8",
);
const headingCss = readFileSync(
    path.resolve(process.cwd(), "webview/heading.css"),
    "utf-8",
);

describe("WebView 样式", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.head.innerHTML = `<style>${styleCss}</style><style>${topBarOverflowCss}</style><style>${headingCss}</style>`;
        document.body.innerHTML = "";
    });

    it("顶栏包含弹出菜单时 应该 允许菜单溢出容器", () => {
        document.body.innerHTML = `
            <div class="milkdown">
                <div class="milkdown-top-bar">
                    <div class="top-bar-inner">
                        <div class="top-bar-heading-selector">
                            <div class="top-bar-heading-dropdown"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const inner = document.querySelector<HTMLElement>(".top-bar-inner");

        expect(inner).not.toBeNull();
        expect(getComputedStyle(inner!).overflow).toBe("visible");
    });

    it("溢出菜单相关样式 应该 存在且隐藏 class 生效", () => {
        document.body.innerHTML = `
            <button class="epytor-topbar-more-btn">⋯</button>
            <div class="epytor-topbar-overflow-menu"></div>
            <div class="top-bar-item top-bar-item--overflow-hidden"></div>
        `;
        const hiddenItem = document.querySelector<HTMLElement>(".top-bar-item--overflow-hidden");
        expect(hiddenItem).not.toBeNull();
        expect(getComputedStyle(hiddenItem!).display).toBe("none");
        const moreBtn = document.querySelector<HTMLElement>(".epytor-topbar-more-btn");
        expect(getComputedStyle(moreBtn!).position).toBe("fixed");
        const menu = document.querySelector<HTMLElement>(".epytor-topbar-overflow-menu");
        expect(getComputedStyle(menu!).position).toBe("fixed");
    });

    it("吸顶条 hidden 属性 应该 真正隐藏（回归：display:flex 曾覆盖 UA 的 hidden 样式）", () => {
        document.body.innerHTML = `
            <div class="heading-sticky-title" hidden>
                <span class="heading-sticky-text">标题</span>
            </div>
            <div class="heading-sticky-title">
                <span class="heading-sticky-text">可见标题</span>
            </div>
        `;
        const [hiddenSticky, visibleSticky] =
            document.querySelectorAll<HTMLElement>(".heading-sticky-title");
        // 根因回归：.heading-sticky-title 声明了 display:flex，
        // 若没有 [hidden] 兜底规则，hidden 属性会被 flex 覆盖导致吸顶条无法消失
        expect(getComputedStyle(hiddenSticky).display).toBe("none");
        expect(getComputedStyle(visibleSticky).display).toBe("flex");
    });

    it("溢出「⋯」按钮 hidden 属性 应该 真正隐藏（回归：display:inline-flex 曾覆盖 UA 的 hidden 样式）", () => {
        document.body.innerHTML = `
            <button class="epytor-topbar-more-btn" hidden>⋯</button>
            <button class="epytor-topbar-more-btn">⋯</button>
        `;
        const [hiddenBtn, visibleBtn] =
            document.querySelectorAll<HTMLElement>(".epytor-topbar-more-btn");
        expect(getComputedStyle(hiddenBtn).display).toBe("none");
        expect(getComputedStyle(visibleBtn).display).toBe("inline-flex");
    });

    it("表格整行/整列选中工具栏 应该 有 VSCode 变量主题适配规则（回归：官方浅色/独立配色未适配）", () => {
        // cell-handle 是 Vue overlay，祖先链含 .milkdown-table-block；与官方同前缀靠后覆盖
        expect(styleCss).toContain(".milkdown-table-block .cell-handle .button-group");
        expect(styleCss).toContain("--vscode-editorWidget-background");
        expect(styleCss).toContain("--vscode-toolbar-hoverBackground");
    });

    it("表格单元格内自动链接 应该 强制任意处断行（回归：inline 元素 break-word 不强制断，长 URL 撑宽页面）", () => {
        // 7.22.1 真实 DOM：table 直接在 .ProseMirror 下
        expect(styleCss).toContain(".milkdown .ProseMirror table td a");
        expect(styleCss).toContain("overflow-wrap: anywhere");
    });

    it("codeBlockMaxHeight 注入的 CSS 变量 应该 有消费规则（回归：零消费方=死配置）", () => {
        expect(styleCss).toContain("var(--code-block-max-height)");
    });

    it("折叠期守卫 应该 由 JS 记账属性驱动，而不是精确尺寸媒体查询（回归：窗口缩放让媒体查询失效）", () => {
        // 判据与 JS 常量同源：viewportLedger 改属性名时这条会红
        expect(styleCss).toContain(`html[${HOST_COLLAPSED_ATTRIBUTE}] .milkdown-top-bar`);
        expect(styleCss).toContain(`html[${HOST_COLLAPSED_ATTRIBUTE}] body {`);
        expect(styleCss).toContain("var(--epytor-last-body-width, 100%)");
        // 精确尺寸的媒体查询在 window.zoomLevel ≠ 0 时不匹配（实测 innerWidth=300 却 mq=false），
        // 会让整块守卫静默失效——禁止再退回这种写法
        expect(styleCss).not.toContain("@media (width: 300px) and (height: 150px)");
    });

    it("折叠期 应该 关闭顶栏/目录/浮动工具栏模糊（回归：合成器重建图层推迟首帧，小画面偶发可见）", () => {
        const start = styleCss.indexOf("折叠期几何守卫");
        expect(start).toBeGreaterThanOrEqual(0);
        const foldBlock = styleCss.slice(start, styleCss.indexOf("/* Milkdown 根容器 */", start));
        expect(foldBlock).toContain("backdrop-filter: none !important");
        expect(foldBlock).toContain(".milkdown-top-bar");
        expect(foldBlock).toContain(".milkdown-toolbar");
        expect(foldBlock).toContain(".toc-panel");
        expect(foldBlock).toContain(".toc-toggle-tab");
    });

    it("折叠期正文版式 应该 钉住上次真实宽度（回归：折叠期按 300px 重排，切回那一帧整篇重新折行）", () => {
        const start = styleCss.indexOf("折叠期几何守卫");
        const foldBlock = styleCss.slice(start, styleCss.indexOf("/* Milkdown 根容器 */", start));
        expect(foldBlock).toContain(`html[${HOST_COLLAPSED_ATTRIBUTE}] body {`);
        expect(foldBlock).toContain("width: var(--epytor-last-body-width, 100%)");
        expect(foldBlock).toContain("overflow-x: clip");
    });

    it("折叠期 应该 不画固定 UI、但保留正文（回归：整块隐藏会变成「整个页面闪一次」）", () => {
        const start = styleCss.indexOf("折叠期几何守卫");
        const foldBlock = styleCss.slice(start, styleCss.indexOf("/* Milkdown 根容器 */", start));
        // 固定 UI 折叠期不画：裁切边界落在顶栏按钮/标题字形中间最像坏掉
        expect(foldBlock).toMatch(new RegExp(`html\\[${HOST_COLLAPSED_ATTRIBUTE}\\] \\.milkdown-top-bar,\\s*\\n`));
        expect(foldBlock).toMatch(new RegExp(`html\\[${HOST_COLLAPSED_ATTRIBUTE}\\] \\.milkdown-toolbar,\\s*\\n`));
        // 正文必须留着：整块 visibility:hidden 会让切回时先空一下（用户反馈「整个页面闪一次」）
        expect(foldBlock).not.toContain("body > * {");
        // 必须保留布局：display:none 会真的重排并破坏滚动位置
        expect(foldBlock).not.toMatch(/display:\s*none/);
    });

    it("重建期加载点阵 应该 已移除（中间态只留主题背景，对齐官方预览观感）", () => {
        expect(styleCss).not.toContain("epytor-loading");
        expect(styleCss).not.toContain("epytor-matrix");
        expect(styleCss).not.toContain("epytor-dot-chase");
    });
});