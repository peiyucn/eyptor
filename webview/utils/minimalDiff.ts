type SigLine = { text: string; lineIdx: number };
type Anchor = { savedIndex: number; serializedIndex: number };

const SEP_ROW_RE = /^\|[\s\-:|]+\|$/;
const TABLE_ROW_RE = /^\|.*\|$/;
const MAX_LCS_CELLS = 40_000;

function normalizeSepRow(line: string): string {
    const t = line.trim();
    const cells = t.split('|').slice(1, -1).map((c) => {
        return c.trim().replace(/(:?)-+(:?)/g, (_match, a: string, b: string) => (a ?? '') + '-' + (b ?? ''));
    });
    return '|' + cells.join('|') + '|';
}

function normalizeSplitStrong(line: string): string {
    let prev: string;
    do {
        prev = line;
        line = line.replace(
            /\*\*((?:[^*]|\*(?!\*))*)\*\* \*\*((?:[^*]|\*(?!\*))*)\*\*/g,
            '**$1 $2**',
        );
    } while (line !== prev);
    return line;
}

function normalizeTableDataRow(line: string): string {
    const t = line.trim();
    const cells = t.split('|').slice(1, -1).map((c) => {
        const v = c.trim();
        return v === '<br />' ? '' : v;
    });
    return '|' + cells.join('|') + '|';
}

function normalizeFenceOpen(line: string): string {
    return line.replace(/^(\s*`{3,})\s+/, '$1');
}

function normalizeLine(line: string, listLine: ListLineParts | null, indentRank: number | undefined): string {
    // 列表行：标记符（`-` / `*` / `+`、`1.` / `1)`）与缩进宽度都只是写法，不算差异——
    // 上游序列化固定写 `*` 与 3 空格缩进，若不归一化，保存会把用户原文的 `- item`、
    // 4 空格嵌套反复改写（回归：列表写法被保存重写）。缩进取「同一连续列表段内的档位」，
    // 因此真实改层级（用户在编辑器里缩进/反缩进）仍会改变签名并被如实保存。
    if (listLine && indentRank !== undefined) {
        return `\u0000list\u0000${indentRank}\u0000${listLine.canonicalMarker}\u0000${normalizeSplitStrong(listLine.rest)}`;
    }
    const t = line.trim();
    if (SEP_ROW_RE.test(t)) return normalizeSepRow(line);
    if (TABLE_ROW_RE.test(t)) return normalizeTableDataRow(line);
    if (/^`{3,}/.test(t)) return normalizeFenceOpen(line);
    return normalizeSplitStrong(line);
}

function signatureLines(markdown: string): SigLine[] {
    const lines = markdown.split("\n");
    const listLines = lines.map(listLineParts);
    const indentRanks = listIndentRanks(listLines);
    return lines.reduce<SigLine[]>((acc, line, lineIdx) => {
        if (line.trim() !== "") {
            acc.push({ text: normalizeLine(line, listLines[lineIdx], indentRanks.get(lineIdx)), lineIdx });
        }
        return acc;
    }, []);
}

/** 列表行拆解：缩进宽度（制表符按 4 空格展开）+ 归一的标记 + 标记之后的内容 */
interface ListLineParts {
    indent: number;
    canonicalMarker: string;
    rest: string;
}

/** 行首列表标记（标记后需有空格或是空项本身；`---` 分隔线与 `-` setext 下划线不匹配） */
const LIST_LINE_RE = /^([ \t]*)([-*+]|\d{1,9})([.)]?)([ \t]+|$)(.*)$/;

function listLineParts(line: string): ListLineParts | null {
    const match = LIST_LINE_RE.exec(line);
    if (!match) return null;
    const [, rawIndent, numberOrBullet, delimiter, , rest] = match;
    const indent = [...rawIndent].reduce((sum, ch) => sum + (ch === "\t" ? 4 : 1), 0);
    // 无序标记的字符差异归一为同一个记号；有序列表的编号是内容（`1.` / `3.` 不同），只归一
    // `.` 与 `)` 这种分隔符写法
    const canonicalMarker = delimiter
        ? `${numberOrBullet}|`
        : "\u2022";
    return { indent, canonicalMarker, rest };
}

/**
 * 连续列表行（中间不被空行或非列表行打断）内，各行缩进的档位：
 * 把该段出现过的缩进宽度排序后取序号，于是「4 空格一级」与「3 空格一级」得到同一档位。
 */
function listIndentRanks(listLines: Array<ListLineParts | null>): Map<number, number> {
    const ranks = new Map<number, number>();
    let runStart = 0;
    const closeRun = (endExclusive: number): void => {
        const widths = new Set<number>();
        for (let index = runStart; index < endExclusive; index++) {
            const parts = listLines[index];
            if (parts) widths.add(parts.indent);
        }
        if (widths.size > 0) {
            const sorted = [...widths].sort((a, b) => a - b);
            for (let index = runStart; index < endExclusive; index++) {
                const parts = listLines[index];
                if (parts) ranks.set(index, sorted.indexOf(parts.indent));
            }
        }
        runStart = endExclusive;
    };
    for (let index = 0; index < listLines.length; index++) {
        if (listLines[index] === null) closeRun(index);
    }
    closeRun(listLines.length);
    return ranks;
}

