import "@milkdown/crepe/theme/classic-dark.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/latex.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/top-bar.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "./style.css"; // 必须在 Crepe CSS 之后加载，用 VSCode 变量覆盖 Crepe 主题
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../shared/constants";
import {
    createEditor,
    getEditorView,
    registerSelectionChangeHandler,
    setLogTableSel,
    setSerializationMode,
    setSerializationDebug,
} from "./editor";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
    notifyReady,
    notifyUpdate,
    notifyFrontmatterUpdate,
    onMessage,
    notifySwitchToTextEditor,
    notifyUploadImage,
    notifyGetProjectImages,
    notifyRenameImage,
    notifyWordCount,
    notifyOpenUrl,
    notifyOpenFile,
    notifyOpenSettings,
    getWebviewState,
    setWebviewState,
} from "./messaging";
import { showImagePicker } from "./components/imagePicker";
import { setupPathLink } from "./components/pathLink";
import { initPathComplete, dispatchPathSuggestions } from "./components/pathLink/pathComplete";
import { dispatchImgPathSuggestions, dispatchImagePathResolved } from "./components/imageView/imgPathComplete";
import { setImageUriMap, showGlobalLightbox } from "./components/imageView";
import { initFindBar } from "./components/findBar";
import { initToc } from "./components/toc";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { applyTooltip } from "./ui/tooltip";
import { IconMaximize2 } from "./ui/icons";
import { t } from "./i18n";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterRow } from "./utils/frontmatter";

let currentEditor: Editor | null = null;
let currentLineMap: number[] = [];
let _debugLog = false;

// 修饰键监听：按住 Ctrl/Meta 时给 body 加 class，链接 hover 显示小手
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) document.body.classList.add('epytor-modifier-active');
});
document.addEventListener('keyup', (e) => {
    if (!e.ctrlKey && !e.metaKey) document.body.classList.remove('epytor-modifier-active');
});
window.addEventListener('blur', () => document.body.classList.remove('epytor-modifier-active'));
export function getLineMap(): number[] {
    return currentLineMap;
}

// 存储原始 markdown 内容（来自 init/revert 消息，未经 Milkdown 序列化）
let markdownSource = "";
export function getMarkdownSource(): string {
    return markdownSource;
}

/** 将 lineMap 中的源码行号（1-indexed）对应的块滚动到视口顶部，段内做比例插值 */
function scrollToSourceLine(view: EditorView, lineMap: number[], targetLine: number): void {
    if (!lineMap.length) { return; }
    let blockIdx = 0;
    for (let i = 0; i < lineMap.length; i++) {
        if (lineMap[i] <= targetLine) { blockIdx = i; }
        else { break; }
    }
    const children = view.dom.children;
    if (blockIdx >= children.length) { return; }
    const el = children[blockIdx] as HTMLElement;
    if (!el) { return; }

    // 段内比例插值：目标行在段落源码中的位置比例 → 对应渲染块中的滚动偏移
    const blockStartLine = lineMap[blockIdx];
    const totalSourceLines = getMarkdownSource().split('\n').length;
    const nextBlockStartLine = blockIdx + 1 < lineMap.length ? lineMap[blockIdx + 1] : totalSourceLines + 1;
    const blockLineCount = nextBlockStartLine - blockStartLine;
    const lineOffset = targetLine - blockStartLine;
    const proportion = blockLineCount > 1 ? Math.min(lineOffset / (blockLineCount - 1), 1) : 0;

    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const elRect = el.getBoundingClientRect();
    const scrollTarget = elRect.top + window.scrollY + elRect.height * proportion - topbarH - VIEWPORT_PADDING * 2;

    if (_debugLog) console.log('[scrollToLine] targetLine:', targetLine, 'blockIdx:', blockIdx, 'lineMap[blockIdx]:', lineMap[blockIdx], 'proportion:', proportion.toFixed(2));
    window.scrollTo({ top: scrollTarget });
}

