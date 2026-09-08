import "./findBar.css";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { createButton } from "@/ui/dom";
import { IconChevronUp, IconChevronDown, IconX } from "@/ui/icons";
import { t, kbd } from "@/i18n";
import { findMatches, MAX_MATCHES } from "@/utils/findMatches";

// TypeScript 类型声明：CSS Custom Highlight API（Chromium 105+ / Electron 22+）
declare class Highlight {
    constructor(...ranges: Range[]);
}
declare namespace CSS {
    const highlights: Map<string, Highlight>;
}

export interface FindBarController {
    open(initialQuery?: string): void;
    close(): void;
    isOpen(): boolean;
}

export function initFindBar(getEditorEl: () => HTMLElement | null): FindBarController {
    // ── DOM 结构 ─────────────────────────────────────────
    const bar = document.createElement("div");
    bar.className = "find-bar";
    bar.setAttribute("role", "search");

    const input = document.createElement("input");
    input.className = "find-bar__input";
    input.type = "text";
    input.placeholder = t("Find");
    input.setAttribute("aria-label", t("Find"));
    input.spellcheck = false;
    input.autocomplete = "off";

    const count = document.createElement("span");
    count.className = "find-bar__count";

    const btnPrev = createButton({
        className: "find-bar__btn",
        icon: IconChevronUp,
        title: `${t("Previous Match")} (${kbd("Shift-Enter")})`,
    });
    btnPrev.setAttribute("aria-label", t("Previous Match"));

    const btnNext = createButton({
        className: "find-bar__btn",
        icon: IconChevronDown,
        title: `${t("Next Match")} (Enter)`,
    });
    btnNext.setAttribute("aria-label", t("Next Match"));

    const sep = document.createElement("div");
    sep.className = "find-bar__sep";

    const btnCase = createButton({
        className: "find-bar__btn",
        label: "Aa",
        title: t("Match Case"),
    });
    btnCase.setAttribute("aria-label", t("Match Case"));
    btnCase.setAttribute("aria-pressed", "false");

    const btnRegex = createButton({
        className: "find-bar__btn",
        label: ".*",
        title: t("Regular Expression"),
    });
    btnRegex.setAttribute("aria-label", t("Regular Expression"));
    btnRegex.setAttribute("aria-pressed", "false");

    const btnClose = createButton({
        className: "find-bar__btn",
        icon: IconX,
        title: `${t("Close")} (Esc)`,
    });
    btnClose.setAttribute("aria-label", t("Close"));

    // 布局：input → count → prev↑ → next↓ → sep → Aa → .* → close
    bar.append(input, count, btnPrev, btnNext, sep, btnCase, btnRegex, btnClose);
    document.body.appendChild(bar);

    // ── 状态 ─────────────────────────────────────────────
    let visible = false;
    let caseSensitive = false;
    let useRegex = false;
    let matchRanges: Range[] = [];
    let currentIdx = 0;
    let debounceTimer = 0;
    /** 本轮搜索是否因达到上限被截断（计数显示「N+」） */
    let truncated = false;

    // ── 高亮更新 ─────────────────────────────────────────
    function updateHighlights() {
        if (!("highlights" in CSS)) { return; }
        if (!matchRanges.length) {
            CSS.highlights.delete("find-highlight");
            CSS.highlights.delete("find-highlight-current");
            return;
        }
        CSS.highlights.set("find-highlight", new Highlight(...matchRanges));
        if (matchRanges[currentIdx]) {
            CSS.highlights.set("find-highlight-current", new Highlight(matchRanges[currentIdx]));
        }
    }

    function clearHighlights() {
        if (!("highlights" in CSS)) { return; }
        CSS.highlights.delete("find-highlight");
        CSS.highlights.delete("find-highlight-current");
    }

    // ── 搜索 ──────────────────────────────────────────────
    function search(query: string) {
        if (!visible) return; // 双保险：关闭后任何迟到调用都不执行（见 close 的 timer 清理）
        matchRanges = [];
        currentIdx = 0;
        truncated = false;

        if (!query) {
            count.textContent = "";
            bar.classList.remove("find-bar--no-results");
            updateHighlights();
            return;
        }

        const editorEl = getEditorEl();
        if (!editorEl) { return; }

        let invalidRegex = false;
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            const result = findMatches(node.textContent!, query, { caseSensitive, useRegex });
            if (result.invalidRegex) {
                invalidRegex = true;
                break;
            }
            for (const m of result.matches) {
                // 聚合上限：匹配总数封顶 MAX_MATCHES（防单个 Highlight 注册海量 Range）
                if (matchRanges.length >= MAX_MATCHES) {
                    truncated = true;
                    break;
                }
                const r = new Range();
                r.setStart(node, m.start);
                r.setEnd(node, m.end);
                matchRanges.push(r);
            }
            if (result.truncated || matchRanges.length >= MAX_MATCHES) {
                truncated = true;
                break;
            }
        }

        if (invalidRegex) {
            matchRanges = [];
            count.textContent = t("Invalid Regex");
            bar.classList.add("find-bar--no-results");
            updateHighlights();
            return;
        }

        if (matchRanges.length) {
            count.textContent = `1/${matchRanges.length}${truncated ? "+" : ""}`;
            bar.classList.remove("find-bar--no-results");
            scrollToMatch(0);
        } else {
            count.textContent = t("No results");
            bar.classList.add("find-bar--no-results");
        }
        updateHighlights();
    }

    function scrollToMatch(idx: number) {
        if (!matchRanges[idx]) { return; }
        currentIdx = idx;
        count.textContent = `${currentIdx + 1}/${matchRanges.length}${truncated ? "+" : ""}`;
        updateHighlights();
        const r = matchRanges[idx];
        const node = r.startContainer;
        const el = node instanceof Element ? node : (node as ChildNode).parentElement;
        if (el) {
            const FIND_SCROLL_OFFSET = 60;
            const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
            const rect = el.getBoundingClientRect();
            if (rect.top < topbarH + VIEWPORT_PADDING || rect.bottom > window.innerHeight - VIEWPORT_PADDING) {
                window.scrollTo({ top: rect.top + window.scrollY - topbarH - FIND_SCROLL_OFFSET });
            }
        }
    }

    function goNext() {
        if (!matchRanges.length) { return; }
        scrollToMatch((currentIdx + 1) % matchRanges.length);
    }

    function goPrev() {
        if (!matchRanges.length) { return; }
        scrollToMatch((currentIdx - 1 + matchRanges.length) % matchRanges.length);
    }

    // ── 事件绑定 ─────────────────────────────────────────
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => search(input.value), 150);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) { goPrev(); } else { goNext(); }
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyF") {
            e.preventDefault();
        }
    });

    btnNext.addEventListener("click", goNext);
    btnPrev.addEventListener("click", goPrev);
    btnClose.addEventListener("click", close);

    btnCase.addEventListener("click", () => {
        caseSensitive = !caseSensitive;
        btnCase.classList.toggle("find-bar__btn--active", caseSensitive);
        btnCase.setAttribute("aria-pressed", String(caseSensitive));
        search(input.value);
    });

    btnRegex.addEventListener("click", () => {
        useRegex = !useRegex;
        btnRegex.classList.toggle("find-bar__btn--active", useRegex);
        btnRegex.setAttribute("aria-pressed", String(useRegex));
        search(input.value);
    });

    // 阻止搜索栏内的 mousedown 冒泡，防止编辑器捕获
    bar.addEventListener("mousedown", (e) => e.stopPropagation());

    // ── 公开 API ─────────────────────────────────────────
    function open(initialQuery?: string) {
        visible = true;
        bar.classList.add("find-bar--visible");
        if (initialQuery !== undefined && initialQuery !== input.value) {
            input.value = initialQuery;
        }
        input.focus();
        input.select();
        search(input.value);
    }

    function close() {
        visible = false;
        // 回归（P3）：此前不清防抖 timer——关闭后 150ms 内 pending 搜索照常执行，
        // 高亮复活、计数写回隐藏栏、页面被 scrollToMatch 拽动
        clearTimeout(debounceTimer);
        debounceTimer = 0;
        bar.classList.remove("find-bar--visible");
        bar.classList.remove("find-bar--no-results");
        clearHighlights();
        matchRanges = [];
        count.textContent = "";
    }

    return { open, close, isOpen: () => visible };
}
