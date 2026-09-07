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
 * Clean the presentation-only breaks emitted for empty paragraphs inside a
 * GFM table. Escaped pipes are respected so cell contents are not split.
 */
export function cleanTableBreaks(markdown: string): string {
    const lines = markdown.split("\n");
    let inFence = false;
    let inTable = false;

    return lines.map((line, index) => {
        if (/^\s*(`{3,}|~{3,})/.test(line)) {
            inFence = !inFence;
            inTable = false;
            return line;
        }
        if (inFence) return line;

        const isRow = /^\s*\|.*\|\s*$/.test(line);
        const isSeparator = /^\s*\|[\s\-:|]+\|\s*$/.test(line);
        const adjacentToSeparator =
            isRow &&
            (isSeparator ||
                /^\s*\|[\s\-:|]+\|\s*$/.test(lines[index - 1] ?? "") ||
                /^\s*\|[\s\-:|]+\|\s*$/.test(lines[index + 1] ?? ""));

        if (isSeparator) {
            inTable = true;
            return line;
        }
        if (!isRow) {
            inTable = false;
            return line;
        }
        if (!inTable && !adjacentToSeparator) return line;

        const cells = splitTableCells(line);
        if (cells.length < 2) return line;

        return cells
            .map(cleanTableCellBreak)
            .join("|");
    }).join("\n");
}

function cleanTableCellBreak(cell: string): string {
    const match = cell.match(/<br\s*\/?>\s*$/i);
    if (!match || match.index === undefined) return cell;

    const contentBeforeBreak = cell.slice(0, match.index);
    const trailingPadding = match[0].replace(/<br\s*\/?>/i, "");
    return contentBeforeBreak.trim() ? contentBeforeBreak + trailingPadding : " ";
}

function splitTableCells(line: string): string[] {
    const cells: string[] = [];
    let start = 0;
    let escaped = false;

    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (character === "|") {
            cells.push(line.slice(start, index));
            start = index + 1;
        }
    }
    cells.push(line.slice(start));
    return cells;
}

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
    return cleanTableBreaks(preserveTableBreakStyle(source, serialized));
}

/**
 * 表格单元格内换行的序列化补丁（闭环方案，源码形态 <br>）。
 *
 * mdast 默认 break handler 在表格上下文（unsafe `\n`）退化为空格；GFM 表格
 * 换行的标准表达是 `<br>`，但 remark-gfm 解析层会丢弃表格内 `<br>`（上游
 * Milkdown#2463，加载往返不一致）。配合 Extension 侧加载转换
 * （convertTableBrForDisplay：源码 `<br>` → `&#10;` 再进解析器），形成闭环：
 * 源码 `<br>` → 加载转换 → 渲染换行 → 序列化 `<br>` → 源码往返一致，
 * GitHub 渲染同为换行。
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
        } as T["handlers"],
    };
}
