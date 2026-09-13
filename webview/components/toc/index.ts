import './toc.css';
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { hideStickyUntilNextInteraction, onActiveHeadingChange, getActiveHeadingPos } from "../../headingStickyPlugin";
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";
import { IconChevronRight, IconChevronDown } from "@/ui/icons";
import { getWebviewState, setWebviewState } from "@/messaging";
import { buildHeadingIndex } from "../../utils/headingFold";
import { shouldSkipViewportWork } from "../../utils/viewportLedger";

interface HeadingEntry {
    level: number;
    text: string;
    pos: number;
    /** 折叠状态的稳定键（level:text#序号，与文档位置无关——pos 会随编辑漂移） */
    key: string;
}

/** 折叠键：同名同级标题按「第几次出现」区分（回归 P6：此前 level:text 让同一文档
 * 两个「## 安装」共用一个折叠开关；文档身份维度不需要——每个文档独立 webview 状态） */
export function headingFoldKey(level: number, text: string, nth: number): string {
    return `${level}:${text}#${nth}`;
}

/** 为标题序列分配折叠键（纯函数，供测试；输入只需 level/text） */
export function assignFoldKeys<T extends { level: number; text: string }>(headings: T[]): (T & { key: string })[] {
    const seen = new Map<string, number>();
    return headings.map((h) => {
        const base = `${h.level}:${h.text}`;
        const nth = (seen.get(base) ?? 0) + 1;
        seen.set(base, nth);
        return { ...h, key: headingFoldKey(h.level, h.text, nth) };
    });
}

const TOC_WIDTH = 200;
const TOC_MIN_WIDTH = 200;
const TOC_MAX_WIDTH = 500;

/**
 * 自动展开阈值 = 用户设置的编辑页宽度 + 这个余量（默认 900 + 100 = 1000px）。
 *
 * 为什么是「编辑页宽度 + 余量」：TOC 是给正文让位的侧栏，窗口得先装得下正文列、
 * 再多出一点才值得自动出现（owner 定的口径 2026-09-12）。
 *
 * 为什么量窗口宽而不是量"正文左侧空白"：打开态是推正文的，量空白会把面板自身的影响
 * 算进去（面板一开、正文一窄、"空白"同步缩水 → 立刻判定放不下 → 反馈回路，实测表现为
 * 「自动关闭的阈值偏大」）。窗口宽天然不受面板影响。
 */
export const TOC_AUTO_SHOW_EXTRA_PX = 100;

/** 纯判据（可直测）：窗口宽是否够自动展开 */
export function shouldAutoShowToc(viewportWidth: number, editorMaxWidth: number): boolean {
    return viewportWidth >= editorMaxWidth + TOC_AUTO_SHOW_EXTRA_PX;
}

/**
 * 打开状态的唯一裁决（纯函数，可直测）——优先级按 owner 在 DSH 左边栏上逐条实测的结论：
 *
 * - **用户点过关闭**（`dismissed`）= 最高优先级：无论窗口怎么变都不再自动打开；
 * - 用户点开 = 解除该偏好，此后是否保持**由宽度决定**（手动打开不压过宽度规则）。
 */
export function resolveTocOpen(dismissed: boolean, viewportWidth: number, editorMaxWidth: number): boolean {
    if (dismissed) { return false; }
    return shouldAutoShowToc(viewportWidth, editorMaxWidth);
}

/** 从 EditorView 提取所有 heading 节点（共享索引，口径与折叠/吸顶一致；TOC 列出全部深度） */
function getHeadings(view: EditorView): HeadingEntry[] {
    return assignFoldKeys(
        buildHeadingIndex(view.state.doc).map((entry) => ({
            level: entry.level,
            text: entry.text,
            pos: entry.pos,
        })),
    );
}

/** 根据 heading 在文档中的位置找到对应的标题 DOM 元素 */
function findHeadingElement(view: EditorView, pos: number): HTMLElement | null {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom?.matches("h1,h2,h3,h4,h5,h6")) return dom;
    const { node } = view.domAtPos(pos + 1);
    let el: HTMLElement | null =
        node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    while (el && !el.matches("h1,h2,h3,h4,h5,h6")) el = el.parentElement;
    return el;
}

