import { describe, expect, it } from "vitest";
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

describe("列表 spread 规范化", () => {
    it("列表项从多块变回单块 应该 同步收回 spread", async () => {
        const root = await mount("- a\n- b");
        const view = getEditorView()!;
        const list = view.state.doc.firstChild!;
        expect(list.type.name).toBe("bullet_list");
        const itemEnd = 2 + list.firstChild!.content.size;

        // 往第一个列表项里再插一个段落 → 该项含两块，列表与该项的 spread 都应为 true
        view.dispatch(view.state.tr.insert(itemEnd, view.state.schema.nodes.paragraph!.create()));
        expect(view.state.doc.firstChild!.firstChild!.attrs.spread).toBe(true);
        expect(view.state.doc.firstChild!.attrs.spread).toBe(true);

        // 删掉该段落 → 回到单块，spread 应收回 false
        view.dispatch(view.state.tr.delete(itemEnd, itemEnd + 2));
        expect(view.state.doc.firstChild!.firstChild!.attrs.spread).toBe(false);
        expect(view.state.doc.firstChild!.attrs.spread).toBe(false);

        destroyEditor(); root.remove();
    }, 60000);

    it("多步变更（中间步骤让文档先变长） 应该 不抛错", async () => {
        const root = await mount("- a\n- b");
        const view = getEditorView()!;
        const tr = view.state.tr.insertText("nihao", 3);
        view.dispatch(tr);
        // 第二步把拼音替换成候选词：中间文档比最终文档长，区间换算必须落在最终坐标
        view.dispatch(view.state.tr.replaceWith(3, 8, view.state.schema.text("你好")));
        expect(view.state.doc.textContent).toBe("你好ab");
        destroyEditor(); root.remove();
    }, 60000);
});
