/**
 * 宿主折叠态的排版冻结。
 *
 * 根因（真实 VS Code 1.136 实测，见 docs/checklists/2026-09-08-simplification-batch.md）：
 * 切到非 webview 标签（文本编辑器）时，宿主把 webview 容器摘出布局，iframe 失去
 * `width/height: 100%` 的尺寸约束、回落到 Chromium 的 iframe 默认尺寸 **300×150**；
 * 切回来时宿主再把它放回真实尺寸。这两次视口变化会带着视口单位（`92vw`、`100vh`）
 * 与 body 宽度一起变，整个文档按 300px 重排、再排回来：
 *
 *   实测 846×677 → 300×150：文档高度 3557 → 4202（正文按 285px 重新折行），
 *   layout-shift 0.86；回到 846×677 时再 shift 0.50，中间有 2 帧以 300×150 绘制。
 *
 * 这就是用户看到的「从非 markdown 标签切回 markdown，页面闪一下」。对照：md ↔ md
 * 切换不触发任何尺寸变化（两帧都是 846×677、零 layout-shift），所以不闪。
 *
 * 修法：识别「视口恰好等于 iframe 默认尺寸」这一折叠信号，把视口单位与正文宽度
 * 冻结为折叠前的实测值。排版与折叠前逐像素一致，宿主放回真实尺寸时零重排——
 * 折叠期间用户看到的是同一版式的裁切，而不是重排后的页面。
 */
export const IFRAME_DEFAULT_WIDTH = 300;
export const IFRAME_DEFAULT_HEIGHT = 150;

/** 冻结状态（纯数据，便于单测） */
export interface ViewportFreezeState {
    /** 是否处于冻结（宿主折叠）态 */
    frozen: boolean;
    /** 冻结时使用的视口宽度（px，= 折叠前 innerWidth） */
    frozenVw: number;
    /** 冻结时使用的视口高度（px，= 折叠前 innerHeight） */
    frozenVh: number;
    /** 冻结时使用的 body 宽度（px，= 折叠前 documentElement.clientWidth，已扣除滚动条） */
    frozenBodyWidth: number;
}

export const INITIAL_VIEWPORT_FREEZE_STATE: ViewportFreezeState = {
    frozen: false,
    frozenVw: 0,
    frozenVh: 0,
    frozenBodyWidth: 0,
};

/** 视口尺寸是否为 iframe 默认尺寸（宿主把 webview 摘出布局的唯一可观测信号） */
export function isCollapsedViewport(width: number, height: number): boolean {
    return width === IFRAME_DEFAULT_WIDTH && height === IFRAME_DEFAULT_HEIGHT;
}

/**
 * 依据一次视口读数推进冻结状态：
 * - 折叠尺寸 + 已有折叠前实测值 → 进入冻结（沿用旧值，不刷新基准）
 * - 其他尺寸 → 退出冻结并刷新基准（折叠前实测值）
 */
export function nextViewportFreezeState(
    prev: ViewportFreezeState,
    viewport: { width: number; height: number; bodyWidth: number },
): ViewportFreezeState {
    if (isCollapsedViewport(viewport.width, viewport.height) && prev.frozenVw > 0) {
        return prev.frozen ? prev : { ...prev, frozen: true };
    }
    return {
        frozen: false,
        frozenVw: viewport.width,
        frozenVh: viewport.height,
        frozenBodyWidth: viewport.bodyWidth > 0 ? viewport.bodyWidth : prev.frozenBodyWidth,
    };
}

/**
 * 记录 body 实测宽度（折叠期外的 ResizeObserver 回调用）——正文宽度基准。
 * 必须独立于 resize 事件维护：纵向滚动条出现/消失会改变 body 宽度但不触发 resize，
 * 基准陈旧会让冻结宽度与真实宽度差一个滚动条（切回来时正文横移几像素）。
 */
export function recordBodyWidth(prev: ViewportFreezeState, bodyWidth: number): ViewportFreezeState {
    if (prev.frozen || bodyWidth <= 0 || prev.frozenBodyWidth === bodyWidth) {
        return prev;
    }
    return { ...prev, frozenBodyWidth: bodyWidth };
}

/**
 * 「用户真的把编辑区缩到了 300×150」的认定：**不看时间，看有没有用户输入**。
 * 宿主折叠（切到别的标签）期间用户不在这个 webview 里，收不到任何输入事件；
 * 只有用户真在这个尺寸下操作（点/滚/敲键）才认定是真实的小窗口并解冻排版。
 *
 * 回归（用户报告「切回 md 先出现-又消失-再出现」）：此前用 600ms 计时阈值认定
 * 「稳定停留」，但宿主折叠态会**一直持续到用户切回来**（远超 600ms），标记在折叠期
 * 就被打上，配合当时的「折叠期隐藏正文」规则产生三次变化。计时阈值已删除。
 */
