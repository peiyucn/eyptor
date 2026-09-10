import { describe, expect, it } from "vitest";
import { Selection } from "@milkdown/kit/prose/state";
import { undo } from "@milkdown/kit/prose/history";
import { createEditor, destroyEditor, getEditorView } from "../editor";
import { initUndoShortcutFallback } from "../utils/undoShortcutFallback";

if (typeof (window as unknown as Record<string, unknown>).IntersectionObserver === "undefined") {
    (window as unknown as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
}
if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (() => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } })) as typeof window.matchMedia;
}
(window as unknown as Record<string, unknown>).__i18n = { translations: {}, isMac: false, serializationMode: "clean" };

async function mount(markdown: string): Promise<HTMLElement> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    await createEditor(root, markdown, () => {});
    return root;
}

describe("撤销粒度与 IME 兜底", () => {
    it("连续输入 应该 每次输入一步撤销（回归：500ms 合并窗）", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).insertText("a"));
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).insertText("b"));
        expect(view.state.doc.textContent).toBe("helloab");
        expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
        expect(view.state.doc.textContent).toBe("helloa");
        expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        destroyEditor(); root.remove();
    }, 60000);

    it("IME 一段候选一步；组合标记卡住时 Ctrl+Z 仍能撤", async () => {
        const root = await mount("base");
        const view = getEditorView()!;
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).setMeta("composition", 1).insertText("中"));
        view.dispatch(view.state.tr.setMeta("composition", 1).insertText("文"));
        expect(view.state.doc.textContent).toBe("base中文");
        expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
        expect(view.state.doc.textContent).toBe("base");
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).setMeta("composition", 2).insertText("好"));
        (view as unknown as { input: { composing: boolean } }).input.composing = true;
        initUndoShortcutFallback({ getView: () => view, isActive: () => true });
        const ev = new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true });
        view.dom.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(view.state.doc.textContent).toBe("base");
        destroyEditor(); root.remove();
    }, 60000);
});
