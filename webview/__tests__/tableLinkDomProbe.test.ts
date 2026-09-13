/**
 * 表格内自动链接 DOM 形态回归（wrapMode normal 档断行修复的配套）：
 * 断言 <https://...> 与裸 URL 都渲染为 td > p > a，CSS 规则才能命中
 * （.milkdown .milkdown-table-block table td a → overflow-wrap:anywhere）。
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

describe("表格内自动链接 DOM 形态诊断", () => {
    it("<https://...> 尖括号自动链接 应该 渲染为 a 元素", async () => {
        const editor = await makeEditor(
            "| URL |\n| --- |\n| <https://example.com/very/long/path/to/resource> |\n",
        );
        const view = getView(editor);
        const td = view.dom.querySelector("td");
        expect(td).not.toBeNull();

        const anchor = td!.querySelector("a");
        expect(anchor).not.toBeNull();
        expect(anchor!.textContent).toContain("https://example.com");
        // a 的祖先链：td > p > a
        expect(anchor!.parentElement?.tagName).toBe("P");
    });

    it("裸 URL（无尖括号） 应该 也渲染为 a 元素", async () => {
        const editor = await makeEditor(
            "| URL |\n| --- |\n| https://example.com/very/long/path/to/resource |\n",
        );
        const view = getView(editor);
        const anchor = view.dom.querySelector("td a");
        expect(anchor).not.toBeNull();
    });

    it("CSS 选择器链 .milkdown .ProseMirror table td a 应该 命中（wrapMode 断行规则的前提）", async () => {
        const editor = await makeEditor(
            "| URL |\n| --- |\n| <https://example.com/very/long/path/to/resource> |\n",
        );
        const view = getView(editor);
        // 7.22.1 真实 DOM：table 直接在 .ProseMirror 下，没有 .milkdown-table-block 包装层
        const hit = document.querySelector(".milkdown .ProseMirror table td a");
        expect(hit).not.toBeNull();
        const td = view.dom.querySelector("td");
        expect(td).not.toBeNull();
        expect(td!.closest(".milkdown")).not.toBeNull();
        expect(td!.closest(".ProseMirror")).not.toBeNull();
        // 基础渲染无 .milkdown-table-block 包装层（7.22.1 表格体直接在 .ProseMirror 下）。
        // 注意：这不与 style.test 中「.milkdown-table-block .cell-handle」规则矛盾——
        // cell-handle 是行/列选中时条件挂载的 Vue overlay（其祖先链含 .milkdown-table-block），
        // 基础渲染阶段必然不存在；该 overlay 路径在真实浏览器手测已验证（v1.2.0 手测清单）。
        // 若上游未来给表格体加回包装层，需同步调整本断言与断行规则前缀。
        expect(document.querySelector(".milkdown-table-block")).toBeNull();
    });
});
