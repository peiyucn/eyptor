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
import { applyCodeBlockMaxHeight, applyEditorMaxWidth } from "./utils/layoutVars";
import { showNotice } from "./ui/notice";
import { computeAllHeadingSignature } from "./utils/headingFold";
import { headingFoldPluginKey } from "./headingFoldPlugin";
import {
    createEditor,
    destroyEditor,
    getEditorView,
    getMarkdownForSave,
    setSerializationMode,
} from "./editor";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
    notifyReady,
    notifyMarkDirty,
    notifyUnsavedContent,
    notifyContentResponse,
    notifyFrontmatterUpdate,
    onMessage,
    notifySwitchToTextEditor,
    notifyViewportLine,
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
import { initPathComplete } from "./components/pathLink/pathComplete";
import { dispatchImagePathResolved } from "./components/imageView/imgPathComplete";
import { resolvePathSuggestionRequest } from "./utils/pathSuggestionRequests";
import { setImageUriMap, remapImageUri, showGlobalLightbox } from "./components/imageView";
import { getUserInteractionEpoch } from "./utils/userInteraction";
import { initViewportLedger } from "./utils/viewportLedger";
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
/** 延迟定位/恢复滚动的重试计划（Milkdown 渲染 + 浏览器布局需要时间）；
 *  init 定位与运行期 scrollToLine 共用同一计划（回归 F2：曾两套数组口径不一） */
const SCROLL_RETRY_DELAYS_MS = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];
/** 打开文档时的「视口复位到顶部」计划：焦点获取/布局稳定/滚动锚定都会在首帧后
 *  把视口推向第一个标题，需在前几帧内多次复位（用户交互后立即停止） */
const INITIAL_SCROLL_TOP_DELAYS_MS = [0, 50, 150, 400];
/** 首屏稳定后上报视口顶部行的延迟（晚于上面的复位计划，取到最终位置） */
const INITIAL_VIEWPORT_LINE_REPORT_DELAY_MS = 600;

let _topBarOverflowCtl: { dispose(): void } | null = null;

// 折叠态视口记账（见 utils/viewportLedger.ts）——折叠期几何守卫的数据来源。
//
// 正式架构（已定案）：webview **保活**（retainContextWhenHidden: true，见
// src/MarkdownEditorProvider.ts）——切到别的标签不销毁、不重建，撤销历史与折叠状态都留着。
// 代价是折叠期正文会真实地按 300×150 重排一次再排回来：这是渲染器的自然行为，**不隐藏
// 正文、不冻结版式**（隐藏/冻结过的几版都会在折叠窗口里给出「非正文」的画面，比不干预更
// 刺眼）。折叠期只治三类与正文版式无关的副作用——滚动锚定、滚动条、顶栏宽度，见
// style.css 的折叠媒体查询；这里初始化的是它们的数据来源。
initViewportLedger();

let currentEditor: Editor | null = null;
let currentLineMap: number[] = [];
/** 与 currentLineMap 同序的块结束行（滚动同步锚点） */
let currentLineEndMap: number[] = [];

// 修饰键监听：按住 Ctrl/Meta 时给 body 加 class，链接 hover 显示小手
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) document.body.classList.add('epytor-modifier-active');
});
document.addEventListener('keyup', (e) => {
    if (!e.ctrlKey && !e.metaKey) document.body.classList.remove('epytor-modifier-active');
});
window.addEventListener('blur', () => document.body.classList.remove('epytor-modifier-active'));

/**
 * 将 lineMap 中源码行号（1-indexed）对应的位置滚动到视口顶部。
 *
 * 锚点插值（对照 VS Code 内置 Markdown 预览的滚动同步实现）：它给每个渲染块标
 * data-line/endLine，然后——
 *   目标行落在块内：块顶 + 块高 × (line - start) / (end - start)
 *   目标行落在块间空白：在「上一块底」与「下一块顶」之间按行数比例插值
 *   没有下一块：块顶
 * 这样长代码块/长段落也能精确落到行，而不是只能落到块首。
 */
