import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_COLLAPSED_ATTRIBUTE } from "../utils/viewportLedger";

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

/** 去掉 CSS 注释（规则匹配必须跳过注释里的花括号/逗号） */
function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 折叠期几何守卫那一段 CSS（从注释标题到 Milkdown 根容器之前） */
function foldBlockCss(): string {
    const start = styleCss.indexOf("折叠期几何守卫");
    expect(start).toBeGreaterThanOrEqual(0);
    return styleCss.slice(start, styleCss.indexOf("/* Milkdown 根容器 */", start));
}

/**
 * 找出满足条件的规则（选择器列表包含给定选择器），返回完整选择器集合与声明体。
 * 让断言看行为（覆盖了哪些元素、声明了什么），而不是在整段 CSS 里找字符串。
 * `bodyIncludes` 用于在多个同选择器规则中挑出目标那条（例如钉宽度 vs 隐藏）。
 */
function findRule(selector: string, bodyIncludes?: string): { selectors: string[]; body: string } | null {
    for (const m of stripComments(styleCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
        if (!selectors.includes(selector)) { continue; }
        if (bodyIncludes && !m[2].includes(bodyIncludes)) { continue; }
        return { selectors, body: m[2] };
    }
    return null;
}

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
        const foldBlock = foldBlockCss();
        expect(foldBlock).toContain("backdrop-filter: none !important");
    });

    it("折叠期正文版式 应该 钉住上次真实宽度（回归：折叠期按 300px 重排，切回那一帧整篇重新折行）", () => {
        const foldBlock = foldBlockCss();
        expect(foldBlock).toContain(`html[${HOST_COLLAPSED_ATTRIBUTE}] body {`);
        expect(foldBlock).toContain("width: var(--epytor-last-body-width, 100%)");
        expect(foldBlock).toContain("overflow-x: clip");
    });

    /**
     * 折叠期「不画固定 UI」的行为级断言：解析出该规则的**选择器集合与声明体**，
     * 断言覆盖哪些元素、声明了什么——而不是在整段 CSS 里找字符串
     * （字符串断言删掉整条规则也会绿，且改换行/顺序就误红）。
     */
    it("折叠期 应该 不画固定 UI、但保留正文（回归：整块隐藏会变成「整个页面闪一次」）", () => {
        const rule = findRule(`html[${HOST_COLLAPSED_ATTRIBUTE}] .milkdown-top-bar`, "visibility: hidden");
        expect(rule).not.toBeNull();
        // 声明体：隐藏但保留布局（display:none 会真的重排并破坏滚动位置）
        expect(rule!.body).toContain("visibility: hidden");
        expect(rule!.body).not.toMatch(/display:\s*none/);
        // 选择器集合：顶栏、浮动工具栏、目录、以及挂 body 的固定浮层都要覆盖
        for (const sel of [
            ".milkdown-top-bar",
            ".milkdown-toolbar",
            ".toc-panel",
            ".toc-toggle-tab",
            ".epytor-topbar-more-btn",
            ".epytor-topbar-overflow-menu",
            ".find-bar",
            ".epytor-notice",
        ]) {
            expect(rule!.selectors).toContain(`html[${HOST_COLLAPSED_ATTRIBUTE}] ${sel}`);
        }
        // 正文必须留着：整块隐藏（body 直接子元素全隐）会让切回时先空一下
        const hidden = [...stripComments(styleCss).matchAll(/([^{}]+)\{([^}]*visibility:\s*hidden[^}]*)\}/g)]
            .map((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")))
            .flat()
            .filter((sel) => sel.includes(`[${HOST_COLLAPSED_ATTRIBUTE}]`));
        expect(hidden.some((sel) => /\bbody\s*>\s*\*/.test(sel) || sel.endsWith("body"))).toBe(false);
    });

    it("重建期加载点阵 应该 已移除（中间态只留主题背景，对齐官方预览观感）", () => {
        expect(styleCss).not.toContain("epytor-loading");
        expect(styleCss).not.toContain("epytor-matrix");
        expect(styleCss).not.toContain("epytor-dot-chase");
    });

    /**
     * 排版尺度：四个用户可感知的症状各自对应一条不可回退的声明。
     * 量测口径见各条注释（真实 dist 产物 + Chromium 实测，2026-09-11）。
     */
    it("段落 应该 只用下内边距表达段间距（回归：Crepe 主题的 4px 上内边距顶开首行，让容器上下留白处处不等）", () => {
        const rule = findRule(".milkdown .ProseMirror p", "--epytor-paragraph-gap");
        expect(rule).not.toBeNull();
        // 上内边距必须为 0：它是「标记不对齐 / 引用块上下不等 / 单元格上下不等」的共同根因
        expect(rule!.body).toMatch(/padding:\s*0 0 var\(--epytor-paragraph-gap\)/);
        expect(rule!.body).not.toContain("padding-top");
        expect(rule!.body).not.toContain("padding-bottom");
    });

    it("列表标记盒 应该 与首行行盒同高（回归：标记盒 1.6em vs 行盒 21px，标记比同行文字中心高 3.3px）", () => {
        const rule = findRule(
            ".milkdown .milkdown-list-item-block li .label-wrapper",
            "--epytor-list-line-height",
        );
        expect(rule).not.toBeNull();
        expect(rule!.body).toContain("height: calc(var(--epytor-list-line-height) * 1em)");
        // 标记本体（.label）必须同高，且与 wrapper 同一条规则里声明
        expect(rule!.selectors).toContain(
            ".milkdown .milkdown-list-item-block li .label-wrapper .label",
        );
    });

    it("列表项段落 应该 不留段间距、行高与标记盒同源（回归：相邻项净空 20.8px ≈ 一整行）", () => {
        const rule = findRule(".milkdown .ProseMirror .milkdown-list-item-block p");
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/padding:\s*0\b/);
        expect(rule!.body).toContain("line-height: var(--epytor-list-line-height)");
    });

    it("列表嵌套 应该 不再叠加额外 padding-left（回归：每级步长 55px，标记列 + 1.5em 两段叠加）", () => {
        const rule = findRule(".milkdown .milkdown-list-item-block .milkdown-list-item-block");
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/padding-left:\s*0\b/);
    });

    it("列表标记列宽与间距 应该 走变量（缩进步长 = 两者之和，改一处即可统一）", () => {
        const width = findRule(".milkdown .milkdown-list-item-block li .label-wrapper", "width:");
        expect(width).not.toBeNull();
        expect(width!.body).toContain("width: var(--epytor-list-marker-width)");
        const gap = findRule(".milkdown .milkdown-list-item-block > .list-item", "gap:");
        expect(gap).not.toBeNull();
        expect(gap!.body).toContain("gap: var(--epytor-list-marker-gap)");
    });

    it("引用块末段 应该 贴底（回归：末段 1em 下内边距让上留白 12px、下留白 22px）", () => {
        const rule = findRule(".milkdown .ProseMirror blockquote > p:last-child");
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/padding-bottom:\s*0\b/);
    });

    it("表格单元格末段 应该 贴底（回归：上留白 12.5px、下留白 8.5px；且只贴末段，中间段仍留段间距）", () => {
        const td = findRule(".milkdown .ProseMirror td > p:last-child");
        const th = findRule(".milkdown .ProseMirror th > p:last-child");
        expect(td).not.toBeNull();
        expect(th).not.toBeNull();
        expect(td!.body).toMatch(/padding-bottom:\s*0\b/);
        // 裸 `td > p` 会把中间段也贴平——必须带 :last-child
        expect(findRule(".milkdown .ProseMirror td > p")).toBeNull();
    });

    it("软换行 应该 只断行不占位（回归：display:block 让每处软换行多出一整行空白，两行文字排成 3 个行盒）", () => {
        const rule = findRule(
            '.milkdown span[data-type="hardbreak"][data-is-inline="true"]',
        );
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/display:\s*block/);
        expect(rule!.body).toMatch(/height:\s*0\b/);
    });

    it("顶栏 应该 不使用 backdrop-filter（回归：常驻 fixed 元素 + 背景滤镜，切换标签时顶栏那一条还停在旧画面）", () => {
        const rule = findRule(".milkdown .milkdown-top-bar", "background:");
        expect(rule).not.toBeNull();
        expect(rule!.body).not.toContain("backdrop-filter");
        // 底色必须不透明，否则去掉模糊后正文会直接透出来
        expect(rule!.body).not.toMatch(/background:[^;]*transparent/);
    });
});