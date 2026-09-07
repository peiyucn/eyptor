/**
 * Vendor 化的虚拟光标（基于 prosemirror-virtual-cursor 0.4.2，Apache-2.0/MIT 上游）。
 *
 * epytor 修改（用户决策「彻底解决，即使上游不支持」）：
 * 1. handleKeyDown：行内代码行尾（后面无内容，marksAfter 缺失）按 ArrowRight 时
 *    切换 storedMarks 为空——与「有后续内容」场景行为一致：先显示块外指示，
 *    输入即普通文本，不直接移动光标（上游此场景不处理，光标 sticky 无法退出）。
 * 2. updateCursor：行尾单侧（marksAfter 缺失）也渲染左右指示（上游要求两侧
 *    marks 都存在才渲染，行尾永远无指示）。
 *
 * 维护：上游更新时对照 diff 合并；改动集中在上文两处带 [epytor] 注释的分支。
 */
import { Mark } from "@milkdown/kit/prose/model";
import type { ResolvedPos } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export interface VirtualCursorOptions {
    skipWarning?: string[] | true;
}

const pluginKey = new PluginKey("prosemirror-virtual-cursor");

export function createVirtualCursor(options: VirtualCursorOptions = {}): Plugin {
    const skipWarning = options.skipWarning ?? false;
    let _cursor: HTMLElement | null = null;

    return new Plugin({
        key: pluginKey,
        view: (view) => {
            if (skipWarning !== true) {
                checkInclusive(view.state.schema, skipWarning || []);
            }
            const doc = view.dom.ownerDocument;
            _cursor = _cursor || document.createElement("div");
            const cursor = _cursor;
            const update = () => {
                updateCursor(view, cursor);
            };
            let observer: ResizeObserver | undefined;
            if (window.ResizeObserver) {
                observer = new window.ResizeObserver(() => update());
                observer.observe(view.dom);
            }
            doc.addEventListener("selectionchange", update);
            return {
                update: () => {
                    update();
                },
                destroy: () => {
                    doc.removeEventListener("selectionchange", update);
                    if (observer) {
                        observer.unobserve(view.dom);
                    }
                },
            };
        },
        props: {
            handleKeyDown: (view, event) => {
                const { selection } = view.state;
                if (
                    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                    event.isComposing ||
                    !["ArrowLeft", "ArrowRight"].includes(event.key) ||
                    !isTextSelection(selection) ||
                    !selection.empty
                ) {
                    return false;
                }
                const $pos = selection.$head;
                const [marksBefore, marksAfter] = getMarksAround($pos);
                const marks = view.state.storedMarks || $pos.marks();

                // [epytor] 行尾（无后续内容）ArrowRight：切换 storedMarks 为空——
                // 与有后续内容场景一致（先显示块外指示，输入即普通文本，不移动光标）。
                // 注意 marksBefore 非空才处理（普通文本尾部 marksBefore 为空数组，
                // 误拦截会破坏正常的方向键移动）
                if (
                    event.key === "ArrowRight" &&
                    marksBefore && marksBefore.length > 0 && !marksAfter &&
                    Mark.sameSet(marksBefore, marks)
                ) {
                    view.dispatch(view.state.tr.setStoredMarks(Mark.none));
                    return true;
                }

                if (marksBefore && marksAfter && !Mark.sameSet(marksBefore, marksAfter)) {
                    if (event.key === "ArrowLeft" && !Mark.sameSet(marksBefore, marks)) {
                        view.dispatch(view.state.tr.setStoredMarks(marksBefore));
                        return true;
                    }
                    if (event.key === "ArrowRight" && !Mark.sameSet(marksAfter, marks)) {
                        view.dispatch(view.state.tr.setStoredMarks(marksAfter));
                        return true;
                    }
                }
                if (event.key === "ArrowLeft" && $pos.textOffset === 1) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(TextSelection.create(view.state.doc, $pos.pos - 1))
                            .setStoredMarks($pos.marks()),
                    );
                    return true;
                }
                const next = $pos.parent.maybeChild($pos.index());
                if (event.key === "ArrowRight" && next && $pos.textOffset + 1 === next.nodeSize) {
                    view.dispatch(
                        view.state.tr
                            .setSelection(TextSelection.create(view.state.doc, $pos.pos + 1))
                            .setStoredMarks($pos.marks()),
                    );
                    return true;
                }
                return false;
            },
            decorations: (state) => {
                if (!_cursor || !isTextSelection(state.selection) || !state.selection.empty) {
                    return undefined;
                }
                return DecorationSet.create(state.doc, [
                    Decoration.widget(0, _cursor, {
                        key: "prosemirror-virtual-cursor",
                    }),
                ]);
            },
            attributes: {
                class: "virtual-cursor-enabled",
            },
        },
    });
}

