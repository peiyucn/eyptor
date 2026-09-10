/**
 * 折叠态视口记账（折叠期几何守卫的数据来源，见 style.css 的折叠媒体查询）。
 *
 * 背景（真实 VS Code 1.136 实测）：切到非 webview 标签时，宿主把 webview 容器摘出布局，
 * iframe 失去 `width/height: 100%` 的尺寸约束、回落到 Chromium 的 iframe 默认尺寸
 * **300×150**；切回来再放回真实尺寸。保活架构（`retainContextWhenHidden: true`，见
 * src/MarkdownEditorProvider.ts）下 webview 不重建，所以折叠期正文会真实地按 300px 重排
 * 一次再排回来——这是渲染器的自然行为，**不再用「隐藏正文 / 冻结版式」去干预**。
 *
 * 本模块只做两件事，都不改变正文版式：
 *   1. 识别折叠读数（视口恰为 300×150）：供视口驱动的 UI 逻辑「此刻别按假尺寸测量」；
 *   2. 把**折叠期外**实测到的真实 body 宽度记成 CSS 变量（--epytor-last-body-width），
 *      供折叠媒体查询钉住顶栏宽度——顶栏 fixed + left/right:0，宽度跟随视口，不钉住时
 *      折叠帧里按钮会收进「⋯」、切回再展开，用户看到顶栏闪一下。
 *
 * 宽度基准必须用 ResizeObserver 维护、不能只看 resize 事件：纵向滚动条出现/消失会改变
 * body 宽度但不触发 resize，基准陈旧会让钉住的宽度与真实宽度差一个滚动条。
 */
export const IFRAME_DEFAULT_WIDTH = 300;
export const IFRAME_DEFAULT_HEIGHT = 150;

/** 真实 body 宽度（px）写入的 CSS 变量名（style.css 折叠媒体查询消费） */
export const LAST_BODY_WIDTH_VAR = "--epytor-last-body-width";

/** 最近一次记账的真实 body 宽度（px；0 = 尚未记到基准） */
let lastBodyWidth = 0;

/** 视口尺寸是否为 iframe 默认尺寸（宿主把 webview 摘出布局的唯一可观测信号） */
export function isCollapsedViewport(width: number, height: number): boolean {
    return width === IFRAME_DEFAULT_WIDTH && height === IFRAME_DEFAULT_HEIGHT;
}

/**
 * 视口驱动的测量/自动显隐逻辑此刻是否应跳过。折叠期视口读数是宿主造成的 300×150 假
 * 尺寸：按它测量会把顶栏按钮收进「⋯」、把目录误判成放不下、让吸顶条按错误宽度摆放；
 * 这些都发生在用户看不见的那一帧，屏幕切回来就表现为「闪一下」。折叠期跳过，恢复真实
 * 尺寸时的 resize / ResizeObserver 会重新触发它们。
 */
export function shouldSkipViewportWork(): boolean {
    return isCollapsedViewport(window.innerWidth, window.innerHeight);
}

/**
 * 记一步「真实几何」（纯函数）：折叠期的读数是假值、非正数是尚未布局，都不入账。
 */
export function nextLastBodyWidth(
    prev: number,
    viewport: { width: number; height: number },
    bodyWidth: number,
): number {
    if (isCollapsedViewport(viewport.width, viewport.height) || bodyWidth <= 0) {
        return prev;
    }
    return bodyWidth;
}

function readViewport(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
}

function readBodyWidth(): number {
    return document.body?.getBoundingClientRect().width ?? 0;
}

/** 记一次账并同步 CSS 变量（宽度没变时不写 DOM） */
function sync(): void {
    const next = nextLastBodyWidth(lastBodyWidth, readViewport(), readBodyWidth());
    if (next === lastBodyWidth) { return; }
    lastBodyWidth = next;
    document.documentElement.style.setProperty(LAST_BODY_WIDTH_VAR, `${next}px`);
}

/**
 * 初始化（在 webview 入口调用一次）：立即建立一次基准，此后由 ResizeObserver 跟踪 body
 * 宽度变化（窗口缩放、纵向滚动条出现/消失都走这条路径）。
 *
 * 若初始化时视口恰好是折叠读数（页面在后台创建），本次不写变量——CSS 的
 * `var(--epytor-last-body-width, 100%)` 回退到 100%，等恢复真实尺寸后第一次回调补上。
 */
export function initViewportLedger(): void {
    lastBodyWidth = 0;
    sync();
    if (typeof ResizeObserver === "undefined" || !document.body) { return; }
    new ResizeObserver(sync).observe(document.body);
}
