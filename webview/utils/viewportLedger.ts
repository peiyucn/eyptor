/**
 * 折叠态视口记账（折叠期几何守卫的数据来源，见 style.css 的「折叠期几何守卫」一节）。
 *
 * 背景（真实 VS Code 1.136 实测）：切到非 webview 标签时，宿主把 webview 容器摘出布局，
 * iframe 失去 `width/height: 100%` 的尺寸约束、回落到 Chromium 的 iframe 默认尺寸
 * **300×150**；切回来再放回真实尺寸。保活架构（`retainContextWhenHidden: true`，见
 * src/MarkdownEditorProvider.ts）下 webview 不重建，所以这个 300×150 的假视口会真实地
 * 重排一次正文、再排回来；切回那一帧里旧画面就与新画面不同，用户看到「闪」。
 * style.css 的折叠期守卫因此把 body 宽度钉在上次真实宽度（第 4 条）并让固定 UI 在折叠期
 * 不画（第 5 条，正文照常显示）——版式不随假视口变化，那 80–160ms 里屏幕上是终稿同位置的
 * 正文裁切。
 *
 * 本模块只做三件事，都不改变正文版式：
 *   1. 识别折叠读数（视口恰为 300×150，且用户没在这个尺寸下操作过）：供视口驱动的 UI 逻辑
 *      「此刻别按假尺寸测量」，并把结论写成 HOST_COLLAPSED_ATTRIBUTE 交给 CSS；
 *   2. 把**折叠期外**实测到的真实 body 宽度记成 CSS 变量（--epytor-last-body-width），
 *      供折叠期守卫钉住顶栏与正文宽度——顶栏 fixed + left/right:0，宽度跟随视口，不钉住时
 *      折叠帧里按钮会收进「⋯」、切回再展开，用户看到顶栏闪一下；
 *   3. 区分「宿主摘挂」与「用户真把编辑区缩到 300×150」——两种情形读数完全相同，分界只能靠
 *      **用户输入**：被宿主摘挂的 webview 收不到任何输入事件，用户真在小窗口里点/滚/敲键才
 *      收得到。折叠读数下收到 pointerdown / wheel / keydown / touchstart 即认定「真实小窗口」
 *      （<html> 上的 TINY_REAL_ATTRIBUTE）：顶栏不再按上次真实宽度钉住、记账也不再跳过
 *      （isHostCollapsedViewport 会因此为 false，CSS 消费的 HOST_COLLAPSED_ATTRIBUTE
 *      随之移除）；尺寸离开 300×150 即清除标记（下一次宿主折叠仍按折叠处理）。**不用计时**
 *      ——宿主折叠态会一直持续到用户切回来，计时阈值必然在折叠期就被打上标记
 *      （回归：切回来「出现-消失-再出现」）。作用范围：标记只影响顶栏钉定与记账；
 *      目录自动显隐与吸顶几何仍按 shouldSkipViewportWork()（只看读数）跳过。
 *
 * 折叠恢复时的滚动位置校正另见 utils/collapseScrollGuard.ts（本模块只负责把「此刻是否折叠」
 * 告诉它）。
 *
 * 宽度基准必须用 ResizeObserver 维护、不能只看 resize 事件：纵向滚动条出现/消失会改变
 * body 宽度但不触发 resize，基准陈旧会让钉住的宽度与真实宽度差一个滚动条。
 */
import { clearCollapsedEdge, recordScrollPosition, trackViewportResize } from "./collapseScrollGuard";

export const IFRAME_DEFAULT_WIDTH = 300;
export const IFRAME_DEFAULT_HEIGHT = 150;

/** 真实 body 宽度（px）写入的 CSS 变量名（style.css 折叠期守卫消费） */
export const LAST_BODY_WIDTH_VAR = "--epytor-last-body-width";

