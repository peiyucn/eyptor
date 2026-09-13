import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeOverflow, type TopBarMeasuredItem } from "../utils/topBarOverflow";
import { initTopBarOverflow } from "../components/topBarOverflow";
import { IFRAME_DEFAULT_HEIGHT, IFRAME_DEFAULT_WIDTH, TINY_REAL_ATTRIBUTE } from "../utils/viewportLedger";

/** 改写 jsdom 视口尺寸（只读属性需 defineProperty） */
function setViewport(width: number, height: number): void {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

function makeItems(widths: number[]): TopBarMeasuredItem[] {
    return widths.map((width, index) => ({ key: `item-${index}`, width }));
}

describe("computeOverflow", () => {
    it("容器足够宽时 应该 不收起任何项", () => {
        const items = makeItems([40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 200, moreBtnWidth: 30 });
        expect(hidden.size).toBe(0);
    });

    it("超出时 应该 从右往左收起", () => {
        const items = makeItems([40, 40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 140, moreBtnWidth: 30 });
        expect(hidden).toEqual(new Set(["item-3", "item-2"]));
    });

    it("极端窄容器 应该 全部收起", () => {
        const items = makeItems([40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 20, moreBtnWidth: 30 });
        expect(hidden.size).toBe(3);
    });

    it("固定项 应该 优先保留（跳过收起）", () => {
        const items: TopBarMeasuredItem[] = [
            { key: "heading", width: 60 },
            { key: "b", width: 40 },
            { key: "c", width: 40 },
            { key: "d", width: 40 },
        ];
        // 预算 130-30=100：heading(60)+b(40) 可容纳，d/c 收起
        const hidden = computeOverflow({
            items,
            containerWidth: 130,
            moreBtnWidth: 30,
            pinnedKeys: new Set(["heading"]),
        });
        expect(hidden.has("heading")).toBe(false);
        expect(hidden).toEqual(new Set(["d", "c"]));
    });
});

/**
 * 生命周期回归：dispose() 必须把 init 时注册的 window resize 监听器摘干净。
 *
 * 回归：dispose 里写的是 removeEventListener("resize", schedule)，而注册的是
 * scheduleUnlessCollapsed——不是同一引用，监听器留在 window 上。编辑器每次重建
 * （切源码再切回、revert、窗口重载）都泄漏一个，之后每次窗口缩放都会对已销毁的实例
 * 再跑一次测量（getTopBarEl / DOM 查询 / rAF）。
 */
describe("initTopBarOverflow 生命周期", () => {
    /** 可控 rAF：measure 何时执行由测试决定 */
    let rafQueue: FrameRequestCallback[];
    /** dispose 里 disconnect 次数（RO 是否释放） */
    let observerDisconnects: number;

    class FakeResizeObserver {
        observe(): void { /* noop */ }
        unobserve(): void { /* noop */ }
        disconnect(): void { observerDisconnects++; }
    }

    const flushRaf = (): void => {
        const queue = rafQueue;
        rafQueue = [];
        for (const cb of queue) { cb(0); }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        rafQueue = [];
        observerDisconnects = 0;
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.documentElement.removeAttribute(TINY_REAL_ATTRIBUTE);
        setViewport(1024, 768);
        document.body.innerHTML = "";
    });

    it("dispose 后窗口缩放 应该 不再测量（监听器已释放）", () => {
        const getTopBarEl = vi.fn(() => null);
        const ctl = initTopBarOverflow({ getTopBarEl, runItem: vi.fn() });
        flushRaf(); // init 末尾的首次测量
        const measured = getTopBarEl.mock.calls.length;
        expect(measured).toBeGreaterThan(0);

        ctl.dispose();
        window.dispatchEvent(new Event("resize"));
        flushRaf();

        // 修复前：注册的是 scheduleUnlessCollapsed、移除的是 schedule → 监听器仍在，
        // 这次 resize 会把已 dispose 的实例再测一次
        expect(getTopBarEl).toHaveBeenCalledTimes(measured);
        expect(observerDisconnects).toBe(1);
    });

    it("真实小窗口（用户在 300×150 下操作过） 应该 照常测量（回归 A6）", () => {
        const getTopBarEl = vi.fn(() => null);
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        // 折叠读数 + 用户输入标记 = 用户真把编辑区缩到了这个尺寸
        document.documentElement.setAttribute(TINY_REAL_ATTRIBUTE, "");

        const ctl = initTopBarOverflow({ getTopBarEl, runItem: vi.fn() });
        flushRaf();
        const measured = getTopBarEl.mock.calls.length;
        expect(measured).toBeGreaterThan(0);

        window.dispatchEvent(new Event("resize"));
        flushRaf();

        // 不测量的话按钮会保持上一次真实宽度的排版，在实际 285px 宽的顶栏里溢出
        expect(getTopBarEl).toHaveBeenCalledTimes(measured + 1);
        ctl.dispose();
    });

    it("宿主折叠读数（没有任何用户输入） 应该 跳过测量（顶栏不闪）", () => {
        const getTopBarEl = vi.fn(() => null);
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);

        const ctl = initTopBarOverflow({ getTopBarEl, runItem: vi.fn() });
        flushRaf();
        const measured = getTopBarEl.mock.calls.length;
        expect(measured).toBeGreaterThan(0);

        window.dispatchEvent(new Event("resize"));
        flushRaf();

        expect(getTopBarEl).toHaveBeenCalledTimes(measured);
        ctl.dispose();
    });

    it("dispose 移除的 resize 处理器 应该 与注册的是同一引用", () => {
        const addSpy = vi.spyOn(window, "addEventListener");
        const removeSpy = vi.spyOn(window, "removeEventListener");
        const ctl = initTopBarOverflow({ getTopBarEl: () => null, runItem: vi.fn() });

        const added = addSpy.mock.calls.filter((call) => call[0] === "resize").map((call) => call[1]);
        ctl.dispose();
        const removed = removeSpy.mock.calls.filter((call) => call[0] === "resize").map((call) => call[1]);

        expect(added).toHaveLength(1);
        expect(removed).toContain(added[0]);
    });
});
