/**
 * themeBus 订阅生命周期回归测试：
 * createEditor 订阅主题、destroyEditor 必须退订——回归：退订函数曾被丢弃，
 * init/revert 每次重建向 themeBus 泄漏一个监听器（闭包持有旧文档 mermaidCodeMap，
 * 主题切换时重放全部旧回调）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, destroyEditor } from "../editor";
import { getThemeListenerCount } from "../utils/themeBus";

if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ }
    };
}
if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (() => ({
        matches: false, media: "", onchange: null,
        addListener() { /* noop */ }, removeListener() { /* noop */ },
        addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
        dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
}

afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

describe("themeBus 订阅生命周期", () => {
    it("createEditor/destroyEditor 多次往返 应该 监听器数量不增长（回归：每次重建泄漏一个订阅）", async () => {
        const before = getThemeListenerCount();
        for (let i = 0; i < 3; i++) {
            const root = document.createElement("div");
            document.body.appendChild(root);
            await createEditor(root, `doc ${i}`, () => {});
            expect(getThemeListenerCount()).toBe(before + 1);
            destroyEditor();
            expect(getThemeListenerCount()).toBe(before);
            root.remove();
        }
    }, 30000);
});
