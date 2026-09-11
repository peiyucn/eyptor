import {
    commandsCtx,
    defaultValueCtx,
    Editor,
    editorViewCtx,
    nodeViewCtx,
    rootCtx,
    schemaCtx,
} from "@milkdown/kit/core";
import {
    toggleStrongCommand,
    toggleEmphasisCommand,
    toggleInlineCodeCommand,
    listItemSchema,
    inlineCodeSchema,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { keymap } from "@milkdown/kit/prose/keymap";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { CellSelection } from "@milkdown/kit/prose/tables";
import { $prose, getMarkdown } from "@milkdown/kit/utils";
import { CrepeBuilder } from "@milkdown/crepe";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";

// ─── Crepe 原生功能 ──────────────────────────────────────────────────────────
// 以下 feature 由 @milkdown/crepe 官方维护，替换我们的自定义实现：
//   feature/table       → 替换 addButtons + handles + toolbar（1,562 行）
//   feature/code-mirror → 替换 codeBlock NodeView + Prism（1,909 行）
//   feature/toolbar     → 选中文字浮动工具栏（启用）
//   feature/latex       → 全新：KaTeX 数学公式支持
// feature/code-mirror → 换回自定义实现（复制反馈、全屏、样式更精致）
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { createVirtualCursor } from "./vendor/prosemirrorVirtualCursor";
// LaTeX feature 用本地惰性 KaTeX 实现（上游静态 import katex 会压入口 480KB，
// 见 vendor/latexFeature.ts 头部注释与 esbuild.mjs katex-stub-for-crepe）
import { latexFeature, createMathInlineView, renderLatexPreview } from "./vendor/latexFeature";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { table } from "@milkdown/crepe/feature/table";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import { buildTopBarConfig } from "./components/topBar/buildTopBar";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { Compartment } from "@codemirror/state";
import { EditorView as CMEditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting, LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages as allCodeLanguages } from "@codemirror/language-data";
import { onThemeChange, isDarkTheme } from "./utils/themeBus";
import { changeRangeInFinalDoc, normalizeListSpread } from "./utils/listSpread";
import { observeCmEditorCount } from "./utils/cmThemeObserver";
import { getUserInteractionEpoch } from "./utils/userInteraction";
import { t } from "./i18n";
import { enhanceMermaidPreview } from "./components/mermaidZoom";
import { headingFoldPlugin } from "./headingFoldPlugin";
import { headingStickyPlugin } from "./headingStickyPlugin";
import { softBreakKeymap } from "./softBreakKeymap";
import { applyMinimalChanges } from "./utils/minimalDiff";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import {
    cleanTextHandler,
    serializeCleanMarkdown,
    withTableBreakHandler,
    type SerializationMode,
} from "./utils/markdownSerializer";

// 只保留常用语言（143 → ~40）
const WANTED_LANGS = new Set([
    "bash", "sh", "c", "cpp", "c++", "csharp", "c#", "css", "go", "html",
    "java", "javascript", "js", "json", "kotlin", "latex", "less", "lua",
    "markdown", "md", "mermaid", "php", "python", "py", "ruby", "rust",
    "sass", "scss", "sql", "swift", "toml", "typescript", "ts", "xml", "yaml", "yml",
]);
const codeLanguages = allCodeLanguages.filter(
    (l: { alias: readonly string[] }) => l.alias.some((a) => WANTED_LANGS.has(a))
);
// Mermaid 不在 @codemirror/language-data 中，手动添加（仅标签，无语法高亮）
codeLanguages.unshift(LanguageDescription.of({
    name: "Text",
    alias: ["text", "plaintext", "txt"],
    extensions: ["txt"],
    load: async () => undefined as unknown as LanguageSupport,
}));
codeLanguages.push(LanguageDescription.of({
    name: "Mermaid",
    alias: ["mermaid"],
    extensions: ["mmd"],
    load: async () => undefined as unknown as LanguageSupport,
}));
// feature/toolbar 暂不启用（与自定义工具栏冲突）

// ─── 保留的自定义插件 ────────────────────────────────────────────────────────
// 以下插件 Crepe 不提供对应功能，永久保留：
//   listSpreadNormalizePlugin → 列表 spread 规范化
//   formatKeymapPlugin       → 自定义格式化快捷键
// 说明：列表 Backspace 不再自定义拦截（原 listLiftPlugin 已移除）——
// 官方 commonmark 默认行为：行首 Backspace = joinBackward（合并/删除行，编号自动重排），
// Shift-Tab = liftListItem（提升层级），与手测反馈一致。

// 格式化快捷键：Mod-b 粗体、Mod-i 斜体、Mod-Shift-x 删除线、Mod-e 行内代码
const formatKeymapPlugin = $prose((ctx) =>
    keymap({
        "Mod-b": () => {
            ctx.get(commandsCtx).call(toggleStrongCommand.key);
            return true;
        },
        "Mod-i": () => {
            ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
            return true;
        },
        "Mod-Shift-x": () => {
            ctx.get(commandsCtx).call(toggleStrikethroughCommand.key);
            return true;
        },
        "Mod-e": () => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            if (!state.selection.empty) {
                ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
                return true;
            }
            const codeMark = state.schema.marks["inlineCode"];
            if (!codeMark) return true;
            const { from } = state.selection;
            const textNode = state.schema.text("​", [codeMark.create()]);
            const tr = state.tr.insert(from, textNode);
            tr.setSelection(TextSelection.create(tr.doc, from + 1));
            view.dispatch(tr);
            return true;
        },
    }),
);