/**
 * 「宿主折叠中」属性（挂在 <html> 上）：折叠期几何守卫的唯一真源（style.css 消费）。
 *
 * 为什么不用 `@media (width: 300px) and (height: 150px)`：Chromium 的媒体查询按**窗口缩放后**
 * 的尺寸求值，而 `window.innerWidth` 报的是未缩放的 CSS px——两者会不一致。用户环境实测
 * （window.zoomLevel = 0.17、devicePixelRatio 2.06）：
 *     window.innerWidth/innerHeight = 300×150   （JS 判据成立）
 *     matchMedia('(width: 300px) and (height: 150px)').matches = false
 *     matchMedia('(max-width: 320px) and (max-height: 170px)').matches = true
 * 即：媒体查询写的守卫在带缩放的机器上**整块失效**（回归：用户装了几版仍能看到「小框」——
 * 折叠期正文照样按 300px 重排、顶栏照样收按钮）。改用 JS 记账判据后与 isHostCollapsedViewport()
 * 同源，缩放、DPI 都不影响。
 */
export const HOST_COLLAPSED_ATTRIBUTE = "data-epytor-host-collapsed";

/** 「真实小窗口」标记属性（挂在 <html> 上；style.css 据此区分同一读数的两种来源） */
export const TINY_REAL_ATTRIBUTE = "data-epytor-tiny-real";

/** 折叠读数下能证明「宿主没摘挂」的用户输入（摘挂的 webview 收不到任何输入事件） */
const REAL_INPUT_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

/** 最近一次记账的真实 body 宽度（px；0 = 尚未记到基准） */
let lastBodyWidth = 0;

/** 视口尺寸是否为 iframe 默认尺寸（宿主摘挂与真实小窗口的**共同**读数） */
export function isCollapsedViewport(width: number, height: number): boolean {
    return width === IFRAME_DEFAULT_WIDTH && height === IFRAME_DEFAULT_HEIGHT;
}

/** 用户是否真在这个尺寸下操作过（标记只看 DOM：CSS 与 JS 同一个真源） */
export function isRealTinyViewport(): boolean {
    return document.documentElement.hasAttribute(TINY_REAL_ATTRIBUTE);
}

/**
 * 记一步「真实小窗口」判定（纯函数）：
 * - 折叠读数下收到用户输入 → 认定真实小窗口；
 * - 折叠读数下没有输入 → 保持原判定（宿主折叠期间只有尺寸变化，不会有输入事件）；
 * - 视口离开折叠读数 → 清除（下一次宿主折叠仍按折叠处理）。
 */
export function nextTinyReal(
    prev: boolean,
    viewport: { width: number; height: number },
    sawInput: boolean,
): boolean {
    if (!isCollapsedViewport(viewport.width, viewport.height)) { return false; }
    return sawInput ? true : prev;
}

/**
 * 此刻的折叠读数是否**确定**是宿主摘挂造成的（用户没在这个尺寸下操作过）。
 * 供「按这个读数干活会不会错」的两处消费方使用：折叠期 CSS 守卫与记账（sync）。
 * 用户真把编辑区缩到 300×150 时为 false——这个尺寸是真的，必须按它重测/记账，否则顶栏按钮
 * 会保持上一次真实宽度的排版而溢出（回归 A6）。
 */
export function isHostCollapsedViewport(): boolean {
    return isCollapsedViewport(window.innerWidth, window.innerHeight) && !isRealTinyViewport();
}

/**
 * 视口驱动的测量/自动显隐逻辑此刻是否应跳过（目录自动显隐、吸顶几何重算、顶栏测量的**外围**
 * 调用点共用）。判据只看读数：视口恰为 300×150 就跳过。
 *
 * 为什么要跳过：宿主折叠期（切到非 webview 标签）视口读数是 300×150 假尺寸，按它测量会把
 * 顶栏按钮收进「⋯」、把目录误判成放不下、让吸顶条按错误宽度摆放；这些都发生在用户看不见
 * 的那一帧，屏幕切回来就表现为「闪一下」。恢复真实尺寸时的 resize / ResizeObserver 会重新触发。
 *
 * 作用范围（用户口径 2026-09-11）：本判据**不**看「真实小窗口」标记——用户真把编辑区缩到
 * 300×150 时目录/吸顶仍按折叠跳过（保持原状）；顶栏钉定与记账另有 isHostCollapsedViewport()
 * 区分（那里必须区分，否则顶栏按钮在 285px 宽下溢出）。
 */