/** 检测视口顶部对应的源码行号（1-indexed），供切换到文本编辑器时定位用 */
function getFirstVisibleSourceLine(view: EditorView, lineMap: number[]): number {
    if (!lineMap.length) { return 1; }
    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const children = view.dom.children;
    for (let i = 0; i < children.length && i < lineMap.length; i++) {
        const rect = (children[i] as HTMLElement).getBoundingClientRect();
        if (rect.bottom > topbarH + VIEWPORT_PADDING) {
            const result = lineMap[i] ?? 1;
            if (_debugLog) console.log('[getFirstVisible] result:', result, 'blockIdx:', i, 'rect.bottom:', rect.bottom.toFixed(0));
            return result;
        }
    }
    // 全部块都在视口上方（理论上不会发生）→ 返回最后一块
    const fallback = lineMap[Math.min(lineMap.length - 1, children.length - 1)] ?? 1;
    if (_debugLog) console.log('[getFirstVisible] fallback result:', fallback, 'lineMap.length:', lineMap.length);
    return fallback;
}

// ── 图片上传：pending promise map ────────────────────
type UploadCallbacks = {
    resolve: (url: string) => void;
    reject: (e: Error) => void;
};
const _pendingUploads = new Map<string, UploadCallbacks>();

// ── 获取项目图片列表：pending promise map ────────────
type GetImagesCallbacks = {
    resolve: (
        images: Array<{
            relPath: string;
            webviewUri: string;
            name: string;
        }> | null,
    ) => void;
    reject: (e: Error) => void;
};
const _pendingGetImages = new Map<string, GetImagesCallbacks>();

// ── 图片重命名：pending promise map ──────────────────
type RenameCallbacks = { resolve: () => void; reject: (e: Error) => void };
const _pendingRenames = new Map<string, RenameCallbacks>();

async function handleRenameImage(
    webviewUri: string,
    newBasename: string,
): Promise<void> {
    const id = `rename_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                _pendingRenames.delete(id);
                reject(new Error("Rename timed out"));
            }
        }, 15000);
        _pendingRenames.set(id, {
            resolve: () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve();
                }
            },
            reject: (e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(e);
                }
            },
        });
        notifyRenameImage(id, webviewUri, newBasename);
    });
}

async function handleGetProjectImages(
    _unusedId: string,
): Promise<Array<{
    relPath: string;
    webviewUri: string;
    name: string;
}> | null> {
    const id = `gimgs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                _pendingGetImages.delete(id);
                resolve(null);
            }
        }, 10000);
        _pendingGetImages.set(id, {
            resolve: (r) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(r);
                }
            },
            reject: (e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(e);
                }
            },
        });
        notifyGetProjectImages(id);
    });
}

async function handleImageFile(file: File, altText: string): Promise<string> {
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise<string>((resolve, reject) => {
        _pendingUploads.set(id, { resolve, reject });
        const timeoutId = setTimeout(() => {
            if (_pendingUploads.has(id)) {
                _pendingUploads.delete(id);
                reject(new Error("Upload timed out"));
            }
        }, 30000);
        // 读取文件为 Uint8Array 后发送给 Extension
        const reader = new FileReader();
        reader.onload = () => {
            const data = new Uint8Array(reader.result as ArrayBuffer);
            notifyUploadImage(id, data, file.type, altText);
        };
        reader.onerror = () => {
            clearTimeout(timeoutId);
            _pendingUploads.delete(id);
            reject(new Error("Failed to read file"));
        };
        reader.readAsArrayBuffer(file);
    });
}

function insertImageNode(src: string, alt: string): void {
    const editor = currentEditor;
    if (!editor) {
        return;
    }
    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const imageType = state.schema.nodes["image"];
        if (!imageType) {
            return;
        }
        const node = imageType.create({ src, alt, title: "" });
        view.dispatch(state.tr.replaceSelectionWith(node));
        view.focus();
    });
}

// 初始化目录面板
const toc = initToc(() => getEditorView());
document.body.appendChild(toc.panel);

// 初始化查找栏
const findBar = initFindBar(() => document.getElementById("editor"));

