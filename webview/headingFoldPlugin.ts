/**
 * 标题折叠插件：ProseMirror Decoration 实现，折叠状态存 PluginKey state，不修改文档。
 * 参考 git-xing/md-wysiwyg-editor v0.3.x 方案，简化：
 * - 去掉层级下拉与 #H 标记（epytor 顶栏已有官方标题下拉）
 * - gutter 只含折叠箭头，hover 标题时显示
 */
import "./heading.css";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { IconChevronDown, IconChevronRight } from "./ui/icons";
import { applyTooltip, hideTooltip } from "./ui/tooltip";
import { t } from "./i18n";
import { findHeadingFoldRange, getHeadingLevel, isHeadingNode, computeAllHeadingFoldRanges, computeHeadingSignature } from "./utils/headingFold";

export type HeadingFoldMeta = { type: "toggle"; pos: number };
type HeadingFoldRange = { from: number; to: number };

export const headingFoldPluginKey = new PluginKey<Set<number>>("epytor-heading-fold");

function createFoldGutter(
    view: import("@milkdown/kit/prose/view").EditorView,
    headingPos: number,
    collapsed: boolean,
): HTMLElement {
    const gutter = document.createElement("span");
    gutter.className = "heading-fold-gutter";
    gutter.contentEditable = "false";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "heading-fold-toggle";
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

        const node = view.state.doc.nodeAt(headingPos);
        if (!isHeadingNode(node)) return;

        const tr = view.state.tr
            .setMeta(headingFoldPluginKey, { type: "toggle", pos: headingPos } satisfies HeadingFoldMeta)
            .setMeta("addToHistory", false);

        if (!collapsed) {
            const range = findHeadingFoldRange(view.state.doc, headingPos, getHeadingLevel(node));
            if (
                range &&
                view.state.selection.from < range.to &&
                view.state.selection.to > range.from
            ) {
                // 光标在即将折叠的区域内：先移出
                tr.setSelection(
                    TextSelection.near(tr.doc.resolve(Math.min(headingPos + 1, tr.doc.content.size))),
                );
            }
        }

        view.dispatch(tr);
        view.focus();
        hideTooltip();
    });

    gutter.appendChild(button);
    return gutter;
}

