/**
 * 折叠态视口记账（折叠期几何守卫的数据来源，见 style.css 的折叠媒体查询）。
 *
 * 背景（真实 VS Code 1.136 实测）：切到非 webview 标签时，宿主把 webview 容器摘出布局，
 * iframe 失去 `width/height: 100%` 的尺寸约束、回落到 Chromium 的 iframe 默认尺寸
 * **300×150**；切回来再放回真实尺寸。保活架构（`retainContextWhenHidden: true`，见
 * src/MarkdownEditorProvider.ts）下 webview 不重建，所以这个 300×150 的假视口会真实地
 * 重排一次正文、再排回来；切回那一帧里旧画面就与新画面不同，用户看到「闪」。
 * style.css 的折叠媒体查询因此把 body 宽度钉在上次真实宽度（第 5 条，不隐藏正文、
 * 也不冻结渲染，只是让版式不随假视口变化）。
 *
 * 本模块只做三件事，都不改变正文版式：
 *   1. 识别折叠读数（视口恰为 300×150，且用户没在这个尺寸下操作过）：供视口驱动的 UI 逻辑
 *      「此刻别按假尺寸测量」；
 *   2. 把**折叠期外**实测到的真实 body 宽度记成 CSS 变量（--epytor-last-body-width），
 *      供折叠媒体查询钉住顶栏宽度——顶栏 fixed + left/right:0，宽度跟随视口，不钉住时
 *      折叠帧里按钮会收进「⋯」、切回再展开，用户看到顶栏闪一下；
 *   3. 区分「宿主摘挂」与「用户真把编辑区缩到 300×150」——两种情形读数完全相同，分界只能靠
 *      **用户输入**：被宿主摘挂的 webview 收不到任何输入事件，用户真在小窗口里点/滚/敲键才
 *      收得到。折叠读数下收到 pointerdown / wheel / keydown / touchstart 即认定「真实小窗口」
 *      （<html> 上的 TINY_REAL_ATTRIBUTE）：顶栏不再按上次真实宽度钉住（style.css）、记账也不再
 *      跳过（isHostCollapsedViewport）；尺寸离开 300×150 即清除标记（下一次宿主折叠仍按折叠
 *      处理）。**不用计时**——宿主折叠态会一直持续到用户切回来，计时阈值必然在折叠期就被打上
 *      标记（回归：切回来「出现-消失-再出现」）。
 *      作用范围（用户口径）：标记只影响**顶栏钉定与记账**；目录自动显隐与吸顶几何仍按
 *      shouldSkipViewportWork()（只看读数）跳过，不隐藏正文、不冻结版式。
 *
 * 宽度基准必须用 ResizeObserver 维护、不能只看 resize 事件：纵向滚动条出现/消失会改变
 * body 宽度但不触发 resize，基准陈旧会让钉住的宽度与真实宽度差一个滚动条。
 */
export const IFRAME_DEFAULT_WIDTH = 300;
export const IFRAME_DEFAULT_HEIGHT = 150;

/** 真实 body 宽度（px）写入的 CSS 变量名（style.css 折叠媒体查询消费） */
export const LAST_BODY_WIDTH_VAR = "--epytor-last-body-width";

/** 「真实小窗口」标记属性（挂在 <html> 上；style.css 折叠媒体查询据此释放顶栏钉定） */
export const TINY_REAL_ATTRIBUTE = "data-epytor-tiny-real";

/** 折叠读数下能证明「宿主没摘挂」的用户输入（摘挂的 webview 收不到任何输入事件） */
const REAL_INPUT_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

