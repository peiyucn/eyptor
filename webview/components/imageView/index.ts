import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type {
    Decoration,
    DecorationSource,
    EditorView,
} from "@milkdown/kit/prose/view";
import {
    IconZoomIn,
    IconPencil,
    IconTrash2,
    IconCheck,
    IconX,
    IconImageOff,
} from "@/ui/icons";
import { t } from "@/i18n";
import { createButton, createSeparator, setupInputKeyboard } from "@/ui/dom";
import { showTooltipAt } from "@/ui/tooltip";
import { attachImgPathComplete, resolveToWebviewUri } from './imgPathComplete';
import './imageView.css';

// ─── 常量 ────────────────────────────────────────────────────
const MAX_IMAGE_LOAD_RETRIES = 5;
const IMAGE_RETRY_BASE_DELAY_MS = 200;
const IMAGE_RETRY_MAX_DELAY_MS = 2000;
const MIN_IMAGE_RESIZE_HEIGHT = 40;
const MAX_IMAGE_RESIZE_RATIO = 0.8;

// ─── webviewUri ↔ relPath 双向映射（由 index.ts 在收到 init/revert 消息时写入）─────
const _uriToRel = new Map<string, string>(); // webviewUri → relPath
const _relToUri = new Map<string, string>(); // relPath    → webviewUri

/** 由外部（index.ts）在 init/revert 收到 imageUriMap 后调用 */
export function setImageUriMap(map: Record<string, string>): void {
    _uriToRel.clear();
    _relToUri.clear();
    for (const [uri, rel] of Object.entries(map)) {
        _uriToRel.set(uri, rel);
        _relToUri.set(rel, uri);
    }
}

/** 将 webviewUri 转为可显示的 relPath（找不到时原样返回） */
function toDisplayPath(src: string): string {
    return _uriToRel.get(src) ?? src;
}

/** 将 relPath 转为可在 NodeView 中直接渲染的 webviewUri（找不到时原样返回） */
function toWebviewUri(src: string): string {
    return _relToUri.get(src) ?? src;
}

type ViewMutationRecord = MutationRecord | { type: "selection"; target: Node };

// ─── Lightbox ──────────────────────────────────────────────
let activeLightbox: HTMLElement | null = null;

export function showGlobalLightbox(src: string, alt: string): void {
    if (activeLightbox) {
        return;
    }

    const lb = document.createElement("div");
    lb.className = "img-editor-lightbox";

    const img = document.createElement("img");
    img.className = "img-editor-lightbox-img";
    img.src = src;
    img.alt = alt;

    const closeBtn = document.createElement("button");
    closeBtn.className = "img-editor-lightbox-close";
    closeBtn.innerHTML = IconX;
    closeBtn.title = t("Close");

    lb.appendChild(img);
    lb.appendChild(closeBtn);
    document.body.appendChild(lb);
    activeLightbox = lb;

    function close(): void {
        if (activeLightbox && document.body.contains(activeLightbox)) {
            document.body.removeChild(activeLightbox);
        }
        activeLightbox = null;
        document.removeEventListener("keydown", onKeyDown);
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    }

    lb.addEventListener("mousedown", (e) => {
        if (e.target === lb) {
            close();
        }
    });
    closeBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
    });
    document.addEventListener("keydown", onKeyDown);
}

// ─── 阻止输入框事件冒泡到 ProseMirror ────────────────────
// ProseMirror 在 view.dom 上监听 copy/cut/paste/keydown 等事件，
// input 内的剪贴板操作会冒泡被拦截（ProseMirror 的 copy handler 会 preventDefault）。
// 统一在 input 上阻止这些事件的冒泡，让浏览器原生行为正常触发。
function isolateInput(input: HTMLInputElement): void {
    const stopOnly = (e: Event) => e.stopPropagation();
    input.addEventListener("copy", stopOnly);
    input.addEventListener("cut", stopOnly);
    input.addEventListener("paste", stopOnly);
    input.addEventListener("mousedown", stopOnly);
    input.addEventListener("click", stopOnly);
    input.addEventListener("select", stopOnly);
    // 注意：不能在此处 stopPropagation keydown——
    // VS Code WebView 依赖 keydown 冒泡到 window 才能触发原生剪贴板操作
}

