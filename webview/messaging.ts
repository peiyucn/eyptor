import type { ToExtensionMessage, ToWebviewMessage, ProjectImage } from "../shared/messages";

export type { ProjectImage };

// Re-export 以保持现有消费者（webview/index.ts 等）对 IncomingMessage 的引用不变
export type IncomingMessage = ToWebviewMessage;

declare function acquireVsCodeApi(): {
    postMessage(message: ToExtensionMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
};

// acquireVsCodeApi 只能调用一次
const vscode = acquireVsCodeApi();

export function notifyReady(): void {
    vscode.postMessage({ type: "ready" });
}

export function notifyMarkDirty(): void {
    vscode.postMessage({ type: "markDirty" });
}

export function notifyContentResponse(content: string): void {
    vscode.postMessage({ type: "contentResponse", content });
}

export function notifyFrontmatterUpdate(frontmatter: string): void {
    vscode.postMessage({ type: "frontmatterUpdate", frontmatter });
}

export function notifyOpenUrl(url: string): void {
    vscode.postMessage({ type: "openUrl", url });
}

export function notifyOpenFile(relativePath: string): void {
    vscode.postMessage({ type: "openFile", path: relativePath });
}

export function notifySwitchToTextEditor(line?: number): void {
    vscode.postMessage({ type: "switchToTextEditor", ...(line !== undefined ? { line } : {}) });
}

/** 视口顶部源码行上报（滚动防抖后调用；切回文本编辑器时按它定位） */
export function notifyViewportLine(line: number): void {
    vscode.postMessage({ type: "viewportLine", line });
}

export function notifyOpenSettings(): void {
    vscode.postMessage({ type: "openSettings" });
}

export function notifyUploadImage(
    id: string,
    data: Uint8Array,
    mimeType: string,
    altText: string,
): void {
    vscode.postMessage({ type: "uploadImage", id, data, mimeType, altText });
}

export function notifyGetProjectImages(id: string): void {
    vscode.postMessage({ type: "getProjectImages", id });
}

export function notifyGetPathSuggestions(id: string, query: string): void {
    vscode.postMessage({ type: "getPathSuggestions", id, query });
}

export function notifyResolveImagePath(id: string, relPath: string): void {
    vscode.postMessage({ type: "resolveImagePath", id, relPath });
}

export function notifyRenameImage(
    id: string,
    webviewUri: string,
    newBasename: string,
): void {
    vscode.postMessage({ type: "renameImage", id, webviewUri, newBasename });
}

export function notifyWordCount(
    lines: number,
    words: number,
    charsNoSpace: number,
    charsWithSpace: number,
): void {
    vscode.postMessage({ type: "wordCount", lines, words, charsNoSpace, charsWithSpace });
}

export function onMessage(handler: (msg: IncomingMessage) => void): void {
    window.addEventListener("message", (event: MessageEvent) => {
        // 最小运行时守卫：只校验载荷形状（回归：event.data 曾直接断言为 IncomingMessage，
        // 无任何校验）。注意：不做 event.source 校验——VS Code WebView 中 Extension 的
        // postMessage 到达时 source 是父窗口而非自身 window，校验来源会丢光合法消息
        // （2026-09-08 曾误加 `event.source === window` 导致整页不渲染，已回退）。
        const data = event.data as unknown;
        if (data === null || typeof data !== "object") {
            return;
        }
        const msg = data as IncomingMessage;
        if (typeof msg.type !== "string") {
            return;
        }
        handler(msg);
    });
}

export function getWebviewState(): Record<string, unknown> | null {
    return vscode.getState() as Record<string, unknown> | null;
}

export function setWebviewState(state: Record<string, unknown>): void {
    vscode.setState(state);
}
