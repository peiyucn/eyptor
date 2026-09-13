import { describe, expect, it } from "vitest";
import { undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
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

/**
 * 一次事务里两步：先插入拼音、再原地替换成候选词。
 * **必须放在同一个事务里**——分成两次 dispatch 时每步各自单步，区间换算的映射路径
 * 根本走不到，那样的用例在任何版本都绿（钉不住回归）。单事务里中间文档比最终文档长
 * （nihao=5 → 你好=2），旧实现把中间步的 newEnd 当最终坐标用会越过文档末尾，
 * nodesBetween 抛 TypeError，异常从 appendTransaction 冒到 applyTransaction，
 * **整条事务（含撤销）被打掉**。
 */
function composeInOneTransaction(view: EditorView, at: number, pinyin: string, hanzi: string): void {
    const tr = view.state.tr.insertText(pinyin, at);
    tr.replaceWith(at, at + pinyin.length, view.state.schema.text(hanzi));
    view.dispatch(tr);
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

    describe("单事务多步（输入法提交形态）", () => {
        it("段落内 应该 不抛错且区间落在最终坐标", async () => {
            const root = await mount("hello");
            const view = getEditorView()!;
            composeInOneTransaction(view, 6, "nihao", "你好");
            expect(view.state.doc.textContent).toBe("hello你好");
            destroyEditor(); root.remove();
        }, 60000);

        it("段落内 应该 一次撤销回到初始（回归：撤销「没反应」）", async () => {
            const root = await mount("hello");
            const view = getEditorView()!;
            composeInOneTransaction(view, 6, "nihao", "你好");
            expect(view.state.doc.textContent).toBe("hello你好");
            expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
            expect(view.state.doc.textContent).toBe("hello");
            destroyEditor(); root.remove();
        }, 60000);

        it("列表项内 应该 不抛错", async () => {
            const root = await mount("- hello\n- b");
            const view = getEditorView()!;
            // 位置从文档结构推导（1 列表开 + 1 项开 + 1 段落开 + 段落文本长），
            // 保证替换范围完全落在该项段落内，不跨项边界
            const item = view.state.doc.firstChild!.firstChild!;
            const at = 3 + item.firstChild!.content.size;
            composeInOneTransaction(view, at, "nihao", "你好");
            expect(view.state.doc.textContent).toBe("hello你好b");
            // 列表结构未被破坏：仍是两项
            expect(view.state.doc.firstChild!.childCount).toBe(2);
            expect(view.state.doc.firstChild!.firstChild!.textContent).toBe("hello你好");
            destroyEditor(); root.remove();
        }, 60000);
    });
});
