import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});