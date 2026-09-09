/**
 * 标题吸顶插件：滚动时在顶栏下方显示当前章节路径（最多 3 级），点击跳回；
 * 与 headingFold 联动折叠开关。
 *
 * 几何口径对齐 VS Code 内置编辑器的吸顶滚动（见 utils/headingSticky.ts）：
 * 标题顶边碰到它那一行就进入固定状态，本章节末尾划过该行时让位给下一个标题。
 * 回归（用户反馈）：旧实现要等标题**整体**滚出顶栏才切换，晚了一个标题高度，
 * 「新章节都已经滑出可见范围后才切换」，反直觉。
 */
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT } from "../shared/constants";
import { IconChevronDown, IconChevronRight } from "./ui/icons";
import { applyTooltip, hideTooltip } from "./ui/tooltip";
import { t } from "./i18n";
import { headingFoldPluginKey, type HeadingFoldMeta } from "./headingFoldPlugin";
import { onViewportRestored, shouldSkipViewportWork } from "./utils/viewportFreeze";
import { buildHeadingIndex, type HeadingIndexEntry } from "./utils/headingFold";
import { computeStickyRows, STICKY_MAX_ROWS, STICKY_ROW_HEIGHT_PX } from "./utils/headingSticky";
import { getUserInteractionEpoch } from "./utils/userInteraction";

/** 隐藏吸顶条直到用户下一次交互（TOC 跳转用；插件实例挂载时赋值） */
let _hideStickyUntilNextInteraction: (() => void) | null = null;

/**
 * TOC 点击跳转后调用：隐藏吸顶条，直到用户下一次交互为止。
 * 回归：用户反馈「点击 TOC 后上一个章节的吸顶条还在」——此前抑制只有 400ms 定时解除，
 * 用户还没滚动就恢复了；改为按交互纪元判定，且跳转落点让目标标题完整可见。
 */
export function hideStickyUntilNextInteraction(): void {
    _hideStickyUntilNextInteraction?.();
}

function getTopbarBottom(): number {
    const topBar = document.querySelector(".milkdown-top-bar");
    return topBar?.getBoundingClientRect().bottom ?? DEFAULT_TOPBAR_HEIGHT;
}

/**
 * 顶层标题元素 + 索引项（P1：由共享索引经 nodeDOM 取得，删掉 querySelectorAll +
 * 逐标题 posAtDOM 反查与 CSS class 嗅探）。
 * 口径：索引的 topLevel 已按 `resolve(pos + 1).depth === 1` 判定，与折叠插件一致。
 */
function getTopLevelHeadings(view: EditorView): Array<{ el: HTMLElement; entry: HeadingIndexEntry }> {
    const out: Array<{ el: HTMLElement; entry: HeadingIndexEntry }> = [];
    for (const entry of buildHeadingIndex(view.state.doc)) {
        if (!entry.topLevel) continue;
        const el = view.nodeDOM(entry.pos);
        if (el instanceof HTMLElement) out.push({ el, entry });
    }
    return out;
}

