import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingRequestRegistry } from "../utils/pendingRequest";

describe("PendingRequestRegistry 请求-响应注册表", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolve 回包 应该 结算 promise 并清理槽位", async () => {
        const reg = new PendingRequestRegistry<string>("t");
        const { id, promise } = reg.begin({ timeoutMs: 5000, timeout: { kind: "reject", error: "timeout" } });
        reg.resolve(id, "ok");
        await expect(promise).resolves.toBe("ok");
        // 槽位已清：重复结算无害
        expect(() => reg.resolve(id, "again")).not.toThrow();
    });

    it("reject 回包 应该 结算 promise 并清理槽位", async () => {
        const reg = new PendingRequestRegistry<string>("t");
        const { id, promise } = reg.begin({ timeoutMs: 5000, timeout: { kind: "reject", error: "timeout" } });
        reg.reject(id, "server said no");
        await expect(promise).rejects.toThrow("server said no");
    });

    it("超时（reject 模式） 应该 以超时错误结算", async () => {
        vi.useFakeTimers();
        const reg = new PendingRequestRegistry<string>("t");
        const { promise } = reg.begin({ timeoutMs: 3000, timeout: { kind: "reject", error: "Upload timed out" } });
        const assertion = expect(promise).rejects.toThrow("Upload timed out");
        await vi.advanceTimersByTimeAsync(3000);
        await assertion;
    });

    it("超时（resolve 模式） 应该 以兜底值结算（项目图库超时返回 null 而非报错）", async () => {
        vi.useFakeTimers();
        const reg = new PendingRequestRegistry<string[] | null>("t");
        const { promise } = reg.begin({ timeoutMs: 3000, timeout: { kind: "resolve", value: null } });
        const assertion = expect(promise).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(3000);
        await assertion;
    });

    it("cancel 应该 以原因结算（读取失败等中途放弃路径）", async () => {
        const reg = new PendingRequestRegistry<string>("t");
        const { promise, cancel } = reg.begin({ timeoutMs: 5000, timeout: { kind: "reject", error: "timeout" } });
        cancel("Failed to read file");
        await expect(promise).rejects.toThrow("Failed to read file");
    });

    it("结算后 cancel 应该 无副作用（settled 双保险）", async () => {
        const reg = new PendingRequestRegistry<string>("t");
        const { id, promise, cancel } = reg.begin({ timeoutMs: 5000, timeout: { kind: "reject", error: "timeout" } });
        reg.resolve(id, "ok");
        cancel("late cancel");
        await expect(promise).resolves.toBe("ok");
    });

    it("超时后晚到回包 应该 被忽略（不二次结算）", async () => {
        vi.useFakeTimers();
        const reg = new PendingRequestRegistry<string>("t");
        const { id, promise } = reg.begin({ timeoutMs: 3000, timeout: { kind: "reject", error: "timeout" } });
        const assertion = expect(promise).rejects.toThrow("timeout");
        await vi.advanceTimersByTimeAsync(3000);
        await assertion;
        expect(() => reg.resolve(id, "too late")).not.toThrow();
    });
});