const USER_INPUT_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

let state: ViewportFreezeState = INITIAL_VIEWPORT_FREEZE_STATE;

/** 当前是否处于宿主折叠（排版已冻结）态——视口驱动的 UI 逻辑应跳过 */
export function isViewportFrozen(): boolean {
    return state.frozen;
}

/**
 * 视口驱动的测量/自动显隐逻辑此刻是否应跳过。
 * 除了已冻结，还要覆盖「ResizeObserver 早于 resize 事件到达」的同一帧：此刻读数已是
 * 折叠尺寸但冻结尚未应用，按 300px 测量会得出错误结论（顶栏收按钮、目录自动收起）。
 */
export function shouldSkipViewportWork(): boolean {
    return state.frozen || isCollapsedViewport(window.innerWidth, window.innerHeight);
}

/**
 * 是否处于「冻结 + 真实视口比冻结尺寸小」的过渡帧：宿主显示面板后、把 iframe 放回
 * 真实尺寸前的那 ~100ms（实测 resize 事件要 60–100ms 才到）。这期间正文排版是冻结的
 * 正确版式，只是被视口裁切在左边一小块里；正文照常显示（内容连续，不出现空白闪），
 * 仅额外抑制此刻会出现在编辑区中间的滚动条。
 *
 * 真实视口恰为 300×150（用户真把编辑区拖到那么小）时不算过渡帧：冻结值与视口一致。
 */
export function isViewportShrunk(
    prev: ViewportFreezeState,
    viewport: { width: number; height: number },
): boolean {
    return prev.frozen && (viewport.width !== prev.frozenVw || viewport.height !== prev.frozenVh);
}

function apply(next: ViewportFreezeState, root: HTMLElement): void {
    // 过渡帧标记：独立于冻结状态本身，所以放在早退之前
    root.classList.toggle(
        "epytor-viewport-shrunk",
        isViewportShrunk(next, { width: window.innerWidth, height: window.innerHeight }),
    );
    if (next.frozen === state.frozen && next.frozenVw === state.frozenVw
        && next.frozenVh === state.frozenVh && next.frozenBodyWidth === state.frozenBodyWidth) {
        return;
    }
    state = next;
    if (next.frozen) {
        root.style.setProperty("--epytor-frozen-vw", `${next.frozenVw}px`);
        root.style.setProperty("--epytor-frozen-vh", `${next.frozenVh}px`);
        root.style.setProperty("--epytor-frozen-body-width", `${next.frozenBodyWidth}px`);
        root.classList.add("epytor-viewport-frozen");
    } else {
        root.classList.remove("epytor-viewport-frozen");
        root.style.removeProperty("--epytor-frozen-vw");
        root.style.removeProperty("--epytor-frozen-vh");
        root.style.removeProperty("--epytor-frozen-body-width");
        // 持续维护「上一次真实尺寸」：折叠的第一帧早于 resize 事件（实测 62ms），
        // 那时只能靠纯 CSS 媒体查询兜底（见 style.css 的 @media 折叠规则）
        root.style.setProperty("--epytor-last-vw", `${next.frozenVw}px`);
        root.style.setProperty("--epytor-last-vh", `${next.frozenVh}px`);
        root.style.setProperty("--epytor-last-body-width", `${next.frozenBodyWidth}px`);
    }
}

function readViewport(): { width: number; height: number; bodyWidth: number } {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        bodyWidth: document.body?.getBoundingClientRect().width ?? 0,
    };
}

function sync(): void {
    apply(nextViewportFreezeState(state, readViewport()), document.documentElement);
}

/**
 * 折叠尺寸下的用户输入：认定「用户真的把编辑区缩到了 300×150」，解除冻结并按当前
 * 尺寸重建基准（否则排版被钉在旧宽度）。隐藏中的 webview 收不到输入，宿主折叠态不会误判。
 */
function onUserInput(): void {
    if (!isCollapsedViewport(window.innerWidth, window.innerHeight)) { return; }
    apply(nextViewportFreezeState(INITIAL_VIEWPORT_FREEZE_STATE, readViewport()), document.documentElement);
}

/** 初始化（在 webview 入口调用一次）：建立基准 → 监听 resize → 跟踪 body 宽度 */
export function initViewportFreeze(): void {
    sync();
    window.addEventListener("resize", sync);
    // 折叠尺寸下的真实用户输入 → 认定是真实小窗口并解冻（见 onUserInput）
    for (const type of USER_INPUT_EVENTS) {
        window.addEventListener(type, onUserInput, { passive: true, capture: true });
    }
    if (typeof ResizeObserver !== "undefined" && document.body) {
        const observer = new ResizeObserver(() => {
            apply(recordBodyWidth(state, document.body.getBoundingClientRect().width), document.documentElement);
        });
        observer.observe(document.body);
    }
}
