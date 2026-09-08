import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadThemeBus() {
    vi.resetModules();
    return import("../../webview/utils/themeBus");
}

describe("themeBus", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.className = "";
    });

    it("浅色主题订阅时 应该 立即回调 false", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();

        const unsubscribe = onThemeChange(listener);

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(false);
        unsubscribe();
    });

    it.each(["vscode-dark", "vscode-high-contrast"])(
        "%s 主题订阅时 应该 立即回调 true",
        async (themeClass) => {
            document.body.className = themeClass;
            const { onThemeChange } = await loadThemeBus();
            const listener = vi.fn();

            const unsubscribe = onThemeChange(listener);

            expect(listener).toHaveBeenCalledWith(true);
            unsubscribe();
        },
    );

    it("主题明暗发生变化时 应该 通知订阅者一次", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);

        document.body.className = "vscode-dark";

        await vi.waitFor(() => {
            expect(listener).toHaveBeenCalledTimes(2);
        });
        expect(listener).toHaveBeenLastCalledWith(true);
        unsubscribe();
    });

    it("主题类别变化但明暗不变时 应该 不重复通知", async () => {
        document.body.className = "vscode-dark";
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);

        document.body.className = "vscode-high-contrast";

        await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
        });
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("取消订阅后主题变化时 应该 不再通知订阅者", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);
        unsubscribe();

        document.body.className = "vscode-dark";

        await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
        });
        expect(listener).toHaveBeenCalledOnce();
    });

    it("isDarkTheme 应该 与订阅回调的初值口径一致", async () => {
        document.body.className = "vscode-high-contrast";
        const { isDarkTheme, onThemeChange } = await loadThemeBus();
        const listener = vi.fn();

        const unsubscribe = onThemeChange(listener);

        expect(isDarkTheme()).toBe(true);
        expect(listener).toHaveBeenCalledWith(isDarkTheme());
        unsubscribe();
    });
});