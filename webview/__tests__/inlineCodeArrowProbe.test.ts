/**
 * 行内代码行尾方向键行为回归测试（vendor 虚拟光标）：
 * 行尾（后面无内容）按 ArrowRight 应与「有后续内容」场景一致——
 * 不移动光标、切换 storedMarks 为空（块外指示由渲染层显示）、输入即普通文本。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { inlineCodeSchema } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createVirtualCursor } from "../vendor/prosemirrorVirtualCursor";

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
    crepe.editor.use(
        inlineCodeSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), inclusive: true })),
    );
    crepe.editor.use($prose(() => createVirtualCursor()));
    const editor = await crepe.create();
    return editor;
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

function pressKey(view: EditorView, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    return event;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("行内代码行尾方向键（vendor 虚拟光标）", () => {
    it("行尾按 ArrowRight 应该 不移动光标但清空 storedMarks，输入为普通文本（回归：与有后续内容行为一致）", async () => {
        const editor = await makeEditor("para `code`\n");
        const view = getView(editor);
        let codeEnd = -1;
        view.state.doc.descendants((node, pos) => {
            if (node.text === "code") codeEnd = pos + node.nodeSize;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codeEnd)));
        const posBefore = view.state.selection.from;

        pressKey(view, "ArrowRight");

        // 光标不移动（与有后续内容时一致：先切换块内块外指示）
        expect(view.state.selection.from).toBe(posBefore);
        // storedMarks 已清空（输入不再带 code）
        view.dispatch(view.state.tr.insertText("x"));
        let codeTexts: string[] = [];
        view.state.doc.descendants((node) => {
            if (node.marks.some((m) => m.type.name === "inlineCode")) codeTexts.push(node.text ?? "");
        });
        expect(codeTexts.some((t) => t.includes("x"))).toBe(false);
    });

    it("代码中间按 ArrowRight 应该 放行（仍在代码内移动）", async () => {
        const editor = await makeEditor("para `codex`\n");
        const view = getView(editor);
        let codePos = -1;
        view.state.doc.descendants((node, pos) => {
            if (node.text === "codex") codePos = pos + 2; // 光标在 "co" 之后
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codePos)));

        const event = pressKey(view, "ArrowRight");
        // 不拦截（defaultPrevented false），由内置处理移动；storedMarks 无变化
        expect(event.defaultPrevented).toBe(false);
    });

    it("普通文本（无 mark）尾部按 ArrowRight 应该 走上游文本边界行为（回归：不误触我们的行尾分支）", async () => {
        const editor = await makeEditor("para\n");
        const view = getView(editor);
        // 光标在普通文本尾部（无任何 mark）
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));

        pressKey(view, "ArrowRight");
        // 上游原有分支把光标移到文本节点边界（pos 4 → 5）；我们的行尾分支
        // 要求 marksBefore 非空，普通文本不触发（不抛错、行为与上游一致）
        expect(view.state.selection.from).toBe(5);
    });
});
