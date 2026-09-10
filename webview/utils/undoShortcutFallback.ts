/**
 * IME 场景的撤销/重做兜底路由。
 *
 * 背景（用户实测）：英文输入 Ctrl+Z 正常，中文输入后 Ctrl+Z 无效。ProseMirror 在
 * `view.composing` 为 true 时会直接忽略所有 keydown（不在组合输入期间处理键盘）；若 IME
 * 提交后组合标记没有及时清掉，后续 Ctrl+Z 就会被一直吞掉——文档里中文已进历史（命令
 * 直调可撤），只是键盘事件到不了。
 *
 * 最小干预：
 * - 只在事件明确不属于输入法组合（event.isComposing === false）时考虑接管；
 * - 编辑器内且组合标记正常（composing=false）时不插手——交给 ProseMirror 自己的 keymap
 *   （它会先 forceFlush 未落盘的 DOM 变更，处理时机最正确）；
 * - 组合标记卡住（composing=true 但按键非组合），或焦点在编辑器 DOM 之外（切回后活跃
 *   元素在 body/顶栏）时，把 Mod-z / Mod-y / Shift-Mod-z 直接路由到历史命令；
 * - 查找框、frontmatter 输入框、代码块（有自己的撤销栈）一律不接管。
 */
import { redo, undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";

/** 有自己的撤销栈/输入语义的区域：这些地方的原生 Ctrl+Z 不归编辑器管 */
const EXCLUDED_SELECTOR = "input, textarea, select, .cm-editor";

export interface UndoShortcutDeps {
    getView: () => EditorView | null;
    isActive: () => boolean;
}

export function initUndoShortcutFallback(deps: UndoShortcutDeps): void {
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
        // 正常路径（编辑器内、组合标记未卡住）交给 ProseMirror：它会先 forceFlush
        // 尚未并入 state 的 DOM 变更，绕过它可能撤到旧状态。
        if (insideEditor && !view.composing) { return; }
        const handled = isUndo
            ? undo(view.state, view.dispatch, view)
            : redo(view.state, view.dispatch, view);
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}
