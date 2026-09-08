import { notifyGetPathSuggestions, notifyResolveImagePath } from "@/messaging";
import { getFileIcon } from "../pathLink/fileIcons";
import type { PathSuggestionItem } from "../../../shared/messages";
import { createPathDropdown } from "@/ui/pathCompleteCore";
import { PATH_COMPLETE_DEBOUNCE_MS, PATH_COMPLETE_RETRIGGER_DELAY_MS, PATH_PREFIX_REGEX } from "../../../shared/constants";
import { beginPathSuggestionRequest } from "@/utils/pathSuggestionRequests";

const IMG_ACTIVE_CLASS = "img-path-complete-item--active";

// ─── 常量 ────────────────────────────────────────────────────
const RESOLVE_IMAGE_TIMEOUT_MS = 3000;
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

// 触发路径补全的前缀检测与超时/防抖常量统一在 shared/constants.ts

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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let isDestroyed = false;
    let skipDatasetClear = false;
    /** 最近一次发出的补全请求 id（过期守卫：晚到的旧响应不得覆盖当前下拉） */
    let latestSuggestionId = "";

    const dropdown = createPathDropdown<PathSuggestionItem>({
        listClass: "img-path-complete-list",
        itemClass: "img-path-complete-item",
        activeClass: IMG_ACTIVE_CLASS,
        renderItem: (item) => {
            if (item.webviewUri) {
                return `<img class="img-complete-thumb" src="${item.webviewUri}" alt=""><span class="img-complete-label">${escapeHtml(lastSeg(item.path))}</span>`;
            }
            const iconEl = document.createElement("span");
            iconEl.className = "img-complete-icon";
            iconEl.innerHTML = getFileIcon(item.path, item.isDir);
            const label = document.createElement("span");
            label.className = "img-complete-label";
            label.textContent = lastSeg(item.path);
            return `${iconEl.outerHTML}${label.outerHTML}`;
        },
        getTitle: (item) => item.path,
        onSelect: (item) => applySelection(item),
    });

    function lastSeg(path: string): string {
        return path.replace(/\/$/, "").split("/").pop() ?? path;
    }

    /** 最小 HTML 转义（缩略图分支以 innerHTML 拼装 label 文本） */
    function escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

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
            dropdown.close();
            setTimeout(() => { triggerSuggest(); }, PATH_COMPLETE_RETRIGGER_DELAY_MS);
        } else {
            dropdown.close();
        }
    }

    // ── 触发补全请求 ───────────────────────────────────────────

    function triggerSuggest(): void {
        const query = input.value.trim();
        if (!query || !PATH_PREFIX_REGEX.test(query)) {
            // 使 in-flight 旧响应失效（查询已不匹配），防下拉复活
            latestSuggestionId = "";
            dropdown.close();
            return;
        }

        // 请求登记与超时清理统一走 pathSuggestionRequests（回归 P4：此前手写 Map + setTimeout）
        const handle = beginPathSuggestionRequest();
        latestSuggestionId = handle.id;
        handle.promise.then((items) => {
            // 过期守卫：目录大时请求 A 后发 B，A 晚回会覆盖 B 的下拉（回归）
            if (isDestroyed || handle.id !== latestSuggestionId) { return; }
            // 双保险：输入框已脱离文档（宿主关闭对话框）时拒绝渲染，防游离下拉复活
            if (!input.isConnected) return;
            const filtered = items.filter(item => item.isDir || item.webviewUri !== undefined);
            if (filtered.length === 0) return;
            const rect = input.getBoundingClientRect();
            dropdown.show(
                { left: rect.left, top: rect.bottom + 2 },
                filtered,
                `${rect.width}px`,
            );
        }).catch(() => { /* 超时/取消：静默放弃，下拉不复活 */ });
        notifyGetPathSuggestions(handle.id, query);
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
            if (dropdown.isOpen()) {
                dropdown.handleKeydown(e); // 选中当前高亮项
            } else {
                onEnter?.();
            }
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (dropdown.isOpen()) {
                dropdown.close();
            } else {
                onEscape?.();
            }
            return;
        }

        if (!dropdown.isOpen()) { return; }
        dropdown.handleKeydown(e); // 方向键 / Tab
    }

    function onDocMousedown(e: MouseEvent): void {
        if (dropdown.isOpen() && !dropdown.contains(e.target as Node) && e.target !== input) {
            dropdown.close();
        }
    }

    function onBlur(): void {
        // 延迟关闭，让 mousedown 的 applySelection 先执行
        setTimeout(() => {
            if (!isDestroyed) { dropdown.close(); }
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
        dropdown.close();
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeydown, true);
        input.removeEventListener("blur", onBlur);
        document.removeEventListener("mousedown", onDocMousedown, true);
    };
}
