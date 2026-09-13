/**
 * shared/messages.ts
 * WebView ↔ Extension 双向消息类型的唯一权威来源。
 * 两侧均从此处导入，禁止各自内联重复定义。
 */

/** 图片元数据：磁盘相对路径 + WebView 可访问 URI + 文件名 */
export type ProjectImage = {
    relPath: string;
    webviewUri: string;
    name: string;
};

/** 路径补全建议条目 */
export type PathSuggestionItem = {
    path: string;
    isDir: boolean;
    webviewUri?: string;  // 仅图片文件时返回，供缩略图预览
};

/**
 * WebView → Extension 方向的消息。
 * 所有字段反映发送方的实际约束：发送方必须提供的字段不得写成可选。
 */
export type ToExtensionMessage =
    | { type: "ready" }
    | { type: "markDirty" }
    /** webview 主动推来的未落盘内容副本（停手 400ms / blur / pagehide；扩展在 webview 重建时用它恢复内容、问不到 webview 时用它兜底保存） */
    | { type: "unsavedContent"; content: string }
    | { type: "contentResponse"; content: string }
    | { type: "frontmatterUpdate"; frontmatter: string }
    | { type: "openUrl"; url: string }
    | { type: "openFile"; path: string }
    | { type: "switchToTextEditor"; line?: number }
    | { type: "viewportLine"; line: number }
    | { type: "openSettings" }
    | { type: "uploadImage"; id: string; data: Uint8Array; mimeType: string; altText: string }
    | { type: "getProjectImages"; id: string }
    | { type: "renameImage"; id: string; webviewUri: string; newBasename: string }
    | { type: "getPathSuggestions"; id: string; query: string }
    | { type: "resolveImagePath"; id: string; relPath: string }
    | { type: "wordCount"; lines: number; words: number; charsNoSpace: number; charsWithSpace: number };

/**
 * Extension → WebView 方向的消息。
 * lineMap 在 init/revert 中为可选：Extension 始终发送，但 WebView 侧用 `?? []` 兜底以防万一。
 */
export type ToWebviewMessage =
    | { type: "init"; content: string; active?: boolean; serializationMode?: "clean" | "compatible"; lineMap?: number[]; lineEndMap?: number[]; scrollToLine?: number; frontmatter?: string; imageUriMap?: Record<string, string> }
    | { type: "revert"; content: string; lineMap?: number[]; lineEndMap?: number[]; frontmatter?: string; imageUriMap?: Record<string, string> }
    | { type: "panelActiveState"; active: boolean }
    | { type: "requestContent" }
    | { type: "scrollToLine"; line: number }
    | { type: "lineMapUpdate"; lineMap: number[]; lineEndMap?: number[] }
    | { type: "setSerializationMode"; mode: "clean" | "compatible" }
    | { type: "tableWrapModeChanged"; mode: string }
    /** 编辑器内容区最大宽度（px，已按 schema 上下限净化） */
    | { type: "editorMaxWidthChanged"; value: number }
    /** 代码块最大显示高度（px，已按 schema 上下限净化） */
    | { type: "codeBlockMaxHeightChanged"; value: number }
    /** WebView 内一次性提示条（文案已由 Extension 本地化） */
    | { type: "notice"; message: string }
    | { type: "imageUploaded"; id: string; url: string }
    | { type: "imageUploadError"; id: string; error: string }
    | { type: "projectImagesList"; id: string; images: ProjectImage[] }
    | { type: "imageRenamed"; id: string; oldWebviewUri: string; newWebviewUri: string; newRelPath: string }
    | { type: "imageRenameError"; id: string; error: string }
    | { type: "requestSwitchToTextEditor" }
    | { type: "pathSuggestions"; id: string; items: PathSuggestionItem[] }
    | { type: "imagePathResolved"; id: string; webviewUri: string };
