import "@milkdown/crepe/theme/classic-dark.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/top-bar.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
// LaTeX 样式改为本地摘录版（不含 katex.min.css —— 三格式字体 base64 内联 ~1.4MB，
// 是 webview.css 膨胀主因；KaTeX 样式随首个数学渲染按需加载，见 vendor/latexFeature.ts）
import "./latex.css";
import "./style.css"; // 必须在 Crepe CSS 之后加载，用 VSCode 变量覆盖 Crepe 主题
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING, OPEN_URL_SCHEMES, extractUrlScheme } from "../shared/constants";
import { resolveTableWrapVars } from "../shared/tableWrap";
import type { ToWebviewMessage } from "../shared/messages";
import { PendingRequestRegistry } from "./utils/pendingRequest";
import { applyTableWrapVars } from "./utils/tableWrap";
import { computeHeadingSignature } from "./utils/headingFold";
import {
    createEditor,
    destroyEditor,
    getEditorView,
    getMarkdownForSave,
    setLogTableSel,
    setSerializationMode,
    setSerializationDebug,
} from "./editor";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
    notifyReady,
    notifyMarkDirty,
    notifyContentResponse,
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
import { t } from "./i18n";
import { createFrontmatterPanel, type FrontmatterPanelHandle } from "./components/frontmatterPanel";
import { initTopBarOverflow } from "./components/topBarOverflow";
import { enhanceCodeBlocks } from "./components/codeBlockEnhance";
import { setupTopBarBrand, setupTopBarTooltips } from "./components/topBar/topBarDecorations";

// ─── 语义常量（*_MS 命名；回归：超时/防抖裸数字散落各处理函数） ─────────────
const RENAME_IMAGE_TIMEOUT_MS = 15000;
const UPLOAD_IMAGE_TIMEOUT_MS = 30000;
const GET_PROJECT_IMAGES_TIMEOUT_MS = 10000;
const MARK_DIRTY_DEBOUNCE_MS = 300;
const TOC_REFRESH_DEBOUNCE_MS = 800;
const SCROLL_SAVE_DEBOUNCE_MS = 200;
/** 延迟定位/恢复滚动的重试计划（Milkdown 渲染 + 浏览器布局需要时间） */
const SCROLL_RETRY_DELAYS_MS = [300, 600, 1100, 2000];

let _topBarOverflowCtl: { dispose(): void } | null = null;

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
// 请求-响应注册表（settled 双保险 + 超时，统一三种宿主请求样板，见 utils/pendingRequest）
const _uploadRequests = new PendingRequestRegistry<string>("img");

// ── 获取项目图片列表：pending promise map ────────────
const _getImagesRequests = new PendingRequestRegistry<Array<{
    relPath: string;
    webviewUri: string;
    name: string;
}> | null>("gimgs");

// ── 图片重命名：pending promise map ──────────────────
const _renameRequests = new PendingRequestRegistry<void>("rename");

async function handleRenameImage(
    webviewUri: string,
    newBasename: string,
): Promise<void> {
    const { id, promise } = _renameRequests.begin({
        timeoutMs: RENAME_IMAGE_TIMEOUT_MS,
        timeout: { kind: "reject", error: "Rename timed out" },
    });
    notifyRenameImage(id, webviewUri, newBasename);
    return promise;
}

