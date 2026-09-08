/**
 * 表格换行往返回归测试（闭环方案，源码形态 <br>）：
 * Extension 加载时把表格内 <br> 转为 &#10; 实体再进解析器（convertTableBrForDisplay），
 * 渲染为换行；保存序列化回 <br>。覆盖手测反馈「编辑后进源码正常、回编辑页换行失效」
 * ——根因：remark-gfm 解析层丢弃 <br>。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { softBreakKeymap } from "../softBreakKeymap";
import { withTableBreakHandler } from "../utils/markdownSerializer";

if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ }
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

async function makeEditor(md: string) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new CrepeBuilder({ root, defaultValue: md });
    crepe.editor.config((ctx) => {
        ctx.update(remarkStringifyOptionsCtx, (options) => withTableBreakHandler(options));
    });
    crepe.editor.use(softBreakKeymap);
    const editor = await crepe.create();
    return editor;
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

function setCursor(view: EditorView, pos: number): void {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

function pressShiftEnter(view: EditorView): boolean {
    let handled = false;
    const event = { key: "Enter", shiftKey: true, preventDefault() { /* noop */ }, stopPropagation() { /* noop */ } } as unknown as KeyboardEvent;
    view.someProp("handleKeyDown", (f) => {
        if (f(view, event)) { handled = true; return true; }
        return false;
    });
    return handled;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("表格换行往返（<br> 闭环）", () => {
    it("加载含 &#10; 的表格（Extension 转换产物） 应该 解析 hardbreak 并渲染 br 元素", async () => {
        const editor = await makeEditor("| A |\n| --- |\n| x&#10;z |\n");
        const view = getView(editor);
        let hb = 0;
        view.state.doc.descendants((node) => { if (node.type.name === "hardbreak") hb++; });
        expect(hb).toBe(1);
        expect(view.dom.querySelectorAll('span[data-type="hardbreak"][data-is-inline="true"]').length).toBe(1);
        // 序列化输出 GFM 标准 <br>（源码形态），加载时再由 Extension 转回实体
        expect(editor.action(getMarkdown())).toContain("x<br>z");
    });

    it("回编辑页后再按 Shift+Enter 应该 插入第二个换行且序列化为 <br>", async () => {
        const editor = await makeEditor("| A |\n| --- |\n| x&#10;z |\n");
        const view = getView(editor);
        let cellPos = -1;
        view.state.doc.descendants((node, p) => { if (cellPos < 0 && node.type.name === "table_cell") cellPos = p; });
        setCursor(view, cellPos + 3);
        const handled = pressShiftEnter(view);
        expect(handled).toBe(true);
        const md = editor.action(getMarkdown());
        expect(md).toContain("x<br>");
        expect(md).toContain("z");
    });
});
