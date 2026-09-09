import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findHeadingFoldRange, getHeadingLevel, isHeadingNode, computeAllHeadingFoldRanges, buildHeadingIndex, computeAllHeadingSignature, computeHeadingSignature } from "../utils/headingFold";
import { normalizeFoldPositions } from "../headingFoldPlugin";

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

describe("computeAllHeadingFoldRanges（单遍 O(n)，与 findHeadingFoldRange 等价）", () => {
    it("多层混合标题 应该 与逐标题计算结果完全一致", async () => {
        const editor = await makeEditor(
            "# Top\ncontent top\n## A\ncontent A\n### Sub\ncontent Sub\n## B\ncontent B\n# Bottom\ncontent bottom\n",
        );
        const view = getView(editor);
        const doc = view.state.doc;
        const headings = headingPositions(view);
        const all = computeAllHeadingFoldRanges(doc);

        // 每个标题的 ranges 都应与旧实现一致
        for (const { pos, level } of headings) {
            expect(all.get(pos)).toEqual(findHeadingFoldRange(doc, pos, level));
        }
        // 全部标题都在 map 中
        expect(all.size).toBe(headings.length);
    });

    it("叶子标题（无后续内容） 应该 为 null", async () => {
        const editor = await makeEditor("## A\n");
        const view = getView(editor);
        const all = computeAllHeadingFoldRanges(view.state.doc);
        const headings = headingPositions(view);
        expect(all.get(headings[0].pos)).toBeNull();
    });
});

describe("buildHeadingIndex（折叠 / 吸顶 / TOC 共享索引，回归 P1）", () => {
    it("顶层标题 应该 标记 topLevel 并附带折叠范围", async () => {
        const editor = await makeEditor("## A\ncontent A\n## B\n");
        const view = getView(editor);
        const index = buildHeadingIndex(view.state.doc);

        expect(index).toHaveLength(2);
        expect(index.every((e) => e.topLevel)).toBe(true);
        expect(index[0]).toMatchObject({ level: 2, text: "A" });
        expect(index[0].foldRange).not.toBeNull();
        expect(index[1].foldRange).toBeNull(); // 末尾标题无后续内容
        // pos 与 doc.forEach 的 offset 同口径（顶层判定不得引入 ±1 偏移）
        expect(index.map((e) => e.pos)).toEqual(headingPositions(view).map((h) => h.pos));
    });

    it("嵌套标题（引用内） 应该 标记为非顶层且无折叠范围", async () => {
        const editor = await makeEditor("> ## 引用内标题\n>\n> 内容\n");
        const view = getView(editor);
        const index = buildHeadingIndex(view.state.doc);

        const nested = index.filter((e) => !e.topLevel);
        expect(nested).toHaveLength(1);
        expect(nested[0].text).toBe("引用内标题");
        expect(nested[0].foldRange).toBeNull();
    });

    it("签名：嵌套标题变化 应该 改变全部标题签名，但不影响顶层签名", async () => {
        const before = await makeEditor("## A\n\n> ### 引用内\n");
        const after = await makeEditor("## A\n\n> ### 引用内改\n");
        const beforeDoc = getView(before).state.doc;
        const afterDoc = getView(after).state.doc;

        expect(computeAllHeadingSignature(beforeDoc)).not.toBe(computeAllHeadingSignature(afterDoc));
        expect(computeHeadingSignature(beforeDoc)).toBe(computeHeadingSignature(afterDoc));
    });
});

describe("normalizeFoldPositions（webview 重建后恢复折叠状态）", () => {
    it("有效标题位置 应该 保留，指向正文/越界的位置 应该 丢弃", async () => {
        const editor = await makeEditor("# 一级\n\n正文\n\n## 二级\n\n正文\n");
        const doc = getView(editor).state.doc;
        const headingPos = headingPositions(getView(editor))[0].pos;

        expect(normalizeFoldPositions(doc, [headingPos])).toEqual([headingPos]);
        expect(normalizeFoldPositions(doc, [headingPos + 1])).toEqual([]);
        expect(normalizeFoldPositions(doc, [999999])).toEqual([]);
    });

    it("空数组 应该 返回空数组", async () => {
        const editor = await makeEditor("# 一级\n\n正文\n");
        expect(normalizeFoldPositions(getView(editor).state.doc, [])).toEqual([]);
    });
});