async function handleImageFile(file: File, altText: string): Promise<string> {
    const { id, promise, cancel } = _uploadRequests.begin({
        timeoutMs: UPLOAD_IMAGE_TIMEOUT_MS,
        timeout: { kind: "reject", error: "Upload timed out" },
    });
    // 读取文件为 Uint8Array 后发送给 Extension
    const reader = new FileReader();
    reader.onload = () => {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        notifyUploadImage(id, data, file.type, altText);
    };
    reader.onerror = () => cancel("Failed to read file");
    reader.readAsArrayBuffer(file);
    return promise;
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
let _frontmatterPanelHandle: FrontmatterPanelHandle | null = null;
/** 文档变更后 UI 刷新（TOC/字数/脏标记）的防抖 timer */
let _docChangedTimer: ReturnType<typeof setTimeout> | null = null;
/** TOC/字数刷新 timer（更长防抖 + rAF，挪出输入热路径——万行文档全量重建 TOC 是上屏后卡顿来源） */
let _tocRefreshTimer: ReturnType<typeof setTimeout> | null = null;
/** 上次 TOC 刷新的标题签名（标题结构未变则跳过重建） */
let _lastTocSignature = "";

/** 释放两个防抖 timer（编辑器销毁/重建前调用）——旧防抖回调会污染新文档：
 * 回归：revert 重建编辑器未清理 timer，≤300ms 后旧回调把已还原的文档标脏、
 * 旧 _tocRefreshTimer 对新 view 做多余全量刷新 */
function releaseDocTimers(): void {
    if (_docChangedTimer !== null) {
        clearTimeout(_docChangedTimer);
        _docChangedTimer = null;
    }
    if (_tocRefreshTimer !== null) {
        clearTimeout(_tocRefreshTimer);
        _tocRefreshTimer = null;
    }
}

function renderFrontmatterPanel(frontmatter: string | undefined): void {
    const editorEl = document.getElementById('editor');
    if (!frontmatter) {
        _frontmatterPanelHandle?.dispose();
        _frontmatterPanelHandle = null;
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }
    // 重建前先 dispose 旧实例，取消其防抖 timer（防止 revert 后旧编辑写回）
    _frontmatterPanelHandle?.dispose();
    _frontmatterPanelHandle = createFrontmatterPanel(frontmatter, (serialized) => {
        notifyFrontmatterUpdate(serialized);
    });
    if (!_frontmatterPanelHandle) {
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }
    const editor = document.getElementById('editor');
    editor?.parentNode?.insertBefore(_frontmatterPanelHandle.panel, editor);
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
    // 销毁旧编辑器（revert 时使用）；destroyEditor 会连带清理主题订阅与观察器
    if (currentEditor) {
        destroyEditor();
        currentEditor = null;
        container.innerHTML = "";
        releaseDocTimers();
        _topBarOverflowCtl?.dispose();
        _topBarOverflowCtl = null;
    }

    currentEditor = await createEditor(
        container,
        markdown,
        () => {
            // 文档变更轻量通知（序列化已在保存时拉取，这里只做 UI 刷新 + 脏标记）
            if (_docChangedTimer) clearTimeout(_docChangedTimer);
            _docChangedTimer = setTimeout(() => {
                notifyMarkDirty(); // 通知 Extension 内容已变（自动保存防抖到点后拉取）
            }, MARK_DIRTY_DEBOUNCE_MS);
            // TOC/字数：标题签名不变则跳过 TOC 重建（根源级优化：输入正文零重建，
            // 替代纯防抖延时——停顿后仍会重建的开销被真正消除）；字数统计轻量照常
            if (_tocRefreshTimer) clearTimeout(_tocRefreshTimer);
            _tocRefreshTimer = setTimeout(() => {
                requestAnimationFrame(() => {
                    const view = getEditorView();
                    if (view) {
                        const sig = computeHeadingSignature(view.state.doc);
                        if (sig === _lastTocSignature) return;
                        _lastTocSignature = sig;
                    }
                    toc.refresh(); // 内容变化时刷新目录（面板关闭时是 no-op）
                    updateWordCount(); // 更新字数统计
                });
            }, TOC_REFRESH_DEBOUNCE_MS);
        },
        handleRenameImage,
        () => toc.toggle(),
        window.__i18n?.serializationMode ?? "clean",
    );
    toc.updatePosition(); // 工具栏已就绪，更新 TOC 吸顶位置
    toc.refresh(); // 编辑器初始化完成后刷新一次
    toc.show();    // toolbar 就绪，显示 TOC 面板
    updateWordCount(); // 编辑器初始化完成后统计一次

    // 顶栏溢出菜单（topBar 已渲染后初始化）
    _topBarOverflowCtl = initTopBarOverflow({
        getTopBarEl: () => document.querySelector<HTMLElement>(".milkdown-top-bar"),
        runItem: (meta) => {
            currentEditor?.action((ctx) => {
                meta.onRun(ctx);
                // 执行后把焦点还给编辑器（按钮点击会夺焦）
                ctx.get(editorViewCtx).focus();
            });
        },
    });
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
	            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(clean)) {
	                // 协议白名单：file:/javascript:/自定义协议不发往 Extension（回归：无白名单）
	                if (OPEN_URL_SCHEMES.has(extractUrlScheme(clean))) notifyOpenUrl(clean);
	            }
	            else notifyOpenFile(clean);
	        }
	    }, true);
		    // 滚动时关闭 link tooltip：先解除 hover 锁定，再隐藏。
		    // rAF 节流 + 无浮层零工作（回归：每个 scroll 事件全量 querySelectorAll +
		    // 合成 pointerleave 派发，即使没有任何打开的浮层也照常执行）
	    let linkTipCloseRaf = 0;
	    window.addEventListener("scroll", () => {
	        if (linkTipCloseRaf) return;
	        linkTipCloseRaf = requestAnimationFrame(() => {
	            linkTipCloseRaf = 0;
	            const els = document.querySelectorAll(
	                ".milkdown-link-preview, .milkdown-link-edit"
	            );
	            if (els.length === 0) return;
	            els.forEach(el => {
	                el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
	                requestAnimationFrame(() => {
	                    const htmlEl = el as HTMLElement;
	                    htmlEl.dataset.show = "false";
	                });
	            });
	        });
	    }, true);
	    // 工具栏图片插入 → 弹出选择器（上传 + 项目图片库 + URL）
    document.addEventListener('epytor:insertImage', () => {
        showImagePicker(
            (file) => {
                // 错误向上传播给选择器展示（回归：此处空 catch 吞掉失败，选完文件无事发生）
                return handleImageFile(file, '').then(url => insertImageNode(url, ''));
            },
            (relPath) => {
                insertImageNode(relPath, '');
            },
            (url) => {
                insertImageNode(url, '');
            },
            () => {
                // 统一注册表：含 10s 超时兜底 resolve(null)（回归：内联版无超时，
                // Extension 不响应时选择器永久停在 Loading）
                const { id, promise } = _getImagesRequests.begin({
                    timeoutMs: GET_PROJECT_IMAGES_TIMEOUT_MS,
                    timeout: { kind: "resolve", value: null },
                });
                notifyGetProjectImages(id);
                return promise;
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
    }, SCROLL_SAVE_DEBOUNCE_MS);
}, { passive: true });

