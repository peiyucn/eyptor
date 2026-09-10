/**
 * 顶栏溢出菜单：窗口收窄时把放不下的按钮收进「⋯」面板。
 * 约束：官方 topBar 为 Vue 组件，禁止 DOM 移动；本组件仅控制显示 class +
 * 渲染 body 级溢出面板（按钮副本），按钮动作由宿主注入的 runItem 回调执行。
 */
import "./topBarOverflow.css";
import type { Ctx } from "@milkdown/kit/ctx";
import { computeOverflow, type TopBarMeasuredItem } from "@/utils/topBarOverflow";
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";
import { shouldSkipViewportWork } from "@/utils/viewportLedger";

export interface TopBarButtonMeta {
    key: string;
    icon: string;
    onRun: (ctx: Ctx) => void;
}

interface TopBarOverflowHost {
    getTopBarEl: () => HTMLElement | null;
    /** 执行被收起按钮的原动作（由宿主注入编辑器 ctx） */
    runItem: (meta: TopBarButtonMeta) => void;
}

const ITEM_LABELS: Record<string, string> = {
    "heading": t("Heading"),
    "undo": t("Undo"),
    "redo": t("Redo"),
    "clear-format": t("Clear Formatting"),
    "image": t("Insert Image"),
    "table": t("Insert Table"),
    "link": t("Insert/Edit Link"),
    "code-block": t("Code Block"),
    "math": t("Math Formula"),
    "bullet-list": t("Bullet List"),
    "ordered-list": t("Ordered List"),
    "task-list": t("Task List"),
    "quote": t("Blockquote"),
    "hr": t("Horizontal Rule"),
    "toc": t("Table of Contents"),
    "settings": t("Settings"),
};

/** 优先保留的按钮（heading 下拉与 history 组） */
const PINNED_KEYS = new Set(["heading", "undo", "redo"]);

/**
 * 常驻溢出菜单的按钮（用户决策）：非编辑类按钮（如设置）默认不进顶栏，
 * 顶栏只放编辑相关按钮——按钮总数减少、溢出频率降低，
 * 且「⋯」按钮固定右缘不再需要动态跟随间隙（结构性消除重叠）。
 */
const ALWAYS_IN_MENU_KEYS = new Set(["settings"]);

const MORE_BTN_WIDTH = 34;
/**
 * 安全边距：固定右缘方案下按钮组实际占位与预算存在系统性偏差
 * （真实引擎实测重叠 7-40px，来自居中 flex 的 item 收缩/间距），预留 96px 兜底。
 */
const MORE_BTN_SAFETY_GAP_PX = 96;
const HIDDEN_CLASS = "top-bar-item--overflow-hidden";

let _meta: TopBarButtonMeta[] = [];

export function setTopBarButtonMeta(meta: TopBarButtonMeta[]): void {
    _meta = meta;
}

/**
 * 顶栏按钮实际可用宽度 = topBar 宽度 − 左右内边距。
 * 回归：此前直接使用 topBar 全宽作为预算，未扣除 padding-left 85px / padding-right 40px，
 * 预算虚高 125px，收窄窗口时按钮溢出并与「⋯」按钮重叠。
 */
export function getTopBarUsableWidth(topBar: HTMLElement): number {
    const style = window.getComputedStyle(topBar);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    return Math.max(0, topBar.clientWidth - padLeft - padRight);
}

/** 按 meta 顺序定位指定 key 的顶栏按钮 DOM（heading selector 与普通 item 均计入序列） */
export function findTopBarButtonEl(topBar: HTMLElement, key: string): HTMLElement | null {
    const children = Array.from(
        topBar.querySelectorAll<HTMLElement>(".top-bar-item, .top-bar-heading-selector"),
    );
    let metaIdx = 0;
    for (const child of children) {
        const meta = _meta[metaIdx];
        if (meta && meta.key === key) return child;
        metaIdx++;
    }
    return null;
}

let _activeMenu: HTMLElement | null = null;
let _onMenuKey: ((e: KeyboardEvent) => void) | null = null;
let _onMenuDocMousedown: ((e: MouseEvent) => void) | null = null;
let _onMenuScroll: (() => void) | null = null;

function closeMenu(): void {
    _activeMenu?.remove();
    _activeMenu = null;
    if (_onMenuKey) document.removeEventListener("keydown", _onMenuKey);
    if (_onMenuDocMousedown) document.removeEventListener("mousedown", _onMenuDocMousedown, true);
    if (_onMenuScroll) window.removeEventListener("scroll", _onMenuScroll, true);
    _onMenuKey = null;
    _onMenuDocMousedown = null;
    _onMenuScroll = null;
}

