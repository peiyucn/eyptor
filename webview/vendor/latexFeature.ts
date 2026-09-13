/**
 * [vendor] Crepe LaTeX feature（@milkdown/crepe 7.22.1 · src/feature/latex/*）的本地化版本。
 *
 * 许可：MIT（© 2020-present Mirone，Milkdown / @milkdown/crepe 上游）；
 * 本文件是对上游代码的本地化改动，版权声明随上游保留。
 *
 * 上游对照（每节标注来源文件，升级上游时逐节 diff）：
 *   §inline-latex  ← src/feature/latex/inline-latex.ts
 *   §block-latex   ← src/feature/latex/block-latex.ts
 *   §command       ← src/feature/latex/command.ts
 *   §input-rule    ← src/feature/latex/input-rule.ts
 *   §remark        ← src/feature/latex/remark.ts
 *   §tooltip       ← src/feature/latex/inline-tooltip/{tooltip,view,component}.tsx
 *   §feature       ← src/feature/latex/index.ts
 *   §icons         ← src/icons/confirm.ts
 *
 * 与上游的差异（[epytor]）：
 *   1. KaTeX 惰性加载：上游 `import katex from 'katex'`（静态，480KB + 三格式字体 ~1.4MB
 *      全部压入首屏 webview.js/css）。本实现首次渲染数学内容时才动态加载 katex 与
 *      独立构建的 katex-styles.css；行内公式注册 NodeView（加载期间显示原始 TeX 源码
 *      占位，渲染完成后异步回填，带 token 防陈旧写回）。
 *   2. 块级公式预览走异步契约且由 editor.ts 的 renderPreview 统一接管：本文件导出
 *      renderLatexPreview（返回 undefined，katex 就绪后 applyPreview 回填）。上游是在
 *      feature 内 ctx.update(codeBlockConfig.key) 包装——本实现不 import codeBlockConfig，
 *      因为 pnpm 下 @milkdown/components 存在多个 peer 变体实例（根 kit 与 crepe 内部
 *      kit 解析到不同实例），其 SliceType symbol 分裂，跨上下文 update 会
 *      contextNotFound（实测探针）。FeaturesCtx 走字符串查找不受影响。
 *   3. 移除 keepAlive(h)（上游为防 TSX 编译树摇；本实现直接调用 h()，无需保留）。
 *
 * 为何不直接用上游 feature：`import { CrepeBuilder } from '@milkdown/crepe'` 的静态依赖
 * 链里有 `import katex from 'katex'`（crepe index 内联整份 latex feature），任何入口都会
 * 拉进 katex——见 esbuild.mjs 的 katex-stub-for-crepe 插件（把 crepe 模块的 katex 导入
 * 重定向到 katexLazyStub.ts；crepe 内联 latex 代码路径在 epytor 永不执行）。
 */
import type { Ctx } from "@milkdown/kit/ctx";
import type { Editor } from "@milkdown/kit/core";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { findNodeInSelection, nodeRule } from "@milkdown/kit/prose";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { PluginView } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import type { NodeView } from "@milkdown/kit/prose/view";
import { redo, undo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Schema } from "@milkdown/kit/prose/model";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $nodeSchema, $command, $inputRule, $remark } from "@milkdown/kit/utils";
import { tooltipFactory, TooltipProvider } from "@milkdown/kit/plugin/tooltip";
import { textblockTypeInputRule } from "@milkdown/kit/prose/inputrules";
import { defineComponent, h, shallowRef, createApp } from "vue";
import type { App, ShallowRef, VNodeRef } from "vue";
import { Icon } from "@milkdown/kit/component";
import { CrepeFeature } from "@milkdown/crepe";
import type { Node as UnistNode } from "@milkdown/kit/transformer";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import type { KatexOptions } from "katex";

