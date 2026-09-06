import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findHeadingFoldRange, getHeadingLevel, isHeadingNode } from "../utils/headingFold";

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

function headingPositions(view: EditorView): Array<{ pos: number; level: number }> {
    const out: Array<{ pos: number; level: number }> = [];
    view.state.doc.forEach((node, offset) => {
        if (isHeadingNode(node)) {
            out.push({ pos: offset, level: getHeadingLevel(node) });
        }
    });
    return out;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("findHeadingFoldRange", () => {
    it("同级标题之前 应该 截断折叠范围", async () => {
        const editor = await makeEditor("## A\ncontent A\n## B\ncontent B\n");
        const view = getView(editor);
        const headings = headingPositions(view);
        expect(headings).toHaveLength(2);
        const range = findHeadingFoldRange(view.state.doc, headings[0].pos, 2)!;
        expect(range).not.toBeNull();
        // 范围应覆盖 A 的 content，止于 B 之前
        expect(range.to).toBeLessThanOrEqual(headings[1].pos);
        expect(range.from).toBeGreaterThan(headings[0].pos);
        // B 的 content 不在范围内
        expect(view.state.doc.textBetween(range.from, range.to)).toContain("content A");
        expect(view.state.doc.textBetween(range.from, range.to)).not.toContain("content B");
    });

    it("子标题（更高层级）应该 不截断折叠范围", async () => {
        const editor = await makeEditor("## A\ncontent A\n### Sub\ncontent Sub\n");
        const view = getView(editor);
        const headings = headingPositions(view);
        const range = findHeadingFoldRange(view.state.doc, headings[0].pos, 2)!;
        expect(range).not.toBeNull();
        expect(view.state.doc.textBetween(range.from, range.to)).toContain("content Sub");
    });

    it("更高级标题（# 一级）应该 截断折叠范围", async () => {
        const editor = await makeEditor("## A\ncontent A\n# Top\ncontent Top\n");
        const view = getView(editor);
        const headings = headingPositions(view);
        const range = findHeadingFoldRange(view.state.doc, headings[0].pos, 2)!;
        expect(range).not.toBeNull();
        expect(view.state.doc.textBetween(range.from, range.to)).toContain("content A");
        expect(view.state.doc.textBetween(range.from, range.to)).not.toContain("content Top");
    });

    it("无后续内容的叶子标题 应该 不可折叠", async () => {
        const editor = await makeEditor("## A\n");
        const view = getView(editor);
        const headings = headingPositions(view);
        expect(findHeadingFoldRange(view.state.doc, headings[0].pos, 2)).toBeNull();
    });

    it("非标题位置 应该 返回 null", async () => {
        const editor = await makeEditor("para\n");
        const view = getView(editor);
        expect(findHeadingFoldRange(view.state.doc, 0, 2)).toBeNull();
    });
});
