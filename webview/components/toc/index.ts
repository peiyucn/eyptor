import './toc.css';
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";
import { IconPin, IconChevronRight, IconChevronDown, IconChevronsUp, IconChevronsDown } from "@/ui/icons";
import { getWebviewState, setWebviewState } from "@/messaging";

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

/** 从 EditorView 提取所有 heading 节点 */
function getHeadings(view: EditorView): HeadingEntry[] {
    const headings: Omit<HeadingEntry, "key">[] = [];
    view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
        if (node.type.name === "heading") {
            headings.push({
                level: node.attrs["level"] as number,
                text: node.textContent,
                pos,
            });
        }
    });
    return assignFoldKeys(headings);
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

    const header = document.createElement("div");
    header.className = "toc-header";

    const headerTitle = document.createElement("span");
    headerTitle.className = "toc-header-title";
    headerTitle.textContent = t("Table of Contents");

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
                    // 吸顶条可见时额外让出它的高度（回归：TOC 跳转后目标标题被吸顶条遮挡）
                    const stickyEl = document.querySelector<HTMLElement>(".heading-sticky-title");
                    const stickyH = stickyEl && !stickyEl.hidden && stickyEl.style.display !== "none"
                        ? stickyEl.getBoundingClientRect().height
                        : 0;
                    const top = el.getBoundingClientRect().top + window.scrollY - topbarH - stickyH - VIEWPORT_PADDING;
                    window.scrollTo({ top, behavior: "smooth" });
                } catch { /* heading 元素已不在 DOM 中，忽略此次跳转 */ }
            });

            item.appendChild(label);
            list.appendChild(item);
        });
        updateCollapseBtn();
    }

    function outsideClickHandler(e: MouseEvent): void {
        if (isPinned) return; // 钉住时不因外部点击关闭
        if (!panel.contains(e.target as Node)) {
            close();
        }
    }

    function syncBodyPadding(): void {
        const active = isPinned && isOpen;
        document.body.classList.toggle("toc-pinned", active);
        const topbar = document.querySelector<HTMLElement>(".milkdown-top-bar");
        if (active) {
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
        updateTabPos();
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
    function hasEnoughSpace(): boolean {
        const editorEl = document.getElementById("editor");
        if (!editorEl) {
            return false;
        }
        return editorEl.getBoundingClientRect().left >= panelWidth;
    }

    function checkAutoShow(): void {
        if (isPinned) return; // 钉住时不因窗口尺寸变化自动关闭
        if (hasEnoughSpace() && !isOpen) {
            openPanel(true);
        } else if (!hasEnoughSpace() && isAutoShown) {
            close();
        }
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
    });

    window.addEventListener("resize", checkAutoShow);

    function show(): void {
        panel.style.visibility = 'visible';
        tabEl.style.visibility = 'visible';
    }

    return { panel, toggle, refresh, show };
}
