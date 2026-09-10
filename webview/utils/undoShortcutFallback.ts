/**
 * IME 场景的撤销/重做兜底路由 + 组合状态残留修复。
 *
 * 根因（用户实测 + 排查）：中文能进文档并保存，但撤销不了（连顶栏按钮也不行）。
 * 部分 IME（VS Code WebView + Windows）提交后 compositionend 未送达/未处理，ProseMirror
 * 会一直认为处于组合输入：组合状态下它不重绘文档 DOM——撤销命令即使执行了画面也不更新；
 * 键盘事件则被组合守卫直接忽略。英文不经过组合，所以一切正常。
 *
 * 修复：检测到组合标记卡住时，先合成一次 compositionend，让 ProseMirror 走它自己的收尾
 * 流程（清标记 + flush + 重绘），再执行撤销/重做；键盘与编辑器外 UI 点击两个入口都覆盖。
 * 正常路径、代码块、输入框不干预。
 */
import { redo, undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";

/** 有自己的撤销栈/输入语义的区域：这些地方的原生 Ctrl+Z 不归编辑器管 */
const EXCLUDED_SELECTOR = "input, textarea, select, .cm-editor";

export interface UndoShortcutDeps {
    getView: () => EditorView | null;
    isActive: () => boolean;
}

/** 结束卡住的组合状态（合成 compositionend，走 ProseMirror 自己的收尾流程并重绘） */
export function endStaleComposition(view: EditorView): void {
    if (!view.composing) { return; }
    try {
        view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    } catch {
        const input = (view as unknown as { input?: { composing?: boolean } }).input;
        if (input) { input.composing = false; }
    }
}

export function initUndoShortcutFallback(deps: UndoShortcutDeps): void {
    // 编辑器外 UI（顶栏撤销/重做按钮等）：按下时先解组合。按钮 mousedown 会
    // preventDefault 不夺焦，编辑器不会 blur，卡住的组合态不会自己结束。
    window.addEventListener("pointerdown", (event) => {
        const view = deps.getView();
        if (!view || !view.composing || !deps.isActive()) { return; }
        const target = event.target;
        if (target instanceof Node && view.dom.contains(target)) { return; }
        endStaleComposition(view);
    }, true);

    window.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) { return; }
        if (event.isComposing) { return; }
        const key = event.key.toLowerCase();
        const isUndo = key === "z" && !event.shiftKey;
        const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
        if (!isUndo && !isRedo) { return; }
        const target = event.target;
        if (target instanceof Element && target.closest(EXCLUDED_SELECTOR)) { return; }
        const view = deps.getView();
        if (!view || !deps.isActive()) { return; }
        const insideEditor = target instanceof Node && view.dom.contains(target);
        // 正常路径（编辑器内、组合标记正常）交给 ProseMirror：它会先 forceFlush，
        // 绕过它可能撤到旧状态。
        if (insideEditor && !view.composing) { return; }
        if (view.composing) { endStaleComposition(view); }
        const handled = isUndo
            ? undo(view.state, view.dispatch, view)
            : redo(view.state, view.dispatch, view);
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}
