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

describe("WebView 样式", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.head.innerHTML = `<style>${styleCss}</style><style>${topBarOverflowCss}</style>`;
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
});