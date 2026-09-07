/**
 * 行内代码行尾方向键退出回归测试：
 * inclusive:true 恢复后（7.22.0 行为），行尾按 ArrowRight 应明确移出 code mark
 * （此前「块尾无法退出」——inclusive mark 右边界 sticky 且无退出机制）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { inlineCodeSchema } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { exitInlineCodePlugin } from "../editor";

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
    crepe.editor.use(exitInlineCodePlugin);
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

describe("行内代码行尾方向键退出", () => {
    it("行尾按 ArrowRight 应该 移出 code mark（回归：块尾无法退出）", async () => {
        const editor = await makeEditor("para `code`\n");
        const view = getView(editor);
        let codeEnd = -1;
        view.state.doc.descendants((node, pos) => {
            if (node.text === "code") codeEnd = pos + node.nodeSize;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codeEnd)));

        const event = pressKey(view, "ArrowRight");
        expect(event.defaultPrevented).toBe(true);
        // 行为级断言：退出后输入 "x"，x 必须是普通文本（不带 inlineCode mark）
        // （回归：仅移动选区未清 storedMarks，inclusive 边界输入仍是代码——两轮「仍无法移出」）
        view.dispatch(view.state.tr.insertText("x"));
        let codeTexts: string[] = [];
        view.state.doc.descendants((node) => {
            if (node.marks.some((m) => m.type.name === "inlineCode")) codeTexts.push(node.text ?? "");
        });
        expect(codeTexts.some((t) => t.includes("x"))).toBe(false);
    });

    it("代码中间按 ArrowRight 应该 放行默认（仍在代码内移动）", async () => {
        const editor = await makeEditor("para `codex`\n");
        const view = getView(editor);
        let codeStart = -1;
        view.state.doc.descendants((node, pos) => {
            if (node.text === "codex") codeStart = pos + 2; // 光标在 "co" 之后
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codeStart)));

        const event = pressKey(view, "ArrowRight");
        // 下一位置仍在 code mark 内 → 插件放行（不拦截），由内置处理移动
        expect(event.defaultPrevented).toBe(false);
    });
});
