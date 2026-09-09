import { describe, it, expect, vi, afterEach } from "vitest";
import {
    INITIAL_VIEWPORT_FREEZE_STATE,
    IFRAME_DEFAULT_HEIGHT,
    IFRAME_DEFAULT_WIDTH,
    initViewportFreeze,
    isCollapsedViewport,
    isViewportFrozen,
    isViewportShrunk,
    nextViewportFreezeState,
    recordBodyWidth,
    type ViewportFreezeState,
} from "../utils/viewportFreeze";

/** 改写 jsdom 视口尺寸（只读属性需 defineProperty） */
function setViewport(width: number, height: number): void {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

/**
 * 宿主折叠态判定（回归：切到非 webview 标签时宿主把 webview 摘出布局，iframe 回落
 * 到 Chromium 默认尺寸 300×150，正文按 300px 重排再排回来 → 用户看到页面闪一下）。
 */
describe("isCollapsedViewport", () => {
    it("恰好 300×150 应该 判定为折叠", () => {
        expect(isCollapsedViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT)).toBe(true);
    });

    it("300×151 / 301×150 应该 不判定为折叠", () => {
        expect(isCollapsedViewport(300, 151)).toBe(false);
        expect(isCollapsedViewport(301, 150)).toBe(false);
    });

    it("正常编辑器尺寸 应该 不判定为折叠", () => {
        expect(isCollapsedViewport(846, 677)).toBe(false);
    });
});

describe("nextViewportFreezeState", () => {
    const real = { width: 846, height: 677, bodyWidth: 831 };

    it("首次正常尺寸 应该 记录基准且不冻结", () => {
        const next = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        expect(next).toEqual({ frozen: false, frozenVw: 846, frozenVh: 677, frozenBodyWidth: 831 });
    });

    it("折叠尺寸 应该 冻结并沿用折叠前基准（不把 300×150 记成新基准）", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        const next = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(next).toEqual({ frozen: true, frozenVw: 846, frozenVh: 677, frozenBodyWidth: 831 });
    });

    it("冻结后再次收到折叠读数 应该 保持原状态对象（不重复写 DOM）", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(nextViewportFreezeState(frozen, { width: 300, height: 150, bodyWidth: 285 })).toBe(frozen);
    });

    it("折叠后回到真实尺寸 应该 解冻并刷新基准", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        const restored = nextViewportFreezeState(frozen, { width: 900, height: 700, bodyWidth: 885 });
        expect(restored).toEqual({ frozen: false, frozenVw: 900, frozenVh: 700, frozenBodyWidth: 885 });
    });

    it("无基准时收到折叠读数 应该 只记录（首次加载即折叠的兜底）", () => {
        const next = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, { width: 300, height: 150, bodyWidth: 285 });
        expect(next).toEqual({ frozen: false, frozenVw: 300, frozenVh: 150, frozenBodyWidth: 285 });
    });

    it("真实视口恰为 300×150 时 应该 冻结值与视口一致（等价于不冻结，无副作用）", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, { width: 300, height: 150, bodyWidth: 285 });
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(frozen.frozenVw).toBe(300);
        expect(frozen.frozenBodyWidth).toBe(285);
    });

    it("用户折叠期间改了窗口尺寸 应该 解冻后按新尺寸重排", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        const frozen: ViewportFreezeState = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        const next = nextViewportFreezeState(frozen, { width: 1200, height: 800, bodyWidth: 1185 });
        expect(next.frozen).toBe(false);
        expect(next.frozenVw).toBe(1200);
    });

    it("bodyWidth 读数为 0（body 尚未布局） 应该 沿用旧基准", () => {
        const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, real);
        const next = nextViewportFreezeState(base, { width: 900, height: 700, bodyWidth: 0 });
        expect(next.frozenBodyWidth).toBe(831);
    });
});

describe("recordBodyWidth", () => {
    const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, { width: 846, height: 677, bodyWidth: 846 });

    it("折叠期外的实测宽度 应该 更新基准（纵向滚动条出现后差一个滚动条）", () => {
        const next = recordBodyWidth(base, 831);
        expect(next.frozenBodyWidth).toBe(831);
    });

    it("宽度未变 应该 返回同一状态对象（不重复写 DOM）", () => {
        expect(recordBodyWidth(base, 846)).toBe(base);
    });

    it("折叠期内 应该 忽略读数（此刻 body 宽度是冻结出来的假值）", () => {
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(recordBodyWidth(frozen, 285)).toBe(frozen);
    });

    it("非正数读数 应该 忽略", () => {
        expect(recordBodyWidth(base, 0)).toBe(base);
        expect(recordBodyWidth(base, -5)).toBe(base);
    });
});

describe("isViewportShrunk", () => {
    const base = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, { width: 846, height: 677, bodyWidth: 831 });

    it("冻结 + 视口比冻结尺寸小 应该 判定为过渡帧（抑制滚动条）", () => {
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(isViewportShrunk(frozen, { width: 300, height: 150 })).toBe(true);
    });

    it("冻结 + 视口已回到真实尺寸 应该 不算过渡帧", () => {
        const frozen = nextViewportFreezeState(base, { width: 300, height: 150, bodyWidth: 285 });
        expect(isViewportShrunk(frozen, { width: 846, height: 677 })).toBe(false);
    });

    it("未冻结 应该 永不算过渡帧", () => {
        expect(isViewportShrunk(base, { width: 300, height: 150 })).toBe(false);
    });

    it("用户真实视口恰为 300×150 应该 不算过渡帧（画面本来就是对的）", () => {
        const small = nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, { width: 300, height: 150, bodyWidth: 285 });
        const frozen = nextViewportFreezeState(small, { width: 300, height: 150, bodyWidth: 285 });
        expect(isViewportShrunk(frozen, { width: 300, height: 150 })).toBe(false);
    });
});

/**
 * 「真实小窗口」的认定：不看时间，看用户输入（回归：此前用 600ms 计时阈值，而宿主
 * 折叠态会一直持续到用户切回来，远超阈值 → 折叠期就误判，切回来出现三次变化）。
 */
describe("真尺寸认定（折叠尺寸下的用户输入）", () => {
    afterEach(() => {
        setViewport(1024, 768);
    });

    it("折叠尺寸下停留但没有用户输入 应该 保持冻结（宿主折叠态不会误判）", () => {
        // 真实顺序：先在真实尺寸下加载（建立基准），再被宿主折叠
        setViewport(846, 677);
        initViewportFreeze();
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        window.dispatchEvent(new Event("resize"));
        expect(isViewportFrozen()).toBe(true);
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("blur"));
        expect(isViewportFrozen()).toBe(true);
    });

    it("折叠尺寸下用户操作 应该 解除冻结（真实小窗口）", () => {
        setViewport(846, 677);
        initViewportFreeze();
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        window.dispatchEvent(new Event("resize"));
        expect(isViewportFrozen()).toBe(true);
        window.dispatchEvent(new Event("pointerdown"));
        expect(isViewportFrozen()).toBe(false);
    });

    it("真实尺寸下用户操作 应该 不改变冻结状态", () => {
        setViewport(846, 677);
        initViewportFreeze();
        window.dispatchEvent(new Event("wheel"));
        expect(isViewportFrozen()).toBe(false);
    });
});
