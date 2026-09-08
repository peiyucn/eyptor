/**
 * 标题吸顶插件：滚动时在顶栏下方显示当前章节标题，点击跳回；与 headingFold 联动折叠开关。
 * 参考 git-xing/md-wysiwyg-editor v0.3.2 最终方案（含推挤过渡与布局修复教训）。
 */
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT } from "../shared/constants";
import { IconChevronDown, IconChevronRight } from "./ui/icons";
import { applyTooltip, hideTooltip } from "./ui/tooltip";
import { t } from "./i18n";
import { headingFoldPluginKey, type HeadingFoldMeta } from "./headingFoldPlugin";
import { findHeadingFoldRange, getHeadingLevel } from "./utils/headingFold";
import { computeStickyActiveIndex } from "./utils/headingSticky";

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

function getTopbarBottom(): number {
    const topBar = document.querySelector(".milkdown-top-bar");
    return topBar?.getBoundingClientRect().bottom ?? DEFAULT_TOPBAR_HEIGHT;
}

function getVisibleHeadings(view: EditorView): HTMLElement[] {
    return Array.from(view.dom.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter((heading) => {
        const rect = heading.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !heading.classList.contains("heading-fold-hidden");
    });
}

function getHeadingText(heading: HTMLElement): string {
    const clone = heading.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".heading-fold-gutter").forEach((node) => node.remove());
    return clone.textContent?.trim() ?? "";
}

function findHeadingPos(view: EditorView, heading: HTMLElement): number | null {
    // DOM 反查（O(depth)）：回归——此前用 doc.descendants 全树遍历且命中后无提前退出，
    // 缓存失效后每个标题一次全文档扫描（含文本节点），滚动路径退化 O(H×N)
    try {
        return view.posAtDOM(heading, 0);
    } catch {
        return null;
    }
}

