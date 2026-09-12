/**
 * Clean Markdown serialization helpers.
 *
 * Milkdown delegates Markdown output to mdast-util-to-markdown. Its default
 * safety rules intentionally escape some punctuation more aggressively than
 * EPYTOR needs (for example, underscores inside identifiers). We keep the
 * upstream safety rules for structural characters and relax only the known
 * false positives, still using the upstream context-aware `safe` function.
 */

type UnsafePattern = {
    character?: string;
    atBreak?: boolean | null;
};

type SafeConfig = {
    before: string;
    after: string;
    encode?: string[];
};

export type MarkdownTextNode = { value: string };
export type MarkdownTextParent = { type?: string } | undefined;

export type MarkdownTextState = {
    unsafe: UnsafePattern[];
    safe(input: string | null | undefined, config: SafeConfig): string;
};

export type MarkdownTextInfo = SafeConfig;

export type SerializationMode = "clean" | "compatible";

export type CleanTextHandler = (
    node: MarkdownTextNode,
    parent: MarkdownTextParent,
    state: MarkdownTextState,
    info: MarkdownTextInfo,
) => string;

const RELAXABLE_CHARACTERS = new Set(["_", "*", "["]);
const PROTECTED_LINK_PARENTS = new Set([
    "link",
    "image",
    "linkReference",
    "imageReference",
]);

function isTechnicalToken(value: string): boolean {
    return /^[A-Za-z0-9_.$:/@+\-[\]]+$/.test(value);
}

function hasAttentionPair(value: string, marker: "_" | "*"): boolean {
    // A token such as __init__ is an identifier, not an emphasis phrase.
    if (isTechnicalToken(value)) return false;

    const escapedMarker = marker === "*" ? "\\*" : "_";
    const pattern = new RegExp(
        `(?:^|[\\s([{"'])${escapedMarker}{1,2}(?=\\S)[^${marker}\\n]+?\\S${escapedMarker}{1,2}(?=$|[\\s)\\]}.,!?;:'"])`,
    );
    return pattern.test(value);
}

