import { notifyGetPathSuggestions, notifyResolveImagePath } from "@/messaging";
import { getFileIcon } from "../pathLink/fileIcons";
import type { PathSuggestionItem } from "../../../shared/messages";
import {
    closeDropdown as closeDropdownState,
    updateActiveItem,
    type DropdownState,
} from "@/ui/dropdownComplete";

const IMG_ACTIVE_CLASS = "img-path-complete-item--active";

// ─── 常量 ────────────────────────────────────────────────────
const RESOLVE_IMAGE_TIMEOUT_MS = 3000;
const PATH_SUGGESTION_TIMEOUT_MS = 5000;
const PATH_COMPLETE_RETRIGGER_DELAY_MS = 50;
const PATH_COMPLETE_DEBOUNCE_MS = 200;
const IMAGE_BLUR_CLOSE_DELAY_MS = 150;

// ─── resolveImagePath 异步机制 ────────────────────────────────
const _pendingResolve = new Map<string, (uri: string) => void>();

/** 由 index.ts 在收到 imagePathResolved 消息时调用 */
export function dispatchImagePathResolved(id: string, webviewUri: string): void {
    const cb = _pendingResolve.get(id);
    if (cb) { _pendingResolve.delete(id); cb(webviewUri); }
}

/** 将 relPath 解析为 webviewUri（异步，超时 3s 返回原值） */
export function resolveToWebviewUri(relPath: string): Promise<string> {
    return new Promise((resolve) => {
        const id = `rip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        const timer = setTimeout(() => {
            _pendingResolve.delete(id);
            resolve(relPath); // 超时回退
        }, RESOLVE_IMAGE_TIMEOUT_MS);
        _pendingResolve.set(id, (uri) => {
            clearTimeout(timer);
            resolve(uri);
        });
        notifyResolveImagePath(id, relPath);
    });
}

// 触发路径补全的前缀检测（与 pathComplete.ts 保持一致）
const PATH_PREFIX_REGEX = /^(@\/|\.{1,2}\/|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)/;

type SuggestCallback = (items: PathSuggestionItem[]) => void;

// 回调 map：id → resolve（全局唯一，各 input 通过 id 区分）
const _pendingImgSuggestions = new Map<string, SuggestCallback>();

/** 外部调用此函数分发 pathSuggestions 消息到本模块 */
export function dispatchImgPathSuggestions(id: string, items: PathSuggestionItem[]): void {
    const cb = _pendingImgSuggestions.get(id);
    if (cb) {
        _pendingImgSuggestions.delete(id);
        cb(items);
    }
}

/**
 * 为一个 <input> 元素附加图片路径自动补全。
 * @param onEnter  dropdown 关闭时 Enter 调用（即 confirm）
 * @param onEscape dropdown 关闭时 Escape 调用（即 cancel）
 * 返回 cleanup 函数，调用后移除事件监听并关闭下拉。
 */
export function attachImgPathComplete(
    input: HTMLInputElement,
    onEnter?: () => void,
    onEscape?: () => void,
): () => void {
    const state: DropdownState = { el: null, activeIndex: -1 };
    let lastItems: PathSuggestionItem[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressMouseover = false;
    let isDestroyed = false;
    let skipDatasetClear = false;
    /** 最近一次发出的补全请求 id（过期守卫：晚到的旧响应不得覆盖当前下拉） */
    let latestSuggestionId = "";

    function closeDropdown(): void { closeDropdownState(state); lastItems = []; }

    function applySelection(item: PathSuggestionItem): void {
        input.value = item.path;
        if (item.webviewUri) {
            input.dataset.imgWebviewUri = item.webviewUri;
        } else {
            delete input.dataset.imgWebviewUri;
        }
        skipDatasetClear = true;
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        input.focus();

        if (item.isDir) {
            closeDropdown();
            setTimeout(() => { triggerSuggest(); }, PATH_COMPLETE_RETRIGGER_DELAY_MS);
        } else {
            closeDropdown();
        }
    }

    function showDropdown(items: PathSuggestionItem[]): void {
        closeDropdown();
        // 双保险：输入框已脱离文档（宿主关闭对话框）时拒绝渲染，防游离下拉复活
        if (!input.isConnected) { return; }
        const filtered = items.filter(item => item.isDir || item.webviewUri !== undefined);
        if (filtered.length === 0) { return; }
        lastItems = filtered;

        const rect = input.getBoundingClientRect();
        const ul = document.createElement("ul");
        ul.className = "img-path-complete-list";
        ul.style.top = `${rect.bottom + 2}px`;
        ul.style.left = `${rect.left}px`;
        ul.style.minWidth = `${rect.width}px`;

        filtered.forEach((item, i) => {
            const li = document.createElement("li");
            li.className = "img-path-complete-item";

            if (item.webviewUri) {
                const thumb = document.createElement("img");
                thumb.className = "img-complete-thumb";
                thumb.src = item.webviewUri;
                thumb.alt = "";
                li.appendChild(thumb);
            } else {
                const iconEl = document.createElement("span");
                iconEl.className = "img-complete-icon";
                iconEl.innerHTML = getFileIcon(item.path, item.isDir);
                li.appendChild(iconEl);
            }

            const lastSeg = item.path.replace(/\/$/, "").split("/").pop() ?? item.path;
            const label = document.createElement("span");
            label.className = "img-complete-label";
            label.textContent = lastSeg;
            li.title = item.path;
            li.appendChild(label);

            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                state.activeIndex = i;
                applySelection(item);
            });
            li.addEventListener("mousemove", () => { suppressMouseover = false; });
            li.addEventListener("mouseover", () => {
                if (suppressMouseover) { return; }
                state.activeIndex = i;
                updateActiveItem(state, IMG_ACTIVE_CLASS);
            });

            ul.appendChild(li);
        });

        document.body.appendChild(ul);
        state.el = ul;
        state.activeIndex = 0;
        updateActiveItem(state, IMG_ACTIVE_CLASS);
    }

    // ── 触发补全请求 ───────────────────────────────────────────

    function triggerSuggest(): void {
        const query = input.value.trim();
        if (!query || !PATH_PREFIX_REGEX.test(query)) {
            // 使 in-flight 旧响应失效（查询已不匹配），防下拉复活
            latestSuggestionId = "";
            closeDropdown();
            return;
        }

        const id = `ips_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        latestSuggestionId = id;
        _pendingImgSuggestions.set(id, (items) => {
            // 过期守卫：目录大时请求 A 后发 B，A 晚回会覆盖 B 的下拉（回归）
            if (!isDestroyed && id === latestSuggestionId) {
                showDropdown(items);
            }
        });
        notifyGetPathSuggestions(id, query);

        // 超时清理
        setTimeout(() => {
            _pendingImgSuggestions.delete(id);
        }, PATH_SUGGESTION_TIMEOUT_MS);
    }

    // ── 事件监听 ───────────────────────────────────────────────

    function onInput(): void {
        // autocomplete 选中后首次 onInput 不清除 dataset（dataset 是手动输入的判断依据）
        if (skipDatasetClear) {
            skipDatasetClear = false;
        } else {
            delete input.dataset.imgWebviewUri;
        }
        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            if (!isDestroyed) { triggerSuggest(); }
        }, PATH_COMPLETE_DEBOUNCE_MS);
    }

    function onKeydown(e: KeyboardEvent): void {
        if (e.isComposing) { return; }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (state.el && state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                applySelection(lastItems[state.activeIndex]);
            } else {
                onEnter?.();
            }
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (state.el) {
                closeDropdown();
            } else {
                onEscape?.();
            }
            return;
        }

        if (!state.el) { return; }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex >= lastItems.length - 1 ? 0 : state.activeIndex + 1;
            updateActiveItem(state, IMG_ACTIVE_CLASS);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex <= 0 ? lastItems.length - 1 : state.activeIndex - 1;
            updateActiveItem(state, IMG_ACTIVE_CLASS);
            return;
        }
        if (e.key === "Tab") {
            if (state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                e.preventDefault();
                e.stopPropagation();
                applySelection(lastItems[state.activeIndex]);
            }
            return;
        }
    }

    function onDocMousedown(e: MouseEvent): void {
        if (state.el && !state.el.contains(e.target as Node) && e.target !== input) {
            closeDropdown();
        }
    }

    function onBlur(): void {
        // 延迟关闭，让 mousedown 的 applySelection 先执行
        setTimeout(() => {
            if (!isDestroyed) { closeDropdown(); }
        }, IMAGE_BLUR_CLOSE_DELAY_MS);
    }

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown, true);
    input.addEventListener("blur", onBlur);
    document.addEventListener("mousedown", onDocMousedown, true);

    // ── cleanup ────────────────────────────────────────────────

    return function detach(): void {
        isDestroyed = true;
        if (debounceTimer) { clearTimeout(debounceTimer); }
        closeDropdown();
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeydown, true);
        input.removeEventListener("blur", onBlur);
        document.removeEventListener("mousedown", onDocMousedown, true);
    };
}
