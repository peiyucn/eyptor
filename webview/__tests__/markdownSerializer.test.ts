import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanTableBreaks,
    cleanTextHandler,
    preserveTableBreakStyle,
    serializeCleanMarkdown,
} from "../utils/markdownSerializer";

const unsafePatterns = [
    { character: "_" },
    { character: "_", atBreak: true },
    { character: "*" },
    { character: "*", atBreak: true },
    { character: "[" },
    { character: "[", atBreak: true },
    { character: "|" },
];

function runTextHandler(value: string, parent?: { type?: string }) {
    let unsafeDuringCall = unsafePatterns;
    const state = {
        unsafe: unsafePatterns.map((pattern) => ({ ...pattern })),
        safe: vi.fn((input: string) => {
            unsafeDuringCall = state.unsafe;
            return input;
        }),
    };
    const originalUnsafe = state.unsafe;
    const output = cleanTextHandler(
        { value },
        parent,
        state,
        { before: "", after: "" },
    );
    return { output, unsafeDuringCall, originalUnsafe, state };
}

describe("Clean Markdown serializer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("cleanTextHandler", () => {
        it("技术标识符中的下划线、星号和方括号应该不触发过度转义", () => {
            const identifier = runTextHandler("operation_log_id");
            const arithmetic = runTextHandler("5 * 10");
            const index = runTextHandler("foo[0]");

            expect(identifier.output).toBe("operation_log_id");
            expect(arithmetic.output).toBe("5 * 10");
            expect(index.output).toBe("foo[0]");
            expect(identifier.unsafeDuringCall).not.toContainEqual({ character: "_" });
            expect(arithmetic.unsafeDuringCall).not.toContainEqual({ character: "*" });
            expect(index.unsafeDuringCall).not.toContainEqual({ character: "[" });
        });

        it("普通文本中可能形成强调的成对标记应该保留安全转义", () => {
            const result = runTextHandler("foo _bar_ baz");

            expect(result.output).toBe("foo _bar_ baz");
            expect(result.unsafeDuringCall).toContainEqual({ character: "_" });
        });

        it("行首结构字符的安全规则应该继续保留", () => {
            const result = runTextHandler("___");

            expect(result.unsafeDuringCall).toContainEqual({ character: "_", atBreak: true });
        });

        it("链接文本中的方括号应该继续保留安全转义", () => {
            const result = runTextHandler("label[0]", { type: "link" });

            expect(result.unsafeDuringCall).toContainEqual({ character: "[" });
        });

        it("处理完成后应该恢复 Milkdown 原始 unsafe 状态", () => {
            const result = runTextHandler("operation_log_id");

            expect(result.state.unsafe).toBe(result.originalUnsafe);
        });
    });

    describe("cleanTableBreaks", () => {
        it("空 cell 中的占位 break 应该被移除", () => {
            expect(cleanTableBreaks("| A | B |\n|---|---|\n| foo | <br /> |")).toBe(
                "| A | B |\n|---|---|\n| foo | |",
            );
        });

        it("cell 尾部无意义 break 应该被移除", () => {
            expect(cleanTableBreaks("| Field | Value |\n|---|---|\n| ok | true<br /> |")).toBe(
                "| Field | Value |\n|---|---|\n| ok | true |",
            );
        });

        it("cell 中间的真实 break 应该保留", () => {
            const input = "| Status |\n|---|\n| 1.新增<br>2.修改 |";

            expect(cleanTableBreaks(input)).toBe(input);
        });

        it("转义竖线不应该被当作 cell 分隔符", () => {
            const input = "| Field | Description |\n|---|---|\n| foo\\|bar | value<br /> |";

            expect(cleanTableBreaks(input)).toBe(
                "| Field | Description |\n|---|---|\n| foo\\|bar | value |",
            );
        });

        it("围栏代码块和普通竖线文本应该保持不变", () => {
            const input = "```text\n| value<br /> |\n```\n\nA | B";

            expect(cleanTableBreaks(input)).toBe(input);
        });
    });

    describe("table break style", () => {
        it("源文件使用 br 时应该继承 br 风格", () => {
            expect(preserveTableBreakStyle("| a<br> |", "| a<br /> |"))
                .toBe("| a<br> |");
        });

        it("没有源风格时应该保留序列化结果", () => {
            const serialized = "| a<br /> |";

            expect(preserveTableBreakStyle("| a |", serialized)).toBe(serialized);
        });

        it("Clean 处理应该先继承风格再清理尾部 break", () => {
            expect(serializeCleanMarkdown(
                "| A |\n|---|\n| a<br> |",
                "| A |\n|---|\n| a<br /> |",
            )).toBe("| A |\n|---|\n| a |");
        });
    });
});
