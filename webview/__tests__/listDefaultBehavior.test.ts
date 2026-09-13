/**
 * 列表默认行为回归测试（官方 commonmark keymap，无自定义列表插件）。
 * 覆盖手测反馈「有序列表中间删除一行后编号重新开始」：
 * - 空项行首 Backspace → 删除该项，编号重排 1..n
 * - 非空项行首 Backspace → joinBackward 并入上一项，编号重排 1..n
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

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
    const editor = await crepe.create();
    return editor;
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

function serialize(editor: Awaited<ReturnType<typeof makeEditor>>): string {
    return editor.action(getMarkdown());
}

function pressBackspace(view: EditorView): boolean {
    let handled = false;
    const event = {
        key: "Backspace",
        preventDefault() { /* noop */ },
        stopPropagation() { /* noop */ },
    } as unknown as KeyboardEvent;
    view.someProp("handleKeyDown", (f) => {
        if (f(view, event)) {
            handled = true;
            return true;
        }
        return false;
    });
    return handled;
}

function collectLabels(view: EditorView): string[] {
    const out: string[] = [];
    view.state.doc.descendants((node) => {
        if (node.type.name === "list_item") out.push(String(node.attrs.label));
    });
    return out;
}

function itemPositions(view: EditorView): number[] {
    const pos: number[] = [];
    view.state.doc.descendants((node, p) => {
        if (node.type.name === "list_item") pos.push(p);
    });
    return pos;
}

function setCursor(view: EditorView, pos: number): void {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("列表官方默认行为", () => {
    it("空项行首 Backspace 应该 删除该项并重编号为 1..3", async () => {
        const editor = await makeEditor("1. a\n2. \n3. c\n4. d\n");
        const view = getView(editor);
        expect(collectLabels(view)).toEqual(["1.", "2.", "3.", "4."]);

        const positions = itemPositions(view);
        setCursor(view, positions[1] + 1);
        const handled = pressBackspace(view);
        expect(handled).toBe(true);

        expect(collectLabels(view)).toEqual(["1.", "2.", "3."]);
        const md = serialize(editor);
        expect(md).toContain("1. a");
        expect(md).toContain("2. c");
        expect(md).toContain("3. d");
    });

    it("非空项行首 Backspace 应该 并入上一项并重编号为 1..3", async () => {
        const editor = await makeEditor("1. a\n2. b\n3. c\n4. d\n");
        const view = getView(editor);

        const positions = itemPositions(view);
        setCursor(view, positions[2] + 1);
        const handled = pressBackspace(view);
        expect(handled).toBe(true);

        expect(collectLabels(view)).toEqual(["1.", "2.", "3."]);
        const md = serialize(editor);
        expect(md).toContain("1. a");
        expect(md).toContain("2. b");
        expect(md).toContain("3. d");
        expect(md).not.toContain("3. c");
        expect(md).not.toContain("1. d");
    });

    it("Shift-Tab 应该 提升层级（官方 lift 键位不回归）", async () => {
        const editor = await makeEditor("- a\n  - b\n  - c\n");
        const view = getView(editor);
        const positions = itemPositions(view);
        setCursor(view, positions[1] + 1);
        let handled = false;
        const event = {
            key: "Tab",
            shiftKey: true,
            preventDefault() { /* noop */ },
            stopPropagation() { /* noop */ },
        } as unknown as KeyboardEvent;
        view.someProp("handleKeyDown", (f) => {
            if (f(view, event)) { handled = true; return true; }
            return false;
        });
        expect(handled).toBe(true);
        expect(itemPositions(view)).toHaveLength(3);
        // b 提升为顶层项：顶层列表 3 项
        const md = serialize(editor);
        expect(md).toContain("* a");
        expect(md).toContain("* b");
        expect(md).toContain("* c");
    });
});