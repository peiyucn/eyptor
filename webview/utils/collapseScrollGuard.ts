/**
 * 折叠恢复时的滚动位置保护（纯状态机，由 utils/viewportLedger.ts 驱动）。
 *
 * 背景（A6 实测）：折叠期视口缩到 300×150 后正文按窄列重排，浏览器为了让「可见内容不动」
 * 会做滚动锚定、把位置就地修正（同一位置实测 scrollY 1500 → 1773）；切回真实尺寸时布局
 * 再次变化，锚定可能再修正一次。折叠期屏幕上是别的编辑器、收不到用户滚动，所以**期望位置
 * 就是进入折叠前记下的那个值**——恢复后校正回去，用户不会看到内容跳一下。
 *
 * 本模块**不判断**「此刻是不是折叠」——调用方（viewportLedger）把结论当参数传进来，
 * 这样它既不依赖折叠判据、也不会与 viewportLedger 形成循环 import。
 *
 * 校正用两次 rAF：锚定调整可能晚于 resize 返回。校正期间要屏蔽滚动记录，否则恢复帧的
 * 锚定调整会把期望位置污染成修正后的值（`restoringScroll`）。
 */

/** 校正后的第二次检查（锚定调整可能晚于 resize 返回） */
const RESTORE_FRAMES = 2;

/** 最近一次「真实读数」下的滚动位置（px） */
let lastRealScrollY = 0;
/** 是否记录过真实读数（后台以折叠尺寸创建的 webview 不能把 0 当成用户位置校正回去） */
let hasRealScrollRecord = false;
/** 上一次读数的折叠态（识别「进入折叠 / 恢复」的沿） */
let wasCollapsed = false;
/** 正在执行校正：期间滚动事件不得覆盖锁存的期望位置 */
let restoringScroll = false;

/**
 * 记录当前位置。`collapsed` 为 true（宿主折叠期）时不记录——那是假读数；
 * 校正进行中也不记录，否则会污染期望位置。
 */
export function recordScrollPosition(collapsed: boolean): void {
    if (restoringScroll || collapsed) { return; }
    lastRealScrollY = window.scrollY;
    hasRealScrollRecord = true;
}

/** 把位置校正回 `expected`（连续两帧，覆盖晚于 resize 返回的锚定调整） */
function restoreTo(expected: number): void {
    restoringScroll = true;
    const restore = (): void => {
        if (window.scrollY !== expected) { window.scrollTo(0, expected); }
    };
    const tick = (remaining: number): void => {
        restore();
        if (remaining > 1) { requestAnimationFrame(() => tick(remaining - 1)); }
        else { restoringScroll = false; }
    };
    requestAnimationFrame(() => tick(RESTORE_FRAMES));
}

/**
 * 视口读数变化时维护折叠的「进入 / 恢复」沿：
 * - 进入折叠：什么都不做（期望位置已在折叠前记下）；
 * - 从折叠恢复：若曾记过真实位置，把它校正回去；
 * - 其它（普通 resize）：按当前位置更新记录。
 */
export function trackViewportResize(collapsed: boolean): void {
    if (wasCollapsed && !collapsed && hasRealScrollRecord) {
        restoreTo(lastRealScrollY);
    } else if (!collapsed) {
        lastRealScrollY = window.scrollY;
        hasRealScrollRecord = true;
    }
    wasCollapsed = collapsed;
}

/** 折叠沿重置（真实小窗口：这个尺寸是真的，离开时不该按「宿主折叠恢复」校正） */
export function clearCollapsedEdge(): void {
    wasCollapsed = false;
}
