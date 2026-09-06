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
    wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand, insertTableCommand } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import type { EditorView } from "@milkdown/kit/prose/view";
import { undo, redo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Plugin, NodeSelection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { lift, wrapIn } from "prosemirror-commands";
import { CellSelection, TableMap } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";
import { CrepeBuilder } from "@milkdown/crepe";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { TbUndo, TbRedo, TbImage, TbEraser, TbGear, TbToc } from "./ui/icons";

// 调试日志开关（由 index.ts setDebugMode 消息驱动）
let logTableSel = false;
export function setLogTableSel(enabled: boolean): void {
    logTableSel = enabled;
}

// ─── Crepe 原生功能 ──────────────────────────────────────────────────────────
// 以下 feature 由 @milkdown/crepe 官方维护，替换我们的自定义实现：
//   feature/table       → 替换 addButtons + handles + toolbar（1,562 行）
//   feature/code-mirror → 替换 codeBlock NodeView + Prism（1,909 行）
//   feature/toolbar     → 选中文字浮动工具栏（启用）
//   feature/latex       → 全新：KaTeX 数学公式支持
// feature/code-mirror → 换回自定义实现（复制反馈、全屏、样式更精致）
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { latex } from "@milkdown/crepe/feature/latex";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { table } from "@milkdown/crepe/feature/table";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { Compartment } from "@codemirror/state";
import { EditorView as CMEditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting, LanguageDescription, type LanguageSupport } from "@codemirror/language";
import type { Ctx } from "@milkdown/kit/ctx";
import { languages as allCodeLanguages } from "@codemirror/language-data";
import mermaid from "mermaid";
import { onThemeChange } from "./utils/themeBus";
import { t } from "./i18n";
import { openTableGridPicker } from "./components/tableGridPicker";
import { enhanceMermaidPreview } from "./components/mermaidZoom";
import { setTopBarButtonMeta, findTopBarButtonEl } from "./components/topBarOverflow";
import { headingFoldPlugin } from "./headingFoldPlugin";
import { headingStickyPlugin } from "./headingStickyPlugin";
import { tableSoftBreakPlugin } from "./tableSoftBreakPlugin";
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
//   selectionPlugin          → 选区变更回调（驱动外部 UI）
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

// 选区变更回调（由 index.ts 注入，用于驱动工具栏等外部 UI）
let _onSelectionChange: ((view: EditorView) => void) | null = null;
export function registerSelectionChangeHandler(cb: (view: EditorView) => void): void {
    _onSelectionChange = cb;
}

const selectionPlugin = $prose(
    () =>
        new Plugin({
            view: () => ({
                update(view, prevState) {
                    if (
                        _onSelectionChange &&
                        (!view.state.selection.eq(prevState.selection) ||
                         !view.state.doc.eq(prevState.doc))
                    ) {
                        _onSelectionChange(view);
                    }
                },
            }),
        }),
);

// 列表 spread 规范化：编辑后若列表项只含单个块级子节点，自动将 spread 重置为 false
const listSpreadNormalizePlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return new Plugin({
        appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            let minFrom = newState.doc.content.size;
            let maxTo = 0;
            for (const tr of transactions) {
                if (!tr.docChanged) continue;
                for (const step of tr.steps) {
                    step.getMap().forEach((_os, _oe, newStart, newEnd) => {
                        if (newStart < minFrom) minFrom = newStart;
                        if (newEnd > maxTo) maxTo = newEnd;
                    });
                }
            }
            if (minFrom > maxTo) return null;
            const tr = newState.tr;
            let changed = false;
            newState.doc.nodesBetween(minFrom, maxTo, (node, pos) => {
                if (node.type !== schema.nodes.bullet_list && node.type !== schema.nodes.ordered_list)
                    return;
                let listNeedsSpread = false;
                let offset = 1;
                node.forEach((item) => {
                    const itemNeedsSpread = item.childCount > 1;
                    if (item.attrs.spread !== itemNeedsSpread) {
                        tr.setNodeMarkup(pos + offset, undefined, { ...item.attrs, spread: itemNeedsSpread });
                        changed = true;
                    }
                    if (itemNeedsSpread) listNeedsSpread = true;
                    offset += item.nodeSize;
                });
                if (node.attrs.spread !== listNeedsSpread) {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, spread: listNeedsSpread });
                    changed = true;
                }
            });
            return changed ? tr : null;
        },
    });
});

