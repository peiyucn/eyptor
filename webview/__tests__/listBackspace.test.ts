/**
 * 列表项行首 Backspace 回归（手测反馈 2026-09-12 两轮）：
 * ① 「退格键退到删除行的时候，光标上移错位比较严重，上下位置不能动」——默认 joinBackward 在
 *    Crepe 的列表 schema 下按「项」合并，空项变成上一项里的第二个空段落，光标停在那一段上；
 * ② 「列表退格不应该是直接删除标号并回到上一行，而是应该断开列表变成正常行」。
 *
 * 本文件锁定**当前语义**：行首退格 = 把该项提升为普通行（列表断开），
 * 有序列表断出来的后半段延续编号。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
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
    return crepe.create();
}

type Editor = Awaited<ReturnType<typeof makeEditor>>;
const getView = (editor: Editor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
const serialize = (editor: Editor): string => editor.action(getMarkdown());

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

/** 顶层块序列（列表压成一项，带每项的 label）：断言"列表断开"这件事最直接。
 *  末尾那条空段落是 Crepe 的编辑区基线（点击正文下方用），不属于改动结果，剔除。 */
function topLevelOutline(view: EditorView): string[] {
    const out: string[] = [];
    view.state.doc.forEach((node, _offset, index) => {
        void index;
        if (node.type.name === "paragraph") { out.push(`p:${node.textContent}`); return; }
        if (node.type.name.endsWith("list")) {
            const items: string[] = [];
            node.forEach((item) => {
                const blocks: string[] = [];
                item.forEach((child) => {
                    blocks.push(child.type.name === "paragraph" ? child.textContent : `<${child.type.name}>`);
                });
                items.push(`${String(item.attrs.label)}${blocks.join("+")}`);
            });
            out.push(`${node.type.name === "ordered_list" ? "ol" : "ul"}[${items.join(", ")}]`);
            return;
        }
        out.push(node.type.name);
    });
    if (out.length > 1 && out[out.length - 1] === "p:") { out.pop(); }
    return out;
}

function itemPositions(view: EditorView): number[] {
    const positions: number[] = [];
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === "list_item") { positions.push(pos); }
    });
    return positions;
}

function setCursor(view: EditorView, pos: number): void {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

const cursorText = (view: EditorView): string => view.state.selection.$from.parent.textContent;
const cursorInTextblock = (view: EditorView): boolean => view.state.selection.$from.parent.isTextblock;

afterEach(() => { document.body.innerHTML = ""; });

describe("列表项行首 Backspace：断开列表变成普通行", () => {
    it("无序列表中间项 应该 升为普通行并断开列表，不留空段落", async () => {
        const editor = await makeEditor("- a\n- b\n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        // 回归①：默认行为会在上一项里塞第二个空段落（这里必须是干净的「p:b」）
        expect(topLevelOutline(view)).toEqual(["ul[•a]", "p:b", "ul[•c]"]);
        // 回归②：光标落在这行普通文字里，上下方向键可移动
        expect(cursorText(view)).toBe("b");
        expect(cursorInTextblock(view)).toBe(true);
    });

    it("无序列表空项 应该 升为普通空行并断开列表", async () => {
        const editor = await makeEditor("- a\n- \n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(topLevelOutline(view)).toEqual(["ul[•a]", "p:", "ul[•c]"]);
        expect(cursorText(view)).toBe("");
        expect(cursorInTextblock(view)).toBe(true);
    });

    it("有序列表中间项 应该 断开列表、且后半段延续编号（不是从 1 重来）", async () => {
        const editor = await makeEditor("1. a\n2. b\n3. c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[1] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(topLevelOutline(view)).toEqual(["ol[1.a]", "p:b", "ol[3.c]"]);
        // 源码同样延续编号（markdown 用起始数字表达）
        expect(serialize(editor)).toContain("3. c");
        expect(serialize(editor)).not.toContain("1. c");
    });

    it("列表第一项 应该 升为普通行，列表整体下移", async () => {
        const editor = await makeEditor("- a\n- b\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[0] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(topLevelOutline(view)).toEqual(["p:a", "ul[•b]"]);
    });

    it("嵌套项 应该 上升一级（回到外层列表），不整段飞出", async () => {
        const editor = await makeEditor("- a\n  - b\n  - \n- c\n");
        const view = getView(editor);
        setCursor(view, itemPositions(view)[2] + 1);
        expect(pressBackspace(view)).toBe(true);

        expect(topLevelOutline(view)).toEqual(["ul[•a+<bullet_list>, •, •c]"]);
        expect(cursorInTextblock(view)).toBe(true);
    });

    it("非行首退格 不应该 改变列表结构（字符删除由浏览器原生处理）", async () => {
        const editor = await makeEditor("- ab\n- c\n");
        const view = getView(editor);
        // 项节点 +1 = 段落起点，+2 = 段落内容起点（行首），+3 = 行首之后
        setCursor(view, itemPositions(view)[0] + 3);
        pressBackspace(view);

        // 结构不变：仍是一个两项的列表（单字符删除不在 keymap 里，由浏览器原生编辑完成，
        // jsdom 下不会发生——本用例只锁「不被提升成普通行」）
        expect(topLevelOutline(view)).toEqual(["ul[•ab, •c]"]);
    });
});
