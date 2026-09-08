import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterEntry } from "../utils/frontmatter";

const kv = (key: string, value: string): FrontmatterEntry => ({ type: "kv", key, value });
const raw = (text: string): FrontmatterEntry => ({ type: "raw", text });

describe("frontmatter 序列化", () => {
    it("parse → serialize 应该 往返一致（常规内容）", () => {
        const src = "---\ntitle: Test\ndate: 2024-01-01\n---\n";
        const entries = parseFrontmatter(src);
        expect(entries).toEqual([
            kv("title", "Test"),
            kv("date", "2024-01-01"),
        ]);
        expect(serializeFrontmatter(entries)).toBe(src);
    });

    it("空 key 行 应该 被忽略", () => {
        const entries = [
            kv("", "x"),
            kv("title", "A"),
        ];
        expect(serializeFrontmatter(entries)).toBe("---\ntitle: A\n---\n");
    });

    it("含引号与冒号的值 应该 原样保留", () => {
        const entries = [
            kv("title", '"A: B"'),
            kv("url", "https://example.com/a:b"),
        ];
        const out = serializeFrontmatter(entries);
        expect(out).toBe('---\ntitle: "A: B"\nurl: https://example.com/a:b\n---\n');
        // 往返
        expect(parseFrontmatter(out)).toEqual(entries);
    });

    it("无有效行 应该 返回空串", () => {
        expect(serializeFrontmatter([])).toBe("");
        expect(serializeFrontmatter([kv(" ", "")])).toBe("");
    });

    it("嵌套列表/块标量续行（非 key:value 行） 应该 原样保留往返（回归：面板编辑曾静默丢失这些行）", () => {
        const src = "---\ntitle: X\ntags:\n  - a\n  - b\n---\n";
        expect(serializeFrontmatter(parseFrontmatter(src))).toBe(src);
    });

    it("块标量（|）与注释 应该 原样保留往返", () => {
        const src = "---\ndescription: |\n  line1\n  line2\n# note\ntitle: X\n---\n";
        expect(serializeFrontmatter(parseFrontmatter(src))).toBe(src);
    });

    it("编辑 kv 行后序列化 应该 只改被编辑行，raw 行原位保留（回归：改一个字段曾连带销毁列表行）", () => {
        const src = "---\ntitle: X\ntags:\n  - a\n---\n";
        const entries = parseFrontmatter(src);
        const title = entries.find((entry) => entry.type === "kv" && entry.key === "title");
        expect(title).toBeDefined();
        if (title?.type === "kv") title.value = "Y";
        expect(serializeFrontmatter(entries)).toBe("---\ntitle: Y\ntags:\n  - a\n---\n");
    });

    it("删除 kv 行后序列化 应该 保留其余 raw 行（置空保序）", () => {
        const entries: (FrontmatterEntry | null)[] = [
            kv("title", "X"),
            raw("  - a"),
            kv("date", "2026-01-01"),
        ];
        entries[0] = null;
        expect(serializeFrontmatter(entries.filter((e): e is FrontmatterEntry => e !== null)))
            .toBe("---\n  - a\ndate: 2026-01-01\n---\n");
    });
});