/** 最近一次「真实读数」下的滚动位置（px）；折叠恢复后据此校正浏览器锚定造成的偏移 */
let lastRealScrollY = 0;
/** 是否记录过真实读数（后台以折叠尺寸创建的 webview 不能把 0 当成用户位置校正回去） */
let hasRealScrollRecord = false;
/** 上一次 resize 读数是否为宿主折叠态（识别「进入折叠 / 恢复」的沿） */
let wasHostCollapsed = false;
/** 正在执行折叠恢复的位置校正：期间滚动事件不得覆盖锁存的期望位置 */
let restoringScroll = false;

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
 * 供「按这个读数干活会不会错」的两处消费方使用：顶栏钉定（style.css 的
 * html:not([data-epytor-tiny-real])）与记账（sync）。
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
 * 顶栏按钮收进「⋯」、把目录误判成放不下、让吸顶条按错误宽度摆放；这些都发生在用户看不见的
 * 那一帧，屏幕切回来就表现为「闪一下」。恢复真实尺寸时的 resize / ResizeObserver 会重新触发。
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

/** 记一次账并同步 CSS 变量（宽度没变时不写 DOM） */
function sync(): void {
    const next = nextLastBodyWidth(lastBodyWidth, readViewport(), readBodyWidth(), isRealTinyViewport());
    if (next === lastBodyWidth) { return; }
    lastBodyWidth = next;
    document.documentElement.style.setProperty(LAST_BODY_WIDTH_VAR, `${next}px`);
}

/** 折叠读数下的用户输入：认定真实小窗口，解除顶栏钉定（CSS）并按真实几何记一次账 */
function onUserInput(): void {
    if (!isCollapsedViewport(window.innerWidth, window.innerHeight)) { return; }
    if (isRealTinyViewport()) { return; }
    document.documentElement.setAttribute(TINY_REAL_ATTRIBUTE, "");
    // 这个 300×150 是真的：尺寸离开时不应按「宿主折叠恢复」去校正滚动位置
    wasHostCollapsed = false;
    sync();
}

/**
 * 真实读数下的滚动：持续记录当前位置（切走前最后一次滚动就是折叠恢复的期望位置）。
 * 折叠期屏幕上是别的编辑器、收不到用户滚动；校正期间（restoringScroll）也不记录，
 * 否则恢复帧的布局锚定调整会把期望位置污染成修正后的值。
 */
function onScroll(): void {
    if (restoringScroll) { return; }
    if (isCollapsedViewport(window.innerWidth, window.innerHeight) && !isRealTinyViewport()) { return; }
    lastRealScrollY = window.scrollY;
    hasRealScrollRecord = true;
}

/**
 * 视口尺寸变化：离开折叠读数即清除标记；识别折叠的「进入 / 恢复」沿，
 * 恢复时把被浏览器滚动锚定挪走的位置校正回折叠前的值。
 *
 * 为什么需要校正：折叠期视口缩到 300×150 后正文按窄列重排，浏览器会做滚动锚定
 * 把位置「就地修正」（A6 实测同一位置 scrollY 1500 → 1773）；恢复真实尺寸时
 * 布局再次变化，锚定可能再修正一次。折叠期屏幕上是别的编辑器、收不到用户滚动，
 * 所以期望位置就是进入折叠前记下的值。两次 rAF：锚定调整可能晚于 resize 返回。
 */
function onViewportResize(): void {
    const marked = isRealTinyViewport();
    const next = nextTinyReal(marked, readViewport(), false);
    if (next !== marked) {
        if (next) { document.documentElement.setAttribute(TINY_REAL_ATTRIBUTE, ""); }
        else { document.documentElement.removeAttribute(TINY_REAL_ATTRIBUTE); }
    }

    const collapsed = isCollapsedViewport(window.innerWidth, window.innerHeight) && !isRealTinyViewport();
    if (wasHostCollapsed && !collapsed && hasRealScrollRecord) {
        const expected = lastRealScrollY;
        restoringScroll = true;
        const restore = (): void => {
            if (window.scrollY !== expected) { window.scrollTo(0, expected); }
        };
        requestAnimationFrame(() => {
            restore();
            requestAnimationFrame(() => {
                restore();
                restoringScroll = false;
            });
        });
    } else if (!collapsed) {
        lastRealScrollY = window.scrollY;
        hasRealScrollRecord = true;
    }
    wasHostCollapsed = collapsed;

    sync();
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