/**
 * 顶层**内容块** DOM 元素（按文档顺序），与行号表逐项对齐。
 *
 * 不能用 `view.dom.children`：ProseMirror 会把 widget 装饰（contenteditable=false 的
 * 占位元素）也塞进编辑区 DOM，实测本项目的文档首个子元素就是一个空 widget——
 * 于是「DOM 第 i 个」与「行号表第 i 项」整体错位一格，且块数不一致（143 vs 142）。
 * 用 `doc.forEach` + `nodeDOM` 取真实块，天然与行号表同序同长。
 */
function getContentBlockElements(view: EditorView): HTMLElement[] {
    const elements: HTMLElement[] = [];
    view.state.doc.forEach((_node, offset) => {
        const dom = view.nodeDOM(offset);
        if (dom instanceof HTMLElement) { elements.push(dom); }
    });
    return elements;
}

/**
 * 吸顶标题条当前占用的高度（未吸顶时为 0）。
 * 视口顶部「可用区」= 顶栏 + 吸顶条之下——定位与反算都必须扣掉它，否则正文会被
 * 吸顶条盖住一到两行（回归：源码→预览定位总是偏后一两个列表项）。
 */
function stickyBarHeight(): number {
    const sticky = document.querySelector<HTMLElement>(".heading-sticky-title");
    if (!sticky || sticky.hidden) { return 0; }
    return sticky.getBoundingClientRect().height;
}

function scrollToSourceLine(view: EditorView, lineMap: number[], lineEndMap: number[], targetLine: number): void {
    if (!lineMap.length) { return; }
    const children = getContentBlockElements(view);
    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const docTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;

    // 找「起始行 ≤ 目标行」的最后一个块
    let prevIdx = -1;
    for (let i = 0; i < lineMap.length && i < children.length; i++) {
        if (lineMap[i] <= targetLine) { prevIdx = i; } else { break; }
    }
    if (prevIdx < 0) { window.scrollTo({ top: 0 }); return; }
    const prevEl = children[prevIdx];
    if (!prevEl) { return; }
    const prevTop = docTop(prevEl);
    const prevEnd = lineEndMap[prevIdx] ?? lineMap[prevIdx];
    const nextIdx = prevIdx + 1;

    let target: number;
    if (targetLine <= prevEnd) {
        // 块内：按行占比插值
        const span = Math.max(1, prevEnd - lineMap[prevIdx]);
        const frac = Math.min(Math.max((targetLine - lineMap[prevIdx]) / span, 0), 1);
        target = prevTop + prevEl.getBoundingClientRect().height * frac;
    } else if (nextIdx < lineMap.length && nextIdx < children.length) {
        // 块间空白：在上一块底与下一块顶之间插值
        const nextEl = children[nextIdx];
        const prevBottom = prevTop + prevEl.getBoundingClientRect().height;
        const nextTop = docTop(nextEl);
        const span = Math.max(1, lineMap[nextIdx] - prevEnd);
        const frac = Math.min(Math.max((targetLine - prevEnd) / span, 0), 1);
        target = prevBottom + (nextTop - prevBottom) * frac;
    } else {
        target = prevTop;
    }

    const place = () => window.scrollTo({ top: target - topbarH - stickyBarHeight() - VIEWPORT_PADDING });
    place();
    // 吸顶条的高度取决于滚动后的位置（滚动前多半还没吸顶，实测差一整行 ~45px）：
    // 下一帧吸顶插件更新完再校正一次，把目标行真正放到吸顶条之下。
    requestAnimationFrame(() => {
        if (stickyBarHeight() > 0) { place(); }
    });
}

/**
 * 检测视口顶部对应的源码行号（1-indexed，可含小数部分四舍五入），供切换到文本编辑器时定位。
 * 锚点插值（对照 VS Code 内置预览的同名反算）：视口顶部落在块内时，按块内高度占比反算行号。
 */
function getFirstVisibleSourceLine(view: EditorView, lineMap: number[], lineEndMap: number[]): number {
    if (!lineMap.length) { return 1; }
    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const children = getContentBlockElements(view);
    const anchorY = topbarH + stickyBarHeight() + VIEWPORT_PADDING;
    for (let i = 0; i < children.length && i < lineMap.length; i++) {
        const rect = children[i].getBoundingClientRect();
        if (rect.bottom > anchorY) {
            const start = lineMap[i] ?? 1;
            const end = lineEndMap[i] ?? start;
            // 顶部落在块内：按占比反算行号；顶部在块上方（还没滚到该块）：直接取块首
            if (end > start && rect.top < anchorY) {
                const frac = Math.min(Math.max((anchorY - rect.top) / Math.max(1, rect.height), 0), 1);
                const line = Math.round(start + frac * (end - start));
                return line;
            }
            return start;
        }
    }
    // 全部块都在视口上方（理论上不会发生）→ 返回最后一块
    const fallback = lineMap[Math.min(lineMap.length - 1, children.length - 1)] ?? 1;
    return fallback;
}

