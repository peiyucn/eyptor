/**
 * 将 Markdown 内容映射为段落行区间表（用于行号映射、滚动同步定位）。
 * 每个元素是一个"段落"（非空行组）的起止行号（1-indexed，闭区间）。
 * 代码块作为整体处理，不拆分内部行。
 *
 * 用途：滚动同步的锚点表（对照 VS Code 内置 Markdown 预览——它给每个渲染块标
 * data-line/endLine，文本↔预览按「块顶/块底 + 块内行占比」线性插值定位）。
 * 代码块按围栏整体成段，end 即闭围栏行。
 */
export interface LineRange {
    start: number;
    end: number;
}

/** 段落行区间表（正文口径，见 LineRange） */
export function computeLineRanges(content: string): LineRange[] {
    const lines = content.split("\n");
    const ranges: LineRange[] = [];
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && lines[i].trim() === "") i++;
        if (i >= lines.length) break;
        const start = i + 1;
        const fenceMatch = lines[i].trimStart().match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            const fence = fenceMatch[1];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith(fence)) i++;
            if (i < lines.length) i++; // 闭围栏
            ranges.push({ start, end: Math.max(start, i) });
        } else {
            while (i < lines.length && lines[i].trim() !== "") i++;
            ranges.push({ start, end: i });
        }
    }
    return ranges;
}

/** 从完整内容中切出 YAML frontmatter 与其行数（与 contentTransform 同口径，避免循环依赖） */
function splitFrontmatter(content: string): { frontmatterLines: number; body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) return { frontmatterLines: 0, body: content };
    return { frontmatterLines: match[0].split("\n").length - 1, body: content.slice(match[0].length) };
}

/**
 * 段落行区间表（显示口径）：ranges[i] = 第 i 个**正文块**在完整源码中的起止行。
 *
 * 回归（用户实测：源码/预览来回切，光标总回到 1 行 1 列）：此前对完整内容直接
 * 算行号，frontmatter 占掉第 0 块，而 webview 的 DOM 子块只有正文，块索引与行号
 * 表错位一格——「预览 → 文本」拿到上一块的行号（首块时正好是第 1 行），
 * 「文本 → 预览」的 scrollToLine 同样落在上一块。
 */
export function computeDisplayLineRanges(content: string): LineRange[] {
    const { frontmatterLines, body } = splitFrontmatter(content);
    return computeLineRanges(body).map((range) => ({
        start: range.start + frontmatterLines,
        end: range.end + frontmatterLines,
    }));
}
