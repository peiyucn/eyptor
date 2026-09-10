import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    IFRAME_DEFAULT_HEIGHT,
    IFRAME_DEFAULT_WIDTH,
    LAST_BODY_WIDTH_VAR,
    TINY_REAL_ATTRIBUTE,
    initViewportLedger,
    isCollapsedViewport,
    isHostCollapsedViewport,
    isRealTinyViewport,
    nextLastBodyWidth,
    nextTinyReal,
    shouldSkipViewportWork,
} from "../utils/viewportLedger";

/** 改写 jsdom 视口尺寸（只读属性需 defineProperty） */
function setViewport(width: number, height: number): void {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

/** jsdom 不做布局，getBoundingClientRect 恒为 0——直接给出 body 实测宽度 */
function stubBodyWidth(width: number): void {
    vi.spyOn(document.body, "getBoundingClientRect")
        .mockReturnValue({ width } as unknown as DOMRect);
}

/** 记进 CSS 变量的真实 body 宽度（px 字符串），未记账时为 "" */
function cssVarValue(): string {
    return document.documentElement.style.getPropertyValue(LAST_BODY_WIDTH_VAR);
}

/** 可控的 ResizeObserver：jsdom 不会因布局变化回调，由测试决定何时触发 */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        FakeResizeObserver.instances.push(this);
    }
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
    /** 模拟浏览器在布局后回调 */
    trigger(): void {
        this.callback([], this as unknown as ResizeObserver);
    }
}

/** 安装假 ResizeObserver（记账只创建这一个；触发时机由测试决定） */
function installFakeResizeObserver(): void {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

/** 初始化时创建的那个 observer */
function ledgerObserver(): FakeResizeObserver {
    const observer = FakeResizeObserver.instances[0];
    if (!observer) { throw new Error("initViewportLedger 未创建 ResizeObserver"); }
    return observer;
}

/**
 * 宿主折叠态判定（回归：切到非 webview 标签时宿主把 webview 摘出布局，iframe 回落到
 * Chromium 默认尺寸 300×150，正文按 300px 重排再排回来 → 用户看到页面闪一下）。
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

/** 折叠期视口读数是假值：此刻的测量会让顶栏收按钮、目录误判、吸顶条错位 */
describe("shouldSkipViewportWork", () => {
    afterEach(() => { setViewport(1024, 768); });

    it("视口恰为 300×150 应该 跳过视口工作", () => {
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        expect(shouldSkipViewportWork()).toBe(true);
    });

    it("真实视口 应该 不跳过", () => {
        setViewport(846, 677);
        expect(shouldSkipViewportWork()).toBe(false);
    });
});

/** 真实几何记账（纯函数）：折叠期外实测到的 body 宽度才入账 */
describe("nextLastBodyWidth", () => {
    const real = { width: 846, height: 677 };

    it("真实尺寸实测宽度 应该 入账", () => {
        expect(nextLastBodyWidth(0, real, 831)).toBe(831);
    });

    it("折叠读数 应该 沿用旧基准（不把 300×150 下的 285 记成真实宽度）", () => {
        expect(nextLastBodyWidth(831, { width: 300, height: 150 }, 285)).toBe(831);
    });

    it("非正数读数 应该 沿用旧基准（body 尚未布局）", () => {
        expect(nextLastBodyWidth(831, real, 0)).toBe(831);
        expect(nextLastBodyWidth(831, real, -5)).toBe(831);
    });

    it("滚动条出现导致的宽度变化 应该 照样入账（同一视口、更窄的 body）", () => {
        expect(nextLastBodyWidth(846, real, 831)).toBe(831);
    });

    it("真实小窗口（用户真在 300×150 下操作过） 应该 照样入账", () => {
        expect(nextLastBodyWidth(831, { width: 300, height: 150 }, 285, true)).toBe(285);
    });
});

/**
 * 「真实小窗口」判定（纯函数，回归 A6）：折叠读数下的用户输入 = 用户真在这个尺寸下用。
 * **不看计时**——宿主折叠态会一直持续到用户切回来，任何时间阈值都会在折叠期就打上标记。
 */
describe("nextTinyReal", () => {
    const tiny = { width: IFRAME_DEFAULT_WIDTH, height: IFRAME_DEFAULT_HEIGHT };
    const real = { width: 846, height: 677 };

    it("折叠读数下有用户输入 应该 认定为真实小窗口", () => {
        expect(nextTinyReal(false, tiny, true)).toBe(true);
    });

    it("折叠读数下没有输入 应该 保持原判定（宿主折叠期间只有尺寸变化）", () => {
        expect(nextTinyReal(false, tiny, false)).toBe(false);
        expect(nextTinyReal(true, tiny, false)).toBe(true);
    });

    it("视口离开折叠读数 应该 清除标记（下一次宿主折叠仍按折叠处理）", () => {
        expect(nextTinyReal(true, real, false)).toBe(false);
        expect(nextTinyReal(true, real, true)).toBe(false);
    });
});

/**
 * 接线：初始化即建立基准，此后由 ResizeObserver 跟踪（窗口缩放、滚动条出现/消失）。
 * 记账结果写进 CSS 变量 --epytor-last-body-width，供折叠媒体查询钉顶栏宽度。
 */
describe("initViewportLedger", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.documentElement.style.removeProperty(LAST_BODY_WIDTH_VAR);
        setViewport(846, 677);
        stubBodyWidth(831);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.style.removeProperty(LAST_BODY_WIDTH_VAR);
        setViewport(1024, 768);
    });

    it("真实尺寸下初始化 应该 立刻把实测 body 宽度写进 CSS 变量", () => {
        installFakeResizeObserver();
        initViewportLedger();
        expect(cssVarValue()).toBe("831px");
    });

    it("折叠期回调 应该 不改变量（假读数不入账）", () => {
        installFakeResizeObserver();
        initViewportLedger();
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        stubBodyWidth(285);
        ledgerObserver().trigger();
        expect(cssVarValue()).toBe("831px");
    });

    it("恢复真实尺寸后回调 应该 更新变量（含滚动条造成的宽度差）", () => {
        installFakeResizeObserver();
        initViewportLedger();
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        stubBodyWidth(285);
        ledgerObserver().trigger();
        setViewport(1200, 800);
        stubBodyWidth(1185);
        ledgerObserver().trigger();
        expect(cssVarValue()).toBe("1185px");
    });

    it("初始化时视口恰为折叠尺寸 应该 不写变量（CSS 回退 100%）", () => {
        installFakeResizeObserver();
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        stubBodyWidth(285);
        initViewportLedger();
        expect(cssVarValue()).toBe("");
    });

    it("ResizeObserver 不可用 应该 只记一次基准且不抛错", () => {
        vi.stubGlobal("ResizeObserver", undefined);
        expect(() => initViewportLedger()).not.toThrow();
        expect(cssVarValue()).toBe("831px");
    });
});

