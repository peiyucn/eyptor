/**
 * 序列化模式持久性回归测试（F1）：
 * init/revert 都走 createEditor，此前 createEditor 用启动快照重置
 * _serializationMode —— 用户中途改配置后，一次外部写盘
 * 触发的 revert（重建编辑器）会把配置静默回滚。修复后重建不得重置。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEditor, destroyEditor, getSerializationMode, setSerializationMode } from "../editor";

if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ }
    };
}
if (typeof (window as unknown as Record<string, unknown>).IntersectionObserver === "undefined") {
    (window as unknown as Record<string, unknown>).IntersectionObserver = class {
        observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } takeRecords() { return []; }
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
// 启动快照故意设为 clean（回归场景：用户运行期改成 compatible）
(window as unknown as Record<string, unknown>).__i18n = {
    translations: {},
    isMac: false,
    serializationMode: "clean",
};

afterEach(() => {
    destroyEditor();
    document.body.innerHTML = "";
    setSerializationMode("clean"); // 复位模块单例，避免污染其他测试
});

describe("序列化模式持久性（F1）", () => {
    it("运行期改为 compatible 后重建编辑器 应该 保持 compatible（回归：启动快照静默回滚）", async () => {
        const root1 = document.createElement("div");
        document.body.appendChild(root1);
        await createEditor(root1, "第一份内容", () => {});
        expect(getSerializationMode()).toBe("clean");

        setSerializationMode("compatible");
        expect(getSerializationMode()).toBe("compatible");

        // 模拟 revert：销毁后重建（init 与 revert 走同一条 createEditor 路径）
        destroyEditor();
        root1.remove();
        const root2 = document.createElement("div");
        document.body.appendChild(root2);
        await createEditor(root2, "外部修改后的内容", () => {});

        expect(getSerializationMode()).toBe("compatible");
    }, 30000);
});