// 列表 spread 规范化：编辑后若列表项只含单个块级子节点，自动将 spread 重置为 false。
// 区间换算与规范化本体在 utils/listSpread.ts（纯逻辑，可直测边界）。
const listSpreadNormalizePlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return new Plugin({
        appendTransaction(transactions, _oldState, newState) {
            const range = changeRangeInFinalDoc(transactions, newState.doc.content.size);
            if (!range) { return null; }
            const tr = newState.tr;
            return normalizeListSpread(newState.doc, schema, tr, range) ? tr : null;
        },
    });
});

// ─── 表格单元格点击修正 ──────────────────────────────────────────────────────

/** 跨格拖选结束后清掉「上次整格选区」的延迟：等后续 click 事件走完再判定是否为新建选区 */
const CELL_SELECTION_CLEAR_DELAY_MS = 200;

const cellClickFixPlugin = $prose(() => {
    let pendingClickPos: number | null = null;
    let cellClickTarget: number | null = null; // 表格单击位置，不受 mouseup 清理影响
    let clickIsPlain = true;
    let wasCrossCell = false;
    let lastGoodCellSelection: CellSelection | null = null;
    let multiSelectCount = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let capturedView: EditorView | null = null;

    return new Plugin({
        view(editorView) {
            capturedView = editorView;
            return { destroy() { capturedView = null; } };
        },
        props: {
            handleDOMEvents: {
                mousedown: (view, event) => {
                    if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey) {
                        pendingClickPos = null;
                        return false;
                    }
                    const cell = (event.target as Element).closest("td, th");
                    if (!cell) { pendingClickPos = null; return false; }
                    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                    pendingClickPos = pos ? pos.pos : null;
                    cellClickTarget = pos ? pos.pos : null;
                    clickIsPlain = true;
                    wasCrossCell = false;
                    lastGoodCellSelection = null;
                    lastMouseX = event.clientX;
                    lastMouseY = event.clientY;

                    const onMove = (mv: MouseEvent) => {
                        lastMouseX = mv.clientX;
                        lastMouseY = mv.clientY;
                        if (Math.abs(mv.clientX - event.clientX) + Math.abs(mv.clientY - event.clientY) > 4) clickIsPlain = false;
                    };
                    document.addEventListener("mousemove", onMove, true);

                    const cleanup = () => {
                        document.removeEventListener("mouseup", cleanup, true);
                        document.removeEventListener("mousemove", onMove, true);
                        if (wasCrossCell) {
                            pendingClickPos = null;
                            clickIsPlain = true;
                            wasCrossCell = false;
                            const savedCellSel = lastGoodCellSelection;
                            setTimeout(() => { if (lastGoodCellSelection === savedCellSel) lastGoodCellSelection = null; }, CELL_SELECTION_CLEAR_DELAY_MS);
                        } else {
                            Promise.resolve().then(() => { pendingClickPos = null; clickIsPlain = true; });
                        }
                    };
                    document.addEventListener("mouseup", cleanup, true);
                    return false;
                },
            },
        },
        filterTransaction(tr, state) {
            // 原生表格单击→NodeSelection（单元格内段落）→拦截并转为光标定位
            if (tr.selection instanceof NodeSelection) {
                try {
                    const $pos = state.doc.resolve(Math.min(tr.selection.from, state.doc.content.size));
                    for (let d = $pos.depth; d >= 0; d--) {
                        const t = $pos.node(d).type.name;
                        if (t === "table_cell" || t === "table_header") {
                            // 在 Crepe rAF 内被拦截；再套一层 rAF 补 TextSelection
                            const clickPos = cellClickTarget;
                            cellClickTarget = null;
                            requestAnimationFrame(() => {
                                const v = capturedView;
                                if (!v) return;
                                const sel = v.state.selection;
                                if (sel instanceof TextSelection && sel.from === sel.to) return; // 已有光标
                                try {
                                    const p = Math.min(clickPos ?? tr.selection.from, v.state.doc.content.size);
                                    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(p))));
                                } catch { /* cellClickTarget 位置无效，不修正选区 */ }
                            });
                            return false;
                        }
                    }
                } catch { /* 非表格节点内的 $pos 遍历，忽略 */ }
            }
            if (!lastGoodCellSelection) return true;
            if (state.selection instanceof CellSelection && !(tr.selection instanceof CellSelection)) {
                return false;
            }
            return true;
        },
        appendTransaction(_trs, _oldState, newState) {
            if (pendingClickPos === null) return null;
            const sel = newState.selection;
            const $pos = newState.doc.resolve(Math.min(pendingClickPos, newState.doc.content.size));

            // 单格 CellSelection → 转 TextSelection
            if (sel instanceof CellSelection) {
                if (sel.isRowSelection() || sel.isColSelection()) return null;
                if (sel.$anchorCell.pos !== sel.$headCell.pos) {
                    wasCrossCell = true;
                    lastGoodCellSelection = sel;
                    return null;
                }
                try {
                    if (!clickIsPlain && capturedView) {
                        const toCoords = capturedView.posAtCoords({ left: lastMouseX, top: lastMouseY });
                        if (toCoords) {
                            const headP = Math.min(toCoords.pos, newState.doc.content.size);
                            try {
                                const $a = newState.doc.resolve(Math.min(pendingClickPos, newState.doc.content.size));
                                const $h = newState.doc.resolve(headP);
                                let aCellStart = -1, hCellStart = -1;
                                for (let d = $a.depth; d >= 0; d--) { if ($a.node(d).type.name === "table_cell" || $a.node(d).type.name === "table_header") { aCellStart = $a.start(d); break; } }
                                for (let d = $h.depth; d >= 0; d--) { if ($h.node(d).type.name === "table_cell" || $h.node(d).type.name === "table_header") { hCellStart = $h.start(d); break; } }
                                if (aCellStart !== hCellStart) return null;
                            } catch { /* 单元格边界检测失败（文档结构变化），回退为单格光标 */ }
                            return newState.tr.setSelection(TextSelection.create(newState.doc, headP, Math.min(pendingClickPos, newState.doc.content.size)));
                        }
                    }
                    return newState.tr.setSelection(TextSelection.near($pos));
                } catch { /* pos 无效（如节点刚被删除），不修正选区 */ return null; }
            }

            return null;
        },
    });
});