/** 上次由 Extension 导航到的源码行（init 的 scrollToLine）；切换回文本时用于保持精确位置 */
let _lastNavLine: number | null = null;

/**
 * 切换到文本编辑器时要定位的源码行：
 * 优先「视口顶部块的行号」；若用户没滚动（视口仍停在导航到的那个块），
 * 回导航时的原始行而不是块首——否则长代码块/长段落来回切换会逐次漂到块首。
 */
function getSwitchTargetLine(view: EditorView): number | undefined {
    const visible = getFirstVisibleSourceLine(view, currentLineMap, currentLineEndMap);
    if (_lastNavLine === null) { return visible; }
    let blockStart = 0;
    for (const line of currentLineMap) {
        if (line <= _lastNavLine) { blockStart = line; } else { break; }
    }
    return blockStart === visible ? _lastNavLine : visible;
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
            _hasUnsavedChanges = true; // 同步置位：失活兜底推送不依赖下面的防抖
            scheduleContentPush(); // 停手 400ms 后推送副本（尾沿，打字期间零序列化）
            if (_docChangedTimer) clearTimeout(_docChangedTimer);
            _docChangedTimer = setTimeout(() => {
                notifyMarkDirty(); // 通知 Extension 内容已变（自动保存防抖到点后拉取）
                // 字数统计与输入同步（轻量：一次文本遍历 + 一条消息）。
                // 回归 P1：此前它与 TOC 共用一个 800ms 定时器且被标题签名早退跳过，
                // 输入正文时状态栏字数长期不更新（用户反馈「保存后才变」）
                updateWordCount();
            }, MARK_DIRTY_DEBOUNCE_MS);
            // TOC/字数：标题签名不变则跳过 TOC 重建（根源级优化：输入正文零重建，
            // 替代纯防抖延时——停顿后仍会重建的开销被真正消除）
            if (_tocRefreshTimer) clearTimeout(_tocRefreshTimer);
            _tocRefreshTimer = setTimeout(() => {
                requestAnimationFrame(() => {
                    const view = getEditorView();
                    if (!view) return;
                    // 全部标题（含嵌套）签名：只改嵌套标题时也要刷新
                    // （回归 P1：此前复用只覆盖顶层标题的签名，TOC 静默不刷新）
                    const sig = computeAllHeadingSignature(view.state.doc);
                    if (sig !== _lastTocSignature) {
                        _lastTocSignature = sig;
                        toc.refresh(); // 标题结构变化才重建目录（面板关闭时是 no-op）
                    }
                });
            }, TOC_REFRESH_DEBOUNCE_MS);
        },
        handleRenameImage,
        () => toc.toggle(),
    );
    toc.show();    // toolbar 就绪，显示 TOC 面板
    // TOC 全量重建 + 字数统计：双 rAF 延迟到首帧绘制后（首帧性能：万行文档 TOC
    // 重建与全文遍历在 create() 后同步执行会阻塞首帧；首帧先出正文，收尾工作下一帧补齐）
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toc.refresh(); // 编辑器初始化完成后刷新一次（面板关闭时是 no-op）
            updateWordCount(); // 编辑器初始化完成后统计一次
        });
    });

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
        const line = view ? getSwitchTargetLine(view) : undefined;
        notifySwitchToTextEditor(line);
    }
});

// WebView 加载完成，通知 Extension 侧发送初始内容
notifyReady();

// ── 失活兜底：未落盘内容主动回传 ────────────────────────────────
/**
 * retainContextWhenHidden:false 下，切走时宿主会**先销毁 iframe**，扩展再发
 * requestContent 已经无人应答——VS Code 会报「编辑器无响应，文件可能已用旧内容保存」，
 * 且未落盘的编辑丢失。blur / pagehide 是 webview 内部**还能拿到编辑器状态的最后时机**，
 * 此刻主动把内容推给扩展（扩展存内存，随后的保存直接用，不再等拉取）。
 */