export function shouldSkipViewportWork(): boolean {
    return isCollapsedViewport(window.innerWidth, window.innerHeight);
}

/**
 * 记一步「真实几何」（纯函数）：宿主折叠期的读数是假值（除非已认定真实小窗口）、非正数是
 * 尚未布局，都不入账；真实小窗口的 300px 读数是真的，照常入账。
 */
export function nextLastBodyWidth(
    prev: number,
    viewport: { width: number; height: number },
    bodyWidth: number,
    tinyReal = false,
): number {
    if ((isCollapsedViewport(viewport.width, viewport.height) && !tinyReal) || bodyWidth <= 0) {
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

/** 按判定结果写入/移除 <html> 属性；只在判定变化时动 DOM */
function syncAttribute(attribute: string, on: boolean): void {
    const root = document.documentElement;
    if (on === root.hasAttribute(attribute)) { return; }
    if (on) { root.setAttribute(attribute, ""); }
    else { root.removeAttribute(attribute); }
}

/** 记一次账并同步 CSS 变量与折叠属性（都没变时不写 DOM） */
function sync(): void {
    // 记账的 ResizeObserver 会在每次正文尺寸变化时回调（含输入时），所以这里必须廉价
    syncAttribute(HOST_COLLAPSED_ATTRIBUTE, isHostCollapsedViewport());
    const next = nextLastBodyWidth(lastBodyWidth, readViewport(), readBodyWidth(), isRealTinyViewport());
    if (next === lastBodyWidth) { return; }
    lastBodyWidth = next;
    document.documentElement.style.setProperty(LAST_BODY_WIDTH_VAR, `${next}px`);
}

/** 折叠读数下的用户输入：认定真实小窗口，解除折叠期守卫并按真实几何记一次账 */
function onUserInput(): void {
    if (!isCollapsedViewport(window.innerWidth, window.innerHeight) || isRealTinyViewport()) { return; }
    document.documentElement.setAttribute(TINY_REAL_ATTRIBUTE, "");
    // 这个 300×150 是真的：尺寸离开时不应按「宿主折叠恢复」去校正滚动位置
    clearCollapsedEdge();
    sync();
}

/** 视口尺寸变化：清除离开折叠读数的标记，交给滚动保护维护折叠沿，再记账 */
function onViewportResize(): void {
    const marked = isRealTinyViewport();
    const next = nextTinyReal(marked, readViewport(), false);
    if (next !== marked) { syncAttribute(TINY_REAL_ATTRIBUTE, next); }

    trackViewportResize(isHostCollapsedViewport());
    sync();
}

/** 真实读数下的滚动：记录当前位置（折叠期是假读数，由滚动保护自行忽略） */
function onScroll(): void {
    recordScrollPosition(isHostCollapsedViewport());
}

/**
 * 初始化（在 webview 入口调用一次）：立即建立一次基准，此后由 ResizeObserver 跟踪 body
 * 宽度变化（窗口缩放、纵向滚动条出现/消失都走这条路径），并挂上「真实小窗口」的输入判定
 * （折叠读数 + 用户输入才认定，见模块头注释）。
 *
 * 若初始化时视口恰好是折叠读数（页面在后台创建），本次不写变量——CSS 的
 * `var(--epytor-last-body-width, 100%)` 回退到 100%，等恢复真实尺寸后第一次回调补上。
 */
export function initViewportLedger(): void {
    lastBodyWidth = 0;
    sync();
    for (const type of REAL_INPUT_EVENTS) {
        window.addEventListener(type, onUserInput, { passive: true });
    }
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver === "undefined" || !document.body) { return; }
    new ResizeObserver(sync).observe(document.body);
}
