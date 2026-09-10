import { describe, expect, it } from "vitest";
import { Selection } from "@milkdown/kit/prose/state";
import { createEditor, destroyEditor, getEditorView, getMarkdownForSave } from "../editor";

if (typeof (window as unknown as Record<string, unknown>).IntersectionObserver === "undefined") {
    (window as unknown as Record<string, unknown>).IntersectionObserver = class {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
        takeRecords() { return []; }
    };
}
if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
    };
}
if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (() => ({
        matches: false, media: "", onchange: null,
        addListener() { /* noop */ }, removeListener() { /* noop */ },
        addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
        dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
}
(window as unknown as Record<string, unknown>).__i18n = { translations: {}, isMac: false, serializationMode: "clean" };

async function mount(markdown: string): Promise<HTMLElement> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    await createEditor(root, markdown, () => { /* noop */ });
    return root;
}

describe("快照往返（历史恢复前提）", () => {
    it("编辑后推送的 Markdown 重建出的文档 应该 与快照 doc JSON 逐位一致", async () => {
        const root = await mount("# 标题\n\n第一段 hello world\n\n- 甲\n- 乙\n");
        const view = getEditorView();
        expect(view).toBeTruthy();

        // 模拟用户编辑：在文档末尾插入文本
        view!.dispatch(view!.state.tr.setSelection(Selection.atEnd(view!.state.doc)).insertText(" 追加"));
        const pushed = getMarkdownForSave();
        const snapshotDoc = JSON.stringify(view!.state.doc.toJSON());

        destroyEditor();
        root.remove();

        const root2 = await mount(pushed);
        const view2 = getEditorView();
        expect(view2).toBeTruthy();
        expect(JSON.stringify(view2!.state.doc.toJSON())).toBe(snapshotDoc);

        destroyEditor();
        root2.remove();
    }, 60000);
});