let _hasUnsavedChanges = false;

/** 停手多久后推送一次：打字期间不序列化，停手才付这笔钱 */
const CONTENT_PUSH_IDLE_MS = 400;

let _pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushContentNow(): void {
    notifyUnsavedContent(getMarkdownForSave());
}

/**
 * 停手后推送内容给扩展（**尾沿**，不在打字期间推）。
 *
 * 背景：宿主销毁 webview 的时机早于扩展能拉取的时机（实测连 blur/pagehide 都来不及），
 * 而 VS Code 随后保存时又会等一个已经不存在的 webview → 超时后用旧内容落盘并报
 * 「编辑器无响应」。所以扩展侧必须持有一份副本。
 *
 * 但前沿推送代价太高（回归）：连续输入时每约 400ms 就要整篇序列化一次，实测 3000 行
 * 单次 getMarkdown() 约 77ms（getMarkdownForSave P50 84ms / P95 132ms）、942 行约 20ms，
 * 打字期间会周期性卡顿。改为停手 400ms 后才序列化一次：打字期间零成本，那笔开销落在
 * 用户已经停手的时候。
 *
 * 代价（与市面实现同档，zaaack 100ms / markdown-for-humans 500ms）：停手后这 400ms 内
 * 切走，最后一次改动不会被交接。
 */
function scheduleContentPush(): void {
    if (_pushTimer !== null) { clearTimeout(_pushTimer); }
    _pushTimer = setTimeout(() => {
        _pushTimer = null;
        pushContentNow();
    }, CONTENT_PUSH_IDLE_MS);
}

function flushUnsavedContent(): void {
    if (!_hasUnsavedChanges) { return; }
    pushContentNow();
}

window.addEventListener("blur", flushUnsavedContent);
window.addEventListener("pagehide", flushUnsavedContent);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { flushUnsavedContent(); }
});

// ── 滚动位置持久化 ────────────────────────────────────────────
// 保存：滚动时防抖写入 VSCode WebView 状态（跨会话可恢复）
/** 上报视口顶部源码行（切回文本编辑器时定位用）——对照官方
 *  markdown-language-features 用 onDidChangeTextEditorVisibleRanges 持续记录视口顶部行 */
function reportViewportLine(): void {
    const view = getEditorView();
    if (view) {
        notifyViewportLine(getFirstVisibleSourceLine(view, currentLineMap, currentLineEndMap));
    }
}
let _scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('scroll', () => {
    if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
        const cur = getWebviewState() ?? {};
        setWebviewState({ ...cur, scrollY: window.scrollY });
        reportViewportLine();
    }, SCROLL_SAVE_DEBOUNCE_MS);
}, { passive: true });

// 切回 webview 时恢复编辑器焦点（不滚动）。
// 诊断日志证实：VS Code 切 tab 时 webview 的 visibilitychange 不触发（visibility 恒 visible），
// 必须用 window focus 事件（webview 重新激活时触发）
// 根因修复（多 webview 焦点互抢）：一切焦点动作都以 Extension 推送的面板激活态
// （panelActiveState 消息）为准——后台 webview 迟到的 window.focus()/view.focus()
// 会抢走当前文档焦点，导致「切过去无法输入、点击无光标」（对照 VS Code 上游
// #61489 同类问题：webviews stealing focus when not last focused）
let _isActivePanel = true;
const restoreEditorFocus = () => {
    if (!_isActivePanel) return; // 非激活面板不抢焦点
    requestAnimationFrame(() => {
        if (!_isActivePanel) return;
        // 文档未持有焦点时不抢（回归：从资源管理器树点击切换文件时焦点在侧边栏，
        // 无条件 view.focus() 与 VS Code 焦点管理互抢 → 狂闪；tab 点击时 VS Code
        // 已把焦点交给 webview，document.hasFocus() 为 true，恢复路径不受影响）
        if (!document.hasFocus()) return;
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
            // 浏览器对 focus 的「滚动到选区」可能晚于 focus() 返回（下一帧才发生），
            // 同步比对会漏掉 → 下一帧再校正一次（回归：切 tab 回 md 页面时页面跳动）
            const restoreScroll = () => {
                if (window.scrollY !== scrollBefore) {
                    window.scrollTo({ top: scrollBefore });
                }
            };
            restoreScroll();
            requestAnimationFrame(restoreScroll);
        }
    });
};
window.addEventListener("focus", restoreEditorFocus);
// 回归（C6/F5）：此处原有 visibilitychange 处理器（visible 时恢复滚动位置 + 再调
// restoreEditorFocus）——其自身注释已诊断「VS Code 切 tab 时 visibilitychange 不触发
// （visibility 恒 visible）」，实际仅窗口级最小化/恢复可达；而页面隐藏/恢复不会丢失
// 滚动位置（无需恢复）、焦点恢复由 window focus 事件与 panelActiveState 消息覆盖，
// 处理器已删除。滚动位置恢复仍由 init 路径（scheduleDelayedScroll + 交互守卫）负责。
// ─────────────────────────────────────────────────────────────

