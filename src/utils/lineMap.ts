/**
 * 将 Markdown 内容映射为「渲染块行区间表」（用于行号映射、滚动同步定位）。
 *
 * 关键约束：**这张表必须与编辑器的块结构一一对应**。webview 侧按
 * `view.state.doc` 的顶层子节点顺序取 DOM 块（见 webview/index.ts 的
 * getContentBlockElements），表项与块按索引对齐；一旦两者错位，滚动同步就会
 * 整体偏移——行号越靠后偏差越大（回归：用户实测「源码在 3. 保存链路，切回预览
 * 跑到 6」「预览切源码完全无法定位」）。
 *
 * 历史坑：旧实现按「空行分段」扫行——列表项之间有空行时每个列表项各成一段，
 * 而 CommonMark 把它们解析成**一个** list 块。实测一份 554 行清单：DOM 块 142 个、
 * 旧表 232 项，整体错位最多 90 块。现在改用与渲染端同一套解析（remark + GFM + math）
 * 取 mdast 顶层节点的真实起止行，块数与块序都与渲染结果一致。
 */
export interface LineRange {
    start: number;
    end: number;
}

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** mdast 顶层节点在本模块用到的最小形状（不引 @types/mdast，避免多一份类型依赖） */
interface MdastTopLevelNode {
    type: string;
    position?: { start: { line: number }; end: { line: number } };
}

/**
 * 不产生编辑器块的 mdast 顶层节点：链接引用定义、脚注定义、frontmatter。
 * 它们必须从表里剔除，否则块索引会整体后移。
 */
const NON_RENDERED_NODE_TYPES = new Set(["definition", "footnoteDefinition", "yaml", "toml"]);

/** 与 webview 渲染端同口径的解析器（GFM 表格/任务列表 + $..$ 数学） */
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/**
 * 最近一次解析结果缓存（单条）：保存链路会在内容未变时重复请求映射
 * （原生 autoSave、切标签前的落盘），解析一份大文档约 100ms，不值得重算。
 */
let cachedContent: string | undefined;
let cachedRanges: LineRange[] = [];

/** 渲染块行区间表（1-indexed 闭区间，与 mdast 顶层节点同序） */
export function computeLineRanges(content: string): LineRange[] {
    if (content === cachedContent) { return cachedRanges; }
    const tree = parser.parse(content) as unknown as { children: MdastTopLevelNode[] };
    const ranges: LineRange[] = [];
    for (const node of tree.children) {
        if (NON_RENDERED_NODE_TYPES.has(node.type)) { continue; }
        const start = node.position?.start.line;
        const end = node.position?.end.line;
        if (start === undefined || end === undefined) { continue; }
        ranges.push({ start, end: Math.max(start, end) });
    }
    cachedContent = content;
    cachedRanges = ranges;
    return ranges;
}

/** 从完整内容中切出 YAML frontmatter 与其行数（与 contentTransform 同口径，避免循环依赖） */
function splitFrontmatter(content: string): { frontmatterLines: number; body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) return { frontmatterLines: 0, body: content };
    return { frontmatterLines: match[0].split("\n").length - 1, body: content.slice(match[0].length) };
}

/**
 * 渲染块行区间表（显示口径）：ranges[i] = 第 i 个**正文块**在完整源码中的起止行。
 *
 * 回归（用户实测：源码/预览来回切，光标总回到 1 行 1 列）：frontmatter 不是渲染块，
 * 行号表必须跳过它，否则块索引与行号表错位一格。
 */
export function computeDisplayLineRanges(content: string): LineRange[] {
    const { frontmatterLines, body } = splitFrontmatter(content);
    return computeLineRanges(body).map((range) => ({
        start: range.start + frontmatterLines,
        end: range.end + frontmatterLines,
    }));
}
