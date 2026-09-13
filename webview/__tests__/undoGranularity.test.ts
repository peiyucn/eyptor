import { describe, expect, it } from "vitest";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { undo, redo } from "@milkdown/kit/prose/history";
import { createEditor, destroyEditor, getEditorView } from "../editor";

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

/** 模拟输入法一次组合：先插入拼音占位，再替换成候选词（两步，同一组合 ID） */
function compose(view: EditorView, pinyin: string, hanzi: string, compositionId: number): void {
    const at = Selection.atEnd(view.state.doc).from;
    view.dispatch(
        view.state.tr
            .setSelection(Selection.atEnd(view.state.doc))
            .setMeta("composition", compositionId)
            .insertText(pinyin),
    );
    view.dispatch(
        view.state.tr
            .replaceWith(at, at + pinyin.length, view.state.schema.text(hanzi))
            .setMeta("composition", compositionId),
    );
}

const doUndo = (view: EditorView) => undo(view.state, (tr) => view.dispatch(tr));

describe("撤销粒度", () => {
    it("连续输入 应该 每次输入一步撤销（回归：500ms 合并窗）", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).insertText("a"));
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).insertText("b"));
        expect(view.state.doc.textContent).toBe("helloab");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("helloa");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        destroyEditor(); root.remove();
    }, 60000);

    it("英文后接一段中文候选 应该 分两步撤销（回归：组合首步并入上一步）", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).insertText("x"));
        compose(view, "ni", "你", 1);
        expect(view.state.doc.textContent).toBe("hellox你");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hellox");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        destroyEditor(); root.remove();
    }, 60000);

    it("两段中文候选 应该 一段一步撤销", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        compose(view, "ni", "你", 1);
        compose(view, "hao", "好", 2);
        expect(view.state.doc.textContent).toBe("hello你好");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello你");
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        destroyEditor(); root.remove();
    }, 60000);

    it("中文候选提交后撤销 应该 一次撤掉整段（回归：列表 spread 规范化抛错打断撤销）", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        compose(view, "nihao", "你好", 1);
        expect(view.state.doc.textContent).toBe("hello你好");
        // 修复前：组合的多步撤销里，第一步的映射位置越过最终文档末尾，
        // listSpreadNormalizePlugin 的 appendTransaction 抛 TypeError，
        // 整条撤销事务被丢弃 —— 表现为 Ctrl+Z 与顶栏撤销按钮双双「没反应」。
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        destroyEditor(); root.remove();
    }, 60000);

    it("中文候选撤销后 应该 可以重做", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        compose(view, "nihao", "你好", 1);
        expect(doUndo(view)).toBe(true);
        expect(view.state.doc.textContent).toBe("hello");
        expect(redo(view.state, (tr) => view.dispatch(tr))).toBe(true);
        expect(view.state.doc.textContent).toBe("hello你好");
        destroyEditor(); root.remove();
    }, 60000);
});