export const headingStickyPlugin = $prose(() =>
    new Plugin({
        view(view) {
            const sticky = document.createElement("div");
            sticky.className = "heading-sticky-title";
            sticky.hidden = true;
            sticky.style.display = "none";
            sticky.style.setProperty("--epytor-sticky-row-height", `${STICKY_ROW_HEIGHT_PX}px`);
            document.body.appendChild(sticky);

            let rafId: number | null = null;
            // 跳转后抑制吸顶显示（跳转的 scroll 事件会立即重算，目标标题完整可见时
            // 仍会吸顶前一个标题并遮挡目标）。解除条件 = 用户下一次交互（wheel /
            // 键盘 / 滚动条拖拽的 mousedown）——统一用 userInteraction 的 epoch 判定，
            // 不再用定时兜底（回归：定时器会在用户还没动时就把上一个章节的吸顶条放出来）
            let suppressSticky = false;
            let suppressEpoch: number | null = null;

            const STICKY_SCROLL_OFFSET_PX = 8;
            /** 缓存重建防抖时长（连续输入合并为一次全量布局测量） */
            const CACHE_REBUILD_DEBOUNCE_MS = 300;

            /** 隐藏吸顶条，直到用户下一次交互（epoch 变化）为止 */
            const suppressUntilNextInteraction = (): void => {
                suppressSticky = true;
                suppressEpoch = getUserInteractionEpoch();
                hideSticky();
            };
            _hideStickyUntilNextInteraction = suppressUntilNextInteraction;

            const scrollHeadingIntoStickyPosition = (headingPos: number) => {
                requestAnimationFrame(() => {
                    const heading = view.nodeDOM(headingPos);
                    if (!(heading instanceof HTMLElement)) return;
                    const top = heading.getBoundingClientRect().top + window.scrollY - getTopbarBottom() - STICKY_SCROLL_OFFSET_PX;
                    window.scrollTo({ top });
                });
            };

            // 点击某一级跳回该标题：只绑定一次（层级变化仅重建行内容，避免监听器累积）
            sticky.addEventListener("click", (event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest(".heading-sticky-toggle")) return;
                const row = target?.closest<HTMLElement>(".heading-sticky-row");
                const pos = Number(row?.dataset["headingPos"]);
                // pos 是节点起始位置，**文档第一个标题就是 0**（回归：旧代码用 pos > 0
                // 判定，第一级吸顶行点了没反应，二三级正常）
                if (Number.isFinite(pos) && pos >= 0) {
                    suppressUntilNextInteraction();
                    scrollHeadingIntoStickyPosition(pos);
                }
            });

            const makeFoldToggle = (headingPos: number, collapsed: boolean): HTMLButtonElement => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "heading-sticky-toggle";
                button.innerHTML = collapsed ? IconChevronRight : IconChevronDown;
                const tipText = collapsed ? t("Expand content") : t("Collapse content");
                button.setAttribute("aria-label", tipText);
                button.setAttribute("aria-expanded", collapsed ? "false" : "true");
                applyTooltip(button, tipText, { placement: "above" });
                button.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const tr = view.state.tr
                        .setMeta(headingFoldPluginKey, {
                            type: "toggle",
                            pos: headingPos,
                        } satisfies HeadingFoldMeta)
                        .setMeta("addToHistory", false);
                    view.dispatch(tr);
                    view.focus();
                    hideTooltip();
                    scrollHeadingIntoStickyPosition(headingPos);
                });
                return button;
            };

            const hideSticky = () => {
                sticky.hidden = true;
                // 双保险：heading.css 的 display:flex 会覆盖 hidden 属性的 UA 样式，
                // 必须显式控制 display 才能真正隐藏
                sticky.style.display = "none";
                lastRowSignature = "";
            };

            // ── 标题缓存（性能）：文档坐标（docTop/docSectionBottom 相对文档顶部，与滚动无关） ──
            // 回归：1 万行文档输入/滚动卡顿——此前每次 updateSticky 全量
            // querySelectorAll + getBoundingClientRect（几百标题 × 每帧）；
            // 现改为文档变更后防抖重建缓存，滚动时仅纯数字比较
            interface CachedHeading {
                el: HTMLElement;
                /** 节点起始位置（共享索引口径，不再靠 posAtDOM 反查） */
                pos: number;
                level: number;
                /** 嵌套深度（1 = 顶层标题；h1 → h3 的跨级标题记为 2 层） */
                depth: number;
                text: string;
                /** 可折叠（索引的 foldRange 非空；不再嗅探 CSS class） */
                foldable: boolean;
                docTop: number;
                /** 本章节底边的文档坐标（下一个 level ≤ 本标题 的可见标题顶边；末尾取内容底边） */
                docSectionBottom: number;
            }
            let cachedHeadings: CachedHeading[] = [];
            let cacheDirty = true;
            let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
            let lastRowSignature = "";

            const rebuildCache = () => {
                rebuildTimer = null;
                const scrollOffset = window.scrollY;
                const contentBottom = view.dom.getBoundingClientRect().bottom + scrollOffset;
                const levelStack: number[] = [];
                cachedHeadings = [];
                for (const { el, entry } of getTopLevelHeadings(view)) {
                    // 嵌套深度按标题层级栈算：先弹出层级 ≥ 自己的标题，再入栈
                    while (levelStack.length > 0 && levelStack[levelStack.length - 1] >= entry.level) {
                        levelStack.pop();
                    }
                    levelStack.push(entry.level);
                    const depth = levelStack.length;
                    const rect = el.getBoundingClientRect();
                    // 未渲染 / 被折叠隐藏（display:none 时 rect 为 0）
                    if (!(rect.width > 0 && rect.height > 0)) continue;
                    if (el.classList.contains("heading-fold-hidden")) continue;
                    cachedHeadings.push({
                        el,
                        pos: entry.pos,
                        level: entry.level,
                        depth,
                        text: entry.text,
                        foldable: entry.foldRange !== null,
                        docTop: rect.top + scrollOffset,
                        docSectionBottom: contentBottom,
                    });
                }
                // 章节底边 = 下一个「level ≤ 自己」的可见标题顶边（栈式 O(n)；折叠隐藏的内容
                // 已从列表剔除，视觉上章节就断在那里）
                const pending: number[] = [];
                for (let i = 0; i < cachedHeadings.length; i++) {
                    while (pending.length > 0
                        && cachedHeadings[pending[pending.length - 1]].level >= cachedHeadings[i].level) {
                        cachedHeadings[pending.pop()!].docSectionBottom = cachedHeadings[i].docTop;
                    }
                    pending.push(i);
                }
                cacheDirty = false;
            };

            /** 文档变更/折叠状态变化：防抖重建（输入连续时不重复全量扫描） */
            const markCacheDirty = () => {
                cacheDirty = true;
                if (rebuildTimer !== null) clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(() => {
                    rebuildCache();
                    scheduleUpdate();
                }, CACHE_REBUILD_DEBOUNCE_MS);
            };

            /** 最多显示几行：不超过 3 行，且不超过视口高度的 25%（对照内置编辑器） */
            const maxStickyRows = (): number => Math.min(
                STICKY_MAX_ROWS,
                Math.max(1, Math.floor((window.innerHeight * 0.25) / STICKY_ROW_HEIGHT_PX)),
            );

            /** 重建吸顶行内容（源码形式：`##` 前缀 + 纯文本，一级一行，不再渲染标题字号） */
            const renderRows = (indices: number[]): void => {
                const folded = headingFoldPluginKey.getState(view.state);
                const frag = document.createDocumentFragment();
                for (const idx of indices) {
                    const cached = cachedHeadings[idx];
                    const row = document.createElement("div");
                    row.className = "heading-sticky-row";
                    row.dataset["headingPos"] = String(cached.pos);
                    if (cached.foldable) {
                        row.appendChild(makeFoldToggle(cached.pos, folded?.has(cached.pos) ?? false));
                    }
                    const marker = document.createElement("span");
                    marker.className = "heading-sticky-marker";
                    marker.textContent = "#".repeat(cached.level);
                    const label = document.createElement("span");
                    label.className = "heading-sticky-text";
                    label.textContent = cached.text;
                    row.append(marker, label);
                    frag.appendChild(row);
                }
                sticky.replaceChildren(frag);
            };

            const updateSticky = () => {
                rafId = null;
                if (suppressSticky) {
                    // 用户下一次交互（wheel/键盘/滚动条 mousedown）后自动解除
                    if (suppressEpoch !== null && getUserInteractionEpoch() !== suppressEpoch) {
                        suppressSticky = false;
                        suppressEpoch = null;
                    } else {
                        hideSticky();
                        return;
                    }
                }

                const topbarBottom = getTopbarBottom();
                if (cacheDirty) rebuildCache();
                if (cachedHeadings.length === 0) {
                    hideSticky();
                    return;
                }

                // 文档坐标 + 当前 scrollY 换算为视口坐标：纯数字计算，零 DOM 查询
                const scrollY = window.scrollY;
                const rows = computeStickyRows(
                    cachedHeadings.map((h) => ({
                        depth: h.depth,
                        top: h.docTop - scrollY,
                        sectionBottom: h.docSectionBottom - scrollY,
                    })),
                    topbarBottom,
                    STICKY_ROW_HEIGHT_PX,
                    maxStickyRows(),
                );
                if (rows.length === 0) {
                    hideSticky();
                    return;
                }

                const innermost = cachedHeadings[rows[rows.length - 1]];
                const rect = innermost.el.getBoundingClientRect();
                sticky.hidden = false;
                sticky.style.display = "";
                sticky.style.top = `${topbarBottom}px`;
                sticky.style.left = `${rect.left}px`;
                sticky.style.width = `${rect.width}px`;

                const folded = headingFoldPluginKey.getState(view.state);
                const signature = rows
                    .map((idx) => `${cachedHeadings[idx].pos}:${folded?.has(cachedHeadings[idx].pos) ? 1 : 0}`)
                    .join(",");
                if (signature !== lastRowSignature) {
                    lastRowSignature = signature;
                    renderRows(rows);
                }
            };

            const scheduleUpdate = () => {
                // 宿主折叠态（切到非 webview 标签）：此刻按假的 300×150 重建缓存会
                // 让吸顶条按错误位置摆放；折叠期不重算，解冻后的 resize/滚动会补上
                if (shouldSkipViewportWork()) return;
                if (rafId !== null) return;
                rafId = requestAnimationFrame(updateSticky);
            };

            // 用户主动滚动 → 立即解除抑制并刷新（epoch 判定在 updateSticky 内兜底，
            // 这里只负责触发一次重算）
            const clearSuppress = () => {
                if (suppressSticky) { scheduleUpdate(); }
            };

            // 文档内容/布局变化（RO）→ 防抖重建缓存（而非每帧全量测量）；滚动时用缓存纯计算
            const resizeObserver = new ResizeObserver(markCacheDirty);
            resizeObserver.observe(view.dom);

            // 宿主折叠态结束：折叠期 scheduleUpdate 被跳过、触发它的 resize 也已消耗掉，
            // 这里立刻重算一次（否则吸顶条会停在折叠前那一章节约 180ms）
            const unsubscribeRestored = onViewportRestored(() => {
                rebuildCache();
                scheduleUpdate();
            });

            window.addEventListener("scroll", scheduleUpdate, { passive: true });
            // resize 只刷新显示位置（docTop 与视口无关，无需重建缓存）
            window.addEventListener("resize", scheduleUpdate);
            window.addEventListener("wheel", clearSuppress, { passive: true });
            window.addEventListener("touchmove", clearSuppress, { passive: true });
            window.addEventListener("keydown", clearSuppress);
            scheduleUpdate();

            return {
                update(view, prevState) {
                    // 回归：任何事务（含纯光标移动/选区变化）都触发 markCacheDirty，
                    // 每次停顿 300ms 后全量 getBoundingClientRect 重建；仅文档内容或
                    // 折叠状态变化时才需要重建（折叠切换是 meta-only 事务，Set 引用变化）
                    const docChanged = !view.state.doc.eq(prevState.doc);
                    const foldChanged =
                        headingFoldPluginKey.getState(view.state) !==
                        headingFoldPluginKey.getState(prevState);
                    if (docChanged || foldChanged) {
                        markCacheDirty();
                    }
                },
                destroy() {
                    unsubscribeRestored();
                    if (rafId !== null) cancelAnimationFrame(rafId);
                    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
                    if (_hideStickyUntilNextInteraction === suppressUntilNextInteraction) {
                        _hideStickyUntilNextInteraction = null;
                    }
                    window.removeEventListener("scroll", scheduleUpdate);
                    window.removeEventListener("resize", scheduleUpdate);
                    window.removeEventListener("wheel", clearSuppress);
                    window.removeEventListener("touchmove", clearSuppress);
                    window.removeEventListener("keydown", clearSuppress);
                    resizeObserver.disconnect();
                    sticky.remove();
                },
            };
        },
    }),
);
