import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentRequestCoordinator } from "../utils/contentRequestCoordinator";

describe("ContentRequestCoordinator 拉取协调", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("并发请求同一 uriKey 应该 单飞且全部收到同一回包（回归：单槽覆盖曾让先发保存悬挂）", async () => {
        const send = vi.fn();
        const coord = new ContentRequestCoordinator(send, 3000);
        const p1 = coord.request("doc", "stale1");
        const p2 = coord.request("doc", "stale2");

        // 单飞：只发一次请求
        expect(send).toHaveBeenCalledTimes(1);

        coord.resolve("doc", "fresh");
        await expect(p1).resolves.toBe("fresh");
        await expect(p2).resolves.toBe("fresh");
    });

    it("回包晚到（无等待者） 应该 安全忽略", () => {
        const coord = new ContentRequestCoordinator(vi.fn(), 3000);
        expect(() => coord.resolve("doc", "late")).not.toThrow();
    });

    it("超时 应该 以首个请求者的兜底内容结算全部等待者（不悬挂）", async () => {
        vi.useFakeTimers();
        const coord = new ContentRequestCoordinator(vi.fn(), 3000);
        const p1 = coord.request("doc", "memory1");
        const p2 = coord.request("doc", "memory2");

        await vi.advanceTimersByTimeAsync(3000);
        await expect(p1).resolves.toBe("memory1");
        await expect(p2).resolves.toBe("memory1");
    });

    it("超时后晚到回包 应该 被忽略（不二次结算）", async () => {
        vi.useFakeTimers();
        const resolveSpy = vi.fn();
        const coord = new ContentRequestCoordinator(vi.fn(), 3000);
        const p = coord.request("doc", "memory");
        p.then(resolveSpy);

        await vi.advanceTimersByTimeAsync(3000);
        coord.resolve("doc", "too-late");
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        expect(resolveSpy).toHaveBeenCalledWith("memory");
    });

    it("结算后新请求 应该 重新发送（不误用已结算条目）", async () => {
        const send = vi.fn();
        const coord = new ContentRequestCoordinator(send, 3000);
        const p1 = coord.request("doc", "s1");
        coord.resolve("doc", "r1");
        await expect(p1).resolves.toBe("r1");

        const p2 = coord.request("doc", "s2");
        expect(send).toHaveBeenCalledTimes(2);
        coord.resolve("doc", "r2");
        await expect(p2).resolves.toBe("r2");
    });

    it("settleAll（面板销毁） 应该 以兜底内容结算（保存不悬挂）", async () => {
        const coord = new ContentRequestCoordinator(vi.fn(), 3000);
        const p1 = coord.request("doc", "memory");
        const p2 = coord.request("doc", "other");
        coord.settleAll("doc");
        await expect(p1).resolves.toBe("memory");
        await expect(p2).resolves.toBe("memory");
    });

    it("settleAll 无等待者 应该 无副作用", () => {
        const coord = new ContentRequestCoordinator(vi.fn(), 3000);
        expect(() => coord.settleAll("doc")).not.toThrow();
    });

    it("超时 应该 触发 onTimeout 回调（保存不悬挂且宿主可给用户警告）", async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        const coord = new ContentRequestCoordinator(vi.fn(), 3000, onTimeout);
        const p = coord.request("doc", "memory");
        await vi.advanceTimersByTimeAsync(3000);
        await expect(p).resolves.toBe("memory");
        expect(onTimeout).toHaveBeenCalledWith("doc");
    });

    it("正常回包结算 应该 不触发 onTimeout（不误报编辑器未响应）", async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        const coord = new ContentRequestCoordinator(vi.fn(), 3000, onTimeout);
        const p = coord.request("doc", "memory");
        coord.resolve("doc", "fresh");
        await expect(p).resolves.toBe("fresh");
        await vi.advanceTimersByTimeAsync(3000);
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