function hasChildren(headings: HeadingEntry[], index: number): boolean {
    if (index >= headings.length - 1) return false;
    return headings[index + 1].level > headings[index].level;
}

function isHeadingVisible(headings: HeadingEntry[], index: number, collapsed: Set<string>): boolean {
    let ancestorLevel = headings[index].level;
    for (let i = index - 1; i >= 0; i--) {
        if (headings[i].level < ancestorLevel) {
            if (collapsed.has(headings[i].key)) return false;
            ancestorLevel = headings[i].level;
        }
    }
    return true;
}

/** 编辑页宽度（px）——由 initToc 的调用方在配置变化时写入 */
let _editorMaxWidth = 900;

/** 更新自动展开阈值所用的编辑页宽度（`epytor.editorMaxWidth`） */
export function setTocEditorMaxWidth(width: number): void {
    if (Number.isFinite(width) && width > 0) { _editorMaxWidth = width; }
}

export function initToc(getEditorView: () => EditorView | null): {
    panel: HTMLElement;
    toggle: () => void;
    refresh: () => void;
    show: () => void;
} {
    const panel = document.createElement("div");
    panel.className = "toc-panel";

    /** TOC 列表项 → 对应标题 DOM 元素（refresh 时填充，点击跳转用；P9） */
    const headingEls = new WeakMap<HTMLElement, HTMLElement>();

    /** 标题位置 → 列表项（高亮跟随用；refresh 时重建） */
    const itemByPos = new Map<number, HTMLElement>();

    /**
     * 高亮当前章节并把它滚进可视区（跟随吸顶条的「我们现在在哪」）。
     *
     * 只动列表自身的 scrollTop（不用 scrollIntoView：那会连带滚动窗口，把正文顶跑）。
     */
    function applyActiveHeading(pos: number | null): void {
        for (const [itemPos, el] of itemByPos) {
            el.classList.toggle("toc-item--active", pos !== null && itemPos === pos);
        }
        if (pos === null) { return; }
        const item = itemByPos.get(pos);
        if (!item) { return; }
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        if (itemRect.top >= listRect.top && itemRect.bottom <= listRect.bottom) { return; }
        list.scrollTop += itemRect.top - listRect.top - (listRect.height - itemRect.height) / 2;
    }

    const header = document.createElement("div");
    header.className = "toc-header";

    const headerTitle = document.createElement("span");
    headerTitle.className = "toc-header-title";
    // 标题短一点（手测反馈：Table of Contents 太长）——英文显示 Contents，中文词典给「目录」
    headerTitle.textContent = t("Contents");
    // 说明：本组件**不再**有「整体收起/展开」与「钉住」两个按钮——
    // 每个节点自己能收展（前者多余）；打开即常驻（后者的语义被"打开"吸收）。
    header.appendChild(headerTitle);

    const list = document.createElement("div");
    list.className = "toc-list";

    panel.appendChild(header);
    panel.appendChild(list);

    // ── 右侧 Tab（独立 fixed 元素，JS 同步 left 对齐 panel 右边缘）──
    const tabEl = document.createElement("button");
    tabEl.className = "toc-toggle-tab";
    tabEl.tabIndex = -1;
    document.body.appendChild(tabEl);

    /**
     * 只有两个状态：打开 / 关闭。`dismissedByUser` 承载「用户点过关闭」这个**最高优先级**
     * 偏好（持久化）——它成立时无论窗口怎么变都不自动打开；用户点开即解除。
     * 见 docs/specs/2026-09-12-toc-two-state.md。
     */
    let isOpen = false;
    let dismissedByUser = false;
    let panelWidth = TOC_WIDTH;

    // 从 webview 状态恢复：关闭偏好 + 面板宽度（`tocPinned` 已废弃，不再读取）
    const savedState = getWebviewState();
    if (savedState?.tocDismissed === true) { dismissedByUser = true; }
    if (savedState?.tocWidth && typeof savedState.tocWidth === "number") {
        panelWidth = Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, savedState.tocWidth));
    }
    panel.style.width = `${panelWidth}px`;

    // ── 折叠状态（稳定键：level:text#序号；回归——曾以文档 pos 为键，跨文档恢复时
    // 新文档标题被旧 pos 集合错误折叠，且编辑漂移后折叠指示错位；再回归 P6——仅
    // level:text 时同名同级标题共用一个开关） ────────────────────────────────
    const collapsedHeadings = new Set<string>();
    if (Array.isArray(savedState?.tocCollapsed)) {
        for (const key of savedState.tocCollapsed) {
            // 仅接受当前格式的字符串键；旧版本持久化的数字 pos 与 level:text 键
            // 一律丢弃（一次性迁移：老键不会匹配新键，留着只会被反复持久化）
            if (typeof key === "string" && key.includes("#")) collapsedHeadings.add(key);
        }
    }

    function saveCollapsedState(): void {
        setWebviewState({
            ...(getWebviewState() ?? {}),
            tocDismissed: dismissedByUser,
            tocWidth: panelWidth,
            tocCollapsed: Array.from(collapsedHeadings),
        });
    }

    function refresh(): void {
        if (!isOpen) return;
        const view = getEditorView();
        if (!view) return;
        const headings = getHeadings(view);
        list.innerHTML = "";
        itemByPos.clear();
        // headingEls 为 WeakMap：列表重建后旧项自动可回收，无需清空
        if (headings.length === 0) {
            const empty = document.createElement("div");
            empty.className = "toc-empty";
            empty.textContent = t("No headings");
            list.appendChild(empty);
            return;
        }
        headings.forEach((h, idx) => {
            if (!isHeadingVisible(headings, idx, collapsedHeadings)) return;

            const item = document.createElement("div");
            item.className = `toc-item toc-item--h${h.level}`;
            item.style.paddingLeft = `${(h.level - 1) * 12 + 8}px`;
            // 记录标题 DOM 元素引用（点击跳转用；P9：替代「按文本反查 pos」的 O(n) 路径）
            const headingEl = findHeadingElement(view, h.pos);
            if (headingEl) { headingEls.set(item, headingEl); }

            const hasKids = hasChildren(headings, idx);
            const toggle = document.createElement("span");
            toggle.className = "toc-collapse-toggle";
            if (hasKids) {
                const isCollapsed = collapsedHeadings.has(h.key);
                toggle.innerHTML = isCollapsed ? IconChevronRight : IconChevronDown;
                toggle.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isCollapsed) {
                        collapsedHeadings.delete(h.key);
                    } else {
                        collapsedHeadings.add(h.key);
                    }
                    saveCollapsedState();
                    refresh();
                });
            } else {
                toggle.textContent = "–";
                toggle.style.cursor = "default";
            }
            item.appendChild(toggle);

            const label = document.createElement("span");
            label.className = "toc-item-label";
            label.textContent = h.text || `${t("Heading")} ${h.level}`;
            applyTooltip(label, h.text, { placement: "above", truncatedOnly: true });

            label.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const v = getEditorView();
                if (!v) return;
                try {
                    // 点击时用 refresh 时记录的标题 DOM 元素反查当前位置（回归 P9：
                    // 此前按「level+文本」全文档 descendants 反查——每次点击 O(n)，
                    // 且两个同文同级标题永远命中第一个；元素引用随 ProseMirror DOM
                    // 复用稳定，posAtDOM 即得当前位置）
                    const el = headingEls.get(item);
                    if (!el || !v.dom.contains(el)) return;
                    const topbar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
                    const topbarH = topbar?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
                    // 跳转后隐藏吸顶条直到用户下一次交互：目标章节正常显示在顶栏下方，
                    // 不再残留上一个章节的吸顶条（用户反馈：应该正常显示到对应章节、没有吸顶标题）
                    hideStickyUntilNextInteraction();
                    const top = el.getBoundingClientRect().top + window.scrollY - topbarH - VIEWPORT_PADDING;
                    window.scrollTo({ top, behavior: "smooth" });
                } catch { /* heading 元素已不在 DOM 中，忽略此次跳转 */ }
            });

            item.appendChild(label);
            list.appendChild(item);
            itemByPos.set(h.pos, item);
        });
        applyActiveHeading(getActiveHeadingPos());
    }

    function syncBodyPadding(): void {
        document.body.classList.toggle("toc-open", isOpen);
        const topbar = document.querySelector<HTMLElement>(".milkdown-top-bar");
        // 打开态一律推正文（没有悬浮态）：面板不遮字，窗口窄也由用户自己关
        if (isOpen) {
            document.body.style.paddingLeft = `${panelWidth}px`;
            if (topbar) topbar.style.paddingLeft = `${panelWidth}px`;
        } else {
            document.body.style.paddingLeft = '';
            if (topbar) topbar.style.paddingLeft = '';
        }
    }

    function updateTabPos(): void {
        tabEl.style.left = isOpen ? `${panelWidth}px` : '0px';
        // 把手方向随状态翻转（用户明确点开就在那儿放着的视觉预期）
        tabEl.textContent = isOpen ? "‹" : "›";
        tabEl.dataset.tocState = isOpen ? "open" : "closed";
        applyTooltip(tabEl, isOpen ? t("Collapse") : t("Expand"), { placement: "above" });
    }

    /** 关闭；`byUser` 表示这是用户点击关闭 —— 记成最高优先级偏好并持久化 */
    function close(byUser: boolean): void {
        isOpen = false;
        panel.classList.remove("toc-panel--open");
        if (byUser) {
            dismissedByUser = true;
            saveCollapsedState();
        }
        updateTabPos();
        syncBodyPadding();
    }

    /** 打开；用户点击打开会**解除**关闭偏好（此后是否保持由宽度决定） */
    function open(byUser: boolean): void {
        isOpen = true;
        if (byUser && dismissedByUser) {
            dismissedByUser = false;
            saveCollapsedState();
        }
        panel.classList.add("toc-panel--open");
        refresh();
        updateTabPos();
        syncBodyPadding();
    }

    function toggle(): void {
        if (isOpen) {
            close(true);
        } else {
            open(true);
        }
    }

    // Tab：关闭时点按=toggle，展开时点按=toggle / 拖拽=调整宽度
    let tabDragStart = 0;
    let tabDragWidth = 0;
    let tabDragging = false;
    tabEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 关闭状态：不进入拖拽，直接 toggle
        if (!isOpen) { toggle(); return; }
        tabDragStart = e.clientX;
        tabDragWidth = panelWidth;
        tabDragging = false;
        document.body.classList.add("toc-resizing");

        function onMove(ev: MouseEvent) {
            const delta = ev.clientX - tabDragStart;
            if (!tabDragging && Math.abs(delta) < 3) return;
            tabDragging = true;
            const newWidth = Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, tabDragWidth + delta));
            if (newWidth !== panelWidth) {
                panelWidth = newWidth;
                panel.style.width = `${panelWidth}px`;
                updateTabPos();
                syncBodyPadding();
            }
        }
        function onUp() {
            document.body.classList.remove("toc-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (!tabDragging) toggle();
            saveCollapsedState();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // ── 宽度自适应（只在没有关闭偏好时起作用）──────────────────
    function checkAutoShow(): void {
        // 宿主折叠态（切到非 webview 标签）视口是假的 300×150：此刻判定会把目录误收起，
        // 切回来再展开——用户看到左侧闪动
        if (shouldSkipViewportWork()) return;
        const shouldOpen = resolveTocOpen(dismissedByUser, document.documentElement.clientWidth, _editorMaxWidth);
        if (shouldOpen && !isOpen) {
            open(false);
        } else if (!shouldOpen && isOpen) {
            close(false);
        } else if (isOpen) {
            syncBodyPadding();
        }
    }

    // 面板位置（top/height）由 toc.css 静态声明（与 topbar 高度 36px 对齐）——
    // 回归：此前 updatePanelPosition() 每次调用都写入与 CSS 相同的定值，且被
    // rAF 初始化与 resize 重复调用、永不产生不同结果（死重函数，已删除）

    updateTabPos();
    requestAnimationFrame(() => {
        checkAutoShow();
        // 首帧同步一次当前章节（订阅只覆盖"变化"）
        applyActiveHeading(getActiveHeadingPos());
    });

    window.addEventListener("resize", checkAutoShow);
    // 当前章节跟随（判定与吸顶条同源：吸顶条最内层那一行）
    onActiveHeadingChange(applyActiveHeading);

    function show(): void {
        panel.style.visibility = 'visible';
        tabEl.style.visibility = 'visible';
    }

    return { panel, toggle, refresh, show };
}