export function buildFoldDecorations(doc: ProseNode, folded: ReadonlySet<number>): DecorationSet {
    const decorations: Decoration[] = [];
    const hiddenRanges: HeadingFoldRange[] = [];
    // 单遍 O(n) 计算所有标题折叠范围（回归：曾每标题全量扫描，1 万行 315ms/次）
    const foldRanges = computeAllHeadingFoldRanges(doc);

    doc.forEach((node, offset) => {
        if (!isHeadingNode(node)) return;

        const level = getHeadingLevel(node);
        const collapsed = folded.has(offset);
        const range = foldRanges.get(offset) ?? null;
        const foldable = Boolean(range);

        decorations.push(
            Decoration.node(offset, offset + node.nodeSize, {
                class: `heading-fold-heading${foldable ? " heading-fold-heading--foldable" : ""}${collapsed ? " heading-fold-heading--collapsed" : ""}`,
            }),
        );
        if (foldable) {
            decorations.push(
                Decoration.widget(
                    offset + 1,
                    (view) => createFoldGutter(view, offset, collapsed),
                    {
                        // key 含折叠状态：状态翻转时强制重建 widget（chevron 图标切换）
                        key: `epytor-heading-fold-gutter-${offset}-${collapsed ? "closed" : "open"}`,
                    },
                ),
            );
        }

        if (collapsed && range) {
            hiddenRanges.push(range);
        }
    });

    if (hiddenRanges.length > 0) {
        // 排序 + 合并重叠区间（外层折叠包含内层折叠），块遍历用双指针单遍判定——
        // 回归：每块 hiddenRanges.some 线性扫描，O(顶层块数 × 折叠数)
        const sorted = [...hiddenRanges].sort((a, b) => a.from - b.from);
        const merged: HeadingFoldRange[] = [];
        for (const range of sorted) {
            const last = merged[merged.length - 1];
            if (last && range.from <= last.to) {
                last.to = Math.max(last.to, range.to);
            } else {
                merged.push({ from: range.from, to: range.to });
            }
        }
        let rangeIdx = 0;
        doc.forEach((node, offset) => {
            while (rangeIdx < merged.length && offset >= merged[rangeIdx].to) {
                rangeIdx++;
            }
            const range = merged[rangeIdx];
            if (range && offset >= range.from && offset < range.to) {
                decorations.push(
                    Decoration.node(offset, offset + node.nodeSize, {
                        class: "heading-fold-hidden",
                    }),
                );
            }
        });
    }

    return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

export const headingFoldPlugin = $prose(() => {
    // 装饰缓存（每编辑器实例独立）：标题结构 + 折叠状态签名不变时复用
    let cachedSignature = "";
    let cachedDecorations: DecorationSet | null = null;

    return new Plugin<Set<number>>({
        key: headingFoldPluginKey,
        state: {
            init: () => new Set<number>(),
            apply(tr, value, _oldState, newState) {
                let next = value;

                if (tr.docChanged) {
                    next = new Set<number>();
                    for (const pos of value) {
                        const mapped = tr.mapping.map(pos, -1);
                        if (isHeadingNode(newState.doc.nodeAt(mapped))) {
                            next.add(mapped);
                        }
                    }
                }

                const meta = tr.getMeta(headingFoldPluginKey) as HeadingFoldMeta | undefined;
                if (meta?.type === "toggle") {
                    next = new Set<number>(next);
                    if (next.has(meta.pos)) {
                        next.delete(meta.pos);
                    } else if (isHeadingNode(newState.doc.nodeAt(meta.pos))) {
                        next.add(meta.pos);
                    }
                }

                return next;
            },
        },
        props: {
            decorations(state) {
                const folded = headingFoldPluginKey.getState(state) ?? new Set<number>();
                // 缓存：标题结构 + 折叠状态不变时直接复用（输入正文零重建——
                // 回归：万行文档每键全量重建装饰是上屏卡顿根源，防抖延时只是推迟开销）
                const signature = computeHeadingSignature(state.doc, folded);
                if (cachedDecorations !== null && signature === cachedSignature) {
                    return cachedDecorations;
                }
                cachedSignature = signature;
                cachedDecorations = buildFoldDecorations(state.doc, folded);
                return cachedDecorations;
            },
            handleKeyDown(view, event) {
                // 折叠标题末尾按 Enter：自动展开后放行
                if (event.key !== "Enter") return false;
                const folded = headingFoldPluginKey.getState(view.state);
                if (!folded || folded.size === 0) return false;

                const { $from } = view.state.selection;
                let headingPos: number | null = null;
                let headingTextLen = 0;
                for (let depth = $from.depth; depth >= 0; depth--) {
                    const node = $from.node(depth);
                    if (node.type.name === "heading") {
                        headingPos = $from.before(depth);
                        headingTextLen = node.textContent.length;
                        break;
                    }
                }
                if (headingPos === null || !folded.has(headingPos)) return false;
                if ($from.pos < headingPos + 1 + headingTextLen) return false;

                // 展开并把光标移入展开内容的第一个块（不产生新段落）
                const headingNode = view.state.doc.nodeAt(headingPos);
                const range = headingNode
                    ? findHeadingFoldRange(view.state.doc, headingPos, getHeadingLevel(headingNode))
                    : null;
                const tr = view.state.tr
                    .setMeta(headingFoldPluginKey, { type: "toggle", pos: headingPos } satisfies HeadingFoldMeta)
                    .setMeta("addToHistory", false);
                if (range) {
                    tr.setSelection(
                        TextSelection.near(tr.doc.resolve(Math.min(range.from + 1, tr.doc.content.size))),
                    );
                }
                view.dispatch(tr);
                view.focus();
                return true;
            },
        },
        view(view) {
            let hoveredGutter: HTMLElement | null = null;

            const setHoveredGutter = (gutter: HTMLElement | null) => {
                if (gutter === hoveredGutter) return;
                hoveredGutter?.classList.remove("heading-fold-gutter--visible");
                hoveredGutter = gutter;
                hoveredGutter?.classList.add("heading-fold-gutter--visible");
            };

            const handleMouseMove = (event: MouseEvent) => {
                const target = event.target as Element | null;
                const heading = target?.closest("h1,h2,h3,h4,h5,h6") ?? null;
                if (heading && view.dom.contains(heading)) {
                    setHoveredGutter(heading.querySelector<HTMLElement>(".heading-fold-gutter"));
                } else {
                    setHoveredGutter(null);
                }
            };

            const handleMouseLeave = () => setHoveredGutter(null);
            view.dom.addEventListener("mousemove", handleMouseMove);
            view.dom.addEventListener("mouseleave", handleMouseLeave);

            return {
                update() {
                    if (hoveredGutter && !view.dom.contains(hoveredGutter)) {
                        setHoveredGutter(null);
                    }
                },
                destroy() {
                    view.dom.removeEventListener("mousemove", handleMouseMove);
                    view.dom.removeEventListener("mouseleave", handleMouseLeave);
                    setHoveredGutter(null);
                },
            };
        },
    });
});
