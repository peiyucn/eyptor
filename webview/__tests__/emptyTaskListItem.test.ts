/**
 * 空任务项识别（纯函数）回归测试。
 *
 * 回归来源（2026-09-13，owner 在笔记里踩到）：`- [ ] `（标记后什么都不写）在 remark-gfm
 * 里不被识别成任务项——mdast 的 `checked` 停在 null、`[ ]` 留成正文文本（实测三种空写法
 * 全部如此）。本函数在解析后补齐，让空复选框与 `- [ ] a` 同构。
 */
import { describe, expect, it } from "vitest";
import { fixEmptyTaskListItems, type MdastNode } from "../utils/emptyTaskListItem";

/** 造一棵 `- [标记]` 的列表树：marker 为 null 表示没有标记文本 */
function listTree(marker: string | null, checked: boolean | null = null, extra: MdastNode[] = []): MdastNode {
    const paragraph: MdastNode = {
        type: "paragraph",
        children: marker === null ? [] : [{ type: "text", value: marker }],
    };
    return {
        type: "root",
        children: [{
            type: "list",
            children: [{
                type: "listItem",
                checked,
                children: [paragraph, ...extra],
            }],
        }],
    };
}

function item(tree: MdastNode): MdastNode {
    return tree.children![0].children![0];
}

describe("fixEmptyTaskListItems", () => {
    it("`- [ ] `（空复选框）应该 变成未勾选任务项并摘掉标记文本", () => {
        const tree = listTree("[ ] ");

        fixEmptyTaskListItems(tree);

        expect(item(tree).checked).toBe(false);
        expect(item(tree).children).toHaveLength(1);
        expect(item(tree).children![0].children).toEqual([]);
    });

    it("`- [x]` / `- [X]` 应该 变成已勾选任务项", () => {
        for (const marker of ["[x]", "[X]", "[x] "]) {
            const tree = listTree(marker);
            fixEmptyTaskListItems(tree);
            expect(item(tree).checked).toBe(true);
        }
    });

    it("上游已识别的任务项（有内容）应该 原样不动", () => {
        const tree = listTree("a", false);

        fixEmptyTaskListItems(tree);

        expect(item(tree).checked).toBe(false);
        expect(item(tree).children![0].children).toEqual([{ type: "text", value: "a" }]);
    });

    it("标记后面还有内容但上游没识别时 应该 不接管（避免与上游规则打架）", () => {
        const tree = listTree("[ ] 后面还有字");

        fixEmptyTaskListItems(tree);

        expect(item(tree).checked).toBeNull();
        expect(item(tree).children![0].children).toEqual([{ type: "text", value: "[ ] 后面还有字" }]);
    });

    it("普通空列表项（没有标记文本）应该 不动", () => {
        const tree = listTree(null);

        fixEmptyTaskListItems(tree);

        expect(item(tree).checked).toBeNull();
    });

    it("标记不在首块时 应该 不动", () => {
        const tree: MdastNode = {
            type: "root",
            children: [{
                type: "list",
                children: [{
                    type: "listItem",
                    checked: null,
                    children: [
                        { type: "paragraph", children: [{ type: "text", value: "正文" }] },
                        { type: "paragraph", children: [{ type: "text", value: "[ ]" }] },
                    ],
                }],
            }],
        };

        fixEmptyTaskListItems(tree);

        expect(item(tree).checked).toBeNull();
    });

    it("嵌套列表里的空任务项 应该 同样被识别", () => {
        const inner: MdastNode = {
            type: "list",
            children: [{
                type: "listItem",
                checked: null,
                children: [{ type: "paragraph", children: [{ type: "text", value: "[ ]" }] }],
            }],
        };
        const tree: MdastNode = {
            type: "root",
            children: [{
                type: "list",
                children: [{
                    type: "listItem",
                    checked: false,
                    children: [
                        { type: "paragraph", children: [{ type: "text", value: "outer" }] },
                        inner,
                    ],
                }],
            }],
        };

        fixEmptyTaskListItems(tree);

        expect(inner.children![0].checked).toBe(false);
    });

    it("异常输入（null / 无 children / 字段类型不对）应该 不抛错", () => {
        expect(() => fixEmptyTaskListItems(null)).not.toThrow();
        expect(() => fixEmptyTaskListItems({ type: "root" })).not.toThrow();
        expect(() => fixEmptyTaskListItems({ type: "root", children: [{ type: "listItem", children: "oops" } as unknown as MdastNode] })).not.toThrow();
        expect(() => fixEmptyTaskListItems({ type: "root", children: [{ type: "list", children: [{ type: "listItem", checked: null, children: [{ type: "paragraph", children: [{ type: "text", value: 42 }] }] }] }] })).not.toThrow();
    });
});
