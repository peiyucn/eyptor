/**
 * messaging.ts 测试：验证消息发送函数是否以正确格式调用 postMessage。
 * acquireVsCodeApi 已在 setup.ts 中注入到 globalThis。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockVscodeApi } from "./setup";

// 延迟导入，确保 acquireVsCodeApi 在 setup.ts 中已完成注入
const {
    notifyReady,
    notifyMarkDirty,
    notifyContentResponse,
    notifyOpenUrl,
    notifyOpenFile,
    notifySwitchToTextEditor,
    notifyUploadImage,
    notifyGetProjectImages,
    notifyGetPathSuggestions,
    notifyResolveImagePath,
    notifyRenameImage,
    notifyOpenSettings,
} = await import("../../webview/messaging");

describe("messaging — postMessage 格式验证", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("notifyReady 发送 { type: 'ready' }", () => {
        notifyReady();
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({ type: "ready" });
    });

    it("notifyMarkDirty 发送 { type: 'markDirty' }（拉取式保存的轻量脏标记）", () => {
        notifyMarkDirty();
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({ type: "markDirty" });
    });

    it("notifyContentResponse 携带 content 字段（保存时拉取的序列化回传）", () => {
        notifyContentResponse("# Hello");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "contentResponse",
            content: "# Hello",
        });
    });

    it("notifyOpenUrl 携带 url 字段", () => {
        notifyOpenUrl("https://example.com");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "openUrl",
            url: "https://example.com",
        });
    });

    it("notifyOpenFile 携带 path 字段", () => {
        notifyOpenFile("./docs/README.md");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "openFile",
            path: "./docs/README.md",
        });
    });

    it("notifySwitchToTextEditor 不带 line 时不发送 line 字段", () => {
        notifySwitchToTextEditor();
        const msg = mockVscodeApi.postMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(msg.type).toBe("switchToTextEditor");
        expect("line" in msg).toBe(false);
    });

    it("notifySwitchToTextEditor 携带 line 时发送 line 字段", () => {
        notifySwitchToTextEditor(42);
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "switchToTextEditor",
            line: 42,
        });
    });

    it("notifyUploadImage 携带所有必需字段", () => {
        const data = new Uint8Array([1, 2, 3]);
        notifyUploadImage("req-001", data, "image/png", "photo");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "uploadImage",
            id: "req-001",
            data,
            mimeType: "image/png",
            altText: "photo",
        });
    });

    it("notifyGetProjectImages 携带 id 字段", () => {
        notifyGetProjectImages("img-list-1");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "getProjectImages",
            id: "img-list-1",
        });
    });

    it("notifyGetPathSuggestions 携带 id 和 query", () => {
        notifyGetPathSuggestions("path-req-1", "./docs/");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "getPathSuggestions",
            id: "path-req-1",
            query: "./docs/",
        });
    });

    it("notifyResolveImagePath 携带 id 和 relPath", () => {
        notifyResolveImagePath("resolve-1", "./images/photo.png");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "resolveImagePath",
            id: "resolve-1",
            relPath: "./images/photo.png",
        });
    });

    it("notifyRenameImage 携带 id/webviewUri/newBasename", () => {
        notifyRenameImage("rename-1", "vscode-resource://img.png", "new-name.png");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "renameImage",
            id: "rename-1",
            webviewUri: "vscode-resource://img.png",
            newBasename: "new-name.png",
        });
    });

    it("notifyOpenSettings 发送 { type: 'openSettings' }", () => {
        notifyOpenSettings();
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({ type: "openSettings" });
    });

    it("onMessage 合法对象载荷 应该 转发给 handler（回归：无任何运行时校验直接断言类型）", async () => {
        const { onMessage } = await import("../../webview/messaging");
        const handler = vi.fn();
        onMessage(handler);
        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "wordCount", lines: 1, words: 2, charsNoSpace: 3, charsWithSpace: 4 },
        }));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("onMessage 非对象载荷（字符串）应该 丢弃", async () => {
        const { onMessage } = await import("../../webview/messaging");
        const handler = vi.fn();
        onMessage(handler);
        window.dispatchEvent(new MessageEvent("message", { data: "not-an-object" }));
        expect(handler).not.toHaveBeenCalled();
    });

    it("onMessage 缺少 type 的对象 应该 丢弃", async () => {
        const { onMessage } = await import("../../webview/messaging");
        const handler = vi.fn();
        onMessage(handler);
        window.dispatchEvent(new MessageEvent("message", { data: { content: "x" } }));
        expect(handler).not.toHaveBeenCalled();
    });
});