// ── 用户交互保护：延迟定位滚动不得覆盖用户已开始的交互 ──────
// 回归：1 万行文档渲染慢，切回预览的「定位到文本编辑器光标行」在 300-2000ms
// 重试期间才执行，用户已开始编辑/点击时页面突然跳到标题行/mermaid 处
// 跟踪器统一在 utils/userInteraction.ts（回归 F4：此前此处与 editor.ts 各注册一套监听）

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
 * 即放弃，避免渲染慢时延迟定位突然跳动页面。调用时取交互纪元快照起算。
 */
function scheduleDelayedScroll(
    action: (view: EditorView) => void,
    delays: number[] = SCROLL_RETRY_DELAYS_MS,
): void {
    const epochAtStart = getUserInteractionEpoch();
    let done = false;
    const tryOnce = () => {
        if (done) return;
        if (getUserInteractionEpoch() !== epochAtStart) { done = true; return; }
        const view = getEditorView();
        if (!view) return;
        // 检查第一个**内容块**的 DOM 高度：若为 0 说明布局尚未完成。
        // 不能用 view.dom.children[0]——它是虚拟光标 widget（空 div，高度 0），
        // 会让这个守卫永远不通过、滚动动作一次都不执行（回归：切回预览完全不定位）。
        const firstBlock = getContentBlockElements(view)[0];
        if (!firstBlock || firstBlock.getBoundingClientRect().height === 0) { return; }
        action(view);
        done = true;
    };
    for (const delay of delays) {
        setTimeout(tryOnce, delay);
    }
}

/**
 * 待定位行（1-indexed）。回归（用户实测「切回预览定位不准」）：切到预览时扩展会发
 * `scrollToLine`，但那条消息可能在 webview 重建、编辑器尚未渲染时到达——旧实现只在
 * 一份 2 秒的重试计划里尝试，大文件渲染超过 2 秒就静默丢弃，预览停在原处/顶部。
 * 现在目标行会一直保留到真正滚动成功；编辑器重建完成后再应用一次。
 */
let _pendingScrollLine: number | null = null;

/**
 * 还原折叠状态（webview 重建后）。
 * 只有「标题结构签名」一致才恢复——文档变了，保存的位置会错位到别的标题上。
 */
function restoreFoldState(): void {
    const saved = (getWebviewState() as
        { foldState?: { sig?: string; folded?: number[] } } | null)?.foldState;
    if (!saved?.sig || !saved.folded?.length) { return; }
    const view = getEditorView();
    if (!view || computeAllHeadingSignature(view.state.doc) !== saved.sig) { return; }
    view.dispatch(
        view.state.tr
            .setMeta(headingFoldPluginKey, { type: "set", folded: saved.folded })
            .setMeta("addToHistory", false),
    );
}

/** 应用待定位行（编辑器就绪时调用；未就绪时按计划重试） */
function applyPendingScrollLine(): void {
    if (_pendingScrollLine === null) { return; }
    const line = _pendingScrollLine;
    scheduleDelayedScroll((view) => {
        scrollToSourceLine(view, currentLineMap, currentLineEndMap, line);
        if (_pendingScrollLine === line) { _pendingScrollLine = null; }
    });
}

