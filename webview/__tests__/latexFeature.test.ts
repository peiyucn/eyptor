/**
 * 惰性 KaTeX latex feature（vendor/latexFeature.ts）回归测试：
 * 数学解析/序列化往返/命令切换，以及 katex 模块加载未决时的源码占位、
 * 就绪后按 token 收敛只渲染最新值的 NodeView 行为。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, destroyEditor } from "../editor";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

const h = vi.hoisted(() => {
    let resolveKatexModule!: () => void;
    const katexModuleGate = new Promise<void>((resolve) => {
        resolveKatexModule = resolve;
    });
    const katexRender = vi.fn();
    return { katexModuleGate, resolveKatexModule, katexRender };
});

// katex 模块求值挂起（模拟 chunk 网络加载中），由测试显式放行——
// 与真实惰性加载一致：loadKatex() 未决期间渲染请求排队，就绪后按 token 收敛。
vi.mock("katex", async () => {
    await h.katexModuleGate;
    return {
        default: {
            render: (...args: unknown[]) => {
                h.katexRender(...args);
                // 模拟同步渲染写 DOM（真实 katex.render 为同步）
                const dom = args[1] as HTMLElement;
                dom.innerHTML = `<i class="katex-render">K:${String(args[0])}</i>`;
            },
            renderToString: () => "<i class=\"katex-render\">K:html</i>",
        },
    };
});

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

async function makeEditor(md: string): Promise<{ editor: Editor; root: HTMLElement }> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = await createEditor(root, md, () => {});
    return { editor, root };
}

function getView(editor: Editor): EditorView {
    let view: EditorView | null = null;
    editor.action((ctx) => {
        view = ctx.get(editorViewCtx);
    });
    return view!;
}

function findMathPos(editor: Editor): number {
    let pos = -1;
    editor.action((ctx) => {
        const doc = ctx.get(editorViewCtx).state.doc;
        doc.descendants((node, p) => {
            if (node.type.name === "math_inline") pos = p;
        });
    });
    return pos;
}

afterEach(() => {
    destroyEditor();
    document.body.innerHTML = "";
    document.head.querySelectorAll("link[data-epytor-katex]").forEach((el) => el.remove());
    vi.clearAllMocks();
});

describe("惰性 KaTeX latex feature", () => {
    it("$x^2$ 应该 解析为 math_inline 节点且序列化往返保留", async () => {
        const { editor, root } = await makeEditor("前文 $x^2$ 后文");
        const span = root.querySelector<HTMLElement>('span[data-type="math_inline"]');
        expect(span).not.toBeNull();
        expect(span!.dataset.value).toBe("x^2");

        const markdown = editor.action(getMarkdown());
        expect(markdown).toContain("$x^2$");
    }, 20000);

    it("$$块公式$$ 应该 解析为 LaTeX 代码块并序列化往返保留", async () => {
        const { editor } = await makeEditor("$$\na + b\n$$");
        let lang = "";
        editor.action((ctx) => {
            const doc = ctx.get(editorViewCtx).state.doc;
            doc.descendants((node) => {
                if (node.type.name === "code_block" && node.attrs.language) {
                    lang = node.attrs.language as string;
                }
            });
        });
        expect(lang.toLowerCase()).toBe("latex");

        const markdown = editor.action(getMarkdown());
        expect(markdown).toContain("a + b");
        expect(markdown).toContain("$$");
    }, 20000);

    it("ToggleLatex 命令 应该 选中文本转公式、再次执行还原文本", async () => {
        const { editor } = await makeEditor("hello world");
        const view = getView(editor);
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));

        editor.action((ctx) => {
            ctx.get(commandsCtx).call("ToggleLatex");
        });

        let mathCount = 0;
        let mathValue = "";
        editor.action((ctx) => {
            const doc = ctx.get(editorViewCtx).state.doc;
            doc.descendants((node) => {
                if (node.type.name === "math_inline") {
                    mathCount++;
                    mathValue = node.attrs.value as string;
                }
            });
        });
        expect(mathCount).toBe(1);
        expect(mathValue).toBe("hello");

        // 命令已把选区设为该节点（NodeSelection），再次执行还原文本
        editor.action((ctx) => {
            ctx.get(commandsCtx).call("ToggleLatex");
        });
        const markdown = editor.action(getMarkdown());
        expect(markdown).toContain("hello");
        expect(markdown).not.toContain("$hello$");
    }, 20000);

    it("katex 加载未决时 应该 显示源码占位，就绪后仅按最新值渲染一次", async () => {
        const { editor, root } = await makeEditor("$a$");
        const span = root.querySelector<HTMLElement>('span[data-type="math_inline"]');
        expect(span).not.toBeNull();

        // 未就绪：占位样式 + 源码文本；样式 <link> 已注入（幂等，先于模块求值）
        expect(span!.classList.contains("epytor-math-inline--loading")).toBe(true);
        expect(span!.textContent).toBe("a");
        expect(document.head.querySelectorAll("link[data-epytor-katex]")).toHaveLength(1);

        // katex 仍未就绪时值变化：第二次渲染请求排队，占位跟随新值
        const view = getView(editor);
        const pos = findMathPos(editor);
        expect(pos).toBeGreaterThan(0);
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: "b" }));
        expect(span!.textContent).toBe("b");

        // 放行 katex 模块：两次渲染请求收敛为一次、只渲染最新值 b
        h.resolveKatexModule();
        await vi.waitFor(() => expect(h.katexRender).toHaveBeenCalledTimes(1));
        expect(h.katexRender).toHaveBeenCalledWith(
            "b",
            span,
            expect.objectContaining({ throwOnError: false })
        );
        expect(span!.innerHTML).toContain("K:b");
        expect(span!.classList.contains("epytor-math-inline--loading")).toBe(false);
    }, 20000);

    it("编辑器重建 应该 不重复注入 KaTeX 样式 link（幂等）", async () => {
        await makeEditor("$a$");
        h.resolveKatexModule();
        await vi.waitFor(() => expect(h.katexRender).toHaveBeenCalledTimes(1));

        // 重建编辑器（revert 场景）：再次触发加载路径
        const second = await makeEditor("$b$");
        void second;
        expect(document.head.querySelectorAll("link[data-epytor-katex]")).toHaveLength(1);
    }, 20000);
});