// ─── §icons（上游 src/icons/confirm.ts）──────────────────────────────────────
export const confirmIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
  >
    <g clip-path="url(#clip0_1013_1606)">
      <path
        d="M9.00012 16.1998L5.50012 12.6998C5.11012 12.3098 4.49012 12.3098 4.10012 12.6998C3.71012 13.0898 3.71012 13.7098 4.10012 14.0998L8.29012 18.2898C8.68012 18.6798 9.31012 18.6798 9.70012 18.2898L20.3001 7.69982C20.6901 7.30982 20.6901 6.68982 20.3001 6.29982C19.9101 5.90982 19.2901 5.90982 18.9001 6.29982L9.00012 16.1998Z"
        fill="#817567"
      />
    </g>
    <defs>
      <clipPath id="clip0_1013_1606">
        <rect width="24" height="24" />
      </clipPath>
    </defs>
  </svg>
`;

// ─── [epytor] KaTeX 惰性加载 ─────────────────────────────────────────────────
// 上游：import katex from 'katex'（静态）。
// 本实现：首个数学内容渲染时才加载 katex 及其样式（字体随 katex.min.css 走惰性
// chunk）——首屏 webview.css 1.5MB → ~150KB、入口 JS -480KB 的关键。
let _katexPromise: Promise<typeof import("katex").default> | null = null;

/** KaTeX 样式注入（幂等）：样式由 esbuild 构建为独立入口 dist/katex-styles.css，
 * 运行时注入 <link>——与入口 JS/CSS 同源（import.meta.url 解析），CSP style-src
 * 的 cspSource 放行。首次数学渲染前零加载。 */
function loadKatexCss(): void {
    if (document.querySelector('link[data-epytor-katex]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.epytorKatex = "";
    link.href = new URL("./katex-styles.css", import.meta.url).href;
    document.head.appendChild(link);
}

function loadKatex(): Promise<typeof import("katex").default> {
    // 样式注入移出模块守卫：幂等（loadKatexCss 内部去重），每次渲染请求都保证
    // <link> 在位——回归：注入曾放在 if (!_katexPromise) 内，link 被移除后
    // （或异常场景）后续渲染请求不再注入，数学公式失去样式
    loadKatexCss();
    if (!_katexPromise) {
        _katexPromise = import("katex").then((mod) => mod.default);
    }
    return _katexPromise;
}

// ─── §inline-latex（上游 src/feature/latex/inline-latex.ts）──────────────────
export const mathInlineId = "math_inline";

/// Schema for inline math node.
/// Add support for:
///
/// ```markdown
/// $a^2 + b^2 = c^2$
/// ```
export const mathInlineSchema = $nodeSchema(mathInlineId, () => ({
    group: "inline",
    inline: true,
    draggable: true,
    atom: true,
    attrs: {
        value: {
            default: "",
        },
    },
    parseDOM: [
        {
            tag: `span[data-type="${mathInlineId}"]`,
            getAttrs: (dom) => {
                return {
                    value: (dom as HTMLElement).dataset.value ?? "",
                };
            },
        },
    ],
    // [epytor] 上游此处同步 katex.render；本实现返回原始 TeX 源码占位，
    // 渲染由 createMathInlineView（NodeView）在 katex 加载后异步完成。
    // toDOM 仍是剪贴板/序列化回退（数据属性与上游一致，保证 parse 往返）。
    toDOM: (node) => {
        const code: string = node.attrs.value;
        const dom = document.createElement("span");
        dom.dataset.type = mathInlineId;
        dom.dataset.value = code;
        dom.classList.add("epytor-math-inline--loading");
        dom.textContent = code;
        return dom;
    },
    parseMarkdown: {
        match: (node) => node.type === "inlineMath",
        runner: (state, node, type) => {
            state.addNode(type, { value: node.value as string });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === mathInlineId,
        runner: (state, node) => {
            state.addNode("inlineMath", undefined, node.attrs.value);
        },
    },
}));

/**
 * [epytor] 行内公式 NodeView：占位 → katex 就绪后异步渲染。
 * 每次值变化（update）或渲染请求都递增 token，晚到的旧渲染结果被丢弃（防陈旧写回）。
 */
export function createMathInlineView(node: ProseNode): NodeView {
    let current = node;
    const dom = document.createElement("span");
    dom.dataset.type = mathInlineId;
    dom.dataset.value = current.attrs.value as string;
    dom.classList.add("epytor-math-inline--loading");
    dom.textContent = current.attrs.value as string;

    let destroyed = false;
    let renderToken = 0;

    const render = () => {
        const code = current.attrs.value as string;
        const token = ++renderToken;
        void loadKatex()
            .then((katex) => {
                if (destroyed || token !== renderToken) return;
                dom.classList.remove("epytor-math-inline--loading");
                dom.textContent = "";
                try {
                    katex.render(code, dom, {
                        throwOnError: false,
                    });
                } catch {
                    // 渲染失败降级为源码展示（等价上游 throwOnError:false 的错误输出意图）
                    dom.textContent = code;
                }
            })
            .catch(() => { /* katex 加载失败：保持源码占位 */ });
    };

    void render();

    return {
        dom,
        update(next) {
            if (next.type.name !== mathInlineId) return false;
            if (next.attrs.value !== current.attrs.value) {
                current = next;
                dom.dataset.value = next.attrs.value as string;
                dom.classList.add("epytor-math-inline--loading");
                dom.textContent = next.attrs.value as string;
                render();
            }
            return true;
        },
        destroy() {
            destroyed = true;
        },
    };
}

// ─── §block-latex（上游 src/feature/latex/block-latex.ts，未改动）────────────
export const blockLatexSchema = codeBlockSchema.extendSchema((prev) => {
    return (ctx) => {
        const baseSchema = prev(ctx);
        return {
            ...baseSchema,
            toMarkdown: {
                match: baseSchema.toMarkdown.match,
                runner: (state, node) => {
                    const language = node.attrs.language ?? "";
                    if (language.toLowerCase() === "latex") {
                        state.addNode(
                            "math",
                            undefined,
                            node.content.firstChild?.text || ""
                        );
                    } else {
                        return baseSchema.toMarkdown.runner(state, node);
                    }
                },
            },
        };
    };
});

// ─── §command（上游 src/feature/latex/command.ts，未改动）────────────────────
export const toggleLatexCommandName = "ToggleLatex";

export const toggleLatexCommand = $command(toggleLatexCommandName, (ctx) => {
    return () => (state, dispatch) => {
        const {
            hasNode: hasLatex,
            pos: latexPos,
            target: latexNode,
        } = findNodeInSelection(state, mathInlineSchema.type(ctx));

        const { selection, doc, tr } = state;
        if (!hasLatex) {
            const text = doc.textBetween(selection.from, selection.to);
            let _tr = tr.replaceSelectionWith(
                mathInlineSchema.type(ctx).create({
                    value: text,
                })
            );
            if (dispatch) {
                dispatch(
                    _tr.setSelection(NodeSelection.create(_tr.doc, selection.from))
                );
            }
            return true;
        }

        const { from, to } = selection;
        if (!latexNode || latexPos < 0) return false;

        let _tr = tr.delete(latexPos, latexPos + 1);
        const content = (latexNode as ProseNode).attrs.value;
        _tr = _tr.insertText(content, latexPos);
        if (dispatch) {
            dispatch(
                _tr.setSelection(
                    TextSelection.create(_tr.doc, from, to + content.length - 1)
                )
            );
        }
        return true;
    };
});

// ─── §input-rule（上游 src/feature/latex/input-rule.ts，未改动）──────────────
/// Input rule for inline math.
/// When you type $E=MC^2$, it will create an inline math node.
export const mathInlineInputRule = $inputRule((ctx) =>
    nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
        getAttr: (match) => {
            return {
                value: match[1] ?? "",
            };
        },
    })
);

