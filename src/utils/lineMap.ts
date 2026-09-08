/**
 * 将 Markdown 内容映射为段落行号数组（用于编辑器行高亮、全局搜索跳转）。
 * 每个元素是一个"段落"（非空行组）的起始行号（1-indexed）。
 * 代码块作为整体处理，不拆分内部行。
 */
export function computeLineMap(content: string): number[] {
    const lines = content.split("\n");
    const map: number[] = [];
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && lines[i].trim() === "") i++;
        if (i >= lines.length) break;
        map.push(i + 1);
        const fenceMatch = lines[i].trimStart().match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            const fence = fenceMatch[1];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith(fence)) i++;
            if (i < lines.length) i++;
        } else {
            while (i < lines.length && lines[i].trim() !== "") i++;
        }
    }
    return map;
}

/** 从完整内容中切出 YAML frontmatter 与其行数（与 contentTransform 同口径，避免循环依赖） */
function splitFrontmatter(content: string): { frontmatterLines: number; body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) return { frontmatterLines: 0, body: content };
    return { frontmatterLines: match[0].split("\n").length - 1, body: content.slice(match[0].length) };
}

/**
 * 行号映射（显示口径）：lineMap[i] = 第 i 个**正文块**在完整源码中的行号。
 *
 * 回归（用户实测：源码/预览来回切，光标总回到 1 行 1 列）：此前对完整内容直接
 * 调 computeLineMap，frontmatter 占掉 lineMap[0]，而 webview 的 DOM 子块只有正文，
 * 块索引与 lineMap 错位一格——「预览 → 文本」拿到上一块的行号（首块时正好是第 1 行），
 * 「文本 → 预览」的 scrollToLine 同样落在上一块。
 */
export function computeDisplayLineMap(content: string): number[] {
    const { frontmatterLines, body } = splitFrontmatter(content);
    return computeLineMap(body).map((line) => line + frontmatterLines);
}