// ─── 自定义视图组件 ─────────────────────────────────────────

import { createImageView } from "./components/imageView";

// ─── 编辑器实例管理 ──────────────────────────────────────────────────────────

let _editor: Editor | null = null;
let _savedMarkdown = '';
/** CodeMirror 主题补配观察器断开函数（编辑器重建时先断开旧的） */
let _disconnectCmObserver: (() => void) | null = null;
/** 主题订阅退订句柄（createEditor 订阅、destroyEditor 退订）——
 * 回归：退订函数曾被丢弃，init/revert 每次重建向 themeBus 泄漏一个监听器，
 * 闭包持有整篇旧文档的 mermaidCodeMap 且主题切换时重放全部旧回调 */
let _unsubscribeTheme: (() => void) | null = null;
let _serializationMode: SerializationMode = "clean";

export function setSerializationMode(mode: SerializationMode): void {
    _serializationMode = mode;
}

/** 当前序列化模式（回归测试观测口：init/revert 重建不得重置运行期配置） */
export function getSerializationMode(): SerializationMode {
    return _serializationMode;
}

function prepareMarkdownForSave(source: string, serialized: string): string {
    if (_serializationMode === "compatible") return applyMinimalChanges(source, serialized);
    try {
        return applyMinimalChanges(source, serializeCleanMarkdown(source, serialized));
    } catch (error) {
        // 错误日志保留（与调试开关无关）：clean 序列化器异常时回退 compatible 输出，
        // 静默回退会掩盖序列化器缺陷
        console.warn("[markdown-serialization] Clean serializer failed; using compatible output", { error });
        return applyMinimalChanges(source, serialized);
    }
}