/// A input rule for creating block math.
/// For example, `$$ ` will create a code block with language LaTeX.
export const mathBlockInputRule = $inputRule((ctx) =>
    textblockTypeInputRule(/^\$\$[\s\n]$/, codeBlockSchema.type(ctx), () => ({
        language: "LaTeX",
    }))
);

// ─── §remark（上游 src/feature/latex/remark.ts，未改动）──────────────────────
export const remarkMathPlugin = $remark<"remarkMath", undefined>(
    "remarkMath",
    () => remarkMath
);

function visitMathBlock(ast: UnistNode) {
    return visit(
        ast,
        "math",
        (
            node: UnistNode & { value: string },
            index: number,
            parent: UnistNode & { children: UnistNode[] }
        ) => {
            const { value } = node as UnistNode & { value: string };
            const newNode = {
                type: "code",
                lang: "LaTeX",
                value,
            };
            parent.children.splice(index, 1, newNode);
        }
    );
}

/// Turn math block into code block with language LaTeX.
export const remarkMathBlockPlugin = $remark(
    "remarkMathBlock",
    () => () => visitMathBlock
);

// ─── §tooltip（上游 src/feature/latex/inline-tooltip/*，未改动逻辑）───────────
export const inlineLatexTooltip = tooltipFactory("INLINE_LATEX");

