/**
 * 嵌套标题口径诊断（D7）：headingFold 用 doc.forEach（仅顶层块），
 * headingSticky 用 DOM querySelectorAll（全层级）——若 schema 允许 blockquote/列表内
 * 标题，两插件对「哪些标题参与折叠/吸顶」口径不一致。本探针实测 7.22.1 行为。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
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

async function makeEditor(md: string) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new CrepeBuilder({ root, defaultValue: md });
    return crepe.create();
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("嵌套标题 schema 行为诊断", () => {
    it("blockquote 内标题 应该 被 schema 接受（若接受：折叠/吸顶口径不一致需统一）", async () => {
        const editor = await makeEditor("> ## 引用内标题\n>\n> 内容\n");
        const view = getView(editor);

        const nested: Array<{ pos: number; depth: number }> = [];
        view.state.doc.descendants((node, pos, parent) => {
            if (node.type.name === "heading" && parent !== null) {
                nested.push({ pos, depth: parent.type.name === "doc" ? 0 : 1 });
            }
            return true;
        });

        // 实测输出：嵌套标题是否存在（该结果决定 D7 修复方案）
        expect(nested.length).toBeGreaterThan(0);
        // doc.forEach 只遍历顶层块：blockquote 内的标题不在其中
        const topLevel = new Set<number>();
        view.state.doc.forEach((node, offset) => {
            if (node.type.name === "heading") topLevel.add(offset);
        });
        // 若嵌套标题存在且不在顶层集合中，则口径不一致成立
        expect(nested.every((h) => topLevel.has(h.pos))).toBe(false);
    });
});
