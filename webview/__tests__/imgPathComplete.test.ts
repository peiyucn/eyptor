import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockVscodeApi } from "./setup";
import { attachImgPathComplete, dispatchImgPathSuggestions } from "../components/imageView/imgPathComplete";
import type { PathSuggestionItem } from "../../shared/messages";

const item = (path: string, isDir = false, webviewUri?: string): PathSuggestionItem => ({ path, isDir, webviewUri });

// jsdom 未实现 scrollIntoView（dropdownComplete 激活项时调用），补 no-op 桩
HTMLElement.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView ?? (() => {});

/** 输入并触发防抖后的补全请求，返回本次请求 id */
function typeAndGetRequestId(input: HTMLInputElement, value: string): string {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    const calls = mockVscodeApi.postMessage.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === "getPathSuggestions",
    );
    const last = calls[calls.length - 1]?.[0] as { id: string };
    return last.id;
}

describe("imgPathComplete 补全竞态防护", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("晚到的旧请求响应 应该 被丢弃，不覆盖当前下拉（回归：A 先发 B 后发，A 晚回覆盖 B）", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        attachImgPathComplete(input);

        const idA = typeAndGetRequestId(input, "@/a");
        const idB = typeAndGetRequestId(input, "@/b");
        expect(idA).not.toBe(idB);

        // 旧请求 A 晚回：下拉不得出现
        dispatchImgPathSuggestions(idA, [item("a.md"), item("a-dir", true)]);
        expect(document.querySelector(".img-path-complete-list")).toBeNull();

        // 新请求 B 回包：正常渲染（无 webviewUri 的普通文件被过滤，仅目录项渲染）
        dispatchImgPathSuggestions(idB, [item("b.md"), item("b-dir", true)]);
        expect(document.querySelector(".img-path-complete-list")).not.toBeNull();
        expect(document.querySelector(".img-complete-label")?.textContent).toBe("b-dir");
    });

    it("查询被清空后 应该 使 in-flight 响应失效（下拉不复活）", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        attachImgPathComplete(input);

        const id = typeAndGetRequestId(input, "@/a");
        // 用户清空输入：触发一次防抖后的 triggerSuggest（非匹配 → 关闭 + 失效）
        typeAndGetRequestId(input, "");
        dispatchImgPathSuggestions(id, [item("a.md"), item("a-dir", true)]);
        expect(document.querySelector(".img-path-complete-list")).toBeNull();
    });

    it("detach 后 应该 拒绝渲染（输入框销毁后不游离复活；回归：imagePicker 丢弃 detach 泄漏监听）", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        const detach = attachImgPathComplete(input);

        const id = typeAndGetRequestId(input, "@/a");
        detach();
        input.remove(); // 宿主关闭对话框
        dispatchImgPathSuggestions(id, [item("a.md"), item("a-dir", true)]);
        expect(document.querySelector(".img-path-complete-list")).toBeNull();
    });

    it("isConnected 双保险：输入框脱离文档后响应 应该 不渲染", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        attachImgPathComplete(input);

        const id = typeAndGetRequestId(input, "@/a");
        input.remove(); // 未 detach（模拟宿主异常路径）但输入框已脱离文档
        dispatchImgPathSuggestions(id, [item("a.md"), item("a-dir", true)]);
        expect(document.querySelector(".img-path-complete-list")).toBeNull();
    });
});
