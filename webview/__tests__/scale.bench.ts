/**
 * 规模对比基准（探针）：3000 行 vs 10000 行文档逐键 insertText 管道耗时。
 * 用户实证 3000 行流畅、10000 行卡——找规模敏感的热点（线性 vs 超线性）。
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

function makeDoc(headingCount: number): string {
    const lines: string[] = [];
    for (let i = 0; i < headingCount; i++) {
        lines.push(`## 标题 ${i}`);
        lines.push("正文一行内容");
        lines.push("正文二行内容");
        lines.push("");
    }
    return lines.join("\n");
}

async function benchKeyPress(headingCount: number): Promise<{ avg: number; max: number }> {
    const editor = await makeEditor(makeDoc(headingCount));
    const view = getView(editor);
    const pos = Math.floor(view.state.doc.content.size / 2);
    let total = 0;
    let maxMs = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        view.dispatch(view.state.tr.insertText("x", pos + i));
        const ms = performance.now() - t0;
        total += ms;
        if (ms > maxMs) maxMs = ms;
    }
    await editor.destroy();
    document.body.innerHTML = "";
    return { avg: total / N, max: maxMs };
}

describe("规模对比基准（探针）", () => {
    it("3000 行 vs 10000 行逐键耗时", async () => {
        const small = await benchKeyPress(600); // 600 标题 ≈ 3000 行
        // eslint-disable-next-line no-console
        console.log(`[scale-bench] 3000行: avg=${small.avg.toFixed(2)}ms max=${small.max.toFixed(1)}ms`);
        const large = await benchKeyPress(2000); // 2000 标题 ≈ 10000 行
        // eslint-disable-next-line no-console
        console.log(`[scale-bench] 10000行: avg=${large.avg.toFixed(2)}ms max=${large.max.toFixed(1)}ms`);
    }, 180000);
});
