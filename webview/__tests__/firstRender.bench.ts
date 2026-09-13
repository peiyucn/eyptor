/**
 * 首次渲染基准（探针）：打开 md 文件时的 createEditor（全功能栈：
 * Crepe 原生 feature + 自定义插件 + CodeMirror NodeView + 图片 NodeView）耗时。
 * 规模与内容构成分档：典型文档 / 代码块密集 / 万行级，找首次渲染的规模敏感热点。
 */
import { describe, it } from "vitest";
import { createEditor, destroyEditor } from "../editor";
import { editorViewCtx } from "@milkdown/kit/core";

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
if (typeof (window as unknown as Record<string, unknown>).IntersectionObserver === "undefined") {
    (window as unknown as Record<string, unknown>).IntersectionObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } takeRecords() { return []; }
    };
}
(window as unknown as Record<string, unknown>).__i18n = {
    translations: {},
    isMac: false,
    serializationMode: "clean",
};

/** 典型文档：标题 + 正文 + 列表混合，n 个「章节」 */
function makeTypicalDoc(chapterCount: number): string {
    const lines: string[] = [];
    for (let i = 0; i < chapterCount; i++) {
        lines.push(`## 章节 ${i}`);
        lines.push("这是一段正文内容，用于测量典型 Markdown 文档的首次渲染耗时。");
        lines.push("");
        lines.push(`- 列表项 ${i}.1`);
        lines.push(`- 列表项 ${i}.2 带 **粗体** 与 \`行内代码\``);
        lines.push("");
        if (i % 5 === 0) {
            lines.push("| 列 A | 列 B |");
            lines.push("| --- | --- |");
            lines.push(`| 值 ${i} | 描述 ${i} |`);
            lines.push("");
        }
    }
    return lines.join("\n");
}

/** 代码块密集：n 个带语言的围栏代码块（触发 CodeMirror NodeView） */
function makeCodeDoc(blockCount: number): string {
    const lines: string[] = [];
    for (let i = 0; i < blockCount; i++) {
        lines.push(`## 代码示例 ${i}`);
        lines.push("```typescript");
        lines.push(`function calc${i}(input: number): number {`);
        lines.push(`  const result = input * ${i};`);
        lines.push("  return result;");
        lines.push("}");
        lines.push("```");
        lines.push("");
    }
    return lines.join("\n");
}

async function benchCreate(label: string, md: string): Promise<void> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const t0 = performance.now();
    const editor = await createEditor(root, md, () => { /* noop */ });
    const createMs = performance.now() - t0;
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    const domNodes = root.querySelectorAll("*").length;
    const docSize = view.state.doc.content.size;
    destroyEditor();
    root.remove();
    // eslint-disable-next-line no-console
    console.log(
        `[first-render] ${label}: create=${createMs.toFixed(1)}ms docSize=${docSize} domNodes=${domNodes}`
    );
}

describe("首次渲染基准（探针）", () => {
    it("不同规模与内容构成的 createEditor 耗时", async () => {
        await benchCreate("典型~500行", makeTypicalDoc(100));
        await benchCreate("典型~2500行", makeTypicalDoc(500));
        await benchCreate("典型~10000行", makeTypicalDoc(2000));
        await benchCreate("代码密集~900行", makeCodeDoc(100));
        await benchCreate("代码密集~4500行", makeCodeDoc(500));
    }, 300000);
});
