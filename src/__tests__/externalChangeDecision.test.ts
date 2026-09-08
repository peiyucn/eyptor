import { describe, expect, it } from "vitest";
import { decideExternalChange, type ExternalChangeContext } from "../utils/externalChangeDecision";

const ctx = (overrides: Partial<ExternalChangeContext>): ExternalChangeContext => ({
    latest: "old",
    diskContent: "external",
    lastDisk: "old",
    memoryBefore: "old",
    ...overrides,
});

describe("decideExternalChange 外部写盘回退决策", () => {
    it("无未落盘编辑 + 外部写盘 应该 采纳盘上内容（回归：旧逻辑永远保留用户内容、外部修改无法进入编辑器）", () => {
        const decision = decideExternalChange(ctx({ latest: "old", diskContent: "external", lastDisk: "old" }));
        expect(decision.keepUserContent).toBe(false);
        expect(decision.nextLastDisk).toBe("external");
    });

    it("有未落盘编辑 + 外部写盘 应该 保留用户内容并标记 dirty", () => {
        const decision = decideExternalChange(ctx({ latest: "old+edit", lastDisk: "old" }));
        expect(decision.keepUserContent).toBe(true);
    });

    it("快照未播种 应该 以 revert 前内存为基准（latest 相同 → 采纳）", () => {
        const decision = decideExternalChange(ctx({ latest: "old", lastDisk: undefined, memoryBefore: "old" }));
        expect(decision.keepUserContent).toBe(false);
    });

    it("快照未播种且 latest 与内存不同 应该 保守保留（不丢编辑）", () => {
        const decision = decideExternalChange(ctx({ latest: "old+edit", lastDisk: undefined, memoryBefore: "old" }));
        expect(decision.keepUserContent).toBe(true);
    });

    it("保留分支后再一次外部写盘 应该 继续保留用户内容（回归：快照更新为外部内容，用户编辑相对其未落盘）", () => {
        // 第一次外部写盘：保留用户内容，快照更新为第一次的外部内容
        const first = decideExternalChange(ctx({ latest: "old+edit", diskContent: "external1", lastDisk: "old" }));
        expect(first.keepUserContent).toBe(true);
        expect(first.nextLastDisk).toBe("external1");

        // 第二次外部写盘：用户仍未保存，快照 = external1
        const second = decideExternalChange(ctx({ latest: "old+edit", diskContent: "external2", lastDisk: first.nextLastDisk }));
        expect(second.keepUserContent).toBe(true);
        expect(second.nextLastDisk).toBe("external2");
    });

    it("用户保存后（快照=用户内容）+ 外部写盘 应该 采纳外部内容", () => {
        // 用户保存：快照更新为保存内容；随后外部写盘
        const decision = decideExternalChange(ctx({ latest: "saved", diskContent: "external", lastDisk: "saved" }));
        expect(decision.keepUserContent).toBe(false);
    });
});