// ─── 辅助：从 src 提取文件名（不含扩展名） ───────────────
function basenameNoExt(src: string): string {
    const name = src.split("/").pop() ?? src;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

// ─── 工具栏按钮工厂 ────────────────────────────────────────
function makeBtn(icon: string, label: string): HTMLButtonElement {
    return createButton({ className: "img-tb-btn", icon, tabIndex: -1, title: label, tooltipPlacement: "above" });
}

function makeSep(): HTMLElement {
    return createSeparator("img-tb-sep", "span");
}

// ─── 工具栏内联编辑辅助 ──────────────────────────────────────
interface ToolbarInlineEditOptions {
    initialValue: string;
    placeholder: string;
    /** 确认回调，value 为输入值，input 保留 dataset 等属性 */
    onConfirm: (value: string, input: HTMLInputElement) => void;
    /** 取消回调 */
    onCancel?: () => void;
    /**
     * 可选的输入增强（如 autocomplete）。
     * 传入 input + confirm/cancel 回调，返回 detach 清理函数。
     * 不提供时默认使用 setupInputKeyboard 处理 Enter/Escape。
     */
    setupComplete?: (
        input: HTMLInputElement,
        confirm: () => void,
        cancel: () => void,
    ) => (() => void) | void;
}

/**
 * 在工具栏上启动内联编辑：隐藏原有内容，显示 input + 确认/取消按钮。
 * 确认/取消后自动恢复工具栏原貌。
 */
function startToolbarInlineEdit(
    toolbar: HTMLElement,
    options: ToolbarInlineEditOptions,
): void {
    const input = document.createElement("input");
    input.className = "img-rename-input";
    input.value = options.initialValue;
    input.placeholder = options.placeholder;
    isolateInput(input);

    function doConfirm(): void {
        const value = input.value.trim();
        options.onConfirm(value, input);
        cleanup();
    }

    function doCancel(): void {
        options.onCancel?.();
        cleanup();
    }

    const confirmBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        icon: IconCheck,
        onClick: doConfirm,
    });
    confirmBtn.style.color = "var(--vscode-charts-green, #4caf50)";
    const cancelBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        icon: IconX,
        onClick: doCancel,
    });

    // 隐藏原有工具栏内容，显示编辑控件
    Array.from(toolbar.children).forEach((el) => {
        (el as HTMLElement).style.display = "none";
    });
    toolbar.appendChild(input);
    toolbar.appendChild(confirmBtn);
    toolbar.appendChild(cancelBtn);

    input.focus();
    input.select();

    const detachComplete = options.setupComplete
        ? (options.setupComplete(input, doConfirm, doCancel) ?? undefined)
        : undefined;

    if (!options.setupComplete) {
        setupInputKeyboard(input, doConfirm, doCancel);
    }

    function cleanup(): void {
        detachComplete?.();
        if (toolbar.contains(input)) toolbar.removeChild(input);
        if (toolbar.contains(confirmBtn)) toolbar.removeChild(confirmBtn);
        if (toolbar.contains(cancelBtn)) toolbar.removeChild(cancelBtn);
        Array.from(toolbar.children).forEach((el) => {
            (el as HTMLElement).style.display = "";
        });
    }
}