/** 在 #editor 前渲染 frontmatter 可编辑面板；无 frontmatter 时移除面板 */
function renderFrontmatterPanel(frontmatter: string | undefined): void {
    const existing = document.getElementById('frontmatter-panel');
    const editorEl = document.getElementById('editor');
    if (!frontmatter) {
        existing?.remove();
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }
    const entries = parseFrontmatter(frontmatter);
    if (entries.length === 0) {
        existing?.remove();
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }

    const panel = existing ?? document.createElement('div');
    panel.id = 'frontmatter-panel';
    panel.className = 'frontmatter-panel';
    panel.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'frontmatter-table';
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    panel.appendChild(table);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const collectRows = (): FrontmatterRow[] => {
        const rows: FrontmatterRow[] = [];
        tbody.querySelectorAll<HTMLTableRowElement>('tr.fm-row').forEach((tr) => {
            const keyInput = tr.querySelector<HTMLInputElement>('.fm-key-input');
            const valueInput = tr.querySelector<HTMLInputElement>('.fm-val-input');
            rows.push({
                key: keyInput?.value ?? "",
                value: valueInput?.value ?? "",
            });
        });
        return rows;
    };
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            notifyFrontmatterUpdate(serializeFrontmatter(collectRows()));
        }, 300);
    };

    const addRow = (key = "", value = ""): void => {
        const tr = document.createElement('tr');
        tr.className = 'fm-row';
        const keyTd = document.createElement('td');
        keyTd.className = 'fm-key';
        const keyInput = document.createElement('input');
        keyInput.className = 'fm-key-input';
        keyInput.value = key;
        keyInput.placeholder = 'key';
        keyInput.spellcheck = false;
        const valTd = document.createElement('td');
        valTd.className = 'fm-val';
        const valueInput = document.createElement('input');
        valueInput.className = 'fm-val-input';
        valueInput.value = value;
        valueInput.placeholder = 'value';
        valueInput.spellcheck = false;
        const delTd = document.createElement('td');
        delTd.className = 'fm-del';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'fm-del-btn';
        delBtn.textContent = '✕';
        delBtn.setAttribute('aria-label', t('Delete'));
        delBtn.addEventListener('click', () => {
            tr.remove();
            scheduleSave();
        });
        delTd.appendChild(delBtn);
        keyTd.appendChild(keyInput);
        valTd.appendChild(valueInput);
        tr.append(keyTd, valTd, delTd);
        tbody.appendChild(tr);
        keyInput.addEventListener('input', scheduleSave);
        valueInput.addEventListener('input', scheduleSave);
        keyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); valueInput.focus(); }
        });
        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addRow();
                tbody.querySelector<HTMLInputElement>('tr:last-child .fm-key-input')?.focus();
            }
        });
    };

    for (const { key, value } of entries) {
        addRow(key, value);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fm-add-btn';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', t('Add'));
    addBtn.addEventListener('click', () => {
        addRow();
        tbody.querySelector<HTMLInputElement>('tr:last-child .fm-key-input')?.focus();
    });
    panel.appendChild(addBtn);

    const editor = document.getElementById('editor');
    if (!existing) {
        editor?.parentNode?.insertBefore(panel, editor);
    }
    // 有 frontmatter 面板时，editor 的顶部 padding 由面板承担，只保留间距
    if (editor) { editor.style.paddingTop = '16px'; }
}

/** Word 风格字数：CJK 字符逐字 + 非 CJK 连续串计 1 + 空格不计 */
function countWords(text: string): number {
    let count = 0;
    let inNonCjk = false;
    const cjkRe = /[一-鿿㐀-䶿豈-﫿]/;
    for (const ch of text) {
        if (/\s/.test(ch)) {
            inNonCjk = false;
        } else if (cjkRe.test(ch)) {
            inNonCjk = false;
            count++;
        } else {
            if (!inNonCjk) {
                inNonCjk = true;
                count++;
            }
        }
    }
    return count;
}

/** 计算字数统计并通知 Extension 更新状态栏 */
function updateWordCount(): void {
    const view = getEditorView();
    if (!view) return;
    const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
    notifyWordCount(
        text.split("\n").length,
        countWords(text),
        text.replace(/\s/g, "").length,
        text.length,
    );
}

