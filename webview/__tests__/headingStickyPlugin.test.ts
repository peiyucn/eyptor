/**
 * 标题吸顶完整链路回归测试：真实 createEditor + 桩测布局 rect，
 * 滚动后吸顶条必须显示。
 * 回归：D7 顶层标题过滤用 doc.forEach offset（节点起始）与
 * posAtDOM(元素, 0)（起始 + 1）直接比对，恒差 1 → 缓存恒空 →
 * 吸顶条永远隐藏（用户报告「标题吸顶整个没了」）。
 */
import { describe, expect, it } from "vitest";
import { createEditor, destroyEditor } from "../editor";

if (typeof (window as unknown as Record<string, unknown>).IntersectionObserver === "undefined") {
    (window as unknown as Record<string, unknown>).IntersectionObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } takeRecords() { return []; }
    };
}
if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (() => ({
        matches: false, media: "", onchange: null,
        addListener() { /* noop */ }, removeListener() { /* noop */ },
        addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
        dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
}
(window as unknown as Record<string, unknown>).__i18n = {
    translations: {},
    isMac: false,
    debugMode: false,
    serializationMode: "clean",
};

/** 模拟布局：scrollY=150 时第一个标题（60..100）已滚出顶栏（36），应吸顶「标题 0」 */
let scrollY = 150;
Object.defineProperty(window, "scrollY", { get: () => scrollY, configurable: true });

class FakeResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
    }
    observe(target: Element): void {
        // 模拟真实 RO 的初始回调（布局完成后触发）
        setTimeout(() => this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver), 0);
    }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}
(window as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver;

describe("标题吸顶完整链路", () => {
    it("滚动后 应该 显示吸顶条且内容为已滚出的标题", async () => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        const lines: string[] = [];
        for (let i = 0; i < 10; i++) {
            lines.push(`## 标题 ${i}`);
            lines.push("正文一行");
            lines.push("正文两行");
        }
        const editor = await createEditor(root, lines.join("\n"), () => {});
        void editor;

        // 桩测布局 rect：标题 i 的文档坐标 = 60 + i*120（标题块高度 40）
        let headingIndex = 0;
        root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
            const i = headingIndex++;
            const docTop = 60 + i * 120;
            (el as HTMLElement).getBoundingClientRect = () =>
                ({
                    width: 800,
                    height: 40,
                    top: docTop - scrollY,
                    bottom: docTop + 40 - scrollY,
                    left: 100,
                    right: 900,
                    x: 100,
                    y: docTop - scrollY,
                    toJSON: () => ({}),
                }) as DOMRect;
        });
        const topbar = root.querySelector(".milkdown-top-bar") as HTMLElement | null;
        if (topbar) {
            topbar.getBoundingClientRect = () =>
                ({ width: 800, height: 36, top: 0, bottom: 36, left: 0, right: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        }

        // 触发滚动更新（插件监听 window scroll）；等待 RO 初始回调 + 300ms 缓存重建 + rAF
        window.dispatchEvent(new Event("scroll"));
        await new Promise((r) => setTimeout(r, 500));
        await new Promise((r) => requestAnimationFrame(() => r(null)));

        const sticky = document.querySelector<HTMLElement>(".heading-sticky-title");
        expect(sticky).not.toBeNull();
        expect(sticky!.hidden).toBe(false);
        expect(sticky!.textContent).toContain("标题 0");

        destroyEditor();
        root.remove();
    }, 60000);
});
