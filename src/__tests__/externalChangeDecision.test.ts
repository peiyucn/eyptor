import { describe, expect, it } from "vitest";
import { decideExternalChange, type ExternalChangeContext } from "../utils/externalChangeDecision";

const ctx = (overrides: Partial<ExternalChangeContext>): ExternalChangeContext => ({
    webviewDirty: false,
    ...overrides,
});

describe("decideExternalChange 外部写盘回退决策", () => {
    it("webview 无未落盘编辑 + 外部写盘 应该 采纳盘上内容", () => {
        expect(decideExternalChange(ctx({ webviewDirty: false })).keepUserContent).toBe(false);
    });

    it("webview 有未落盘编辑 + 外部写盘 应该 保留用户内容并标记 dirty", () => {
        expect(decideExternalChange(ctx({ webviewDirty: true })).keepUserContent).toBe(true);
    });

    it("回归：原文含 ~（序列化会转义成 \\~）且用户没编辑 应该 仍然采纳外部写入", () => {
        // 旧实现拿「webview 序列化结果」与「盘上原文快照」逐字节比较：\\~ 与 ~ 不同 →
        // 误判成「用户有未落盘编辑」→ 保留 webview 旧内容并置脏 → 用户的自动保存把
        // 外部写入（AI 工具）整份覆盖。现在只看脏状态，与序列化是否忠实无关。
        expect(decideExternalChange(ctx({ webviewDirty: false })).keepUserContent).toBe(false);
    });

    it("用户保存后脏标记清零（见 MarkdownEditorProvider 保存成功分支）+ 外部写盘 应该 采纳外部内容", () => {
        expect(decideExternalChange(ctx({ webviewDirty: false })).keepUserContent).toBe(false);
    });
});