type LatexTooltipProps = {
    config: Partial<LatexConfig>;
    innerView: ShallowRef<EditorView | null>;
    updateValue: ShallowRef<() => void>;
};

const LatexTooltip = defineComponent<LatexTooltipProps>({
    props: {
        config: {
            type: Object,
            required: true,
        },
        innerView: {
            type: Object,
            required: true,
        },
        updateValue: {
            type: Object,
            required: true,
        },
    },
    setup(props) {
        const innerViewRef: VNodeRef = (el) => {
            if (!el || !(el instanceof HTMLElement)) return;
            while (el.firstChild) {
                el.removeChild(el.firstChild);
            }
            if (props.innerView.value) {
                el.appendChild(props.innerView.value.dom);
            }
        };
        const onUpdate = (e: Event) => {
            e.preventDefault();
            props.updateValue.value();
        };

        return () => {
            return h("div", { class: "container" }, [
                props.innerView.value ? h("div", { ref: innerViewRef }) : null,
                h("button", { type: "button", onPointerdown: onUpdate }, [
                    h(Icon, { icon: props.config.inlineEditConfirm }),
                ]),
            ]);
        };
    },
});

export class LatexInlineTooltip implements PluginView {
    #content: HTMLElement;
    #provider: TooltipProvider;
    #dom: HTMLElement;
    #innerView: ShallowRef<EditorView | null> = shallowRef(null);
    #updateValue: ShallowRef<() => void> = shallowRef(() => {});
    #app: App;

    constructor(
        readonly ctx: Ctx,
        view: EditorView,
        config: Partial<LatexConfig>
    ) {
        const content = document.createElement("div");
        content.className = "milkdown-latex-inline-edit";
        this.#content = content;
        this.#app = createApp(LatexTooltip, {
            config,
            innerView: this.#innerView,
            updateValue: this.#updateValue,
        });
        this.#app.mount(content);
        this.#provider = new TooltipProvider({
            debounce: 0,
            content: this.#content,
            shouldShow: this.#shouldShow,
            offset: 10,
            floatingUIOptions: {
                placement: "bottom",
            },
        });
        this.#provider.update(view);
        this.#dom = document.createElement("div");
    }

    #onHide = () => {
        if (this.#innerView.value) {
            this.#innerView.value.destroy();
            this.#innerView.value = null;
        }
    };

    #shouldShow = (view: EditorView) => {
        const shouldShow = () => {
            if (!view.editable) return false;

            const { selection, schema } = view.state;
            if (selection.empty) return false;
            if (!(selection instanceof NodeSelection)) return false;
            const node = selection.node;
            if (node.type.name !== mathInlineId) return false;

            const textFrom = selection.from;

            const paragraph = schema.nodes.paragraph!.create(
                null,
                schema.text(node.attrs.value)
            );

            const innerView = new EditorView(this.#dom, {
                state: EditorState.create({
                    doc: paragraph,
                    schema: new Schema({
                        nodes: {
                            doc: {
                                content: "block+",
                            },
                            paragraph: {
                                content: "inline*",
                                group: "block",
                                parseDOM: [{ tag: "p" }],
                                toDOM() {
                                    return ["p", 0];
                                },
                            },
                            text: {
                                group: "inline",
                            },
                        },
                    }),
                    plugins: [
                        keymap({
                            "Mod-z": undo,
                            "Mod-Z": redo,
                            "Mod-y": redo,
                            Enter: () => {
                                this.#updateValue.value();
                                return true;
                            },
                        }),
                    ],
                }),
            });

            this.#innerView.value = innerView;
            this.#updateValue.value = () => {
                const { tr } = view.state;
                tr.setNodeAttribute(textFrom, "value", innerView.state.doc.textContent);
                view.dispatch(tr);
                requestAnimationFrame(() => {
                    view.focus();
                });
            };
            return true;
        };

        const show = shouldShow();
        if (!show) this.#onHide();
        return show;
    };

    update = (view: EditorView, prevState?: EditorState) => {
        this.#provider.update(view, prevState);
    };

    destroy = () => {
        this.#app.unmount();
        this.#provider.destroy();
        this.#content.remove();
    };
}

