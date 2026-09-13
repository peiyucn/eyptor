/**
 * 查找栏文本匹配纯函数（无 DOM 依赖，可单元测试）。
 * 普通模式：逐字匹配（大小写开关控制大小写归一化）
 * 正则模式：JavaScript RegExp（g / gi），含零宽匹配防护与无效正则反馈
 */
export interface TextMatch {
    start: number;
    end: number;
}

export interface FindMatchesOptions {
    caseSensitive: boolean;
    useRegex: boolean;
}

export interface FindMatchesResult {
    matches: TextMatch[];
    /** 正则模式且查询串无法解析为合法正则时为 true（普通模式恒为 false） */
    invalidRegex: boolean;
    /** 达到上限被截断（真实匹配数 ≥ 上限）——大文档病态正则防护 */
    truncated: boolean;
}

/** 单次查找收集的匹配上限：超出即截断（防大文档病态正则冻结主线程/内存暴涨） */
export const MAX_MATCHES = 5000;

export function findMatches(
    text: string,
    query: string,
    options: FindMatchesOptions,
): FindMatchesResult {
    if (!query) {
        return { matches: [], invalidRegex: false, truncated: false };
    }

    if (options.useRegex) {
        let re: RegExp;
        try {
            re = new RegExp(query, options.caseSensitive ? "g" : "gi");
        } catch {
            return { matches: [], invalidRegex: true, truncated: false };
        }
        const matches: TextMatch[] = [];
        let truncated = false;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length });
            if (matches.length >= MAX_MATCHES) {
                truncated = true;
                break;
            }
            // 零宽匹配防护：空匹配时手动推进，避免死循环（如 `.*`、`a*`）
            if (m[0].length === 0) {
                re.lastIndex = m.index + 1;
            }
        }
        return { matches, invalidRegex: false, truncated };
    }

    const q = options.caseSensitive ? query : query.toLowerCase();
    const t = options.caseSensitive ? text : text.toLowerCase();
    const matches: TextMatch[] = [];
    let truncated = false;
    let idx = 0;
    while (idx < t.length) {
        const found = t.indexOf(q, idx);
        if (found === -1) break;
        matches.push({ start: found, end: found + query.length });
        if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
        }
        idx = found + 1;
    }
    return { matches, invalidRegex: false, truncated };
}