function hasLinkLikeSyntax(value: string): boolean {
    return /!?\[[^\]\n]*\]\s*(?:\(|\[)/.test(value);
}

function shouldPreserveRelaxedCharacter(
    value: string,
    character: string,
    parent: MarkdownTextParent,
): boolean {
    if (character === "_" || character === "*") {
        return hasAttentionPair(value, character);
    }

    if (character === "[") {
        return (
            (parent?.type !== undefined && PROTECTED_LINK_PARENTS.has(parent.type)) ||
            hasLinkLikeSyntax(value)
        );
    }

    return true;
}

/**
 * Serialize a text node using Milkdown's context-aware safety algorithm while
 * removing only redundant escapes for ordinary `_`, `*`, and `[` characters.
 */
export const cleanTextHandler: CleanTextHandler = (node, parent, state, info) => {
    const value = node.value;
    if (/^[^*_\\]*\s+$/.test(value)) return value;

    const originalUnsafe = state.unsafe;
    const preserve = new Set<string>();
    for (const character of RELAXABLE_CHARACTERS) {
        if (shouldPreserveRelaxedCharacter(value, character, parent)) {
            preserve.add(character);
        }
    }

    state.unsafe = originalUnsafe.filter((pattern) => {
        const character = pattern.character;
        if (!character || !RELAXABLE_CHARACTERS.has(character)) return true;
        // Structural forms at the beginning of a line remain protected.
        if (pattern.atBreak) return true;
        return preserve.has(character);
    });

    try {
        return state.safe(value, { ...info, encode: [] });
    } finally {
        state.unsafe = originalUnsafe;
    }
};

/**
 * Keep a file's existing table break spelling when Clean output introduces a
 * real break in a changed table row.
 */
export function preserveTableBreakStyle(source: string, serialized: string): string {
    const sourceStyle = source.match(/<br\s*\/?>/i)?.[0];
    if (!sourceStyle) return serialized;
    return serialized.replace(/<br\s*\/?>/gi, sourceStyle);
}

export function serializeCleanMarkdown(source: string, serialized: string): string {
    return preserveTableBreakStyle(source, serialized);
}

/** 无序列表标记符与有序列表编号后的分隔符（mdast-util-to-markdown 的 bullet / bulletOrdered） */
export interface ListMarkerStyle {
    bullet: "*" | "-" | "+";
    ordered: "." | ")";
}

/**
 * 列表项里「空内容占位」整行：`- <br />` / `- [ ] <br />`（含缩进与有序标记）。
 * preset-commonmark 给「非文档末尾的空段落」补 `<br />` 占位，好让空行往返；加载侧又有
 * `remark-preserve-empty-line` 把它抹掉，所以它本就不是用户内容。
 */
const LIST_ITEM_BREAK_PLACEHOLDER_RE =
    /^([ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*)<br\s*\/?>[ \t]*$/gim;

/**
 * 擦掉列表项内的空内容占位 `<br />`，保留标记本身。
 *
 * 回归（2026-09-13，owner 在笔记里踩到）：空任务项 `- [ ] `（标记后什么都不写）在 mdast
 * 里靠「占位 + 复选框标记」才写得出来 —— 占位在，输出是 `- [ ] <br />`（把 `<br />` 写进
 * 用户笔记）；占位被提前吞掉，复选框标记会一起消失（输出只剩 `-`）。所以在**序列化文本**上
 * 收尾：`- [ ] <br />` → `- [ ] `、`- <br />` → `- `，与用户原文逐字一致。
 */
export function stripListItemBreakPlaceholder(markdown: string): string {
    return markdown.replace(LIST_ITEM_BREAK_PLACEHOLDER_RE, "$1");
}

/** 行首列表标记：`-` / `*` / `+` 后必须有空格（`---` 分隔线、`-` setext 下划线不算） */
const LIST_MARKER_LINE_RE = /^[ \t]*([-*+]|\d{1,9}([.)]))[ \t]+/;

/**
 * 读取文件自己的列表标记风格，供序列化沿用。
 *
 * 回归：mdast-util-to-markdown 默认把无序列表写成 `*`、有序编号写成 `1.`，于是保存会把
 * 用户原文的 `- item` 改写成 `* item`、`1) item` 改写成 `1. item`——语义没变但每次保存都
 * 改用户文件（git 全是噪声），与「clean = 尽量少改」相悖。取**出现次数最多**的写法
 * （并列时取先出现的），没有对应列表时回退上游默认值，保证无列表的文件行为不变。
 */
export function detectListMarkerStyle(source: string): ListMarkerStyle {
    const bullets: Array<"*" | "-" | "+"> = ["*", "-", "+"];
    const orderedMarkers: Array<"." | ")"> = [".", ")"];
    const bulletCounts = new Map<string, number>();
    const orderedCounts = new Map<string, number>();

    for (const line of source.split("\n")) {
        const match = LIST_MARKER_LINE_RE.exec(line);
        if (!match) { continue; }
        const delimiter = match[2];
        const counts = delimiter ? orderedCounts : bulletCounts;
        const marker = delimiter ?? match[1];
        counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }

    return {
        bullet: mostFrequent(bullets, bulletCounts),
        ordered: mostFrequent(orderedMarkers, orderedCounts),
    };
}

/** 取出现次数最多的标记；全为 0 时取该顺序的第一个（= 上游默认写法） */
function mostFrequent<T extends string>(candidates: readonly T[], counts: Map<string, number>): T {
    let best = candidates[0];
    let bestCount = counts.get(best) ?? 0;
    for (const candidate of candidates.slice(1)) {
        const count = counts.get(candidate) ?? 0;
        if (count > bestCount) {
            best = candidate;
            bestCount = count;
        }
    }
    return best;
}

/**
 * 表格换行的序列化补丁（闭环方案，源码形态 <br>）。
 *
 * mdast 默认 break handler 在表格上下文（unsafe `\n`）退化为空格；GFM 表格
 * 换行的标准表达是 `<br>`，但 remark-gfm 解析层会丢弃表格内 `<br>`（上游
 * Milkdown#2463，加载往返不一致）。配合 Extension 侧加载转换
 * （convertTableBrForDisplay：源码 `<br>` → `&#10;` 再进解析器），形成闭环：
 * 源码 `<br>` → 加载转换 → 渲染换行 → 序列化 `<br>` → 源码往返一致，
 * GitHub 渲染同为换行。
 *
 * 回归 P5：表格里的展示性占位此前靠序列化完成后的 cleanTableBreaks 全文件扫描
 * （含手写 GFM 单元格切分）擦除；现在两个来源都在本 handler 里就地处理——
 * ① 空单元格：Milkdown 的 paragraph toMarkdown runner 对空段落追加 html 节点
 *    `<br />`（preset-commonmark lib/index.js:490），在单元格里是纯展示占位；
 * ② 段落末尾的换行：重载时 remark 会裁掉单元格尾部换行，写出去只会造成
 *    「文件里有、重开就没」的不一致。
 */
export function withTableBreakHandler<T extends { handlers?: unknown }>(options: T): T {
    const handlers = (options.handlers ?? {}) as Record<string, unknown>;
    const defaultBreak = handlers.break;
    const defaultText = handlers.text;
    return {
        ...options,
        handlers: {
            ...handlers,
            break: (
                node: unknown,
                parent: unknown,
                state: { stack: string[] },
                info: unknown,
            ) => {
                if (state.stack.includes("tableCell")) {
                    const siblings = (parent as { children?: unknown[] } | undefined)?.children;
                    if (Array.isArray(siblings) && siblings[siblings.length - 1] === node) {
                        return ""; // 段落末尾换行不写源码（重载会被裁掉）
                    }
                    return "<br>";
                }
                const fallback = defaultBreak as
                    | ((n: unknown, p: unknown, s: unknown, i: unknown) => unknown)
                    | undefined;
                return fallback ? fallback(node, parent, state, info) : "";
            },
            // isInline hardbreak（加载 `&#10;` 解析而来）序列化为含 `\n` 的 text：
            // 表格内必须还原为 `<br>`，否则裸换行破坏表格结构
            text: (
                node: { value?: string },
                parent: unknown,
                state: { stack: string[] },
                info: unknown,
            ) => {
                if (state.stack.includes("tableCell") && String(node.value ?? "").includes("\n")) {
                    return String(node.value ?? "").replace(/\n/g, "<br>");
                }
                const fallback = defaultText as
                    | ((n: unknown, p: unknown, s: unknown, i: unknown) => unknown)
                    | undefined;
                return fallback ? fallback(node, parent, state, info) : String(node.value ?? "");
            },
            html: (
                node: { value?: string },
                _parent: unknown,
                state: { stack: string[] },
            ) => {
                const value = String(node.value ?? "");
                // 空单元格的展示性占位（见函数头注释①）：单元格里直接输出空
                if (state.stack.includes("tableCell") && /^<br\s*\/?>$/i.test(value.trim())) {
                    return "";
                }
                // 列表项里的占位**不能**在这里吞掉：mdast 的空任务项序列化要求首块是
                // paragraph 且模板里要能看到标记后的内容，占位没了复选框标记会一起消失
                // （实测 `- [ ] ` 存成 `-`）。该占位改由 stripListItemBreakPlaceholder
                // 在序列化文本上擦除，那时复选框标记已经写好。
                return value;
            },
        } as T["handlers"],
    };
}