/**
 * 「真实小窗口」接线（回归 A6）：宿主摘挂与用户真把编辑区缩到 300×150 读数完全相同，
 * 分界只能靠用户输入——被摘挂的 webview 收不到任何输入事件。
 */
describe("真实小窗口标记接线", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.documentElement.removeAttribute(TINY_REAL_ATTRIBUTE);
        document.documentElement.style.removeProperty(LAST_BODY_WIDTH_VAR);
        setViewport(846, 677);
        stubBodyWidth(831);
        installFakeResizeObserver();
        initViewportLedger();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.removeAttribute(TINY_REAL_ATTRIBUTE);
        document.documentElement.style.removeProperty(LAST_BODY_WIDTH_VAR);
        setViewport(1024, 768);
    });

    it.each(["pointerdown", "wheel", "keydown", "touchstart"])(
        "折叠尺寸下收到 %s 应该 认定真实小窗口、解除折叠判定并按真实宽度记账",
        (type) => {
            setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
            stubBodyWidth(285);
            expect(isHostCollapsedViewport()).toBe(true);

            window.dispatchEvent(new Event(type));

            expect(isRealTinyViewport()).toBe(true);
            // 作用范围（用户口径）：标记只影响顶栏钉定与记账——目录/吸顶共用的
            // shouldSkipViewportWork() 仍按读数走（真实小窗口下保持原状）
            expect(isHostCollapsedViewport()).toBe(false);
            expect(shouldSkipViewportWork()).toBe(true);
            expect(cssVarValue()).toBe("285px");
        },
    );

    it("真实尺寸下用户输入 应该 不打标记", () => {
        window.dispatchEvent(new Event("pointerdown"));
        expect(isRealTinyViewport()).toBe(false);
    });

    it("折叠读数下只有尺寸/焦点事件（没有用户输入） 应该 不打标记（宿主折叠不误判）", () => {
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        stubBodyWidth(285);
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("blur"));

        expect(isRealTinyViewport()).toBe(false);
        expect(isHostCollapsedViewport()).toBe(true);
        expect(shouldSkipViewportWork()).toBe(true);
        expect(cssVarValue()).toBe("831px"); // 假读数没有入账
    });

    it("离开折叠尺寸 应该 清除标记（下一次宿主折叠仍按折叠处理）", () => {
        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        window.dispatchEvent(new Event("keydown"));
        expect(isRealTinyViewport()).toBe(true);

        setViewport(846, 677);
        window.dispatchEvent(new Event("resize"));
        expect(isRealTinyViewport()).toBe(false);

        setViewport(IFRAME_DEFAULT_WIDTH, IFRAME_DEFAULT_HEIGHT);
        expect(isHostCollapsedViewport()).toBe(true);
    });
});