function openOverflowMenu(anchor: HTMLElement, hiddenKeys: ReadonlySet<string>, host: TopBarOverflowHost): void {
    closeMenu();
    if (hiddenKeys.size === 0) return;

    const menu = document.createElement("div");
    menu.className = "epytor-topbar-overflow-menu";
    menu.setAttribute("role", "menu");

    for (const meta of _meta) {
        if (!hiddenKeys.has(meta.key)) continue;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "epytor-topbar-overflow-item";
        item.setAttribute("role", "menuitem");
        item.innerHTML = meta.icon;
        const label = document.createElement("span");
        label.className = "epytor-topbar-overflow-label";
        label.textContent = ITEM_LABELS[meta.key] ?? meta.key;
        item.appendChild(label);
        item.addEventListener("click", () => {
            closeMenu();
            host.runItem(meta);
        });
        menu.appendChild(item);
    }

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const menuWidth = menu.getBoundingClientRect().width;
    const menuHeight = menu.getBoundingClientRect().height;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    // 右缘 clamp：more 按钮贴视口右缘时，右对齐展开的菜单右缘可能超出页面被裁；
    // 用 clientWidth（不含滚动条）对齐可视内容区
    const viewportW = document.documentElement.clientWidth;
    const maxLeft = viewportW - menuWidth - 12;
    if (left > maxLeft) left = maxLeft;
    let top = rect.bottom + 6;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    _activeMenu = menu;
    _onMenuKey = (e) => {
        if (e.key === "Escape") closeMenu();
    };
    _onMenuDocMousedown = (e) => {
        if (!menu.contains(e.target as Node)) closeMenu();
    };
    _onMenuScroll = () => closeMenu();
    document.addEventListener("keydown", _onMenuKey);
    document.addEventListener("mousedown", _onMenuDocMousedown, true);
    window.addEventListener("scroll", _onMenuScroll, true);
}