// 切回 webview 时恢复编辑器焦点（不滚动）。
// 诊断日志证实：VS Code 切 tab 时 webview 的 visibilitychange 不触发（visibility 恒 visible），
// 必须用 window focus 事件（webview 重新激活时触发）
const restoreEditorFocus = () => {
    requestAnimationFrame(() => {
        const view = getEditorView();
        if (view && !view.hasFocus()) {
            // 面板输入框有焦点时不抢（用户可能正在编辑 frontmatter/查找框）
            const active = document.activeElement;
            if (
                active instanceof HTMLInputElement ||
                active instanceof HTMLTextAreaElement
            ) {
                return;
            }
            // 恢复焦点但不得滚动：ProseMirror focus() 会把光标位置 scrollIntoView，
            // 导致切回后页面跳到标题行/mermaid 处（回归：frontmatter 编辑行点击后页面跳）
            const scrollBefore = window.scrollY;
            view.focus();
            if (window.scrollY !== scrollBefore) {
                window.scrollTo({ top: scrollBefore });
            }
        }
    });
};
window.addEventListener("focus", restoreEditorFocus);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const state = getWebviewState();
    if (state?.scrollY !== undefined) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: state.scrollY as number });
        });
    }
    restoreEditorFocus();
});
// ─────────────────────────────────────────────────────────────

// ── 用户交互保护：延迟定位滚动不得覆盖用户已开始的交互 ──────
// 回归：1 万行文档渲染慢，切回预览的「定位到文本编辑器光标行」在 300-2000ms
// 重试期间才执行，用户已开始编辑/点击时页面突然跳到标题行/mermaid 处
let _userInteracted = false;
for (const evt of ["wheel", "mousedown", "keydown", "touchstart"] as const) {
    window.addEventListener(
        evt,
        () => {
            _userInteracted = true;
        },
        { passive: true },
    );
}

// 监听来自 Extension 侧的消息
// init/revert（编辑器生命周期）串行链：并发到达时按序重建——
// 回归：旧实现无互斥，首次 init 的 createEditor 尚未 resolve 时 revert 到达，
// 两个 createEditor 在同一容器并发执行，先完成的 DOM 被后者清空、实例孤儿化
let _editorLifecycleChain: Promise<unknown> = Promise.resolve();

onMessage((msg) => {
    const container = document.getElementById("editor");
    if (!container) {
        return;
    }
    if (msg.type === "init" || msg.type === "revert") {
        _editorLifecycleChain = _editorLifecycleChain.then(() =>
            handleEditorLifecycleMessage(msg, container).catch((err) => {
                // 编辑器重建失败：给出诊断而非静默白屏
                // （回归：异常穿透 async 回调后页面无任何提示、什么都渲染不出来）
                console.error("[epytor] 编辑器初始化失败:", err);
            }),
        );
        return _editorLifecycleChain;
    }
    return handleRegularMessage(msg);
});

/**
 * 延迟执行滚动类动作的统一状态机（三处调用合一：搜索定位 / 恢复滚动位置 / 打开面板时的行定位）：
 * 按 delays 计划重试；DOM 未就绪（view 缺失或首块高度为 0）时等待下一次；用户一旦开始交互
 * 即放弃，避免渲染慢时延迟定位突然跳动页面。调用时重置 _userInteracted 起算。
 */