async function initEditor(
    container: HTMLElement,
    markdown: string,
): Promise<void> {
    // 销毁旧编辑器（revert 时使用）
    if (currentEditor) {
        currentEditor.destroy();
        currentEditor = null;
        container.innerHTML = "";
    }

    currentEditor = await createEditor(
        container,
        markdown,
        (updated) => {
            notifyUpdate(updated);
            toc.refresh(); // 内容变化时刷新目录（面板关闭时是 no-op）
            updateWordCount(); // 更新字数统计
        },
        handleRenameImage,
        () => toc.toggle(),
        window.__i18n?.serializationMode ?? "clean",
    );
    toc.updatePosition(); // 工具栏已就绪，更新 TOC 吸顶位置
    toc.refresh(); // 编辑器初始化完成后刷新一次
    toc.show();    // toolbar 就绪，显示 TOC 面板
    updateWordCount(); // 编辑器初始化完成后统计一次
}

// 链接 Hover 弹框（在 #editor 容器上监听）
const editorContainer = document.getElementById("editor");
if (editorContainer) {
	    // 阻止链接默认跳转 + Cmd/Ctrl+Click 打开 + 锚点跳转
	    // 阻止链接默认跳转 + Ctrl/Cmd+Click 打开 + 锚点跳转
	    editorContainer.addEventListener("click", (e) => {
	        const anchor = (e.target as Element).closest("a");
	        if (!anchor) return;
	        const href = anchor.getAttribute("href") ?? "";
	        e.preventDefault();
	        e.stopImmediatePropagation();
	        if (href.startsWith("#")) {
	            const el = document.getElementById(href.slice(1));
	            if (el) {
	                const tb = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
	                const th = tb?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
	                window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - th - VIEWPORT_PADDING, behavior: "smooth" });
	            }
	            return;
	        }
	        if (e.ctrlKey || e.metaKey) {
	            const clean = href.split("#")[0];
	            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(clean)) notifyOpenUrl(clean);
	            else notifyOpenFile(clean);
	        }
	    }, true);
		    // 滚动时关闭 link tooltip：先解除 hover 锁定，再隐藏
	    window.addEventListener("scroll", () => {
	        document.querySelectorAll(
	            ".milkdown-link-preview, .milkdown-link-edit"
	        ).forEach(el => {
	            el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
	            requestAnimationFrame(() => {
	                const htmlEl = el as HTMLElement;
	                htmlEl.dataset.show = "false";
	            });
	        });
	    }, true);
	    // 工具栏图片插入 → 弹出选择器（上传 + 项目图片库 + URL）
    document.addEventListener('epytor:insertImage', () => {
        showImagePicker(
            (file) => {
                handleImageFile(file, '').then(url => insertImageNode(url, '')).catch(() => {});
            },
            (relPath) => {
                insertImageNode(relPath, '');
            },
            (url) => {
                insertImageNode(url, '');
            },
            () => {
                const id = `gimgs_${Date.now().toString(36)}`;
                return new Promise<any>((resolve) => {
                    _pendingGetImages.set(id, { resolve, reject: () => {} });
                    notifyGetProjectImages(id);
                });
            },
        );
    });
    // 保留快速上传 file input（供拖拽和粘贴复用）
    const imgFileInput = document.createElement('input');
    imgFileInput.type = 'file'; imgFileInput.accept = 'image/*';
    imgFileInput.style.display = 'none';
    document.body.appendChild(imgFileInput);
    document.addEventListener('epytor:openSettings', () => notifyOpenSettings());
    setupPathLink(editorContainer);
    initPathComplete(() => getEditorView());
    enhanceCodeBlocks(editorContainer);
    setupTopBarTooltips(editorContainer);
    setupTopBarBrand(editorContainer);

    // 图片 lightbox：双击/Ctrl+Click 图片放大查看
    editorContainer.addEventListener("mousedown", (e) => {
        const img = (e.target as Element).closest<HTMLImageElement>(
            ".image-wrapper img",
        );
        if (!img || !img.src) return;
        if (e.detail === 2 || (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
            e.preventDefault();
            e.stopPropagation();
            showGlobalLightbox(img.src, img.alt);
        }
    });

    // 点击 #editor 容器底部空白区域（内容最后一行以下）→ 光标移到文档末尾并聚焦
    editorContainer.addEventListener("mousedown", (e) => {
        const view = getEditorView();
        if (!view) { return; }
        // 点到 ProseMirror 内容区域内则不干预，让编辑器自己处理
        if (view.dom.contains(e.target as Node)) { return; }
        // 只响应内容最后一个块底部以下的点击（排除左/右/顶部 padding 区域）
        const lastChild = view.dom.lastElementChild;
        if (!lastChild) { return; }
        const lastRect = lastChild.getBoundingClientRect();
        if (e.clientY <= lastRect.bottom) { return; }
        e.preventDefault();
        const { state } = view;
        const sel = TextSelection.atEnd(state.doc);
        view.dispatch(state.tr.setSelection(sel));
        view.focus();
    });

    // 拖放图片文件到编辑器
    editorContainer.addEventListener("dragover", (e) => {
        const items = e.dataTransfer?.items;
        if (
            items &&
            Array.from(items).some(
                (i) => i.kind === "file" && i.type.startsWith("image/"),
            )
        ) {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    editorContainer.addEventListener("drop", (e) => {
        const files = e.dataTransfer?.files;
        if (!files?.length) {
            return;
        }
        const imageFile = Array.from(files).find((f) =>
            f.type.startsWith("image/"),
        );
        if (!imageFile) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleImageFile(imageFile, "")
            .then((url) => {
                insertImageNode(url, "");
            })
            .catch((err: Error) =>
                console.error("[ImageUpload] drop failed:", err),
            );
    });
}

// 粘贴图片（全局监听，优先处理图片，其他内容交给编辑器自身处理）
document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) {
        return;
    }
    const imageItem = Array.from(items).find((i) =>
        i.type.startsWith("image/"),
    );
    if (!imageItem) {
        return;
    }
    const file = imageItem.getAsFile();
    if (!file) {
        return;
    }
    e.preventDefault();
    handleImageFile(file, "")
        .then((url) => {
            insertImageNode(url, "");
        })
        .catch((err: Error) =>
            console.error("[ImageUpload] paste failed:", err),
        );
});