function getCursorRect(view: EditorView, toStart: boolean): { left: number; right: number; top: number; bottom: number } | null {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!range) return null;
    range.collapse(toStart);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : null;
    if (rect?.height) return rect;
    return view.coordsAtPos(view.state.selection.head);
}

function getMarksAround($pos: ResolvedPos): [readonly Mark[] | undefined, readonly Mark[] | undefined] {
    const index = $pos.index();
    const after = $pos.parent.maybeChild(index);
    let before = $pos.textOffset ? after : null;
    if (!before && index > 0) before = $pos.parent.maybeChild(index - 1);
    return [before?.marks, after?.marks];
}

function isTextSelection(selection: Selection): boolean {
    return selection instanceof TextSelection;
}

function updateCursor(view: EditorView, cursor: HTMLElement): void {
    if (!view || !view.dom || view.isDestroyed || !cursor) return;
    const { state, dom } = view;
    const { selection } = state;
    if (!isTextSelection(selection)) return;
    const cursorRect = getCursorRect(view, selection.$head === selection.$from);
    if (!cursorRect) return;
    const editorRect = dom.getBoundingClientRect();
    let className = "prosemirror-virtual-cursor";
    const $pos = state.selection.$head;
    const [marksBefore, marksAfter] = getMarksAround($pos);
    const marks = state.storedMarks || $pos.marks();

    const sel = selection as TextSelection;
    if (sel.$cursor && marks) {
        if (marksBefore && marksAfter && !Mark.sameSet(marksBefore, marksAfter)) {
            if (Mark.sameSet(marksBefore, marks)) {
                className += " prosemirror-virtual-cursor-left";
            } else if (Mark.sameSet(marksAfter, marks)) {
                className += " prosemirror-virtual-cursor-right";
            }
        } else if (marksBefore && marksBefore.length > 0 && !marksAfter) {
            // [epytor] 行尾单侧也渲染指示：storedMarks 为空（已退出）时显示块外（右）。
            // 注意 marksBefore 非空（普通文本尾部空数组不渲染，回归：非代码尾部误显左下标）
            if (Mark.sameSet(marksBefore, marks)) {
                className += " prosemirror-virtual-cursor-left";
            } else {
                className += " prosemirror-virtual-cursor-right";
            }
        }
    }

    cursor.className = className;
    restartAnimation(cursor, "prosemirror-virtual-cursor-animation");
    cursor.style.height = `${cursorRect.bottom - cursorRect.top}px`;
    cursor.style.left = `${cursorRect.left - editorRect.left}px`;
    cursor.style.top = `${cursorRect.top - editorRect.top}px`;
}

function restartAnimation(element: HTMLElement, className: string): void {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
}

function checkInclusive(schema: { marks: Record<string, { spec: { inclusive?: boolean } }> }, skipWarning: string[]): void {
    for (const [mark, type] of Object.entries(schema.marks)) {
        if (type.spec.inclusive === false && !skipWarning.includes(mark)) {
            console.warn(
                `[prosemirror-virtual-cursor] Virtual cursor does not work well with marks that have inclusive set to false. Please consider removing the inclusive option from the "${mark}" mark or adding it to the "skipWarning" option.`,
            );
        }
    }
}