function scheduleDelayedScroll(
    action: (view: EditorView) => void,
    delays: number[] = SCROLL_RETRY_DELAYS_MS,
): void {
    _userInteracted = false; // 本次定位请求起算
    let done = false;
    const tryOnce = () => {
        if (done) return;
        if (_userInteracted) { done = true; return; }
        const view = getEditorView();
        if (!view) return;
        // 检查第一个块的 DOM 高度：若为 0 说明布局尚未完成
        const firstChild = view.dom.children[0] as HTMLElement | undefined;
        if (!firstChild || firstChild.getBoundingClientRect().height === 0) return;
        action(view);
        done = true;
    };
    for (const delay of delays) {
        setTimeout(tryOnce, delay);
    }
}

/** init/revert：编辑器重建（串行执行，见 _editorLifecycleChain） */
async function handleEditorLifecycleMessage(
    msg: Extract<ToWebviewMessage, { type: "init" | "revert" }>,
    container: HTMLElement,
): Promise<void> {
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
        // Milkdown 渲染 + 浏览器布局需要时间，统一走 scheduleDelayedScroll 重试
        if (msg.type === "init" && msg.scrollToLine) {
            const targetLine = msg.scrollToLine;
            scheduleDelayedScroll((view) => {
                scrollToSourceLine(view, currentLineMap, targetLine);
            });
        } else if (msg.type === "init") {
            // WebView 重建场景（VSCode 重启恢复标签页等）：从持久状态恢复滚动位置
            const saved = getWebviewState();
            if (saved?.scrollY) {
                const targetY = saved.scrollY as number;
                scheduleDelayedScroll(() => {
                    window.scrollTo({ top: targetY });
                });
            }
        }
    }
}

/** 非生命周期消息：直接分发（无编辑器重建副作用，可并行处理） */
function handleRegularMessage(msg: ToWebviewMessage): void {
    if (msg.type === "requestSwitchToTextEditor") {
        // 来自菜单按钮/命令面板的"切换到文本编辑器"请求
        // 与 Cmd+Shift+M 快捷键逻辑相同：先获取当前可见行再通知 Extension
        const view = getEditorView();
        const line = view ? getFirstVisibleSourceLine(view, currentLineMap) : undefined;
        notifySwitchToTextEditor(line);
    } else if (msg.type === "scrollToLine") {
        // 面板已打开时（如全局搜索点击已打开文件）直接滚动；编辑器重建中则按计划重试。
        // 与 init 定位统一走 scheduleDelayedScroll（补上了首块高度检查：此前 view 一出现
        // 就滚动，布局未完成时定位不准）
        const scrollLine = msg.line;
        scheduleDelayedScroll(
            (view) => {
                scrollToSourceLine(view, currentLineMap, scrollLine);
            },
            [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000],
        );
    } else if (msg.type === "lineMapUpdate") {
        currentLineMap = msg.lineMap;
    } else if (msg.type === "setDebugMode") {
        _debugLog = msg.enabled;
        setLogTableSel(msg.enabled);
        setSerializationDebug(msg.enabled);
    } else if (msg.type === "setSerializationMode") {
        setSerializationMode(msg.mode);
    } else if (msg.type === "tableWrapModeChanged") {
        applyTableWrapVars(resolveTableWrapVars(msg.mode));
    } else if (msg.type === "requestContent") {
        // 保存时拉取（拉取式架构）：Extension 在 Cmd+S / 原生 autoSave 时请求一次序列化
        notifyContentResponse(getMarkdownForSave());
    } else if (msg.type === "imageUploaded") {
        _uploadRequests.resolve(msg.id, msg.url);
    } else if (msg.type === "imageUploadError") {
        _uploadRequests.reject(msg.id, msg.error);
    } else if (msg.type === "projectImagesList") {
        _getImagesRequests.resolve(msg.id, msg.images);
    } else if (msg.type === "imageRenamed") {
        _renameRequests.resolve(msg.id);
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
        _renameRequests.reject(msg.id, msg.error);
    } else if (msg.type === "pathSuggestions") {
        dispatchPathSuggestions(msg.id, msg.items);
        dispatchImgPathSuggestions(msg.id, msg.items);
    } else if (msg.type === "imagePathResolved") {
        dispatchImagePathResolved(msg.id, msg.webviewUri);
    } else {
        // 未知消息类型：安全默认（丢弃），debug 模式给出可见性（回归：静默丢弃无诊断）
        if (_debugLog) console.warn("[epytor] 未知消息类型:", (msg as { type: string }).type);
    }
}