// ── 代码块复制 + 全屏 ───────────────────────────────────────────────────────

function enhanceCodeBlocks(container: HTMLElement): void {
    // ── 复制按钮：点击后弹 ✔ 提示 ────────────────────────────────────
    container.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('.copy-button') as HTMLElement | null;
        if (!btn) return;
        setTimeout(() => {
            const tip = applyTooltip(btn, '✔ ' + t('Copied!'));
            tip.show();
            setTimeout(() => tip.setText(t('Copy Code')), 1500);
        }, 100);
    });

    // ── 全屏按钮（我们的自定义功能，不是 Crepe 的，直接创建）─────────────
    const addFullscreenBtn = (block: Element): void => {
        const copyBtn = block.querySelector('.copy-button') as HTMLElement | null;
        if (copyBtn && !copyBtn.dataset.tip) { copyBtn.dataset.tip = '1'; applyTooltip(copyBtn, t('Copy Code')); }
        const previewBtn = block.querySelector('.preview-toggle-button') as HTMLElement | null;
        if (previewBtn && !previewBtn.dataset.tip) { previewBtn.dataset.tip = '1'; applyTooltip(previewBtn, t('Toggle preview')); }

        if (block.querySelector('.epytor-fullscreen-btn')) return;
        const btnGroup = block.querySelector('.tools-button-group');
        if (!btnGroup) return;

        const fsBtn = document.createElement('button');
        fsBtn.className = 'epytor-fullscreen-btn';
        fsBtn.innerHTML = IconMaximize2;
        applyTooltip(fsBtn, t('View Fullscreen'));
        fsBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const cmEditor = block.querySelector('.cm-editor') as HTMLElement | null;
            const cmHost = block.querySelector('.codemirror-host') as HTMLElement | null;
            const previewPanel = block.querySelector('.preview-panel') as HTMLElement | null;
            if (!cmEditor) return;
            const langBtn = block.querySelector('.language-button');
            const lang = langBtn?.textContent?.trim() || '';

            const lb = document.createElement('div');
            lb.className = 'epytor-fs-lightbox';
            const header = document.createElement('div');
            header.className = 'epytor-fs-header';
            const langSpan = document.createElement('span');
            langSpan.className = 'epytor-fs-lang';
            langSpan.textContent = lang;  // 安全注入，避免 XSS
            const closeBtn = document.createElement('button');
            closeBtn.className = 'epytor-fs-close';
            closeBtn.textContent = '✕';
            header.appendChild(langSpan);
            header.appendChild(closeBtn);
            const body = document.createElement('div');
            body.className = 'epytor-fs-body';
            lb.appendChild(header);
            lb.appendChild(body);
            document.body.appendChild(lb);
            body.appendChild(cmEditor);
            if (previewPanel) body.appendChild(previewPanel);

            const close = () => {
                if (cmHost && cmEditor.parentElement !== cmHost) cmHost.appendChild(cmEditor);
                if (previewPanel && previewPanel.parentElement !== block) block.appendChild(previewPanel);
                if (document.body.contains(lb)) document.body.removeChild(lb);
                document.removeEventListener('keydown', onKey);
            };
            const onKey = (ke: KeyboardEvent) => {
                if (ke.key === 'Escape') { ke.preventDefault(); close(); }
            };
            document.addEventListener('keydown', onKey);
            lb.querySelector('.epytor-fs-close')!.addEventListener('mousedown', (me) => { me.preventDefault(); close(); });
            lb.addEventListener('mousedown', (me) => { if (me.target === lb) close(); });
        });
        btnGroup.appendChild(fsBtn);
    };

    // 初次 + 后续代码块都加上全屏按钮
    const scanBlocks = () => container.querySelectorAll('.milkdown-code-block').forEach(addFullscreenBtn);
    requestAnimationFrame(scanBlocks);
    new MutationObserver(() => requestAnimationFrame(scanBlocks))
        .observe(container, { childList: true, subtree: true });

    // 语言搜索框键盘导航
    container.addEventListener('keydown', (e) => {
        const input = e.target as HTMLElement;
        if (!input.closest('.search-box')) return;
        const list = input.closest('.list-wrapper')?.querySelector('.language-list');
        if (!list) return;
        const items = list.querySelectorAll<HTMLElement>('.language-list-item');
        if (items.length === 0) return;
        const focused = list.querySelector<HTMLElement>('.language-list-item.focused');
        let idx = -1;
        if (focused) items.forEach((el, i) => { if (el === focused) idx = i; });
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(idx + 1, items.length - 1);
            items.forEach(el => el.classList.remove('focused'));
            items[next].classList.add('focused');
            items[next].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(idx - 1, 0);
            items.forEach(el => el.classList.remove('focused'));
            items[prev].classList.add('focused');
            items[prev].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focused) focused.click();
        }
    });
}