// ─── NodeView 工厂 ─────────────────────────────────────────
export function createImageView(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    _decorations?: readonly Decoration[],
    _innerDecorations?: DecorationSource,
    onRenameImage?: (webviewUri: string, newBasename: string) => Promise<void>,
): {
    dom: HTMLElement;
    update: (n: PMNode) => boolean;
    selectNode: () => void;
    deselectNode: () => void;
    stopEvent: (e: Event) => boolean;
    ignoreMutation: (m: ViewMutationRecord) => boolean;
    destroy: () => void;
} {
    let currentNode = node;

    // ── 外层 wrapper ──────────────────────────────────────────
    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";

    // ── ratio 编解码（存储在 title 末尾，不修改 schema）──────
    const RATIO_RE = /\s*ratio:([\d.]+)\s*$/;
    function parseRatio(title: string): { clean: string; ratio: number } {
        const m = title.match(RATIO_RE);
        return m ? { clean: title.replace(RATIO_RE, "").trim(), ratio: parseFloat(m[1]) || 1 } : { clean: title, ratio: 1 };
    }
    function encodeRatio(title: string, ratio: number): string {
        if (ratio === 1) return title;
        const { clean } = parseRatio(title);
        const r = `ratio:${ratio.toFixed(2)}`;
        return clean ? `${clean} ${r}` : r;
    }

    let currentRatio = parseRatio((node.attrs["title"] as string) ?? "").ratio;

    // ── 图片 ──────────────────────────────────────────────────
    const img = document.createElement("img");
    img.className = "image-node";
    img.src = (node.attrs["src"] as string) ?? "";
    img.alt = (node.attrs["alt"] as string) ?? "";
    img.draggable = false;
    let imgNaturalH = 0;

    function applyRatio(): void {
        if (imgNaturalH <= 0) imgNaturalH = img.naturalHeight || 0;
        if (imgNaturalH <= 0) return;
        if (currentRatio === 1) { img.style.height = ""; return; }
        img.style.height = `${Math.round(imgNaturalH * currentRatio)}px`;
        img.style.width = "";
    }

    // ── 加载中占位符 ──────────────────────────────────────────
    let imgErrored = false;
    let imgLoaded = false;
    const loadingPlaceholder = document.createElement("div");
    loadingPlaceholder.className = "img-loading-placeholder";
    loadingPlaceholder.innerHTML = '<span class="img-loading-spinner"></span><span>Loading...</span>';

    // ── 图片加载失败占位符 ────────────────────────────────────
    const errorPlaceholder = document.createElement("div");
    errorPlaceholder.className = "img-error-placeholder";
    errorPlaceholder.style.display = "none";

    let retryCount = 0;
    img.addEventListener("error", () => {
        if (retryCount < MAX_IMAGE_LOAD_RETRIES) {
            retryCount++;
            const delay = Math.min(IMAGE_RETRY_BASE_DELAY_MS * retryCount, IMAGE_RETRY_MAX_DELAY_MS);
            setTimeout(() => {
                const src = img.src;
                img.src = "";
                img.src = src.replace(/([?&])_r=\d+/, "") + (src.includes("?") ? "&" : "?") + "_r=" + Date.now();
            }, delay);
            return;
        }
        imgErrored = true;
        img.style.display = "none";
        loadingPlaceholder.style.display = "none";
        errorPlaceholder.innerHTML = `${IconImageOff}<span>${t("Image not found")}</span>`;
        errorPlaceholder.style.display = "flex";
    });

    img.addEventListener("load", () => {
        imgLoaded = true;
        imgNaturalH = img.naturalHeight;
        loadingPlaceholder.style.display = "none";
        if (imgErrored) {
            imgErrored = false;
            img.style.display = "";
            errorPlaceholder.style.display = "none";
        }
        applyRatio();
    });

    // 初始显示加载中（图片稍后自然触发 load/error 切换）
    loadingPlaceholder.style.display = "flex";

    // ── Caption 显示（图片下方说明文字）─────────────────────────
    const captionEl = document.createElement("div");
    captionEl.className = "image-caption";
    captionEl.textContent = parseRatio((node.attrs["title"] as string) ?? "").clean;
    captionEl.addEventListener("mousedown", (e) => {
        // 双击 caption 进入编辑
        if (e.detail === 2) { e.preventDefault(); startCaptionEdit(); }
    });

    // ── 缩放 handle ─────────────────────────────────────────────
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "img-resize-handle";
    let resizeStartY = 0, resizeStartH = 0;

    resizeHandle.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        resizeStartY = e.clientY;
        resizeStartH = img.getBoundingClientRect().height || imgNaturalH;
        document.body.style.cursor = "nwse-resize";
        window.addEventListener("pointermove", onResizeMove);
        window.addEventListener("pointerup", onResizeUp);
    });
    function onResizeMove(e: PointerEvent) {
        const h = Math.max(MIN_IMAGE_RESIZE_HEIGHT, Math.min(window.innerHeight * MAX_IMAGE_RESIZE_RATIO, resizeStartH + (e.clientY - resizeStartY)));
        img.style.height = `${h}px`;
    }
    function onResizeUp() {
        window.removeEventListener("pointermove", onResizeMove);
        window.removeEventListener("pointerup", onResizeUp);
        document.body.style.cursor = "";
        const h = parseFloat(img.style.height) || imgNaturalH;
        if (imgNaturalH <= 0 || h <= 0) return;
        currentRatio = parseFloat((h / imgNaturalH).toFixed(2));
        const pos = getPos();
        if (pos === undefined) return;
        const newTitle = encodeRatio((currentNode.attrs["title"] as string) ?? "", currentRatio);
        view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
            ...currentNode.attrs,
            title: newTitle,
        }));
    }

    // ── 工具栏 ────────────────────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.className = "image-toolbar";
    toolbar.contentEditable = "false";

    // 放大按钮
    const zoomBtn = makeBtn(IconZoomIn, t("View Full Size"));
    zoomBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGlobalLightbox(img.src, img.alt);
    });

    // Caption 编辑（存到 title，和 ratio 共存）
    const captionBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        label: "CAP/ALT",
        title: t("Edit Caption"),
        tooltipPlacement: "above",
        onClick: () => startCaptionEdit(),
    });
    captionBtn.style.fontWeight = "600";

    // 铅笔图标：常驻，点击编辑图片路径（src 属性）
    const renameBtn = makeBtn(IconPencil, t("Edit Image Path"));
    renameBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startSrcEdit();
    });

    // 删除按钮
    const deleteBtn = makeBtn(IconTrash2, t("Delete"));
    deleteBtn.style.color = "var(--vscode-errorForeground, #f44)";
    deleteBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (pos === undefined) {
            return;
        }
        view.dispatch(view.state.tr.delete(pos, pos + currentNode.nodeSize));
        view.focus();
    });

    // ── 信息区：span（只读，远程图片）+ input（可编辑文件名，本地图片）──
    const infoSpan = document.createElement("span");
    infoSpan.className = "img-tb-info";

    const infoInput = document.createElement("input");
    infoInput.type = "text";
    infoInput.className = "img-tb-info img-tb-info--input";
    isolateInput(infoInput);

    let currentInfoEl: HTMLElement = infoSpan;

    function updateInfo(src: string, _alt: string): void {
        const name = src.split("/").pop() ?? src;
        const caption = parseRatio((currentNode.attrs["title"] as string) ?? "").clean;
        const display = caption ? `${name} · ${caption}` : name;
        infoSpan.textContent = display;
        infoSpan.title = display;
        if (document.activeElement !== infoInput) {
            infoInput.value = basenameNoExt(src);
            infoInput.title = name;
        }
    }

    // 本地图片识别：vscode-webview-resource:（旧）或 vscode-cdn.net / vscode-resource（新）
    function isLocalImage(src: string): boolean {
        return /vscode-resource|vscode-cdn\.net/.test(src);
    }

    function updateInfoElement(src: string): void {
        const shouldUseInput = isLocalImage(src) && !!onRenameImage;
        const newEl = shouldUseInput ? infoInput : infoSpan;
        if (currentInfoEl !== newEl && currentInfoEl.parentElement) {
            currentInfoEl.parentElement.replaceChild(newEl, currentInfoEl);
            currentInfoEl = newEl;
        }
    }

    // infoInput 键盘事件（本地图片文件名重命名）
    infoInput.addEventListener("keydown", (e) => {
        if (e.isComposing) {
            return;
        }
        if (e.key === "Enter") {
            e.stopPropagation();
            e.preventDefault();
            const newBasename = infoInput.value.trim();
            const orig = basenameNoExt(rawSrc);
            if (newBasename && newBasename !== orig && onRenameImage) {
                onRenameImage(rawSrc, newBasename).catch((error) => {
                    // 回归：失败被空 catch 吞掉，输入框静默复位、用户以为重命名成功
                    // （文件名非法/被占用/超时均无任何提示）
                    infoInput.value = orig;
                    showTooltipAt(
                        infoInput,
                        // 错误消息来自宿主（Extension 侧已本地化）；极端无 message 时用英文兜底
                        error instanceof Error && error.message ? error.message : "Rename failed",
                        "above",
                    );
                });
            } else {
                infoInput.value = orig;
            }
            infoInput.blur();
            view.focus();
        } else if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            infoInput.value = basenameNoExt(rawSrc);
            infoInput.blur();
            view.focus();
        }
    });

    infoInput.addEventListener("blur", () => {
        // blur 时未提交则恢复原值
        infoInput.value = basenameNoExt(rawSrc);
    });

    infoInput.addEventListener("focus", () => {
        infoInput.select();
    });

    // ── 组装工具栏（固定布局，renameBtn 常驻）────────────────
    toolbar.appendChild(currentInfoEl); // 初始为 infoSpan
    toolbar.appendChild(makeSep());
    toolbar.appendChild(zoomBtn);
    toolbar.appendChild(makeSep());
    toolbar.appendChild(captionBtn);
    toolbar.appendChild(makeSep());
    toolbar.appendChild(renameBtn);     // 常驻
    toolbar.appendChild(makeSep());
    toolbar.appendChild(deleteBtn);

    wrapper.appendChild(img);
    wrapper.appendChild(captionEl);
    wrapper.appendChild(resizeHandle);
    wrapper.appendChild(loadingPlaceholder);
    wrapper.appendChild(errorPlaceholder);
    wrapper.appendChild(toolbar);

    // ── 初始化信息区 ──────────────────────────────────────────
    let rawSrc = (node.attrs["src"] as string) ?? "";
    updateInfo(rawSrc, img.alt);
    updateInfoElement(rawSrc); // 可能将 infoSpan 替换为 infoInput

    // ── Caption 内联编辑（存 title，和 ratio 共存）──────────
    let isEditingCaption = false;

    function startCaptionEdit(): void {
        if (isEditingCaption) return;
        isEditingCaption = true;

        const caption = parseRatio((currentNode.attrs["title"] as string) ?? "").clean;
        startToolbarInlineEdit(toolbar, {
            initialValue: caption,
            placeholder: t("Caption"),
            onConfirm: (newCaption) => {
                isEditingCaption = false;
                const pos = getPos();
                if (pos === undefined) return;
                const newTitle = encodeRatio(newCaption, currentRatio);
                view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
                    ...currentNode.attrs,
                    title: newCaption !== caption ? newTitle : currentNode.attrs.title,
                    alt: newCaption || "",
                }));
                img.alt = newCaption || "";
                captionEl.textContent = newCaption;
                view.focus();
            },
            onCancel: () => {
                isEditingCaption = false;
                view.focus();
            },
        });
    }

    // ── 编辑图片路径（src 属性）────────────────────────────────
    let isEditingSrc = false;

    function startSrcEdit(): void {
        if (isEditingSrc) return;
        isEditingSrc = true;

        startToolbarInlineEdit(toolbar, {
            initialValue: toDisplayPath(rawSrc),
            placeholder: t("Image path or URL"),
            setupComplete: attachImgPathComplete,
            onConfirm: (displayVal, input) => {
                isEditingSrc = false;
                // ① 补全时 dataset 存的 webviewUri 最可靠
                const datasetUri = (input.dataset.imgWebviewUri ?? "").trim();
                // ② 已有映射（init/revert 建立）
                const mappedUri = displayVal ? toWebviewUri(displayVal) : "";

                const applyUri = (newSrc: string) => {
                    if (!newSrc || newSrc === rawSrc) { view.focus(); return; }
                    const pos = getPos();
                    if (pos === undefined) { view.focus(); return; }
                    const nodeSize = currentNode.nodeSize;
                    const tr = view.state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, src: newSrc });
                    const afterPos = pos + nodeSize;
                    if (afterPos <= tr.doc.content.size) {
                        try { tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos), 1)); } catch { /* setNodeMarkup 后节点位置可能偏移，光标恢复失败忽略 */ }
                    }
                    view.dispatch(tr);
                    view.focus();
                };

                if (datasetUri) {
                    applyUri(datasetUri);
                } else if (mappedUri !== displayVal) {
                    applyUri(mappedUri);
                } else if (displayVal) {
                    // 绝对 URL 直接使用，不经过 Extension 解析
                    if (/^https?:\/\//i.test(displayVal)) {
                        applyUri(displayVal);
                    } else {
                        resolveToWebviewUri(displayVal).then(applyUri);
                    }
                }
            },
            onCancel: () => {
                isEditingSrc = false;
                view.focus();
            },
        });
    }

    // ── NodeView 接口 ─────────────────────────────────────────
    return {
        dom: wrapper,

        update(updatedNode: PMNode): boolean {
            if (updatedNode.type !== currentNode.type) {
                return false;
            }
            const newSrc = (updatedNode.attrs["src"] as string) ?? "";
            const newAlt = (updatedNode.attrs["alt"] as string) ?? "";
            if (rawSrc !== newSrc) {
                rawSrc = newSrc;
                imgLoaded = false;
                imgErrored = false;
                imgNaturalH = 0;
                loadingPlaceholder.style.display = "flex";
                errorPlaceholder.style.display = "none";
                img.src = newSrc;
                updateInfoElement(newSrc);
            }
            const newTitle = (updatedNode.attrs["title"] as string) ?? "";
            const { ratio: parsedRatio, clean: caption } = parseRatio(newTitle);
            captionEl.textContent = caption;
            if (currentRatio !== parsedRatio) {
                currentRatio = parsedRatio;
                if (imgNaturalH > 0) applyRatio();
            }
            if (img.alt !== newAlt) {
                img.alt = newAlt;
            }
            currentNode = updatedNode;
            updateInfo(rawSrc, newAlt);
            return true;
        },

        selectNode(): void {
            wrapper.classList.add("image-wrapper--selected");
            toolbar.style.display = "flex";
            resizeHandle.classList.add("img-resize-handle--visible");
            toolbar.classList.add("image-toolbar--below");
        },

        deselectNode(): void {
            wrapper.classList.remove("image-wrapper--selected");
            toolbar.style.display = "none";
            resizeHandle.classList.remove("img-resize-handle--visible");
        },

        stopEvent(e: Event): boolean {
            // 工具栏内的事件（按钮、输入框）阻止 ProseMirror 处理
            return toolbar.contains(e.target as Node);
        },

        ignoreMutation(_m: ViewMutationRecord): boolean {
            // 无 contentDOM，所有 DOM 变动都是 UI 层，ProseMirror 不需要感知
            return true;
        },

        destroy(): void {
            // 清理 lightbox（若此图片触发的 lightbox 仍在显示）
            if (activeLightbox && document.body.contains(activeLightbox)) {
                const lbImg = activeLightbox.querySelector("img");
                if (lbImg && lbImg.src === img.src) {
                    document.body.removeChild(activeLightbox);
                    activeLightbox = null;
                }
            }
        },
    };
}
