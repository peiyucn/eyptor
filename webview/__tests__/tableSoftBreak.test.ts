/**
 * 表格软换行回归测试：单元格内 Shift+Enter 应插入 hardbreak（序列化为 <br>）。
 * 实现路径（P2 简化后）：上游 hardbreakKeymap（Shift-Enter）本就在，单元格内被拦
 * 只因 hardbreakFilterNodes ctx 默认含 "table"——editor.ts 把该 ctx 改为
 * ["code_block"]（放行 table）。本测试用同样配置复现该行为。
 * 历史：更早版本官方 tableKeymap 曾把 Shift+Enter 绑定 goToNextCell（7.22.1 已移除）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { hardbreakFilterNodes } from "@milkdown/kit/preset/commonmark";
import { getMarkdown } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { withTableBreakHandler } from "../utils/markdownSerializer";

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

async function makeEditor(md: string) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new CrepeBuilder({ root, defaultValue: md });
    crepe.editor.config((ctx) => {
        ctx.update(remarkStringifyOptionsCtx, (options) => withTableBreakHandler(options));
        // 与 editor.ts 的配置一致：放行 table 内的 hardbreak（保留 code_block 拦截）
        ctx.set(hardbreakFilterNodes.key, ["code_block"]);
    });
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
    const event = {
        key: "Enter",
        shiftKey: true,
        preventDefault() { /* noop */ },
        stopPropagation() { /* noop */ },
    } as unknown as KeyboardEvent;
    view.someProp("handleKeyDown", (f) => {
        if (f(view, event)) { handled = true; return true; }
        return false;
    });
    return handled;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("表格软换行（上游 hardbreakFilterNodes 配置）", () => {
    it("单元格内 Shift+Enter 应该 插入换行并序列化为 <br>", async () => {
        const editor = await makeEditor("| A | B |\n| --- | --- |\n| x | y |\n");
        const view = getView(editor);

        let cellPos = -1;
        view.state.doc.descendants((node, pos) => {
            if (cellPos < 0 && node.type.name === "table_cell") cellPos = pos;
        });
        // 光标在单元格文本 "x" 之后（cellPos+1 段落起点，+2 "x"，+3 段落末尾）
        setCursor(view, cellPos + 3);

        const handled = pressShiftEnter(view);
        expect(handled).toBe(true);

        // 单元格内出现 hardbreak
        let hasHardbreak = false;
        view.state.doc.descendants((node) => {
            if (node.type.name === "hardbreak") hasHardbreak = true;
        });
        expect(hasHardbreak).toBe(true);

        // 模拟真实用户行为：换行后继续输入 "z"（孤立段落末尾 hardbreak 会被
        // Milkdown hardbreakFilterNodes 序列化时丢弃，这是 CommonMark 正确语义）
        let hbPos = -1;
        view.state.doc.descendants((node, pos) => {
            if (hbPos < 0 && node.type.name === "hardbreak") hbPos = pos;
        });
        view.dispatch(view.state.tr.insert(hbPos + 1, view.state.schema.text("z")));

        const md = editor.action(getMarkdown());
        expect(md).toContain("x<br>z");
        expect(md).not.toContain("<br>z y");
    });

    it("单元格外 Shift+Enter 应该 放行默认行为（Milkdown 默认 hardbreak，本插件不干预）", async () => {
        const editor = await makeEditor("para one\n");
        const view = getView(editor);
        setCursor(view, 5);
        const handled = pressShiftEnter(view);
        // Milkdown 全局默认：单元格外 Shift+Enter 同样产生 hardbreak（软换行）
        let hasHardbreak = false;
        view.state.doc.descendants((node) => {
            if (node.type.name === "hardbreak") hasHardbreak = true;
        });
        expect(handled).toBe(true);
        expect(hasHardbreak).toBe(true);
    });
});
