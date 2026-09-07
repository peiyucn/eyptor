/**
 * 输入基准（探针）：1 万行文档逐键 insertText 的管道耗时。
 * 定位「卡顿有改善但达不到可用状态」的剩余热点（listener 序列化 / decorations / 其他插件）。
 */
import { describe, it } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { withTableBreakHandler } from "../utils/markdownSerializer";

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
    crepe.editor.config((ctx) => {
        ctx.update(remarkStringifyOptionsCtx, (options) => withTableBreakHandler(options));
    });
    return crepe.create();
}

function getView(editor: Awaited<ReturnType<typeof makeEditor>>): EditorView {
    return editor.action((ctx) => ctx.get(editorViewCtx));
}

describe("1 万行输入管道基准（探针）", () => {
    it("100 次 insertText 打印逐键耗时", async () => {
        const lines: string[] = [];
        for (let i = 0; i < 2000; i++) {
            lines.push(`## 标题 ${i}`);
            lines.push("正文一行内容");
            lines.push("正文二行内容");
            lines.push("");
        }
        const editor = await makeEditor(lines.join("\n"));
        const view = getView(editor);

        // 光标放文档中部
        const pos = Math.floor(view.state.doc.content.size / 2);
        let total = 0;
        let maxMs = 0;
        for (let i = 0; i < 100; i++) {
            const t0 = performance.now();
            view.dispatch(view.state.tr.insertText("x", pos + i));
            const ms = performance.now() - t0;
            total += ms;
            if (ms > maxMs) maxMs = ms;
        }
        // eslint-disable-next-line no-console
        console.log(`[input-bench] 100 键总计 ${total.toFixed(1)}ms，平均 ${(total / 100).toFixed(2)}ms/键，最慢 ${maxMs.toFixed(1)}ms`);
    }, 180000);
});