export const headingStickyPlugin = $prose(() =>
    new Plugin({
        view(view) {
            const sticky = document.createElement("div");
            sticky.className = "heading-sticky-title";
            sticky.hidden = true;
            sticky.style.display = "none";
            document.body.appendChild(sticky);

            let rafId: number | null = null;
            let activeHeading: HTMLElement | null = null;
            let activeHeadingPos: number | null = null;
            // 点击吸顶条跳转后抑制吸顶显示（跳转 scroll 事件会立即重新计算，
            // 目标标题完整可见时仍会吸顶前一个标题并遮挡目标）；
            // 用户主动滚动（wheel/touchmove/键盘）后恢复
            let suppressSticky = false;
            /** 跳转抑制的定时兜底解除（回归：滚动条拖拽/中键滚动只发 scroll 事件，
             * 不触发 wheel/touchmove/keydown，此前抑制永不解除、吸顶条一直隐藏） */
            let suppressTimer: ReturnType<typeof setTimeout> | null = null;

            const STICKY_SCROLL_OFFSET_PX = 8;
            const SUPPRESS_AUTO_RELEASE_MS = 400;

            const scrollHeadingIntoStickyPosition = (headingPos: number) => {
                requestAnimationFrame(() => {
                    const heading = view.nodeDOM(headingPos);
                    if (!(heading instanceof HTMLElement)) return;
                    const top = heading.getBoundingClientRect().top + window.scrollY - getTopbarBottom() - STICKY_SCROLL_OFFSET_PX;
                    window.scrollTo({ top });
                });
            };

            // 点击吸顶条跳回标题：只绑定一次（标题变化仅更新内容，避免监听器累积）
            sticky.addEventListener("click", (event) => {
                if ((event.target as HTMLElement).closest(".heading-sticky-toggle")) return;
                const pos = Number(sticky.dataset["headingPos"]);
                if (Number.isFinite(pos) && pos > 0) {
                    // 跳转后抑制吸顶显示，避免前一个标题的吸顶条遮挡刚跳到的标题；
                    // 用户主动滚动（wheel/touchmove/键盘）或定时兜底（滚动条交互只发
                    // scroll 事件）解除
                    hideSticky();
                    suppressSticky = true;
                    if (suppressTimer !== null) clearTimeout(suppressTimer);
                    suppressTimer = setTimeout(() => {
                        suppressTimer = null;
                        suppressSticky = false;
                    }, SUPPRESS_AUTO_RELEASE_MS);
                    scrollHeadingIntoStickyPosition(pos);
                }
            });

            const setStickyContent = (
                heading: HTMLElement,
                headingPos: number,
                collapsed: boolean,
                foldable: boolean,
            ): void => {
                const level = getHeadingLevel(view.state.doc.nodeAt(headingPos) ?? { attrs: {} });
                const text = getHeadingText(heading);
                sticky.innerHTML = "";

                if (foldable) {
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
                    sticky.appendChild(button);
                }

                const marker = document.createElement("span");
                marker.className = "heading-sticky-marker";
                marker.textContent = `H${level}`;

                const label = document.createElement("span");
                label.className = "heading-sticky-text";
                label.textContent = text;

                sticky.append(marker, label);
            };

            const syncTypography = (heading: HTMLElement) => {
                const style = window.getComputedStyle(heading);
                sticky.style.fontSize = style.fontSize;
                sticky.style.lineHeight = style.lineHeight;
                sticky.style.fontWeight = style.fontWeight;
            };

            const hideSticky = () => {
                activeHeading = null;
                activeHeadingPos = null;
                sticky.hidden = true;
                // 双保险：heading.css 的 display:flex 会覆盖 hidden 属性的 UA 样式，
                // 必须显式控制 display 才能真正隐藏
                sticky.style.display = "none";
                delete sticky.dataset["headingPos"];
            };

            // ── 标题缓存（性能）：文档坐标（docTop/docBottom 相对文档顶部，与滚动无关） ──
            // 回归：1 万行文档输入/滚动卡顿——此前每次 updateSticky 全量
            // querySelectorAll + getBoundingClientRect（几百标题 × 每帧）；
            // 现改为文档变更后防抖重建缓存，滚动时仅纯数字比较
            interface CachedHeading {
                el: HTMLElement;
                pos: number | null;
                docTop: number;
                docBottom: number;
            }
            let cachedHeadings: CachedHeading[] = [];
            let cacheDirty = true;
            let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

            const rebuildCache = () => {
                rebuildTimer = null;
                const scrollOffset = window.scrollY;
                cachedHeadings = getVisibleHeadings(view).map((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        el,
                        pos: null,
                        docTop: rect.top + scrollOffset,
                        docBottom: rect.bottom + scrollOffset,
                    };
                });
                cacheDirty = false;
            };

            /** 文档变更/折叠状态变化：防抖重建（输入连续时不重复全量扫描） */
            const markCacheDirty = () => {
                cacheDirty = true;
                if (rebuildTimer !== null) clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(() => {
                    rebuildCache();
                    scheduleUpdate();
                }, 300);
            };

            const updateSticky = () => {
                rafId = null;
                if (suppressSticky) {
                    hideSticky();
                    return;
                }

                const top = getTopbarBottom();
                if (cacheDirty) rebuildCache();
                if (cachedHeadings.length === 0) {
                    hideSticky();
                    return;
                }

                // 文档坐标 + 当前 scrollY 换算为视口坐标：纯数字计算，零 DOM 查询
                const scrollY = window.scrollY;
                let activeIndex = computeStickyActiveIndex(
                    cachedHeadings.map((h) => ({ top: h.docTop - scrollY, bottom: h.docBottom - scrollY })),
                    top,
                );

                if (activeIndex < 0) {
                    hideSticky();
                    return;
                }

                const cached = cachedHeadings[activeIndex];
                const heading = cached.el;
                const text = getHeadingText(heading);
                if (!text) {
                    hideSticky();
                    return;
                }

                let headingPos = cached.pos;
                if (headingPos === null) {
                    headingPos = findHeadingPos(view, heading);
                    if (headingPos === null) {
                        hideSticky();
                        return;
                    }
                    cached.pos = headingPos;
                }

                activeHeadingPos = headingPos;
                const foldable = heading.classList.contains("heading-fold-heading--foldable");
                const collapsed = headingFoldPluginKey.getState(view.state)?.has(headingPos) ?? false;
                const rect = heading.getBoundingClientRect();
                sticky.hidden = false;
                sticky.style.display = "";
                sticky.dataset["headingPos"] = String(headingPos);
                sticky.style.top = `${top}px`;
                sticky.style.left = `${rect.left}px`;
                sticky.style.width = `${rect.width}px`;

                if (
                    heading !== activeHeading ||
                    sticky.dataset["headingText"] !== text ||
                    sticky.dataset["collapsed"] !== String(collapsed)
                ) {
                    activeHeading = heading;
                    sticky.dataset["headingText"] = text;
                    sticky.dataset["collapsed"] = String(collapsed);
                    syncTypography(heading);
                    setStickyContent(heading, headingPos, collapsed, foldable);
                }

                // 无推挤过渡：下一标题顶到时直接切换（推挤曾导致吸顶条被顶栏遮挡）
                sticky.style.transform = "";
            };

            const scheduleUpdate = () => {
                if (rafId !== null) return;
                rafId = requestAnimationFrame(updateSticky);
            };

            // 用户主动滚动 → 解除跳转抑制并刷新（scrollTo 跳转不会触发 wheel/touchmove/keydown）
            const clearSuppress = () => {
                if (suppressTimer !== null) {
                    clearTimeout(suppressTimer);
                    suppressTimer = null;
                }
                if (suppressSticky) {
                    suppressSticky = false;
                    scheduleUpdate();
                }
            };

            // 文档内容/布局变化（RO）→ 防抖重建缓存（而非每帧全量测量）；滚动时用缓存纯计算
            const resizeObserver = new ResizeObserver(markCacheDirty);
            resizeObserver.observe(view.dom);

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
                    if (rafId !== null) cancelAnimationFrame(rafId);
                    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
                    if (suppressTimer !== null) clearTimeout(suppressTimer);
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