/** init/revert：编辑器重建（串行执行，见 _editorLifecycleChain） */
async function handleEditorLifecycleMessage(
    msg: Extract<ToWebviewMessage, { type: "init" | "revert" }>,
    container: HTMLElement,
): Promise<void> {
    // 类型已由签名收窄（回归 C3：此前在函数体内重查 msg.type === init || revert）
    const isInit = msg.type === "init";
    currentLineMap = msg.lineMap ?? [];
    currentLineEndMap = msg.lineEndMap ?? [];
    renderFrontmatterPanel(msg.frontmatter);
    if (msg.imageUriMap) { setImageUriMap(msg.imageUriMap); }
    if (isInit) {
        _isActivePanel = msg.active ?? true;
        // 运行期配置以 init 载荷为准（回归 F1：此前由 createEditor 用启动快照重置，
        // revert 会把用户中途改的序列化模式静默回滚）
        if (msg.serializationMode) { setSerializationMode(msg.serializationMode); }
    }
    await initEditor(container, msg.content);
    // webview 重建（retainContextWhenHidden:false）：还原折叠状态。
    // 折叠会改变布局，必须在定位滚动之前恢复。
    restoreFoldState();
    // 新 WebView 打开时主动获取 DOM 焦点。
    // 若不调用：旧 WebView（path-link-test.md）在 Cmd+Click 后 blur() 释放了焦点，
    // 但新 WebView（README.md）的 iframe 未必自动获得焦点；
    // VS Code 可能仍将 Cmd+W 路由到旧 iframe，导致两个 .md 标签都被关闭。
    // init 仅在首次打开时触发（revert 是内容变更），此处只对首次打开生效。
    // 根因修复：延迟到下一帧并按面板激活态守卫——多 webview 时后台 webview 的
    // 迟到 window.focus() 会抢走当前文档焦点（帧前消息队列已同步最新激活态）。
    if (isInit) {
        requestAnimationFrame(() => {
            if (_isActivePanel) {
                window.focus();
            }
        });
    }
    // 全局搜索导航或切换回预览时，滚动到指定源码行
    // Milkdown 渲染 + 浏览器布局需要时间，统一走 scheduleDelayedScroll 重试
    if (isInit && msg.scrollToLine) {
        _lastNavLine = msg.scrollToLine; // 供切回文本时保持精确行（见 getSwitchTargetLine）
        _pendingScrollLine = msg.scrollToLine;
    } else if (isInit && _pendingScrollLine === null
        && Number((getWebviewState() as { scrollY?: number } | null)?.scrollY ?? 0) > 0) {
        // 折叠重建（retainContextWhenHidden:false：切到别的标签时 webview 被销毁，切回来
        // 是全新实例）→ 恢复上次滚动位置，否则每次切回都从文档顶部开始。
        // 首次打开（无存档）走下面的顶部复位，保证 frontmatter 可见。
        const savedScrollY = Number((getWebviewState() as { scrollY?: number } | null)?.scrollY ?? 0);
        scheduleDelayedScroll(() => { window.scrollTo({ top: savedScrollY }); });
    } else if (isInit && _pendingScrollLine === null) {
        // 新打开文档：确保视口在顶部（frontmatter 可见）。
        // 回归：焦点获取（window.focus → ProseMirror 把光标滚入视口）、布局稳定与
        // 浏览器滚动锚定都会在首帧之后把视口推向第一个标题，单次 scrollTo 会被覆盖，
        // 因此在前几帧内复位若干次；用户一旦交互立即停止干预。
        // 不再恢复上次滚动位置（用户反馈：打开文档应看到 frontmatter，而不是跳到第一个标题）
        // 回归（本轮）：运行期 scrollToLine 可能先于 init 到达并存入 _pendingScrollLine，
        // 此时若仍执行顶部复位，复位定时器（0–400ms）会把刚定位好的视口推回顶部——
        // 是否复位必须看「有没有待定位行」。
        const epochAtStart = getUserInteractionEpoch();
        for (const delay of INITIAL_SCROLL_TOP_DELAYS_MS) {
            setTimeout(() => {
                if (getUserInteractionEpoch() !== epochAtStart) return;
                if (_pendingScrollLine !== null) return;
                window.scrollTo({ top: 0 });
            }, delay);
        }
    }
    // 编辑器已创建：应用待定位行（大文件渲染慢时，这条路径保证定位不会丢）
    applyPendingScrollLine();
    // 首屏稳定后上报一次视口顶部行（未滚动过也有值，供切回文本编辑器时定位）
    setTimeout(reportViewportLine, INITIAL_VIEWPORT_LINE_REPORT_DELAY_MS);
}