/** 为 Crepe top-bar 按钮添加自定义 tooltip（i18n 翻译，无快捷键） */
function setupTopBarTooltips(container: HTMLElement): void {
    const TOOLTIPS = [
        t('Table of Contents'), // toc
        t('Undo'),             // history: undo
        t('Redo'),             // history: redo
        t('Bold'),             // formatting: bold
        t('Italic'),           // formatting: italic
        t('Strikethrough'),    // formatting: strikethrough
        t('Inline Code'),      // formatting: code
        t('Clear Formatting'), // formatting: clear-format
        t('Bullet List'),      // list: bullet
        t('Ordered List'),     // list: ordered
        t('Task List'),        // list: task
        t('Insert/Edit Link'), // insert: link
        t('Insert Image'),     // insert: image
        t('Insert Table'),     // insert: table
        t('Code Block'),       // block: code-block
        t('Math Formula'),     // block: math
        t('Blockquote'),       // more: quote
        t('Horizontal Rule'),  // more: hr
        t('Settings'),         // settings
    ];

    const applyAll = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar) return;
        const items = topBar.querySelectorAll<HTMLElement>('.top-bar-item');
        items.forEach((item, idx) => {
            if (item.dataset.tip) return;
            const text = TOOLTIPS[idx];
            if (text) {
                item.dataset.tip = '1';
                applyTooltip(item, text, { placement: 'below' });
            }
        });
    };

    requestAnimationFrame(applyAll);
    new MutationObserver(() => requestAnimationFrame(applyAll))
        .observe(container, { childList: true, subtree: true });
}