// ─── §feature（上游 src/feature/latex/index.ts）──────────────────────────────
export interface LatexConfig {
    katexOptions: KatexOptions;
    inlineEditConfirm: string;
}

export type LatexFeatureConfig = Partial<LatexConfig>;

export type DefineFeature<Config> = (editor: Editor, config?: Config) => void;

/** katexOptions 由 latexFeature 的 config 注入、renderLatexPreview 读取（模块级单例，
 *  与 editor.ts 的 _serializationMode 同模式；无跨上下文符号问题） */
let _katexOptions: KatexOptions | undefined;

export const latexFeature: DefineFeature<LatexFeatureConfig> = (editor, config) => {
    _katexOptions = config?.katexOptions;
    editor
        .config((ctx) => {
            // 与上游 crepeFeatureConfig(CrepeFeature.Latex) 等价：置位 FeaturesCtx 标志，
            // 使官方 toolbar 的数学按钮按条件显示（本实现不再经过 crepe 内部 latex 路径）。
            // FeaturesCtx 走字符串查找（Container.get 按 name 匹配），跨 kit 变体安全。
            const features = ctx.use<CrepeFeature[], "FeaturesCtx">("FeaturesCtx");
            features.update((flags) => {
                if (flags.includes(CrepeFeature.Latex)) {
                    return flags;
                }
                return [...flags, CrepeFeature.Latex];
            });
        })
        .config((ctx) => {
            const flags = ctx.use<CrepeFeature[], "FeaturesCtx">("FeaturesCtx").get();
            const isCodeMirrorEnabled = flags.includes(CrepeFeature.CodeMirror);
            if (!isCodeMirrorEnabled) {
                throw new Error("You need to enable CodeMirror to use LaTeX feature");
            }

            ctx.set(inlineLatexTooltip.key, {
                view: (view) => {
                    return new LatexInlineTooltip(ctx, view, {
                        inlineEditConfirm: config?.inlineEditConfirm ?? confirmIcon,
                        ...config,
                    });
                },
            });
        })
        .use(remarkMathPlugin)
        .use(remarkMathBlockPlugin)
        .use(mathInlineSchema)
        .use(inlineLatexTooltip)
        .use(mathInlineInputRule)
        .use(mathBlockInputRule)
        .use(blockLatexSchema)
        .use(toggleLatexCommand);
};

/**
 * [epytor] 块级公式（LaTeX 代码块）预览：异步契约——返回 undefined，
 * katex 就绪后 applyPreview 回填。由 editor.ts 的 renderPreview 统一调用
 * （上游是在 feature 内包装 codeBlockConfig.renderPreview，本实现因 pnpm
 * peer 变体符号分裂不 import codeBlockConfig，见文件头注释）。
 * 组件侧契约（@milkdown/components code-block）：返回 undefined → 显示
 * previewLoading 占位，applyPreview 调用后替换（与 mermaid 预览同路径）。
 */
export function renderLatexPreview(
    content: string,
    applyPreview: (value: null | string | HTMLElement) => void
): undefined {
    void loadKatex()
        .then((katex) => {
            const html = katex.renderToString(content, {
                ..._katexOptions,
                throwOnError: false,
                displayMode: true,
            });
            applyPreview(html);
        })
        .catch((err) => {
            console.warn("[epytor][latex] 预览渲染失败:", err);
        });
    return undefined;
}
