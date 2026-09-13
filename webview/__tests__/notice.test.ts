import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showNotice, dismissNotice } from "../ui/notice";

describe("showNotice", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        dismissNotice();
    });

    afterEach(() => {
        dismissNotice();
        vi.useRealTimers();
    });

    it("应该 把文案作为纯文本注入提示条", () => {
        showNotice("<img src=x onerror=alert(1)>");

        const el = document.querySelector(".epytor-notice");
        expect(el?.textContent).toBe("<img src=x onerror=alert(1)>");
        expect(el?.querySelector("img")).toBeNull();
    });

    it("连续显示时 应该 只保留最新一条", () => {
        showNotice("第一条");
        showNotice("第二条");

        const all = document.querySelectorAll(".epytor-notice");
        expect(all.length).toBe(1);
        expect(all[0]?.textContent).toBe("第二条");
    });

    it("超时后 应该 自动移除", () => {
        showNotice("稍后消失");
        expect(document.querySelector(".epytor-notice")).not.toBeNull();

        vi.advanceTimersByTime(10_000);

        expect(document.querySelector(".epytor-notice")).toBeNull();
    });

    it("点击后 应该 立即移除", () => {
        showNotice("点我关闭");
        document.querySelector<HTMLElement>(".epytor-notice")?.click();

        expect(document.querySelector(".epytor-notice")).toBeNull();
    });

    it("dismissNotice 重复调用 应该 安全", () => {
        showNotice("x");
        dismissNotice();
        dismissNotice();

        expect(document.querySelector(".epytor-notice")).toBeNull();
    });
});
