/**
 * 列表项行首 Backspace 落点回归（手测 2026-09-12「退格删行后光标上移错位、上下键走不动」）。
 *
 * 默认 joinBackward 在 Crepe 的列表 schema 下按「项」合并：空项变成上一项里的第二个空段落，
 * 光标停在那一段上；任务列表还会把标记漏进正文。本文件锁定修正后的**行为与落点**
 * （不断言"是否由本插件处理"——第一项仍由默认命令处理，但那也是正确行为）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { listBackspacePlugin } from "../utils/listBackspace";

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
    crepe.editor.use(listBackspacePlugin);
    const editor = await crepe.create();
    return editor;
}

type Editor = Awaited<ReturnType<typeof makeEditor>>;
const getView = (editor: Editor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));

function pressBackspace(view: EditorView): boolean {
    let handled = false;
    const event = {
        key: "Backspace",
        preventDefault() { /* noop */ },
        stopPropagation() { /* noop */ },
    } as unknown as KeyboardEvent;
    view.someProp("handleKeyDown", (f) => {
        if (f(view, event)) { handled = true; return true; }
        return false;
    });
    return handled;
}

/** 顶层列表项的位置（深度优先） */
function itemPositions(view: EditorView): number[] {
    const positions: number[] = [];
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === "list_item") { positions.push(pos); }
    });
    return positions;
}

/** 每个列表项的「段落数 + 文字」（行为断言用，不依赖序列化细节） */
function itemsOutline(view: EditorView): string[] {
    const out: string[] = [];
    view.state.doc.descendants((node) => {
        if (node.type.name !== "list_item") { return true; }
        const blocks: string[] = [];
        node.forEach((child) => {
            blocks.push(child.type.name === "paragraph" ? child.textContent : `<${child.type.name}>`);
        });
        out.push(`${node.attrs.checked === null ? "" : (node.attrs.checked ? "[x]" : "[ ]")}${blocks.join(" + ")}`);
        return true;
    });
    return out;
}

function setCursor(view: EditorView, pos: number): void {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

const cursorText = (view: EditorView): string => view.state.selection.$from.parent.textContent;
const cursorOffset = (view: EditorView): number => view.state.selection.$from.parentOffset;
const cursorInTextblock = (view: EditorView): boolean => view.state.selection.$from.parent.isTextblock;

afterEach(() => { document.body.innerHTML = ""; });

describe("列表项行首 Backspace 落点", () => {
    it("空项行首退格 应该 删除该项、上一项不残留空段落、光标落在上一项文字末尾", async () => {
        const editor = await makeEditor("- a\n- \n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        // 回归：默认行为会在上一项里塞进第二个空段落
        expect(itemsOutline(view)).toEqual(["a", "c"]);
        // 光标落在「a」之后，且处在正常文本块里（上下方向键可移动）
        expect(cursorText(view)).toBe("a");
        expect(cursorOffset(view)).toBe(1);
        expect(cursorInTextblock(view)).toBe(true);
    });

    it("非空项行首退格 应该 把文字并进上一项同一行，光标落在接缝处", async () => {
        const editor = await makeEditor("- a\n- b\n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(itemsOutline(view)).toEqual(["ab", "c"]);
        expect(cursorText(view)).toBe("ab");
        expect(cursorOffset(view)).toBe(1);
        expect(cursorInTextblock(view)).toBe(true);
    });

    it("有序列表空项退格 应该 删除该项并重编号", async () => {
        const editor = await makeEditor("1. a\n2. \n3. c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(itemsOutline(view)).toEqual(["a", "c"]);
        expect(cursorText(view)).toBe("a");
        const labels: string[] = [];
        view.state.doc.descendants((node) => {
            if (node.type.name === "list_item") { labels.push(String(node.attrs.label)); }
        });
        expect(labels).toEqual(["1.", "2."]);
    });

    it("任务列表空项退格 应该 不把「[ ]」标记漏进正文", async () => {
        const editor = await makeEditor("- [ ] a\n- [ ] \n- [ ] c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        // 回归：默认行为会把标记当成文字并进上一项（上一项变成「a + [ ]」两个段落）
        expect(itemsOutline(view)).toEqual(["[ ]a", "[ ]c"]);
        expect(cursorText(view)).toBe("a");
    });

    it("第一项空项退格 应该 由默认命令提升为普通段落（行为正确即可）", async () => {
        const editor = await makeEditor("- \n- b\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[0] + 1);
        pressBackspace(view);

        // 不锁定「谁处理的」：锁行为——列表少一项，文档首块不再是列表项里的同一结构
        expect(itemsOutline(view)).toEqual(["b"]);
    });

    it("嵌套列表空项退格 应该 删除该项、光标落在同层上一项文字末尾", async () => {
        const editor = await makeEditor("- a\n  - b\n  - \n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[2] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(cursorText(view)).toBe("b");
        expect(itemsOutline(view)).toEqual(["a + <bullet_list>", "b", "c"]);
    });
});