/** 非生命周期消息：直接分发（无编辑器重建副作用，可并行处理） */
function handleRegularMessage(msg: ToWebviewMessage): void {
    if (msg.type === "panelActiveState") {
        // 面板激活态同步（多 webview 焦点互抢根因修复）：变激活时驱动焦点恢复
        const wasActive = _isActivePanel;
        _isActivePanel = msg.active;
        if (msg.active && !wasActive) {
            restoreEditorFocus();
        }
    } else if (msg.type === "requestSwitchToTextEditor") {
        // 来自菜单按钮/命令面板的"切换到文本编辑器"请求
        // 与 Cmd+Shift+M 快捷键逻辑相同：先获取当前可见行再通知 Extension
        const view = getEditorView();
        const line = view ? getSwitchTargetLine(view) : undefined;
        notifySwitchToTextEditor(line);
    } else if (msg.type === "scrollToLine") {
        // 面板已打开时（如全局搜索点击已打开文件）直接滚动；编辑器重建中则按计划重试。
        // 与 init 定位统一走 scheduleDelayedScroll（补上了首块高度检查：此前 view 一出现
        // 就滚动，布局未完成时定位不准）
        // 回归（F2）：此前此处另传一份内联 9 段延迟数组，与 SCROLL_RETRY_DELAYS_MS
        // 口径不一致且无注释依据——已统一为同一常量（细粒度版对 init 也安全：
        // 视图未就绪的早期尝试是空操作，等下一次重试）
        const scrollLine = msg.line;
        // 目标行保留到真正滚动成功（编辑器重建期间到达也不丢，见 _pendingScrollLine）
        _pendingScrollLine = scrollLine;
        applyPendingScrollLine();
    } else if (msg.type === "lineMapUpdate") {
        currentLineMap = msg.lineMap;
        currentLineEndMap = msg.lineEndMap ?? [];
    } else if (msg.type === "setSerializationMode") {
        setSerializationMode(msg.mode);
    } else if (msg.type === "tableWrapModeChanged") {
        applyTableWrapVars(resolveTableWrapVars(msg.mode));
    } else if (msg.type === "editorMaxWidthChanged") {
        applyEditorMaxWidth(msg.value);
    } else if (msg.type === "codeBlockMaxHeightChanged") {
        applyCodeBlockMaxHeight(msg.value);
    } else if (msg.type === "notice") {
        showNotice(msg.message);
    } else if (msg.type === "requestContent") {
        // 保存时拉取（拉取式架构）：Extension 在 Cmd+S / 原生 autoSave 时请求一次序列化
        _hasUnsavedChanges = false; // 已按当前内容应答，落盘由扩展负责
        notifyContentResponse(getMarkdownForSave());
    } else if (msg.type === "imageUploaded") {
        _uploadRequests.resolve(msg.id, msg.url);
    } else if (msg.type === "imageUploadError") {
        _uploadRequests.reject(msg.id, msg.error);
    } else if (msg.type === "projectImagesList") {
        _getImagesRequests.resolve(msg.id, msg.images);
    } else if (msg.type === "imageRenamed") {
        _renameRequests.resolve(msg.id);
        // 同步展示映射：重命名后的新 URI 要能反查回可读相对路径
        // （回归：此前 map 只在 init/revert 刷新，编辑路径时输入框显示编码后的 URI 尾巴）
        remapImageUri(msg.oldWebviewUri, msg.newWebviewUri, msg.newRelPath);
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
        resolvePathSuggestionRequest(msg.id, msg.items);
    } else if (msg.type === "imagePathResolved") {
        dispatchImagePathResolved(msg.id, msg.webviewUri);
    } else {
        // 未知消息类型：安全默认（丢弃），但必须留痕（回归：静默丢弃无诊断）
        console.warn("[epytor] 未知消息类型:", (msg as { type: string }).type);
    }
}
