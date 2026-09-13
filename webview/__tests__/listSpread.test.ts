import { describe, expect, it } from "vitest";
import { createEditor, destroyEditor, getEditorView } from "../editor";
import { changeRangeInFinalDoc, normalizeListSpread } from "../utils/listSpread";

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

describe("changeRangeInFinalDoc（纯逻辑）", () => {
    it("无变更事务 应该 返回 null", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        const tr = view.state.tr.setSelection(view.state.selection);
        expect(changeRangeInFinalDoc([tr], view.state.doc.content.size)).toBeNull();
        destroyEditor(); root.remove();
    }, 60000);

    it("单步事务 应该 落在该步的新位置上", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        const tr = view.state.tr.insertText("xyz", 3);
        const range = changeRangeInFinalDoc([tr], tr.doc.content.size);
        // 插入区间是 [3, 3+3)（doc 坐标含起始边界，这里断言覆盖到插入内容）
        expect(range).not.toBeNull();
        expect(range!.from).toBeLessThanOrEqual(3);
        expect(range!.to).toBeGreaterThanOrEqual(6);
        destroyEditor(); root.remove();
    }, 60000);

    it("多步事务（中间文档比最终长） 应该 换算到最终坐标且不越界（回归：中文撤销失效）", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        const tr = view.state.tr.insertText("nihao", 6);
        tr.replaceWith(6, 11, view.state.schema.text("你好"));
        const docSize = tr.doc.content.size;
        const range = changeRangeInFinalDoc([tr], docSize);
        expect(range).not.toBeNull();
        expect(range!.from).toBeGreaterThanOrEqual(0);
        expect(range!.to).toBeLessThanOrEqual(docSize);
        expect(range!.from).toBeLessThanOrEqual(range!.to);
        destroyEditor(); root.remove();
    }, 60000);

    it("区间恒在文档范围内（多个场景遍历）", async () => {
        const root = await mount("hello world");
        const view = getEditorView()!;
        const scenarios = [
            (v: typeof view) => { const t = v.state.tr.insertText("abcdefgh", 11); t.delete(1, 6); return t; },
            (v: typeof view) => { const t = v.state.tr.delete(1, 12); t.insertText("x", 1); return t; },
            (v: typeof view) => { const t = v.state.tr.insertText("aaaaaaaaaa", 1); t.replaceWith(1, 11, v.state.schema.text("b")); return t; },
        ];
        for (const build of scenarios) {
            const tr = build(view);
            const docSize = tr.doc.content.size;
            const range = changeRangeInFinalDoc([tr], docSize);
            if (!range) { continue; }
            expect(range.from).toBeGreaterThanOrEqual(0);
            expect(range.to).toBeLessThanOrEqual(docSize);
            expect(range.from).toBeLessThanOrEqual(range.to);
        }
        destroyEditor(); root.remove();
    }, 60000);
});

describe("normalizeListSpread（纯逻辑）", () => {
    it("列表项含多块时 应该 把 spread 置 true", async () => {
        const root = await mount("- a\n- b");
        const view = getEditorView()!;
        const list = view.state.doc.firstChild!;
        const itemEnd = 2 + list.firstChild!.content.size;
        const tr = view.state.tr.insert(itemEnd, view.state.schema.nodes.paragraph!.create());
        const doc = tr.doc;
        const tr2 = view.state.tr;
        normalizeListSpread(doc, view.state.schema, tr2, { from: 0, to: doc.content.size });
        expect(tr2.steps.length).toBeGreaterThan(0);
        destroyEditor(); root.remove();
    }, 60000);

    it("无列表的区间 应该 不产生任何步骤", async () => {
        const root = await mount("hello");
        const view = getEditorView()!;
        const tr = view.state.tr;
        const changed = normalizeListSpread(view.state.doc, view.state.schema, tr, { from: 1, to: 5 });
        expect(changed).toBe(false);
        expect(tr.steps.length).toBe(0);
        destroyEditor(); root.remove();
    }, 60000);

    it("越界区间 应该 不抛错（异常一律吞掉，绝不打掉用户事务）", async () => {
        const root = await mount("- a\n- b");
        const view = getEditorView()!;
        const tr = view.state.tr;
        const docSize = view.state.doc.content.size;
        expect(() => normalizeListSpread(view.state.doc, view.state.schema, tr, { from: docSize - 1, to: docSize + 999 }))
            .not.toThrow();
        destroyEditor(); root.remove();
    }, 60000);
});
