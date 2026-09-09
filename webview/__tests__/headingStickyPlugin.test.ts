/**
 * 标题吸顶完整链路回归测试：真实 createEditor + 桩测布局 rect。
 * 回归：D7 顶层标题过滤用 doc.forEach offset（节点起始）与
 * posAtDOM(元素, 0)（起始 + 1）直接比对，恒差 1 → 缓存恒空 →
 * 吸顶条永远隐藏（用户报告「标题吸顶整个没了」）。
 * 回归（本轮）：切换时机改为「标题顶边碰到吸顶行即固定」（对齐 VS Code 内置编辑器），
 * 旧实现要等标题整体滚出顶栏，晚一个标题高度。
 */
import { describe, expect, it, vi } from "vitest";
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

let scrollY = 150;
Object.defineProperty(window, "scrollY", { get: () => scrollY, configurable: true });

class FakeResizeObserver {
    /** 全部实例：测试用 fireResize 精确触发某个 target 的回调 */
    static instances: FakeResizeObserver[] = [];
    private cb: ResizeObserverCallback;
    targets: Element[] = [];
    constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        FakeResizeObserver.instances.push(this);
    }
    observe(target: Element): void {
        this.targets.push(target);
        // 模拟真实 RO 的初始回调（布局完成后触发）
        setTimeout(() => this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver), 0);
    }
    unobserve(): void { /* noop */ }
    disconnect(): void { this.targets = []; }
    fire(target: Element): void {
        this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
}
(window as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver;

/** 触发所有观测该 target 的 RO 回调（模拟一次真实布局变化） */
function fireResize(target: Element): void {
    for (const instance of FakeResizeObserver.instances) {
        if (instance.targets.includes(target)) {
            instance.fire(target);
        }
    }
}

const HEADING_HEIGHT = 40;
const TOPBAR_BOTTOM = 36;

/** 标题的视口几何（可变量：测试里模拟「正文容器只平移/改宽度」的布局变化） */
let headingLeft = 100;
let headingWidth = 800;

/** 建编辑器 + 桩测每个标题的布局（docTop 由调用方给，视口坐标随 scrollY 换算） */
async function mountWithStubLayout(
    lines: string[],
    docTopOf: (index: number) => number,
): Promise<HTMLElement> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = await createEditor(root, lines.join("\n"), () => {});
    void editor;

    let index = 0;
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
        const docTop = docTopOf(index++);
        (el as HTMLElement).getBoundingClientRect = () =>
            ({
                width: headingWidth,
                height: HEADING_HEIGHT,
                top: docTop - scrollY,
                bottom: docTop + HEADING_HEIGHT - scrollY,
                left: headingLeft,
                right: headingLeft + headingWidth,
                x: headingLeft,
                y: docTop - scrollY,
                toJSON: () => ({}),
            }) as DOMRect;
    });
    const topbar = root.querySelector(".milkdown-top-bar") as HTMLElement | null;
    if (topbar) {
        topbar.getBoundingClientRect = () =>
            ({ width: 800, height: TOPBAR_BOTTOM, top: 0, bottom: TOPBAR_BOTTOM, left: 0, right: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
    // 正文容器要够高（最后一个章节的底边取内容底边；jsdom 无布局会得到 0）
    const prose = root.querySelector(".ProseMirror") as HTMLElement | null;
    if (prose) {
        prose.getBoundingClientRect = () =>
            ({ width: 800, height: 5000, top: 0, bottom: 5000, left: 0, right: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
    return root;
}

/** 触发一次滚动更新，等 RO 初始回调 + 300ms 缓存重建 + rAF */
async function settle(): Promise<void> {
    window.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
}

const stickyEl = () => document.querySelector<HTMLElement>(".heading-sticky-title");

describe("标题吸顶完整链路", () => {
    it("标题顶边碰到吸顶行 应该 立即吸顶该标题（旧实现要等整体滚出，晚一个标题高度）", async () => {
        // 标题 i 的 docTop = 60 + i*120；scrollY=150 时标题 1 的顶边 = 30（已越过顶栏底 36）
        scrollY = 150;
        const root = await mountWithStubLayout(
            Array.from({ length: 10 }, (_, i) => `## 标题 ${i}\n正文一行\n正文两行`).flatMap((s) => s.split("\n")),
            (i) => 60 + i * 120,
        );
        await settle();

        const sticky = stickyEl();
        expect(sticky).not.toBeNull();
        expect(sticky!.hidden).toBe(false);
        expect(sticky!.textContent).toContain("标题 1");

        destroyEditor();
        root.remove();
    }, 60000);

    it("下一个标题尚未碰到吸顶行 应该 保持上一个标题", async () => {
        // scrollY=100 时标题 1 的顶边 = 80（仍在吸顶行下方）
        scrollY = 100;
        const root = await mountWithStubLayout(
            Array.from({ length: 10 }, (_, i) => `## 标题 ${i}\n正文一行\n正文两行`).flatMap((s) => s.split("\n")),
            (i) => 60 + i * 120,
        );
        await settle();

        const sticky = stickyEl();
        expect(sticky!.hidden).toBe(false);
        expect(sticky!.textContent).toContain("标题 0");
        expect(sticky!.textContent).not.toContain("标题 1");

        destroyEditor();
        root.remove();
    }, 60000);

    it("点击第一级吸顶行 应该 跳回文档第一个标题（回归：pos=0 被 pos>0 挡掉，点了没反应）", async () => {
        // scrollY=100：第一个标题已越过吸顶行，第二个标题尚未碰到 → 只显示第一级
        scrollY = 100;
        const root = await mountWithStubLayout(
            Array.from({ length: 10 }, (_, i) => `## 标题 ${i}\n正文一行\n正文两行`).flatMap((s) => s.split("\n")),
            (i) => 60 + i * 120,
        );
        await settle();

        const rows = Array.from(stickyEl()!.querySelectorAll<HTMLElement>(".heading-sticky-row"));
        expect(rows).toHaveLength(1);
        expect(rows[0].dataset["headingPos"]).toBe("0");

        const scrollTo = vi.fn();
        const original = window.scrollTo;
        window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
        try {
            rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            expect(scrollTo).toHaveBeenCalledTimes(1);
            const arg = scrollTo.mock.calls[0][0] as { top: number };
            expect(Number.isFinite(arg.top)).toBe(true);
        } finally {
            window.scrollTo = original;
        }

        destroyEditor();
        root.remove();
    }, 60000);

    it("多级标题 应该 逐级显示（源码形式行：外层在上、内层在下）", async () => {
        // h1@60、h3@190；scrollY=150 → 第一行 y=36 落在 h1 章节内，第二行 y=58 落在 h3 内
        scrollY = 150;
        const root = await mountWithStubLayout(
            ["# 一级", "正文", "### 三级", "正文"],
            (i) => (i === 0 ? 60 : 190),
        );
        await settle();

        const sticky = stickyEl();
        expect(sticky!.hidden).toBe(false);
        const rows = Array.from(sticky!.querySelectorAll<HTMLElement>(".heading-sticky-row"));
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain("一级");
        expect(rows[1].textContent).toContain("三级");
        expect(rows[0].querySelector(".heading-sticky-marker")?.textContent).toBe("#");
        expect(rows[1].querySelector(".heading-sticky-marker")?.textContent).toBe("###");

        destroyEditor();
        root.remove();
    }, 60000);

    it("目录开合改变正文可用宽度 应该 立即重算吸顶条几何（回归：要滑动一下才自适应宽度）", async () => {
        scrollY = 150;
        headingLeft = 100;
        headingWidth = 800;
        const root = await mountWithStubLayout(
            Array.from({ length: 10 }, (_, i) => `## 标题 ${i}\n正文一行\n正文两行`).flatMap((s) => s.split("\n")),
            (i) => 60 + i * 120,
        );
        await settle();

        const sticky = stickyEl();
        expect(sticky!.hidden).toBe(false);
        expect(sticky!.style.left).toBe("100px");
        expect(sticky!.style.width).toBe("800px");

        // 目录钉住：正文靠 body 的 padding-left 让位。正文容器已达 max-width，
        // 于是正文只平移/改宽而 view.dom 尺寸可以完全不变——默认 border-box 的
        // ResizeObserver 收不到，吸顶条会停在旧几何直到用户滚动一次。
        headingLeft = 200;
        headingWidth = 600;
        fireResize(document.body);
        await new Promise((r) => requestAnimationFrame(() => r(null)));

        expect(sticky!.style.left).toBe("200px");
        expect(sticky!.style.width).toBe("600px");

        headingLeft = 100;
        headingWidth = 800;
        destroyEditor();
        root.remove();
    }, 60000);
});
