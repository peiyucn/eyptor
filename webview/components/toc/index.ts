import './toc.css';
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { hideStickyUntilNextInteraction, onActiveHeadingChange, getActiveHeadingPos } from "../../headingStickyPlugin";
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";
import { IconPin, IconChevronRight, IconChevronDown, IconChevronsUp, IconChevronsDown } from "@/ui/icons";
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
 * 非固定态自动展开所需的左侧空白（面板宽度的比例）。
 *
 * 回归（用户反馈 2026-09-12）：「自动出现的时机是判定宽度吧？目前好像宽度设置的比较宽，
 * 可以窄一点，让非固定 toc 尽早能自动显示出来」——原判据要求左侧空白 ≥ 整个面板宽度，
 * 窗口稍窄就永远不出现。改为按比例放行；同时自动展开时面板**收窄到空白之内**，
 * 所以放宽阈值不会遮住正文。
 */
const TOC_AUTO_SHOW_MIN_MARGIN_RATIO = 0.55;

/** 纯判据（可直测）：左侧空白是否够自动展开。
 *  取整后再比：`200 × 0.55` 在浮点下是 110.00000000000001，会把「刚好 110px」判成不够。 */
export function shouldAutoShowToc(leftSpace: number, panelWidth: number): boolean {
    return leftSpace >= Math.floor(panelWidth * TOC_AUTO_SHOW_MIN_MARGIN_RATIO);
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

    // ── 全部折叠/展开按钮 ───────────────────────────────────
    const collapseAllBtn = document.createElement("button");
    collapseAllBtn.className = "toc-pin-btn";
    collapseAllBtn.tabIndex = -1;
    const collapseAllTip = applyTooltip(collapseAllBtn, t("Collapse all"), { placement: "below" });

    function updateCollapseBtn(): void {
        const view = getEditorView();
        const headings = view ? getHeadings(view) : [];
        const anyExpanded = headings.some(
            (h, i) => hasChildren(headings, i) && !collapsedHeadings.has(h.key),
        );
        collapseAllBtn.innerHTML = anyExpanded ? IconChevronsUp : IconChevronsDown;
        collapseAllTip.setText(anyExpanded ? t("Collapse all") : t("Expand all"));
    }

    // ── 固定按钮 ──────────────────────────────────────────────
    const pinBtn = document.createElement("button");
    pinBtn.className = "toc-pin-btn";
    pinBtn.tabIndex = -1;
    pinBtn.innerHTML = IconPin;
    applyTooltip(pinBtn, t("Pin panel"), { placement: "below" });

    header.appendChild(headerTitle);
    header.appendChild(collapseAllBtn);
    header.appendChild(pinBtn);

    const list = document.createElement("div");
    list.className = "toc-list";

    panel.appendChild(header);
    panel.appendChild(list);

    // ── 右侧 Tab（独立 fixed 元素，JS 同步 left 对齐 panel 右边缘）──
    const tabEl = document.createElement("button");
    tabEl.className = "toc-toggle-tab";
    tabEl.tabIndex = -1;
    document.body.appendChild(tabEl);

    let isOpen = false;
    let isAutoShown = false;
    let isPinned = false;
    let panelWidth = TOC_WIDTH;

    // 从 webview 状态恢复固定设置和面板宽度
    const savedState = getWebviewState();
    if (savedState?.tocPinned) {
        isPinned = true;
        pinBtn.classList.add("toc-pin-btn--active");
    }
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
    updateCollapseBtn();

    // ── Pin 按钮点击 ─────────────────────────────────────────
    pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        pinBtn.classList.toggle("toc-pin-btn--active", isPinned);
        // 钉住时不注册外部点击关闭；取消固定后若面板仍打开则补注册
        if (!isPinned && isOpen && !isAutoShown) {
            setTimeout(() => {
                document.addEventListener("mousedown", outsideClickHandler);
            }, 0);
        }
        syncBodyPadding();
        setWebviewState({ ...(getWebviewState() ?? {}), tocPinned: isPinned, tocWidth: panelWidth });
    });

    // ── 全部折叠/展开点击 ──────────────────────────────────────
    collapseAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const view = getEditorView();
        const headings = view ? getHeadings(view) : [];
        const anyExpanded = headings.some(
            (h, i) => hasChildren(headings, i) && !collapsedHeadings.has(h.key),
        );
        if (anyExpanded) {
            headings.forEach((h, i) => {
                if (hasChildren(headings, i)) collapsedHeadings.add(h.key);
            });
            collapseAllBtn.title = t("Expand all");
        } else {
            collapsedHeadings.clear();
            collapseAllBtn.title = t("Collapse all");
        }
        saveCollapsedState();
        updateCollapseBtn();
        refresh();
    });

    function saveCollapsedState(): void {
        setWebviewState({
            ...(getWebviewState() ?? {}),
            tocPinned: isPinned,
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
            updateCollapseBtn();
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
        updateCollapseBtn();
        applyActiveHeading(getActiveHeadingPos());
    }

    function outsideClickHandler(e: MouseEvent): void {
        if (isPinned) return; // 钉住时不因外部点击关闭
        if (!panel.contains(e.target as Node)) {
            close();
        }
    }

    function syncBodyPadding(): void {
        document.body.classList.toggle("toc-pinned", isPinned);
        const topbar = document.querySelector<HTMLElement>(".milkdown-top-bar");
        // 面板展开时若左侧空白放不下它，就把正文推开——**不覆盖正文**。
        // 回归（手测 2026-09-12）：原实现只在钉住时推正文，非固定态把面板拖宽会压在正文上，
        // 看着像布局坏了；而一旦改成"自动展开就推"，窗口很宽时正文又会无谓地右移。
        // 判据用 freeLeftMargin()（已扣掉当前 padding），因此不会与 padding 互相触发。
        const shouldPush = isOpen && freeLeftMargin() < panelWidth;
        if (shouldPush) {
            document.body.style.paddingLeft = `${panelWidth}px`;
            if (topbar) topbar.style.paddingLeft = `${panelWidth}px`;
        } else {
            document.body.style.paddingLeft = '';
            if (topbar) topbar.style.paddingLeft = '';
        }
    }

    function updateTabPos(): void {
        tabEl.style.left = isOpen ? `${panelWidth}px` : '0px';
    }

    function close(): void {
        isOpen = false;
        isAutoShown = false;
        panel.classList.remove("toc-panel--open");
        document.removeEventListener("mousedown", outsideClickHandler);
        updateTabPos();
        syncBodyPadding();
    }

    function openPanel(auto: boolean): void {
        isOpen = true;
        isAutoShown = auto;
        panel.classList.add("toc-panel--open");
        refresh();
        applyPanelWidth();
        syncBodyPadding();
        if (!auto && !isPinned) {
            // 手动打开才注册外部点击关闭（自动展开时或钉住时 TOC 持久显示）
            setTimeout(() => {
                document.addEventListener("mousedown", outsideClickHandler);
            }, 0);
        }
    }

    function toggle(): void {
        if (isOpen) {
            close();
        } else {
            openPanel(false);
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
            setWebviewState({ ...(getWebviewState() ?? {}), tocPinned: isPinned, tocWidth: panelWidth });
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // ── 自动展开检测 ──────────────────────────────────────
    /**
     * 正文列左侧的**未被推开的**空白（px）。
     *
     * 判据必须与当前 padding 无关，否则会自己触发自己。**不能**用 `editor.left − padding`
     * 估算：正文列是居中布局（`max-width` + 自动外边距），去掉 padding 只会让它左移一半，
     * 实测在 1440 宽下算出 170px（真实空白 270px）→ 宽窗口也被判成「放不下」而无谓地推正文。
     * 按列宽直接算：居中布局下左右空白相等。
     */
    function freeLeftMargin(): number {
        const editorEl = document.getElementById("editor");
        if (!editorEl) { return 0; }
        const viewportWidth = document.documentElement.clientWidth;
        return Math.max(0, (viewportWidth - editorEl.getBoundingClientRect().width) / 2);
    }

    function hasEnoughSpace(): boolean {
        return shouldAutoShowToc(freeLeftMargin(), panelWidth);
    }

    function applyPanelWidth(): void {
        panel.style.width = `${panelWidth}px`;
        updateTabPos();
    }

    function checkAutoShow(): void {
        if (isPinned) return; // 钉住时不因窗口尺寸变化自动关闭
        // 宿主折叠态（切到非 webview 标签）视口是假的 300×150：此刻的空间判定
        // 会把目录误判为「放不下」而收起，切回来再展开——用户看到左侧闪动
        if (shouldSkipViewportWork()) return;
        if (!hasEnoughSpace() && isAutoShown) {
            close();
            return;
        }
        if (hasEnoughSpace() && !isOpen) {
            openPanel(true);
            return;
        }
        if (isOpen) { syncBodyPadding(); }
    }

    // 面板位置（top/height）由 toc.css 静态声明（与 topbar 高度 36px 对齐）——
    // 回归：此前 updatePanelPosition() 每次调用都写入与 CSS 相同的定值，且被
    // rAF 初始化与 resize 重复调用、永不产生不同结果（死重函数，已删除）

    updateTabPos();
    requestAnimationFrame(() => {
        if (isPinned && !isOpen) {
            openPanel(true);
        }
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