// ─── 表格单元格点击修正 ──────────────────────────────────────────────────────

function getCellCoords(doc: any, pos: number): { row: number; col: number } | null {
    try {
        const $pos = doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
            const typeName = $pos.node(d).type.name;
            if (typeName === "table_cell" || typeName === "table_header") {
                for (let td = d - 1; td >= 0; td--) {
                    if ($pos.node(td).type.name === "table") {
                        const tableNode = $pos.node(td);
                        const tableStart = $pos.start(td);
                        const cellRelPos = $pos.before(d) - tableStart;
                        const map = TableMap.get(tableNode);
                        const rect = map.findCell(cellRelPos);
                        return { row: rect.top + 1, col: rect.left + 1 };
                    }
                }
            }
        }
    } catch { /* 非表格节点或文档结构异常，返回 null */ }
    return null;
}

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
                            setTimeout(() => { if (lastGoodCellSelection === savedCellSel) lastGoodCellSelection = null; }, 200);
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
/** CodeMirror 主题补配 MutationObserver（编辑器重建时先断开旧的） */
let _cmObserver: MutationObserver | null = null;
let _hasUserInteracted = false;
let _interactionListenerAdded = false;
let _serializationMode: SerializationMode = "clean";
let _serializationDebug = false;

export function setSerializationMode(mode: SerializationMode): void {
    _serializationMode = mode;
}

export function setSerializationDebug(enabled: boolean): void {
    _serializationDebug = enabled;
}

function prepareMarkdownForSave(source: string, serialized: string): string {
    if (_serializationMode === "compatible") return applyMinimalChanges(source, serialized);
    try {
        const clean = serializeCleanMarkdown(source, serialized);
        if (_serializationDebug) {
            console.debug("[markdown-serialization]", {
                nodeType: "document",
                originalSource: source,
                serializedSource: serialized,
                output: clean,
                reason: "clean-mode",
                dirtyStatus: "phase1-whole-document",
            });
        }
        return applyMinimalChanges(source, clean);
    } catch (error) {
        if (_serializationDebug) {
            console.warn("[markdown-serialization] Clean serializer failed; using compatible output", {
                error,
                reason: "clean-serializer-error",
                dirtyStatus: "phase1-whole-document",
            });
        }
        return applyMinimalChanges(source, serialized);
    }
}

function setupInteractionTracking(): void {
    if (_interactionListenerAdded) return;
    _interactionListenerAdded = true;
    const mark = () => { _hasUserInteracted = true; };
    document.addEventListener('keydown',   mark, { capture: true });
    document.addEventListener('mousedown', mark, { capture: true });
    document.addEventListener('paste',     mark, { capture: true });
    document.addEventListener('drop',      mark, { capture: true });
    document.addEventListener('cut',       mark, { capture: true });
}

export function getEditorView(): EditorView | null {
    if (!_editor) return null;
    return _editor.action((ctx) => ctx.get(editorViewCtx));
}

