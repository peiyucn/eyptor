/**
 * Frontmatter 解析/序列化纯函数（无 DOM 依赖，可单元测试）。
 * v1 简单模式：顶层 `key: value` 行可编辑；其余行（缩进行/列表项/注释/块标量续行等）
 * 作为 raw 段原样保留并在序列化时放回原位——面板编辑绝不丢失无法往返的内容。
 */

export interface FrontmatterRow {
    key: string;
    value: string;
}

/** 有序条目：kv = 面板可编辑行；raw = 原样保留行（不支持编辑但绝不丢数据） */
export type FrontmatterEntry =
    | { type: "kv"; key: string; value: string }
    | { type: "raw"; text: string };

/**
 * 可安全扁平编辑的顶层键值行：无前导空白、不以 `-`/`*`/`#` 开头（YAML 列表项与
 * 注释保持 raw）、含冒号。值允许为空（`key:`）。
 */
const KV_LINE_RE = /^([^\s\-*#][^:]*):(.*)$/;

/** 解析 YAML 头为有序条目数组（`---` 分隔行忽略；末尾 split 产生的空行去除，中间空行保留） */
export function parseFrontmatter(raw: string): FrontmatterEntry[] {
    const lines = raw.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const entries: FrontmatterEntry[] = [];
    for (const line of lines) {
        if (/^---/.test(line)) continue;
        const kv = KV_LINE_RE.exec(line);
        if (kv) {
            entries.push({ type: "kv", key: kv[1].trim(), value: kv[2].trim() });
        } else {
            entries.push({ type: "raw", text: line });
        }
    }
    return entries;
}

/** 有序条目序列化为完整 YAML 头（含前后 `---` 与末尾换行）；无有效 kv 行时返回空串 */
export function serializeFrontmatter(entries: FrontmatterEntry[]): string {
    const lines: string[] = [];
    let hasKv = false;
    for (const entry of entries) {
        if (entry.type === "raw") {
            lines.push(entry.text);
        } else if (entry.key.trim() !== "") {
            hasKv = true;
            const key = entry.key.trim();
            lines.push(entry.value !== "" ? `${key}: ${entry.value}` : `${key}:`);
        }
        // 空 key 的 kv 行丢弃（面板校验已拦截，此处兜底）
    }
    if (!hasKv) return "";
    return `---\n${lines.join("\n")}\n---\n`;
}
