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
    let result: number | null = null;
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && view.nodeDOM(pos) === heading) {
            result = pos;
            return false;
        }
        return true;
    });
    return result;
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

            const STICKY_SCROLL_OFFSET_PX = 8;

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

            const updateSticky = () => {
                rafId = null;

                const top = getTopbarBottom();
                const headings = getVisibleHeadings(view);
                if (headings.length === 0) {
                    hideSticky();
                    return;
                }

                let activeIndex = -1;
                let broke = false;
                for (let i = 0; i < headings.length; i++) {
                    const rect = headings[i].getBoundingClientRect();
                    if (rect.bottom > top) {
                        // 第一个尚未完全滚出顶栏的标题：吸顶它的前一个（已滚出的）
                        broke = true;
                        activeIndex =
                            i > 0 && headings[i - 1].getBoundingClientRect().bottom <= top
                                ? i - 1
                                : -1;
                        break;
                    }
                }
                if (!broke && headings.length > 0) {
                    // 循环无 break = 所有标题均已滚出：吸顶最后一个（文档底部）
                    activeIndex = headings.length - 1;
                }

                if (activeIndex < 0) {
                    hideSticky();
                    return;
                }

                const heading = headings[activeIndex];
                const text = getHeadingText(heading);
                if (!text) {
                    hideSticky();
                    return;
                }

                const headingPos = findHeadingPos(view, heading);
                if (headingPos === null) {
                    hideSticky();
                    return;
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

            const resizeObserver = new ResizeObserver(scheduleUpdate);
            resizeObserver.observe(view.dom);

            window.addEventListener("scroll", scheduleUpdate, { passive: true });
            window.addEventListener("resize", scheduleUpdate);
            scheduleUpdate();

            return {
                update: scheduleUpdate,
                destroy() {
                    if (rafId !== null) cancelAnimationFrame(rafId);
                    window.removeEventListener("scroll", scheduleUpdate);
                    window.removeEventListener("resize", scheduleUpdate);
                    resizeObserver.disconnect();
                    sticky.remove();
                },
            };
        },
    }),
);
