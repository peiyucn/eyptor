/**
 * 查找栏关闭后不再执行 pending 搜索（P3 回归）：
 * close() 此前只清 UI 状态、不清 150ms 防抖 timer——关闭后 pending 搜索照常执行，
 * 高亮复活、计数写回隐藏栏、页面可能被 scrollToMatch 拽动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initFindBar } from "../components/findBar";

describe("findBar 关闭清理（P3）", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement("div");
        container.innerHTML = "<p>alpha</p><p>beta</p>";
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("输入防抖未到点就关闭 应该 不再执行搜索（回归：高亮/计数复活）", () => {
        const bar = initFindBar(() => container);
        bar.open("alpha");
        expect(bar.isOpen()).toBe(true);

        // 在输入框输入新查询（150ms 防抖），随即关闭查找栏
        const input = document.querySelector<HTMLInputElement>(".find-bar input, .find-bar__input")!;
        input.value = "beta";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        bar.close();

        // 推进越过防抖窗口：pending 搜索不得执行（计数保持关闭时的空值）
        vi.advanceTimersByTime(300);
        const countEl = document.querySelector<HTMLElement>(".find-bar__count, .find-bar .count");
        expect(bar.isOpen()).toBe(false);
        expect(countEl?.textContent ?? "").toBe("");
    });
});