export function initTopBarOverflow(host: TopBarOverflowHost): { dispose(): void } {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "epytor-topbar-more-btn";
    moreBtn.textContent = "⋯";
    moreBtn.hidden = true;
    moreBtn.setAttribute("aria-label", t("More"));
    applyTooltip(moreBtn, t("More"), { placement: "below" });
    document.body.appendChild(moreBtn);

    let hiddenKeys: Set<string> = new Set();
    let rafId: number | null = null;
    let mutObs: MutationObserver | null = null;

    const measure = (): void => {
        rafId = null;
        // 测量期间挂起 observer：measure 自身会移除/重挂 HIDDEN_CLASS，
        // 若继续观察会把自身 class 变化当成新变化 → schedule → measure 无限循环（每帧重排）
        mutObs?.disconnect();
        mutObs = null;
        const topBar = host.getTopBarEl();
        const inner = topBar?.querySelector<HTMLElement>(".top-bar-inner");
        if (!topBar || !inner) {
            moreBtn.hidden = true;
            return;
        }

        // 先全部显示再测量（常驻菜单的按钮参与布局测量后仍会隐藏）
        inner.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`).forEach((el) => el.classList.remove(HIDDEN_CLASS));

        const containerWidth = getTopBarUsableWidth(topBar);
        const items: TopBarMeasuredItem[] = [];
        let metaIdx = 0;
        for (const child of Array.from(inner.children) as HTMLElement[]) {
            if (child.classList.contains("top-bar-divider")) {
                items.push({ key: `__divider__${items.length}`, width: child.getBoundingClientRect().width });
            } else if (
                child.classList.contains("top-bar-item") ||
                child.classList.contains("top-bar-heading-selector")
            ) {
                const key = _meta[metaIdx]?.key ?? `__item__${metaIdx}`;
                metaIdx++;
                items.push({ key, width: child.getBoundingClientRect().width });
            }
        }

        hiddenKeys = computeOverflow({
            // 常驻菜单按钮（settings）不进顶栏：不占预算
            items: items.filter((item) => !ALWAYS_IN_MENU_KEYS.has(item.key)),
            containerWidth,
            moreBtnWidth: MORE_BTN_WIDTH + MORE_BTN_SAFETY_GAP_PX,
            pinnedKeys: PINNED_KEYS,
        });
        // 常驻菜单按钮永远在溢出集合：more 按钮始终显示、菜单里始终可见
        for (const key of ALWAYS_IN_MENU_KEYS) {
            hiddenKeys.add(key);
        }

        // 应用隐藏 class（DOM 与 meta 顺序一致）；
        // 分割线双向跟随：左侧按钮被收起（组尾）或右侧按钮被收起（组头）时一并隐藏，
        // 否则「⋯」紧跟最后一个可见按钮时会压在残留分割线上（回归：more 压水平线按钮右侧分割线）
        const children = Array.from(inner.children) as HTMLElement[];
        const hiddenFlags = new Map<HTMLElement, boolean>();
        metaIdx = 0;
        for (const child of children) {
            if (child.classList.contains("top-bar-divider")) continue;
            if (
                !child.classList.contains("top-bar-item") &&
                !child.classList.contains("top-bar-heading-selector")
            ) {
                continue;
            }
            const key = _meta[metaIdx]?.key ?? "";
            metaIdx++;
            hiddenFlags.set(child, hiddenKeys.has(key));
        }
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.classList.contains("top-bar-divider")) {
                let prev: HTMLElement | null = null;
                let next: HTMLElement | null = null;
                for (let j = i - 1; j >= 0; j--) {
                    if (hiddenFlags.has(children[j])) { prev = children[j]; break; }
                }
                for (let j = i + 1; j < children.length; j++) {
                    if (hiddenFlags.has(children[j])) { next = children[j]; break; }
                }
                const hidden =
                    (prev !== null && hiddenFlags.get(prev)) ||
                    (next !== null && hiddenFlags.get(next));
                child.classList.toggle(HIDDEN_CLASS, hidden);
                continue;
            }
            if (hiddenFlags.has(child)) {
                child.classList.toggle(HIDDEN_CLASS, hiddenFlags.get(child));
            }
        }

        moreBtn.hidden = hiddenKeys.size === 0;
        const rect = topBar.getBoundingClientRect();
        moreBtn.style.top = `${Math.max(2, rect.top + (rect.height - 28) / 2)}px`;
        // 「⋯」固定右缘（用户决策）：settings 等常驻菜单、顶栏只放编辑按钮，
        // 预算内按钮组不会越过 more 左缘——无需动态跟随间隙，结构性消除重叠。
        // clientWidth 不含纵向滚动条（innerWidth 含），避免右缘被滚动条/编辑框边缘压住
        const viewportW = document.documentElement.clientWidth;
        moreBtn.style.left = `${viewportW - MORE_BTN_WIDTH - 8}px`;
        moreBtn.style.right = "auto";

        // Vue patch 可能覆盖隐藏 class：测量完成后恢复监听（目标可能被重建）；
        // 同时确保 topBar 进入 RO 观察（幂等）——fixed left:0 right:0 尺寸随视口，
        // 直接观察避免 resize 触发缺失导致「⋯」重排滞后（回归：按钮收起时机晚）。
        // 观测 content-box：目录钉住/拖宽度只改 topBar 的 padding-left（border-box 不变），
        // 预算宽度（clientWidth - 左右内边距）却变了——默认 border-box 观测收不到，
        // 「⋯」要等下一次窗口 resize 才重排。
        resizeObserver.observe(topBar, { box: "content-box" });
        mutObs = new MutationObserver(schedule);
        mutObs.observe(topBar, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class"],
        });
    };

    const schedule = (): void => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(measure);
    };

    /** 宿主折叠态（切到非 webview 标签）视口是假的 300×150：此刻测量会把按钮
     *  收进「⋯」，切回来再展开——顶栏可见闪动。折叠期跳过，恢复尺寸的 resize 会重测 */
    const scheduleUnlessCollapsed = (): void => {
        if (shouldSkipViewportWork()) return;
        schedule();
    };

    // 窗口尺寸变化（body 尺寸随之变化）；topBar 内部变化由 mutation observer 捕获
    const resizeObserver = new ResizeObserver(scheduleUnlessCollapsed);
    resizeObserver.observe(document.body);
    window.addEventListener("resize", scheduleUnlessCollapsed);

    moreBtn.addEventListener("mousedown", (e) => {
        // 防止「⋯」按钮夺走编辑器焦点（光标还在但输入失效）
        e.preventDefault();
    });
    moreBtn.addEventListener("click", () => {
        const el = host.getTopBarEl();
        if (!el) return;
        if (_activeMenu) {
            closeMenu();
            return;
        }
        openOverflowMenu(moreBtn, hiddenKeys, host);
    });

    schedule();

    return {
        dispose() {
            mutObs?.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            window.removeEventListener("resize", schedule);
            moreBtn.remove();
            closeMenu();
        },
    };
}