/** 将 EPYTOR🦖 品牌标识注入为 top-bar 真实 flex 子元素（替代 CSS ::after） */
function setupTopBarBrand(container: HTMLElement): void {
    const inject = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar || topBar.querySelector('.epytor-brand')) return;
        const brand = document.createElement('span');
        brand.className = 'epytor-brand';
        brand.textContent = 'EPYTOR🦖';
        topBar.insertBefore(brand, topBar.firstChild);
    };
    requestAnimationFrame(inject);
    new MutationObserver(() => requestAnimationFrame(inject))
        .observe(container, { childList: true, subtree: true });
}

registerSelectionChangeHandler((_view) => {
    // 选区变更回调保留，供后续扩展使用
});

// Cmd/Ctrl+F：打开查找栏（预填当前选区文字）
window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyF" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const view = getEditorView();
        let initialQuery: string | undefined;
        if (view) {
            const { selection, doc } = view.state;
            if (!selection.empty) {
                const text = doc.textBetween(selection.from, selection.to);
                if (text.trim()) { initialQuery = text; }
            }
        }
        findBar.open(initialQuery);
    }
});

// Cmd/Ctrl+Shift+M：切换到文本编辑器（附带当前视口顶部行号，供文本编辑器定位）
window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        const view = getEditorView();
        const line = view ? getFirstVisibleSourceLine(view, currentLineMap) : undefined;
        notifySwitchToTextEditor(line);
    }
});

// WebView 加载完成，通知 Extension 侧发送初始内容
notifyReady();

// ── 滚动位置持久化 ────────────────────────────────────────────
// 保存：滚动时防抖写入 VSCode WebView 状态（跨会话可恢复）
let _scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('scroll', () => {
    if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
        const cur = getWebviewState() ?? {};
        setWebviewState({ ...cur, scrollY: window.scrollY });
    }, 200);
}, { passive: true });

// 恢复（主路径）：tab 切换时 iframe 被隐藏再显示，浏览器会重置 scrollY
// visibilitychange 触发时读取已保存位置并还原
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const state = getWebviewState();
    if (state?.scrollY !== undefined) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: state.scrollY as number });
        });
    }
});
// ─────────────────────────────────────────────────────────────

