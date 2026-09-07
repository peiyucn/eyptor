/**
 * 行内代码 inclusive 回归测试：
 * Milkdown 7.22.1（#2451）把 inlineCode mark 改为 inclusive:false，块尾输入即退出代码 span——
 * epytor 的 ./ @/ 路径补全依赖行内代码尾部继续编辑，config 覆盖恢复 inclusive:true（7.22.0 行为）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { inlineCodeSchema } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

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

async function makeEditor(md: string, overrideInclusive: boolean) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new CrepeBuilder({ root, defaultValue: md });
    crepe.editor.use(
        inlineCodeSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), inclusive: overrideInclusive })),
    );
    const editor = await crepe.create();
    return editor;
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

/** 光标移到 code span 内最后一个字符之后（pos 是 code 文本末尾） */
function caretAtEndOfCode(view: EditorView, text: string): void {
    view.state.doc.descendants((node, pos) => {
        if (node.text === text) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + node.nodeSize)));
            return false;
        }
        return true;
    });
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("行内代码块尾输入（inclusive 回归）", () => {
    it("inclusive:true（epytor 配置）块尾输入 应该 留在代码 span 内", async () => {
        const editor = await makeEditor("`@/utils`\n", true);
        const view = getView(editor);
        caretAtEndOfCode(view, "@/utils");
        view.dispatch(view.state.tr.insertText("x"));

        let codeTexts: string[] = [];
        view.state.doc.descendants((node) => {
            if (node.marks.some((m) => m.type.name === "inlineCode")) codeTexts.push(node.text ?? "");
        });
        expect(codeTexts.some((t) => t.includes("x"))).toBe(true);
    });

    it("inclusive:false（上游 7.22.1 默认）块尾输入 应该 退出代码 span（对照）", async () => {
        const editor = await makeEditor("`@/utils`\n", false);
        const view = getView(editor);
        caretAtEndOfCode(view, "@/utils");
        view.dispatch(view.state.tr.insertText("x"));

        let codeTexts: string[] = [];
        view.state.doc.descendants((node) => {
            if (node.marks.some((m) => m.type.name === "inlineCode")) codeTexts.push(node.text ?? "");
        });
        expect(codeTexts.some((t) => t.includes("x"))).toBe(false);
    });
});
