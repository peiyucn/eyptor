/**
 * 上游版本回归验证：Milkdown 升级后对上游修复项的可自动化断言。
 *
 * 对应 AGENTS「上游限制」维护规则：升级依赖时逐项验证。可自动化部分固化在此：
 * - #2451（7.22.1）：行内代码 mark 改为非 inclusive —— 影响上游限制 #2413（行内样式尾部退出）
 * - syncListOrderPlugin（preset-commonmark）：单个列表内部删除项后编号自动重排
 */
import { afterEach, describe, expect, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

// jsdom 缺这些 API，Crepe feature 可能用到
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

async function makeEditor(md = "") {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new CrepeBuilder({ root, defaultValue: md });
    const editor = await crepe.create();
    return { editor, root };
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>["editor"]): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

function collectLabels(view: EditorView): string[] {
    const out: string[] = [];
    view.state.doc.descendants((node) => {
        if (node.type.name === "list_item") out.push(String(node.attrs.label));
    });
    return out;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("Milkdown 上游版本回归（7.22.1）", () => {
    it("行内代码 mark 应该是非 inclusive（上游 #2451 已生效）", async () => {
        const { editor } = await makeEditor();
        const view = getView(editor);
        const inlineCode = view.state.schema.marks["inlineCode"];
        expect(inlineCode).toBeDefined();
        // #2451 make the inline code mark not inclusive；若上游回退为 inclusive，此处会失败提醒验证 #2413
        expect(inlineCode!.spec.inclusive).toBe(false);
    });

    it("有序列表程序化删除中间项后编号应该重排为 1..3（上游 syncListOrderPlugin 正常）", async () => {
        const { editor } = await makeEditor("1. a\n2. b\n3. c\n4. d\n");
        const view = getView(editor);
        expect(collectLabels(view)).toEqual(["1.", "2.", "3.", "4."]);

        const positions: number[] = [];
        view.state.doc.descendants((node, p) => {
            if (node.type.name === "list_item") positions.push(p);
        });
        const item2Start = positions[1];
        const item2 = view.state.doc.nodeAt(item2Start)!;
        view.dispatch(view.state.tr.delete(item2Start, item2Start + item2.nodeSize));

        expect(collectLabels(view)).toEqual(["1.", "2.", "3."]);
    });

    it("行内代码输入规则 mark 应参与 schema 输入规则（上游 #2445 相关）", async () => {
        const { editor } = await makeEditor();
        const view = getView(editor);
        // 只断言 mark 与 schema 结构完好，输入规则行为由手测清单覆盖
        expect(view.state.schema.marks["inlineCode"]).toBeDefined();
        expect(view.state.schema.marks["strong"]).toBeDefined();
        expect(view.state.schema.marks["emphasis"]).toBeDefined();
    });
});
