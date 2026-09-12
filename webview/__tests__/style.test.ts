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
    it("折叠期 应该 不画固定 UI（回归：顶栏那排按钮被裁成半块，最像「坏掉的小框」）", () => {
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
    });

    it("重建期加载点阵 应该 已移除（中间态只留主题背景，对齐官方预览观感）", () => {
        expect(styleCss).not.toContain("epytor-loading");
        expect(styleCss).not.toContain("epytor-matrix");
        expect(styleCss).not.toContain("epytor-dot-chase");
    });

    /**
     * 排版尺度：全文垂直间距只允许有一个来源（行高 + 块间距两档）。
     * 量测口径见各条注释（真实 dist 产物 + Chromium 实测，2026-09-11）。
     */
    it("所有块级元素 应该 共用同一个块间距（回归：列表项 2.8px / 引用块 4px / 表格 4px / 代码块 4px / 段落 18.2px / 分隔线 21px 各不相同）", () => {
        const rule = findRule(".milkdown .ProseMirror p", "margin: 0 0 var(--epytor-block-gap)");
        expect(rule).not.toBeNull();
        // 同一个块间距必须覆盖全部块级元素，不能只给段落
        for (const sel of [
            ".milkdown .ProseMirror ul",
            ".milkdown .ProseMirror ol",
            ".milkdown .ProseMirror pre",
            ".milkdown .ProseMirror blockquote",
            ".milkdown .ProseMirror hr",
            ".milkdown .ProseMirror .milkdown-table-block",
            ".milkdown .ProseMirror .milkdown-code-block",
            ".milkdown .ProseMirror .milkdown-image-block",
        ]) {
            expect(rule!.selectors).toContain(sel);
        }
    });

    it("行距 应该 单一口径：正文、列表项、标记盒取同一个行高（回归：body 1.6 与上游给 p 的 1.5 各管一段）", () => {
        const root = findRule(".milkdown .ProseMirror", "line-height: var(--epytor-line-height)");
        expect(root).not.toBeNull();
        // 列表项段落与标记盒都从同一个变量取行高，改一处即可统一
        const item = findRule(".milkdown .ProseMirror .milkdown-list-item-block p");
        expect(item).not.toBeNull();
        expect(item!.body).toContain("line-height: var(--epytor-line-height)");
        const marker = findRule(
            ".milkdown .milkdown-list-item-block li .label-wrapper",
            "height: calc(var(--epytor-line-height) * 1em)",
        );
        expect(marker).not.toBeNull();
        expect(marker!.selectors).toContain(
            ".milkdown .milkdown-list-item-block li .label-wrapper .label",
        );
    });

    it("段落 应该 上下内边距都为 0（回归：上游主题的 4px 上内边距顶开首行，让容器上下留白处处不等）", () => {
        const rule = findRule(".milkdown .ProseMirror p", "padding: 0");
        expect(rule).not.toBeNull();
        // 上内边距是「标记不对齐 / 引用块上下不等 / 单元格上下不等」的共同根因
        expect(rule!.body).not.toContain("padding-top");
        expect(rule!.body).not.toContain("padding-bottom");
    });

    it("标题 应该 取尺度里的 2× / 1× 档、且不随标题字号缩放（回归：0.8em/0.4em 让 h1 与下文隔 11.2px、h6 只隔 5.0px）", () => {
        const rule = findRule(
            ".milkdown .ProseMirror h1",
            "margin: var(--epytor-section-gap) 0 var(--epytor-block-gap)",
        );
        expect(rule).not.toBeNull();
        for (const tag of ["h2", "h3", "h4", "h5", "h6"]) {
            expect(rule!.selectors).toContain(`.milkdown .ProseMirror ${tag}`);
        }
        // 上游的 padding:2px 0 必须被清掉，否则标题上下又各多 2px
        expect(rule!.body).toMatch(/padding:\s*0\b/);
    });

    it("容器内的首末块 应该 贴边（回归：末块把外层节奏又叠一层，引用块上 12px / 下 22px）", () => {
        const last = findRule(".milkdown .ProseMirror blockquote > *:last-child");
        const first = findRule(".milkdown .ProseMirror blockquote > *:first-child");
        expect(last).not.toBeNull();
        expect(first).not.toBeNull();
        expect(last!.body).toMatch(/margin-bottom:\s*0\b/);
        expect(first!.body).toMatch(/margin-top:\s*0\b/);
        // 表格单元格同一口径
        expect(last!.selectors).toContain(".milkdown .ProseMirror td > *:last-child");
        expect(last!.selectors).toContain(".milkdown .ProseMirror th > *:last-child");
    });

    it("引用块与单元格内边距 应该 等于块间距（回归：块自身留白与文档节奏两套数字）", () => {
        const bq = findRule(".milkdown .ProseMirror blockquote", "--epytor-container-pad");
        expect(bq).not.toBeNull();
        expect(bq!.body).toContain(
            "padding: var(--epytor-container-pad) 12px var(--epytor-container-pad) 36px",
        );
        const cell = findRule(".milkdown .milkdown-table-block th", "--epytor-container-pad");
        expect(cell).not.toBeNull();
        expect(cell!.body).toContain("padding: var(--epytor-container-pad)");
        expect(cell!.selectors).toContain(".milkdown .milkdown-table-block td");
    });

    it("列表项 应该 用块间距排（回归：0.2em 叠在段落 1em 上，相邻项净空 20.8px ≈ 一整行）", () => {
        const rule = findRule(".milkdown .milkdown-list-item-block", "margin: 0 0 var(--epytor-block-gap)");
        expect(rule).not.toBeNull();
        // 最后一项不再自带一份，避免列表与下文出现双倍间距
        const last = findRule(".milkdown .ProseMirror ul > .milkdown-list-item-block:last-child");
        expect(last).not.toBeNull();
        expect(last!.body).toMatch(/margin-bottom:\s*0\b/);
    });

    it("列表项段落 应该 不留段间距（项间距由列表项自己的块间距给）", () => {
        const rule = findRule(".milkdown .ProseMirror .milkdown-list-item-block p");
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/margin-bottom:\s*0\b/);
        expect(rule!.body).toMatch(/padding:\s*0\b/);
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

    it("软换行 应该 只断行不占位（回归：display:block 让每处软换行多出一整行空白，两行文字排成 3 个行盒）", () => {
        const rule = findRule(
            '.milkdown span[data-type="hardbreak"][data-is-inline="true"]',
        );
        expect(rule).not.toBeNull();
        expect(rule!.body).toMatch(/display:\s*block/);
        expect(rule!.body).toMatch(/height:\s*0\b/);
    });

    it("折叠期 应该 把正文归成纯背景（回归：那 300×150 里残留「孤零零一个目录面板」像渲染坏了）", () => {
        const rule = findRule(`html[${HOST_COLLAPSED_ATTRIBUTE}] body`, "visibility: hidden");
        expect(rule).not.toBeNull();
        // 光靠 visibility 骗不住：子元素自己的 visibility:visible 会翻回来（实测目录面板就是这么
        // 活下来的），必须再压一层 opacity
        expect(rule!.body).toMatch(/opacity:\s*0\b/);
        // body 归空后画布底色由 <html> 提供，所以 html 必须自己有底色
        expect(stripComments(styleCss)).toMatch(/html,\s*body\s*\{[^}]*background-color/);
        // 反面：不允许再出现「失焦/失活即归空」——那会让点侧边栏、点当前标签都闪一下（回归实测）
        expect(styleCss).not.toContain("data-epytor-content-blank");
    });

    it("标题折叠按钮 应该 悬挑在正文列外、且与标题留出间距（回归：常规占位把 H 标题右推；靠右对齐让按钮贴住文字）", () => {
        const body = stripComments(headingCss).match(/\.heading-fold-gutter\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(body).not.toBe("");
        // 负 margin + 等宽：按钮整体挂到正文左缘之外
        expect(body).toMatch(/margin-left:\s*-\d+px/);
        const width = Number(body.match(/width:\s*(\d+)px/)?.[1] ?? 0);
        const buttonWidth = Number(
            stripComments(headingCss).match(/\.heading-fold-toggle\s*\{[^}]*width:\s*(\d+)px/)?.[1] ?? 0,
        );
        // 宽度要大于按钮自身，差额就是按钮与标题文字之间的间距（相等 = 贴在一起）
        expect(buttonWidth).toBeGreaterThan(0);
        expect(width).toBeGreaterThan(buttonWidth);
        // 按钮靠左，把间距留在右侧
        expect(body).toContain("justify-content: flex-start");
        // 反面：不能再留右外边距（那正是把标题文字推右的元凶）
        expect(body).not.toMatch(/margin-right:\s*[1-9]/);
    });
});