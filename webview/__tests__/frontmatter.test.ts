import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../utils/frontmatter";

describe("frontmatter 序列化", () => {
    it("parse → serialize 应该 往返一致（常规内容）", () => {
        const raw = "---\ntitle: Test\ndate: 2024-01-01\n---\n";
        const rows = parseFrontmatter(raw);
        expect(rows).toEqual([
            { key: "title", value: "Test" },
            { key: "date", value: "2024-01-01" },
        ]);
        expect(serializeFrontmatter(rows)).toBe(raw);
    });

    it("空 key 行 应该 被忽略", () => {
        const rows = [
            { key: "", value: "x" },
            { key: "title", value: "A" },
        ];
        expect(serializeFrontmatter(rows)).toBe("---\ntitle: A\n---\n");
    });

    it("含引号与冒号的值 应该 原样保留", () => {
        const rows = [
            { key: "title", value: '"A: B"' },
            { key: "url", value: "https://example.com/a:b" },
        ];
        const out = serializeFrontmatter(rows);
        expect(out).toBe('---\ntitle: "A: B"\nurl: https://example.com/a:b\n---\n');
        // 往返
        expect(parseFrontmatter(out)).toEqual(rows);
    });

    it("无有效行 应该 返回空串", () => {
        expect(serializeFrontmatter([])).toBe("");
        expect(serializeFrontmatter([{ key: " ", value: "" }])).toBe("");
    });
});