// 监听来自 Extension 侧的消息
onMessage(async (msg) => {
    const container = document.getElementById("editor");
    if (!container) {
        return;
    }

    if (msg.type === "init" || msg.type === "revert") {
        markdownSource = msg.content; // 保存原始内容，供行号搜索使用
        currentLineMap = msg.lineMap ?? [];
        renderFrontmatterPanel(msg.frontmatter);
        if (msg.imageUriMap) { setImageUriMap(msg.imageUriMap); }
        await initEditor(container, msg.content);
        // 新 WebView 打开时主动获取 DOM 焦点。
        // 若不调用：旧 WebView（path-link-test.md）在 Cmd+Click 后 blur() 释放了焦点，
        // 但新 WebView（README.md）的 iframe 未必自动获得焦点；
        // VS Code 可能仍将 Cmd+W 路由到旧 iframe，导致两个 .md 标签都被关闭。
        // init 仅在首次打开时触发（revert 是内容变更），此处只对首次打开生效。
        if (msg.type === "init") {
            window.focus();
        }
        // 全局搜索导航或切换回预览时，滚动到指定源码行
        // Milkdown 渲染 + 浏览器布局需要时间，多次重试确保 DOM 就绪后才滚动
        if (msg.type === "init" && msg.scrollToLine) {
            const targetLine = msg.scrollToLine;
            let scrollDone = false;
            const tryScroll = () => {
                if (scrollDone) { return; }
                const view = getEditorView();
                if (!view) { return; }
                // 检查第一个块的 DOM 高度：若为 0 说明布局尚未完成
                const firstChild = view.dom.children[0] as HTMLElement | undefined;
                if (!firstChild || firstChild.getBoundingClientRect().height === 0) { return; }
                scrollToSourceLine(view, currentLineMap, targetLine);
                scrollDone = true;
            };
            // 300ms 首试（Milkdown 渲染需要时间），若失败则在 600ms / 1100ms / 2000ms 继续重试
            for (const delay of [300, 600, 1100, 2000]) {
                setTimeout(tryScroll, delay);
            }
        } else if (msg.type === "init") {
            // WebView 重建场景（VSCode 重启恢复标签页等）：从持久状态恢复滚动位置
            const saved = getWebviewState();
            if (saved?.scrollY) {
                const targetY = saved.scrollY as number;
                let restoreDone = false;
                const tryRestore = () => {
                    if (restoreDone) return;
                    const view = getEditorView();
                    if (!view) return;
                    const firstChild = view.dom.children[0] as HTMLElement | undefined;
                    if (!firstChild || firstChild.getBoundingClientRect().height === 0) return;
                    window.scrollTo({ top: targetY });
                    restoreDone = true;
                };
                for (const delay of [300, 600, 1100, 2000]) {
                    setTimeout(tryRestore, delay);
                }
            }
        }
    } else if (msg.type === "requestSwitchToTextEditor") {
        // 来自菜单按钮/命令面板的"切换到文本编辑器"请求
        // 与 Cmd+Shift+M 快捷键逻辑相同：先获取当前可见行再通知 Extension
        const view = getEditorView();
        const line = view ? getFirstVisibleSourceLine(view, currentLineMap) : undefined;
        notifySwitchToTextEditor(line);
    } else if (msg.type === "scrollToLine") {
        // 面板已打开时（如全局搜索点击已打开文件）直接滚动
        // 若 initEditor 正在重建（getEditorView 返回 null），最多重试 8 次
        const scrollLine = msg.line;
        let scrollAttempts = 0;
        const tryScrollNow = () => {
            const view = getEditorView();
            if (view) {
                scrollToSourceLine(view, currentLineMap, scrollLine);
            } else if (scrollAttempts < 8) {
                scrollAttempts++;
                setTimeout(tryScrollNow, 250);
            }
        };
        tryScrollNow();
    } else if (msg.type === "lineMapUpdate") {
        currentLineMap = msg.lineMap;
    } else if (msg.type === "setDebugMode") {
        _debugLog = msg.enabled;
        setLogTableSel(msg.enabled);
        setSerializationDebug(msg.enabled);
    } else if (msg.type === "setSerializationMode") {
        setSerializationMode(msg.mode);
    } else if (msg.type === "imageUploaded") {
        const cb = _pendingUploads.get(msg.id);
        if (cb) {
            _pendingUploads.delete(msg.id);
            cb.resolve(msg.url);
        }
    } else if (msg.type === "imageUploadError") {
        const cb = _pendingUploads.get(msg.id);
        if (cb) {
            _pendingUploads.delete(msg.id);
            cb.reject(new Error(msg.error));
        }
    } else if (msg.type === "projectImagesList") {
        const cb = _pendingGetImages.get(msg.id);
        if (cb) {
            _pendingGetImages.delete(msg.id);
            cb.resolve(msg.images);
        }
    } else if (msg.type === "imageRenamed") {
        const cb = _pendingRenames.get(msg.id);
        if (cb) {
            _pendingRenames.delete(msg.id);
            cb.resolve();
        }
        // 更新 ProseMirror 文档中对应图片节点的 src
        const editor = currentEditor;
        if (editor) {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const { state } = view;
                const tr = state.tr;
                let changed = false;
                state.doc.descendants((node, pos) => {
                    if (
                        node.type.name === "image" &&
                        node.attrs["src"] === msg.oldWebviewUri
                    ) {
                        tr.setNodeMarkup(pos, null, {
                            ...node.attrs,
                            src: msg.newWebviewUri,
                        });
                        changed = true;
                    }
                });
                if (changed) {
                    view.dispatch(tr);
                }
            });
        }
    } else if (msg.type === "imageRenameError") {
        const cb = _pendingRenames.get(msg.id);
        if (cb) {
            _pendingRenames.delete(msg.id);
            cb.reject(new Error(msg.error));
        }
    } else if (msg.type === "pathSuggestions") {
        dispatchPathSuggestions(msg.id, msg.items);
        dispatchImgPathSuggestions(msg.id, msg.items);
    } else if (msg.type === "imagePathResolved") {
        dispatchImagePathResolved(msg.id, msg.webviewUri);
    }
});
