import { describe, expect, it } from "vitest";
import { assignFoldKeys, headingFoldKey } from "../components/toc/index";

describe("assignFoldKeys", () => {
    it("同名同级标题 应该 各自获得不同折叠键（回归 P6）", () => {
        const keys = assignFoldKeys([
            { level: 2, text: "安装" },
            { level: 2, text: "安装" },
        ]).map((h) => h.key);

        expect(keys[0]).not.toBe(keys[1]);
        expect(keys).toEqual([
            headingFoldKey(2, "安装", 1),
            headingFoldKey(2, "安装", 2),
        ]);
    });

    it("不同级别同名标题 应该 保持原有区分", () => {
        const keys = assignFoldKeys([
            { level: 1, text: "安装" },
            { level: 2, text: "安装" },
        ]).map((h) => h.key);

        expect(keys).toEqual([
            headingFoldKey(1, "安装", 1),
            headingFoldKey(2, "安装", 1),
        ]);
    });

    it("重复标题的序号 应该 按出现顺序递增且与文本无关", () => {
        const keys = assignFoldKeys([
            { level: 2, text: "A" },
            { level: 2, text: "B" },
            { level: 2, text: "A" },
            { level: 2, text: "A" },
        ]).map((h) => h.key);

        expect(keys).toEqual([
            headingFoldKey(2, "A", 1),
            headingFoldKey(2, "B", 1),
            headingFoldKey(2, "A", 2),
            headingFoldKey(2, "A", 3),
        ]);
    });

    it("应保留输入的 level/text 字段（不改变列表结构）", () => {
        const result = assignFoldKeys([{ level: 3, text: "x", pos: 42 }]);

        expect(result[0]).toMatchObject({ level: 3, text: "x", pos: 42 });
    });
});
