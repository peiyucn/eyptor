import { notifyGetPathSuggestions } from "@/messaging";
import { getFileIcon } from "./fileIcons";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createPathDropdown } from "@/ui/pathCompleteCore";

const PATH_ACTIVE_CLASS = "path-complete-item--active";

// ─── 常量 ────────────────────────────────────────────────────
const PATH_RETRIGGER_DELAY_MS = 50;
const PATH_SUGGESTION_TIMEOUT_MS = 5000;
const PATH_DEBOUNCE_MS = 200;

// 触发补全的路径前缀检测
const PATH_PREFIX_REGEX = /^(@\/|\.{1,2}\/|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)/;

type SuggestionItem = { path: string; isDir: boolean };
type SuggestCallback = (items: SuggestionItem[]) => void;

// 路径补全回调 map：id → resolve
const _pendingSuggestions = new Map<string, SuggestCallback>();

/** 外部调用此函数分发 pathSuggestions 消息 */
export function dispatchPathSuggestions(id: string, items: SuggestionItem[]): void {
    const cb = _pendingSuggestions.get(id);
    if (cb) {
        _pendingSuggestions.delete(id);
        cb(items);
    }
}

/** 获取当前光标所在的 inline code 元素（排除 pre>code 和 a>code） */
function getActiveInlineCode(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return null; }
    const node = sel.anchorNode;
    if (!node) { return null; }
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    if (!el) { return null; }
    const code = el.closest("code");
    if (!code) { return null; }
    if (code.closest("pre")) { return null; }
    if (code.closest("a")) { return null; }
    return code as HTMLElement;
}

/** 通过当前 ProseMirror 选区位置查找 inlineCode mark 的文本范围 */
function getCodeNodeRangeFromSelection(view: EditorView): { from: number; to: number } | null {
    const { state } = view;
    const codeMark = state.schema.marks["inlineCode"];
    if (!codeMark) { return null; }

    const { $from } = state.selection;
    const parentStart = $from.start();
    let from: number | undefined;
    let to: number | undefined;
    $from.parent.forEach((node, offset) => {
        if (node.isText && node.marks.some(m => m.type === codeMark)) {
            const s = parentStart + offset;
            const e = s + node.nodeSize;
            if ($from.pos >= s && $from.pos <= e) {
                from = s;
                to = e;
            }
        }
    });
    return from !== undefined && to !== undefined ? { from, to } : null;
}

export function initPathComplete(getEditorViewFn: () => EditorView | null): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let savedRange: { from: number; to: number } | null = null;

    const dropdown = createPathDropdown<SuggestionItem>({
        listClass: "path-complete-list",
        itemClass: "path-complete-item",
        activeClass: PATH_ACTIVE_CLASS,
        renderItem: (item) => {
            const iconEl = document.createElement("span");
            iconEl.className = "path-complete-icon";
            iconEl.innerHTML = getFileIcon(item.path, item.isDir);
            const lastSeg = item.path.replace(/\/$/, '').split('/').pop() ?? item.path;
            const label = document.createElement("span");
            label.className = "path-complete-label";
            label.textContent = lastSeg;
            return `${iconEl.outerHTML}${label.outerHTML}`;
        },
        getTitle: (item) => item.path,
        onClose: () => { savedRange = null; },
        onSelect: (item) => applySelection(item),
    });

    function applySelection(item: SuggestionItem): void {
        const view = getEditorViewFn();
        if (!view) { dropdown.close(); return; }
        const range = savedRange ?? getCodeNodeRangeFromSelection(view);
        if (!range) { dropdown.close(); return; }
        const codeMark = view.state.schema.marks["inlineCode"];
        if (!codeMark) { return; }
        const { state: editorState } = view;
        view.dispatch(
            editorState.tr.replaceRangeWith(
                range.from,
                range.to,
                editorState.schema.text(item.path, [codeMark.create()]),
            ),
        );
        view.focus();

        if (item.isDir) {
            dropdown.close();
            setTimeout(() => {
                const newCode = getActiveInlineCode();
                if (newCode) { triggerSuggest(newCode); }
            }, PATH_RETRIGGER_DELAY_MS);
        } else {
            dropdown.close();
        }
    }

    function triggerSuggest(code: HTMLElement): void {
        const query = (code.textContent ?? "").trim();
        if (!query || !PATH_PREFIX_REGEX.test(query)) {
            dropdown.close();
            return;
        }

        const id = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        _pendingSuggestions.set(id, (items) => {
            const currentCode = getActiveInlineCode();
            if (currentCode === code) {
                const view = getEditorViewFn();
                if (view) { savedRange = getCodeNodeRangeFromSelection(view); }
                const rect = code.getBoundingClientRect();
                dropdown.show(
                    { left: rect.left + window.scrollX, top: rect.bottom + window.scrollY + 2 },
                    items,
                );
            }
        });
        notifyGetPathSuggestions(id, query);

        // 超时清理
        setTimeout(() => {
            if (_pendingSuggestions.has(id)) {
                _pendingSuggestions.delete(id);
            }
        }, PATH_SUGGESTION_TIMEOUT_MS);
    }

    // 键盘导航（capture 阶段，优先于编辑器处理）
    document.addEventListener("keydown", (e) => {
        dropdown.handleKeydown(e);
    }, true);

    // 输入时触发补全（debounce 200ms）
    document.addEventListener("keyup", (e) => {
        if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) { return; }

        const code = getActiveInlineCode();
        if (!code) {
            dropdown.close();
            return;
        }

        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            triggerSuggest(code);
        }, PATH_DEBOUNCE_MS);
    });

    // 点击其他区域关闭下拉
    document.addEventListener("mousedown", (e) => {
        if (dropdown.isOpen() && !dropdown.contains(e.target as Node)) {
            dropdown.close();
        }
    }, true);

    // 失焦关闭
    window.addEventListener("blur", () => {
        dropdown.close();
    });
}