export function applyMinimalChanges(saved: string, serialized: string): string {
    if (saved === serialized) return saved;

    const savedSig = signatureLines(saved);
    const serialSig = signatureLines(serialized);
    const keepMap = new Map<number, number>();

    const anchors = findUniqueAnchors(savedSig, serialSig);
    let savedStart = 0;
    let serializedStart = 0;
    for (const anchor of anchors) {
        addBoundedLcsMatches(
            savedSig,
            savedStart,
            anchor.savedIndex,
            serialSig,
            serializedStart,
            anchor.serializedIndex,
            keepMap,
        );
        keepMap.set(
            serialSig[anchor.serializedIndex].lineIdx,
            savedSig[anchor.savedIndex].lineIdx,
        );
        savedStart = anchor.savedIndex + 1;
        serializedStart = anchor.serializedIndex + 1;
    }
    addBoundedLcsMatches(
        savedSig,
        savedStart,
        savedSig.length,
        serialSig,
        serializedStart,
        serialSig.length,
        keepMap,
    );

    if (keepMap.size === savedSig.length && keepMap.size === serialSig.length && saved.length === serialized.length) {
        return saved;
    }

    const savedLines = saved.split('\n');
    const serializedLines = serialized.split('\n');
    return serializedLines.map((line, lineIdx) => {
        const savedIdx = keepMap.get(lineIdx);
        return savedIdx === undefined ? line : savedLines[savedIdx];
    }).join('\n');
}

function findUniqueAnchors(saved: SigLine[], serialized: SigLine[]): Anchor[] {
    const savedCounts = countSignatures(saved);
    const serializedCounts = countSignatures(serialized);
    const savedUnique = uniqueSignaturePositions(saved, savedCounts);
    const serializedUnique = uniqueSignaturePositions(serialized, serializedCounts);

    const anchors: Anchor[] = [];
    let lastSavedIndex = -1;
    for (let serializedIndex = 0; serializedIndex < serialized.length; serializedIndex++) {
        const signature = serialized[serializedIndex].text;
        const savedIndex = savedUnique.get(signature);
        if (savedIndex === undefined || savedIndex <= lastSavedIndex) continue;
        if (serializedUnique.get(signature) !== serializedIndex) continue;
        anchors.push({ savedIndex, serializedIndex });
        lastSavedIndex = savedIndex;
    }
    return anchors;
}

function countSignatures(lines: SigLine[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const line of lines) {
        counts.set(line.text, (counts.get(line.text) ?? 0) + 1);
    }
    return counts;
}

function uniqueSignaturePositions(
    lines: SigLine[],
    counts: Map<string, number>,
): Map<string, number> {
    const positions = new Map<string, number>();
    for (let index = 0; index < lines.length; index++) {
        const signature = lines[index].text;
        if (counts.get(signature) === 1) positions.set(signature, index);
    }
    return positions;
}

function addBoundedLcsMatches(
    saved: SigLine[],
    savedStart: number,
    savedEnd: number,
    serialized: SigLine[],
    serializedStart: number,
    serializedEnd: number,
    keepMap: Map<number, number>,
): void {
    const savedLength = savedEnd - savedStart;
    const serializedLength = serializedEnd - serializedStart;
    if (savedLength === 0 || serializedLength === 0) return;
    if (savedLength * serializedLength > MAX_LCS_CELLS) return;

    const width = serializedLength + 1;
    const dp = new Uint16Array((savedLength + 1) * width);
    for (let savedOffset = 1; savedOffset <= savedLength; savedOffset++) {
        for (let serializedOffset = 1; serializedOffset <= serializedLength; serializedOffset++) {
            const current = saved[savedStart + savedOffset - 1].text;
            const candidate = serialized[serializedStart + serializedOffset - 1].text;
            const currentIndex = savedOffset * width + serializedOffset;
            if (current === candidate) {
                dp[currentIndex] = dp[(savedOffset - 1) * width + serializedOffset - 1] + 1;
            } else {
                dp[currentIndex] = Math.max(
                    dp[(savedOffset - 1) * width + serializedOffset],
                    dp[savedOffset * width + serializedOffset - 1],
                );
            }
        }
    }

    let savedOffset = savedLength;
    let serializedOffset = serializedLength;
    while (savedOffset > 0 && serializedOffset > 0) {
        const currentIndex = savedOffset * width + serializedOffset;
        if (saved[savedStart + savedOffset - 1].text === serialized[serializedStart + serializedOffset - 1].text) {
            keepMap.set(
                serialized[serializedStart + serializedOffset - 1].lineIdx,
                saved[savedStart + savedOffset - 1].lineIdx,
            );
            savedOffset--;
            serializedOffset--;
        } else if (dp[currentIndex - 1] >= dp[currentIndex - width]) {
            serializedOffset--;
        } else {
            savedOffset--;
        }
    }
}