export async function createEditor(
    container: HTMLElement,
    initialMarkdown: string,
    onUpdate: (markdown: string) => void,
    onRenameImage?: (webviewUri: string, newBasename: string) => Promise<void>,
    onTocToggle?: () => void,
    initialSerializationMode: SerializationMode = "clean",
): Promise<Editor> {
    _serializationMode = initialSerializationMode;
    _serializationDebug = window.__i18n?.debugMode ?? false;
    _hasUserInteracted = false;
    setupInteractionTracking();

    let debounceTimer: ReturnType<typeof setTimeout>;
    let isComposing = false;
    let pendingMd: string | null = null;

    const fireUpdate = (md: string) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => onUpdate(md), 300);
    };
    const commitMarkdownUpdate = (markdown: string) => {
        const toSave = prepareMarkdownForSave(_savedMarkdown, markdown);
        if (toSave === _savedMarkdown) return;
        _savedMarkdown = toSave;
        fireUpdate(toSave);
    };

    const debouncedUpdate = (markdown: string) => {
        if (isComposing) { pendingMd = markdown; return; }
        commitMarkdownUpdate(markdown);
    };

    container.addEventListener('compositionstart', () => { isComposing = true; });
    container.addEventListener('compositionend', () => {
        isComposing = false;
        if (pendingMd !== null) {
            const md = pendingMd;
            pendingMd = null;
            commitMarkdownUpdate(md);
        }
    });

    let isSettled = false;

    // ── CrepeBuilder ──────────────────────────────────────────────────────────
    const crepe = new CrepeBuilder({
        root: container,
        defaultValue: initialMarkdown,
    });

    // Phase 3: 启用 Crepe 原生功能（替换自定义实现 + 新增能力）
    // ── 主题切换总线 ────────────────────────────────────────
    const cmTheme = new Compartment();
    const getCMTheme = (dark: boolean) => dark ? oneDark : syntaxHighlighting(defaultHighlightStyle);

    const reconfigureAllCM = () => {
        document.querySelectorAll(".cm-editor").forEach((el) => {
            const v = CMEditorView.findFromDOM(el as HTMLElement);
            if (v) v.dispatch({ effects: cmTheme.reconfigure(getCMTheme(isDark)) });
        });
    };

    // 监听新 CodeMirror 编辑器创建（补配主题）
    // 模块级引用：编辑器重建时先断开旧的，避免 MutationObserver 累积泄漏
    _cmObserver?.disconnect();
    const cmObserver = new MutationObserver(() => {
        if (document.querySelector(".cm-editor")) setTimeout(reconfigureAllCM, 10);
    });
    _cmObserver = cmObserver;
    cmObserver.observe(container, { childList: true, subtree: true });

    // 主题切换：CodeMirror + Mermaid 全部统一处理
    let isDark = true;
    const mermaidCodeMap = new Map<string, string>();
    let mermaidSeq = 0;

    const renderMermaid = (code: string): Promise<string> => {
        const id = "mermaid-" + Math.random().toString(36).slice(2, 8);
        return mermaid.render(id, code).then(({ svg }) => svg);
    };

    onThemeChange((dark) => {
        isDark = dark;
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
        // 重绘已有 mermaid 预览
        mermaidCodeMap.forEach((code, key) => {
            const el = document.querySelector<HTMLElement>(`[data-mermaid-key="${key}"]`);
            if (el) renderMermaid(code).then((svg) => {
                el.innerHTML = svg;
                const svgEl = el.querySelector<SVGElement>("svg");
                if (svgEl) enhanceMermaidPreview(el, svgEl);
            }).catch(() => {});
        });
        // 重配 CodeMirror
        reconfigureAllCM();
    });

    // Mermaid 预览渲染
    const renderPreview = (lang: string, code: string, apply: (v: string | null) => void) => {
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
            theme: cmTheme.of(getCMTheme(false)),
            renderPreview,
            searchPlaceholder: t('Search language...'),
        })
        .addFeature(cursor) // 原版虚拟光标（mark 边界方向键/方向指示），z-index 已在 style.css 修复被背景盖住问题
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
            buildTopBar: (builder) => {
                // Undo/Redo — 最前面独立组
                builder.addGroup('history', '').addItem('undo', {
                    icon: TbUndo,
                    active: (ctx: Ctx) => undo(ctx.get(editorViewCtx).state),
                    onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); undo(v.state, v.dispatch, v); },
                }).addItem('redo', {
                    icon: TbRedo,
                    active: (ctx: Ctx) => redo(ctx.get(editorViewCtx).state),
                    onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); redo(v.state, v.dispatch, v); },
                });
                // 清除格式 — formatting 组末尾（行内代码后面）
                builder.getGroup('formatting').addItem('clear-format', {
                    icon: TbEraser,
                    active: (ctx) => {
                        const v = ctx.get(editorViewCtx);
                        const { from, to, empty } = v.state.selection;
                        if (!empty) {
                            let has = false;
                            v.state.doc.nodesBetween(from, to, (n) => { if (n.marks.length) { has = true; return false; } return true; });
                            return has;
                        }
                        // 无选区时：光标在链接内即为 active
                        const linkType = v.state.schema.marks['link'];
                        if (!linkType) return false;
                        return linkType.isInSet(v.state.doc.resolve(from).marks()) !== undefined;
                    },
                    onRun: (ctx) => {
                        const v = ctx.get(editorViewCtx);
                        let { from, to, empty } = v.state.selection;
                        const tr = v.state.tr;
                        const linkType = v.state.schema.marks['link'];

                        // 光标在链接内（无选区）→ 取消整个链接
                        if (empty && linkType) {
                            const $from = v.state.doc.resolve(from);
                            if (linkType.isInSet($from.marks())) {
                                while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                                const docSize = v.state.doc.content.size;
                                while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
                                tr.removeMark(from, to, linkType);
                                v.dispatch(tr);
                                return;
                            }
                        }

                        // 有选区 → 扩展链接边界后清除所有标记
                        if (linkType) {
                            while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                            const docSize = v.state.doc.content.size;
                            while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
                        }

                        v.state.doc.nodesBetween(from, to, (n, pos) => {
                            if (n.marks.length) {
                                const s = Math.max(pos, from), e = Math.min(pos + n.nodeSize, to);
                                n.marks.forEach((m) => tr.removeMark(s, e, m.type));
                            }
                        });
                        if (linkType) tr.removeMark(from, to, linkType);
                        v.dispatch(tr);
                    },
                });
                // 图片 — insert 组，link 和 table 之间（清空后按序重建）
                {
                    const g = builder.getGroup('insert'); const items = g.group.items;
                    const linkItem = items.find((i) => i.key === 'link');
                    const tableItem = items.find((i) => i.key === 'table');
                    g.clear();
                    if (linkItem) g.addItem('link', linkItem);
                    g.addItem('image', {
                        icon: TbImage,
                        active: () => false,
                        onRun: (ctx) => {
                            ctx.get(editorViewCtx).dom.dispatchEvent(new CustomEvent('epytor:insertImage', { bubbles: true }));
                        },
                    });
                    if (tableItem) g.addItem('table', {
                        ...tableItem,
                        onRun: (ctx) => {
                            // 网格选择器：hover 预览行列，点击插入（官方 insertTableCommand 支持任意行列）
                            const viewDom = ctx.get(editorViewCtx).dom;
                            const topBar = viewDom.parentElement?.querySelector<HTMLElement>('.milkdown-top-bar');
                            const anchor = (topBar ? findTopBarButtonEl(topBar, 'table') : null) ?? topBar ?? viewDom;
                            openTableGridPicker(anchor, (rows, cols) => {
                                ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
                            });
                        },
                    });
                }
                // 引用块一键退出：在引用内点击 → lift 解包，否则 → 包裹
                {
                    const isInBlockquote = (state: EditorState) => {
                        const bqType = state.schema.nodes['blockquote'];
                        if (!bqType) return false;
                        const { $from } = state.selection;
                        for (let d = $from.depth; d >= 0; d--) {
                            if ($from.node(d).type === bqType) return true;
                        }
                        return false;
                    };

                    const moreG = builder.getGroup('more');
                    const moreItems = moreG.group.items;
                    const quoteItem = moreItems.find((i) => i.key === 'quote');
                    const hrItem = moreItems.find((i) => i.key === 'hr');
                    const quoteIcon = quoteItem?.icon ?? '';
                    moreG.clear();
                    moreG.addItem('quote', {
                        icon: quoteIcon,
                        active: (ctx) => isInBlockquote(ctx.get(editorViewCtx).state),
                        onRun: (ctx) => {
                            const v = ctx.get(editorViewCtx);
                            if (isInBlockquote(v.state)) {
                                lift(v.state, v.dispatch);
                            } else {
                                const bq = v.state.schema.nodes['blockquote'];
                                if (bq) wrapIn(bq)(v.state, v.dispatch);
                            }
                        },
                    });
                    if (hrItem) moreG.addItem('hr', hrItem);
                }
                // 列表切换：不在列表 → 包裹；在列表且类型不同 → 直接切换；类型相同 → 取消列表
                {
                    const findListItems = (state: EditorState) => {
                        const liType = state.schema.nodes['list_item'];
                        const { from, to } = state.selection;
                        const items: Array<{ pos: number; node: any }> = [];
                        state.doc.nodesBetween(from, to, (node, pos) => {
                            if (node.type === liType) items.push({ pos, node });
                        });
                        if (!items.length) {
                            const { $from } = state.selection;
                            for (let d = $from.depth; d >= 0; d--) {
                                if ($from.node(d).type === liType) {
                                    items.push({ pos: $from.before(d), node: $from.node(d) });
                                    break;
                                }
                            }
                        }
                        return items;
                    };
                    // 找到包含这些 list_item 的顶层列表节点（去重）
                    const findTopLists = (state: EditorState, items: Array<{ pos: number; node: any }>) => {
                        const lists: Array<{ pos: number; node: any }> = [];
                        const seen = new Set<number>();
                        items.forEach(({ pos }) => {
                            const $pos = state.doc.resolve(pos);
                            for (let d = $pos.depth; d >= 0; d--) {
                                const node = $pos.node(d);
                                if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
                                    const listPos = $pos.before(d);
                                    if (!seen.has(listPos)) {
                                        seen.add(listPos);
                                        lists.push({ pos: listPos, node });
                                    }
                                    break;
                                }
                            }
                        });
                        return lists;
                    };
                    const listKind = (state: EditorState): 'bullet' | 'ordered' | 'task' | null => {
                        const items = findListItems(state);
                        if (!items.length) return null;
                        const attrs = items[0].node.attrs;
                        if (attrs.checked != null) return 'task';
                        return attrs.listType === 'ordered' ? 'ordered' : 'bullet';
                    };
                    const toggleList = (target: 'bullet' | 'ordered' | 'task') => (ctx: any) => {
                        const v = ctx.get(editorViewCtx);
                        const { state, dispatch } = v;
                        const schema = state.schema;
                        const kind = listKind(state);
                        if (!kind) {
                            // 不在列表 → 原包裹行为
                            let nodeType: any = null;
                            let attrs: any = null;
                            if (target === 'bullet') nodeType = schema.nodes['bullet_list'];
                            else if (target === 'ordered') nodeType = schema.nodes['ordered_list'];
                            else { nodeType = schema.nodes['list_item']; attrs = { checked: false }; }
                            if (nodeType) ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType, attrs });
                            return;
                        }
                        if (kind === target) {
                            // 同类型 → 取消/降级（lift 一层）
                            const liType = schema.nodes['list_item'];
                            liftListItem(liType)(state, dispatch);
                            return;
                        }
                        // 不同类型 → 换外层列表类型 + 更新 list_item attrs
                        // 用 setNodeMarkup（不改变节点大小，光标位置自动保留，不会跳行）
                        const items = findListItems(state);
                        const lists = findTopLists(state, items);
                        if (!lists.length) return;
                        const tr = state.tr;
                        lists.forEach(({ pos, node }) => {
                            const newType = target === 'ordered'
                                ? schema.nodes['ordered_list']
                                : schema.nodes['bullet_list'];
                            const newAttrs = { ...node.attrs };
                            if (target === 'ordered') newAttrs.order = 1;
                            // 换外层类型（content 保留）
                            tr.setNodeMarkup(pos, newType, newAttrs);
                            // 逐个 list_item 更新 attrs
                            let order = 1;
                            node.forEach((item: any, _off: number, itemPos: number) => {
                                const itemAttrs = { ...item.attrs };
                                if (target === 'bullet') {
                                    itemAttrs.listType = 'bullet';
                                    itemAttrs.label = '•';
                                    itemAttrs.checked = null;
                                } else if (target === 'ordered') {
                                    itemAttrs.listType = 'ordered';
                                    itemAttrs.label = `${order}.`;
                                    itemAttrs.checked = null;
                                    order++;
                                } else { // task
                                    itemAttrs.checked = false;
                                    itemAttrs.listType = 'bullet';
                                    itemAttrs.label = '•';
                                }
                                tr.setNodeMarkup(pos + itemPos + 1, undefined, itemAttrs);
                            });
                        });
                        dispatch(tr);
                    };
                    const listG = builder.getGroup('list');
                    const listItems = listG.group.items;
                    const bulletItem = listItems.find((i: any) => i.key === 'bullet-list');
                    const orderedItem = listItems.find((i: any) => i.key === 'ordered-list');
                    const taskItem = listItems.find((i: any) => i.key === 'task-list');
                    if (bulletItem || orderedItem || taskItem) {
                        listG.clear();
                        if (bulletItem) listG.addItem('bullet-list', {
                            icon: bulletItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'bullet',
                            onRun: toggleList('bullet'),
                        });
                        if (orderedItem) listG.addItem('ordered-list', {
                            icon: orderedItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'ordered',
                            onRun: toggleList('ordered'),
                        });
                        if (taskItem) listG.addItem('task-list', {
                            icon: taskItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'task',
                            onRun: toggleList('task'),
                        });
                    }
                }
                // 目录切换 — 设置前独立组
                builder.addGroup('toc', '').addItem('toc', {
                    icon: TbToc,
                    active: () => false,
                    onRun: () => {
                        onTocToggle?.();
                    },
                });
                // 设置 — 末尾独立组
                builder.addGroup('settings', '').addItem('settings', {
                    icon: TbGear,
                    active: () => false,
                    onRun: () => {
                        document.dispatchEvent(new CustomEvent('epytor:openSettings', { bubbles: true }));
                    },
                });
                // 将 toc、history 组移到最前面
                const groups = builder.build();
                const tocGroup = groups.find((g) => g.key === 'toc');
                if (tocGroup) {
                    const idx = groups.indexOf(tocGroup);
                    groups.splice(idx, 1);
                    groups.unshift(tocGroup);
                }
                const historyGroup = groups.find((g) => g.key === 'history');
                if (historyGroup) {
                    const idx = groups.indexOf(historyGroup);
                    groups.splice(idx, 1);
                    groups.splice(1, 0, historyGroup);
                }
                // 顶栏溢出菜单按钮元数据（key/icon/onRun 快照，供溢出面板渲染副本）
                setTopBarButtonMeta(
                    groups.flatMap((g) =>
                        g.items.map((item) => ({
                            key: item.key,
                            icon: (item.icon as string) ?? "",
                            onRun: item.onRun ?? (() => undefined),
                        })),
                    ),
                );
            },
        })
        .addFeature(toolbar)
        .addFeature(table)
        .addFeature(latex)       // 全新：KaTeX 数学公式
        .addFeature(linkTooltip)
    // 已启用：feature/toolbar → 选中文字浮动工具栏

    // 注入保留的自定义配置
    crepe.editor
        .config((ctx) => {
            _savedMarkdown = initialMarkdown;

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

            // 注册自定义 image NodeView
            ctx.set(nodeViewCtx, [
                [
                    "image",
                    (node, view, getPos) =>
                        createImageView(node, view, getPos, undefined, undefined, onRenameImage),
                ],
            ]);

        })
        .use(listener)              // 追加 listener 用于 markdownUpdated
        .use(selectionPlugin)       // 保留：选区变更回调
        .use(formatKeymapPlugin)    // 保留：自定义格式化快捷键
        .use(headingFoldPlugin)     // 标题折叠（Decoration，不修改文档）
        .use(headingStickyPlugin)   // 标题吸顶条（滚动跟随 + 推挤过渡）
        .use(tableSoftBreakPlugin)  // 表格单元格内 Shift+Enter 软换行（<br>）
        .use(cellClickFixPlugin)    // 表格单击→光标定位，拖拽→多选
        .use(listSpreadNormalizePlugin); // 保留：列表 spread 规范化

    // 注册 markdownUpdated 回调（自动保存链路）
    crepe.on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
            if (!isSettled) return;
            if (!_hasUserInteracted) return;
            debouncedUpdate(markdown);
        });
    });

    _editor = await crepe.create();
    isSettled = true;
    return _editor;
}
