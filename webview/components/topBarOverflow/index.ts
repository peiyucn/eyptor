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

const MORE_BTN_WIDTH = 34;
/** 安全边距：居中布局下右侧空隙不可预知，多扣 12px 防「⋯」与最后一个按钮重叠 */
const MORE_BTN_SAFETY_GAP_PX = 12;
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

        // 先全部显示再测量
        inner.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`).forEach((el) => el.classList.remove(HIDDEN_CLASS));

        const containerWidth = getTopBarUsableWidth(topBar);
        const items: TopBarMeasuredItem[] = [];
        let metaIdx = 0;
        for (const child of Array.from(inner.children) as HTMLElement[]) {
            if (child.classList.contains("top-bar-divider")) {
                items.push({ key: `__divider__${items.length}`, width: child.getBoundingClientRect().width, isDivider: true });
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
            items,
            containerWidth,
            moreBtnWidth: MORE_BTN_WIDTH + MORE_BTN_SAFETY_GAP_PX,
            pinnedKeys: PINNED_KEYS,
        });

        // 应用隐藏 class（DOM 与 meta 顺序一致）；
        // 分割线跟随其左侧按钮：左侧按钮被收起时一并隐藏（防宽度收窄后一串孤立分割线）
        metaIdx = 0;
        let prevHidden = false;
        for (const child of Array.from(inner.children) as HTMLElement[]) {
            if (child.classList.contains("top-bar-divider")) {
                child.classList.toggle(HIDDEN_CLASS, prevHidden);
                continue;
            }
            if (
                !child.classList.contains("top-bar-item") &&
                !child.classList.contains("top-bar-heading-selector")
            ) {
                continue;
            }
            const key = _meta[metaIdx]?.key ?? "";
            metaIdx++;
            const hidden = hiddenKeys.has(key);
            child.classList.toggle(HIDDEN_CLASS, hidden);
            prevHidden = hidden;
        }

        moreBtn.hidden = hiddenKeys.size === 0;
        const rect = topBar.getBoundingClientRect();
        moreBtn.style.top = `${Math.max(2, rect.top + (rect.height - 28) / 2)}px`;
        // 动态定位：紧跟按钮组（top-bar-inner）右缘，而非固定视口右缘——
        // 居中布局下右缘空隙不可预知，固定右缘会与最后一个按钮重叠（回归）
        const innerRect = inner.getBoundingClientRect();
        const innerRight = innerRect.width > 0 ? innerRect.right : rect.right - 40;
        const desiredLeft = innerRight + 4;
        moreBtn.style.left = `${Math.min(desiredLeft, window.innerWidth - MORE_BTN_WIDTH - 6)}px`;
        moreBtn.style.right = "auto";

        // Vue patch 可能覆盖隐藏 class：测量完成后恢复监听（目标可能被重建）
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

    // 窗口尺寸变化（body 尺寸随之变化）；topBar 内部变化由 mutation observer 捕获
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
    window.addEventListener("resize", schedule);

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