export function getEditorView(): EditorView | null {
    if (!_editor) return null;
    return _editor.action((ctx) => ctx.get(editorViewCtx));
}

/**
 * 销毁当前编辑器并清理其侧效应（主题订阅、CodeMirror 观察器、模块引用）；幂等。
 * revert/重建前由宿主调用（替代直接 _editor.destroy()）。
 */
export function destroyEditor(): void {
    _unsubscribeTheme?.();
    _unsubscribeTheme = null;
    _disconnectCmObserver?.();
    _disconnectCmObserver = null;
    _editor?.destroy();
    _editor = null;
}

/**
 * 保存时拉取序列化（拉取式架构的序列化唯一入口）：
 * Extension 在自动保存防抖到点 / Cmd+S 时 requestContent，webview 在此序列化一次
 * （含 clean 模式处理 + minimalDiff 保留未改行原文）并回传。输入期间零序列化。
 */
export function getMarkdownForSave(): string {
    if (!_editor) return _savedMarkdown;
    const serialized = _editor.action(getMarkdown());
    const toSave = prepareMarkdownForSave(_savedMarkdown, serialized);
    _savedMarkdown = toSave;
    return toSave;
}

export async function createEditor(
    container: HTMLElement,
    initialMarkdown: string,
    onDocumentChanged: () => void,
    onRenameImage?: (webviewUri: string, newBasename: string) => Promise<void>,
    onTocToggle?: () => void,
): Promise<Editor> {
    // 回归（F1）：不再在此重置序列化模式——init 与 revert 都走 createEditor，
    // 用启动快照重置会把用户中途改的配置静默回滚（外部写盘触发 revert 即复现）。
    // 运行期配置统一由 init 消息载荷与 setSerializationMode 消息维护。
    // 用户交互纪元快照（回归 F4：与 index.ts 的延迟滚动共用同一跟踪器）
    const interactionEpochAtCreate = getUserInteractionEpoch();

    let isSettled = false;

    // 文档变更轻量通知（不含序列化）。
    // 架构调整：序列化从「每键推送」（listener markdownUpdated 每键全量序列化，
    // 1 万行基准 52-99ms 尖峰）改为「保存时拉取」——Extension 在自动保存防抖到点
    // 或 Cmd+S 时发 requestContent，webview 才序列化一次回传。输入期间零序列化。
    // 仅 doc 变化才通知（回归：光标移动/选区变化也是 dispatch，曾误发脏标记，
    // 未编辑也出现 ● 圆点）
    let prevDoc: ProseNode | null = null;
    const updateNotifyPlugin = $prose(() =>
        new Plugin({
            view() {
                return {
                    update(view) {
                        if (!isSettled) return;
                        if (getUserInteractionEpoch() === interactionEpochAtCreate) return;
                        const doc = view.state.doc;
                        if (prevDoc !== null && doc.eq(prevDoc)) return;
                        prevDoc = doc;
                        onDocumentChanged();
                    },
                };
            },
        }),
    );

    // ── CrepeBuilder ──────────────────────────────────────────────────────────
    const crepe = new CrepeBuilder({
        root: container,
        defaultValue: initialMarkdown,
    });

    // Phase 3: 启用 Crepe 原生功能（替换自定义实现 + 新增能力）
    // ── 主题切换总线 ────────────────────────────────────────
    // 初始主题取主题总线当前值（回归：此前硬编码 isDark=true 但传给 CodeMirror 的
    // 初始 extension 是亮色，靠下方的观察器兜底修正）
    let isDark = isDarkTheme();
    const cmTheme = new Compartment();
    // 主题 extension 缓存：每次调用新建对象会让 Compartment.reconfigure 全量重算
    // 并触发 CM 重渲染（放大下方观察器的回环）
    const CM_THEME_EXT = { dark: oneDark, light: syntaxHighlighting(defaultHighlightStyle) };
    const getCMTheme = (dark: boolean) => (dark ? CM_THEME_EXT.dark : CM_THEME_EXT.light);

    const reconfigureAllCM = () => {
        document.querySelectorAll(".cm-editor").forEach((el) => {
            const v = CMEditorView.findFromDOM(el as HTMLElement);
            if (v) v.dispatch({ effects: cmTheme.reconfigure(getCMTheme(isDark)) });
        });
    };

    // 新 CodeMirror 编辑器补配主题：只在 .cm-editor 数量变化时触发（回环防护见
    // utils/cmThemeObserver.ts 注释——此前任何 DOM 变更都排一次重配，重配自身又
    // 产生 DOM 变更，形成 10ms 一次的无限回环）
    _disconnectCmObserver?.();
    _disconnectCmObserver = observeCmEditorCount(container, reconfigureAllCM);

    // 主题切换：CodeMirror + Mermaid 全部统一处理
    const mermaidCodeMap = new Map<string, string>();
    let mermaidSeq = 0;

    // ── Mermaid 惰性加载 ────────────────────────────────────────────────
    // 首帧性能：mermaid 系（core + parser + cytoscape + 各 diagram）是 webview 包
    // 最大单一依赖，静态 import 会把 ~1.3MB（压缩口径）压进入口。改为首个 mermaid
    // 代码块渲染时才加载；主题切换在未加载时只记录目标主题，加载时统一初始化。
    let _mermaidModule: typeof import("mermaid").default | null = null;
    let _mermaidThemeInitializedFor: boolean | null = null;
    async function loadMermaid(): Promise<typeof import("mermaid").default> {
        if (!_mermaidModule) {
            const mod = await import("mermaid");
            _mermaidModule = mod.default;
        }
        if (_mermaidThemeInitializedFor !== isDark) {
            _mermaidModule.initialize({ startOnLoad: false, theme: isDark ? "dark" : "default" });
            _mermaidThemeInitializedFor = isDark;
        }
        return _mermaidModule;
    }

    const renderMermaid = async (code: string): Promise<string> => {
        const id = "mermaid-" + Math.random().toString(36).slice(2, 8);
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, code);
        return svg;
    };

    _unsubscribeTheme = onThemeChange((dark) => {
        isDark = dark;
        // 重绘已有 mermaid 预览（仅 mermaid 已加载时——未加载说明尚无预览可重绘，
        // 主题偏好由 loadMermaid 在首次渲染时套用）
        if (_mermaidModule) {
            _mermaidModule.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
            _mermaidThemeInitializedFor = dark;
            mermaidCodeMap.forEach((code, key) => {
                const el = document.querySelector<HTMLElement>(`[data-mermaid-key="${key}"]`);
                if (el) renderMermaid(code).then((svg) => {
                    el.innerHTML = svg;
                    const svgEl = el.querySelector<SVGElement>("svg");
                    if (svgEl) enhanceMermaidPreview(el, svgEl);
                }).catch(() => { /* 单图渲染失败不影响其他图与主题切换（错误图保持旧内容） */ });
            });
        }
        // 重配 CodeMirror
        reconfigureAllCM();
    });

    // Mermaid 预览渲染
    const renderPreview = (lang: string, code: string, apply: (v: null | string | HTMLElement) => void) => {
        // LaTeX 代码块预览：vendor/latexFeature 的惰性 KaTeX 异步渲染
        // （vendor 不 import codeBlockConfig——pnpm peer 变体下其 SliceType 符号分裂，
        // 跨上下文 update 会 contextNotFound；统一走本文件的 renderPreview）
        if (lang.toLowerCase() === "latex" && code.length > 0) {
            renderLatexPreview(code, apply);
            return null;
        }
        if (lang.toLowerCase() !== "mermaid") return null;
        const key = `m-${++mermaidSeq}`;
        mermaidCodeMap.set(key, code);
        apply(`<div data-mermaid-key="${key}"></div>`);
        const el = () => document.querySelector<HTMLElement>(`[data-mermaid-key="${key}"]`);
        renderMermaid(code).then((svg) => {
            const e = el();
            if (!e) return;
            e.innerHTML = svg;
            const svgEl = e.querySelector<SVGElement>("svg");
            if (svgEl) enhanceMermaidPreview(e, svgEl);
        }).catch((err) => {
            console.warn('[mermaid] render failed:', err);
            const e = el();
            if (e) e.innerHTML = `<span style="color:var(--vscode-errorForeground)">Mermaid: ${err}</span>`;
        });
    };

    crepe
        .addFeature(codeMirror, {
            languages: codeLanguages,
            theme: cmTheme.of(getCMTheme(isDark)),
            renderPreview,
            searchPlaceholder: t('Search language...'),
        })
        .addFeature(listItem)
        .addFeature(topBar, {
            headingOptions: [
                { label: 'P', level: null },
                { label: 'H1', level: 1 },
                { label: 'H2', level: 2 },
                { label: 'H3', level: 3 },
                { label: 'H4', level: 4 },
                { label: 'H5', level: 5 },
                { label: 'H6', level: 6 },
            ],
            buildTopBar: (builder) => buildTopBarConfig(builder, onTocToggle),
        })
        .addFeature(toolbar)
        .addFeature(table)
        .addFeature(latexFeature)   // 本地惰性 KaTeX 实现（替代上游 latex）
        .addFeature(linkTooltip)
    // 已启用：feature/toolbar → 选中文字浮动工具栏

    // 恢复行内代码 mark 的 inclusive：7.22.1（#2451）改为 false，块尾输入即退出
    // 代码 span——epytor 的 ./ @/ 路径补全依赖在行内代码尾部继续编辑，
    // 恢复 7.22.0 行为（退出用方向键/点击明确操作）
    crepe.editor.use(
        inlineCodeSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), inclusive: true })),
    );

    // 光标插件独立注册：官方 cursor 插件（drop indicator）+ 默认行为虚拟光标。
    // 回归：Crepe cursor feature 的 createVirtualCursor 带 skipWarning:['inlineCode']
    // （7.22.1 为 inclusive:false 设计）；epytor 恢复 inclusive:true 后仍跳过警告，
    // 导致行内代码边界的方向指示消失、方向键无法退出——自注册默认行为（7.22.0 一致）
    crepe.editor.use(cursor);
    crepe.editor.use($prose(() => createVirtualCursor()));

    // 撤销粒度：每次输入一步（默认 500ms 合并窗会把连续输入并成一次撤销，
    // 用户无法预知一次 Ctrl+Z 撤掉多少）。IME 组合内部仍按组合 ID 合并——
    // 一段候选提交 = 一步，不会撤到拼音中间态；新一段候选（组合 ID 变化）
    // 与前一次输入各自成步，撤销不会连带撤掉上一步。
    crepe.editor.use($prose(() => {
        let prevComposition: unknown = null;
        return new Plugin({
            filterTransaction(tr) {
                if (!tr.docChanged) { return true; }
                const composition = tr.getMeta("composition") ?? null;
                if (composition === null || composition !== prevComposition) { closeHistory(tr); }
                prevComposition = composition;
                return true;
            },
        });
    }));

    // 注入保留的自定义配置
    crepe.editor
        .config((ctx) => {
            _savedMarkdown = initialMarkdown;

            // 表格单元格内 Shift+Enter 软换行由 softBreakKeymap 负责（见其文件头：
            // 上游命令在行尾已有 hardbreak 时会「转段落」，表格内反直觉，故不采用）。
            // 代码块内的 Shift+Enter 仍走上游默认（softBreakKeymap 返回 false 放行）。

            // Milkdown 的默认 text handler 会对普通文本中的 `_`、`*`、`[`
            // 过度转义。保留其上下文安全规则，只在 Clean 模式放宽已知误报。
            ctx.update(remarkStringifyOptionsCtx, (options) => {
                const compatibleTextHandler = options.handlers?.text;
                if (!compatibleTextHandler) return options;
                // 表格单元格内换行：mdast 默认 handler 在表格上下文退化为空格，
                // 覆盖为 GFM 标准 <br>（两种序列化模式均生效，见 withTableBreakHandler）
                return withTableBreakHandler({
                    ...options,
                    handlers: {
                        ...options.handlers,
                        text: (node, parent, state, info) => {
                            if (_serializationMode === "compatible") {
                                return compatibleTextHandler(node, parent, state, info);
                            }
                            return cleanTextHandler(node, parent, state, info);
                        },
                    },
                });
            });

            // 注册自定义 image / 行内公式 NodeView（行内公式为惰性 KaTeX：
            // 占位展示源码，katex 就绪后异步渲染，见 vendor/latexFeature.ts）
            ctx.set(nodeViewCtx, [
                [
                    "image",
                    (node, view, getPos) =>
                        createImageView(node, view, getPos, undefined, undefined, onRenameImage),
                ],
                [
                    "math_inline",
                    (node) => createMathInlineView(node),
                ],
            ]);

        })
        .use(updateNotifyPlugin)    // 文档变更轻量通知（保存时拉取序列化，输入期间零序列化）
        .use(formatKeymapPlugin)    // 保留：自定义格式化快捷键
        .use(headingFoldPlugin)     // 标题折叠（Decoration，不修改文档）
        .use(headingStickyPlugin)   // 标题吸顶条（滚动跟随 + 推挤过渡）
        .use(softBreakKeymap)       // Shift+Enter 软换行（表格内允许；见文件头回归说明）
        .use(cellClickFixPlugin)    // 表格单击→光标定位，拖拽→多选
        .use(listSpreadNormalizePlugin); // 保留：列表 spread 规范化

    _editor = await crepe.create();
    isSettled = true;
    // 首帧基准：settle 后用户首个交互事务（点击定位光标等纯选区 dispatch）与基准
    // doc 相同即不通知（回归：prevDoc=null 使首事务无条件误发脏标记，未编辑就出 ● 圆点）
    prevDoc = _editor.action((ctx) => ctx.get(editorViewCtx)).state.doc;
    return _editor;
}
