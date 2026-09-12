import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanTextHandler,
    detectListMarkerStyle,
    preserveTableBreakStyle,
    serializeCleanMarkdown,
    stripListItemBreakPlaceholder,
    withTableBreakHandler,
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

    describe("withTableBreakHandler（表格换行 handler 化，回归 P5）", () => {
        const handlersOf = (options: { handlers?: unknown } = { handlers: {} }) =>
            (withTableBreakHandler(options) as { handlers: Record<string, (...args: never[]) => string> }).handlers;
        const inCell = { stack: ["root", "table", "tableRow", "tableCell"] };

        it("表格单元格内的 break 应该 输出 <br>", () => {
            expect(handlersOf().break({} as never, { children: [{}, {}] } as never, inCell as never, {} as never))
                .toBe("<br>");
        });

        it("单元格内段落末尾的 break 应该 输出空（重载时 remark 会裁掉尾部换行）", () => {
            const node = {};
            expect(handlersOf().break(node as never, { children: [node] } as never, inCell as never, {} as never))
                .toBe("");
        });

        it("表格外的 break 应该 走上游默认（无默认 handler 时为空串）", () => {
            expect(handlersOf().break({} as never, {} as never, { stack: ["root"] } as never, {} as never))
                .toBe("");
        });

        it("单元格内含换行的 text 应该 换成 <br>", () => {
            expect(handlersOf().text({ value: "x\nz" } as never, {} as never, inCell as never, {} as never))
                .toBe("x<br>z");
        });

        it("空单元格的空段落占位 <br /> 应该 被去掉（回归：Milkdown 空段落 runner 追加的展示性 html）", () => {
            expect(handlersOf().html({ value: "<br />" } as never, {} as never, inCell as never))
                .toBe("");
        });

        it("表格外的原始 HTML 应该 原样输出", () => {
            expect(handlersOf().html({ value: "<div>hi</div>" } as never, {} as never, { stack: ["root"] } as never))
                .toBe("<div>hi</div>");
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

        it("Clean 处理应该继承源文件 br 风格", () => {
            expect(serializeCleanMarkdown(
                "| A |\n|---|\n| a<br> |",
                "| A |\n|---|\n| a<br /> |",
            )).toBe("| A |\n|---|\n| a<br> |");
        });
    });

    describe("list marker style", () => {
        it("源文件用 `-` 时应该沿用 `-`（回归：保存把 `- item` 改写成 `* item`）", () => {
            expect(detectListMarkerStyle("- one\n- two\n").bullet).toBe("-");
        });

        it("源文件用 `*` 时应该沿用 `*`", () => {
            expect(detectListMarkerStyle("* one\n* two\n").bullet).toBe("*");
        });

        it("任务列表也算无序列表（`- [ ]`）", () => {
            expect(detectListMarkerStyle("- [ ] todo\n- [x] done\n").bullet).toBe("-");
        });

        it("混合写法取出现次数最多的那个", () => {
            expect(detectListMarkerStyle("- a\n- b\n* c\n").bullet).toBe("-");
        });

        it("有序列表取编号后的分隔符", () => {
            expect(detectListMarkerStyle("1) a\n2) b\n").ordered).toBe(")");
            expect(detectListMarkerStyle("1. a\n2. b\n").ordered).toBe(".");
        });

        it("没有列表时应该回退上游默认写法", () => {
            expect(detectListMarkerStyle("# title\n\ntext\n")).toEqual({ bullet: "*", ordered: "." });
        });

        it("分隔线 `---` 与 `-` setext 下划线不应该被当成列表", () => {
            expect(detectListMarkerStyle("title\n---\n\ntext\n")).toEqual({ bullet: "*", ordered: "." });
        });
    });

    describe("list item break placeholder", () => {
        it("空任务项的 `<br />` 占位应该 被擦掉且保留复选框标记（回归：写进用户笔记）", () => {
            expect(stripListItemBreakPlaceholder("- [ ] <br />\n- [x] done\n"))
                .toBe("- [ ] \n- [x] done\n");
        });

        it("已勾选空任务项应该 同样保留标记", () => {
            expect(stripListItemBreakPlaceholder("- [x] <br />\n")).toBe("- [x] \n");
        });

        it("普通空列表项应该 只留标记", () => {
            expect(stripListItemBreakPlaceholder("- <br />\n")).toBe("- \n");
            expect(stripListItemBreakPlaceholder("    - <br />\n")).toBe("    - \n");
            expect(stripListItemBreakPlaceholder("1. <br />\n")).toBe("1. \n");
        });

        it("占位后面还有内容时 应该 不碰（那是真内容）", () => {
            expect(stripListItemBreakPlaceholder("- <br />文字\n")).toBe("- <br />文字\n");
        });

        it("非列表行上的 `<br />` 应该 不碰", () => {
            expect(stripListItemBreakPlaceholder("正文 <br />\n")).toBe("正文 <br />\n");
            expect(stripListItemBreakPlaceholder("<br />\n")).toBe("<br />\n");
        });
    });
});
