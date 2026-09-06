/**
 * Frontmatter 解析/序列化纯函数（无 DOM 依赖，可单元测试）。
 * v1 简单模式：每行 `key: value` 原样保留；空 key 的行忽略。
 */

export interface FrontmatterRow {
    key: string;
    value: string;
}

/** 解析 YAML 头为行数组（与 index.ts 旧 parseFrontmatter 行为一致） */
export function parseFrontmatter(raw: string): FrontmatterRow[] {
    return raw
        .split("\n")
        .filter((line) => !/^---/.test(line) && line.includes(":"))
        .map((line) => {
            const colonIdx = line.indexOf(":");
            return {
                key: line.slice(0, colonIdx).trim(),
                value: line.slice(colonIdx + 1).trim(),
            };
        })
        .filter(({ key }) => key.length > 0);
}

/** 行数组序列化为完整 YAML 头（含前后 `---` 与末尾换行）；无行时返回空串 */
export function serializeFrontmatter(rows: FrontmatterRow[]): string {
    const valid = rows.filter((row) => row.key.trim() !== "");
    if (valid.length === 0) return "";
    const lines = valid.map((row) => `${row.key.trim()}: ${row.value}`);
    return `---\n${lines.join("\n")}\n---\n`;
}
