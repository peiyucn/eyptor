/**
 * Markdown 内容的纯函数转换工具，供 MarkdownEditorProvider 和单元测试共用。
 * 这些函数不依赖 VSCode API（无 webview.asWebviewUri），可在 Node 环境下直接测试。
 */

/**
 * 从 Markdown 内容中提取 YAML Frontmatter。
 * 仅识别文件开头的标准格式（--- ... ---）。
 */
export function extractFrontmatter(content: string): { frontmatter: string; body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (match) {
        return { frontmatter: match[0], body: content.slice(match[0].length) };
    }
    return { frontmatter: "", body: content };
}

/**
 * 将 webviewUri 还原为相对路径，并在最前面拼接 frontmatter。
 * 对应 _prepareContentForSave 的纯函数提取版本。
 */
export function restoreContentForSave(
    content: string,
    frontmatter: string,
    uriMap: Map<string, string>,
): string {
    let result = frontmatter ? frontmatter + content : content;
    for (const [webviewUri, relPath] of uriMap) {
        result = result.split(webviewUri).join(relPath);
    }
    return result;
}

/**
 * 表格单元格内 `<br>` → `&#10;`（显示层兼容转换，闭环方案的一部分）。
 *
 * GFM 表格换行的标准表达是 `<br>`（GitHub 渲染为换行），但 remark-gfm 解析层
 * 会丢弃表格单元格内的 `<br>`（上游 Milkdown#2463），直接加载会丢换行。
 * 因此进解析器前先把表格行内的 `<br>`（含 <br/>、<br /> 等变体）转为 `&#10;`
 * 实体：remark 解析为含 `\n` 的 text，渲染为换行；保存时序列化回 `<br>`，
 * 源码往返一致。代码围栏内不转换（围栏内是代码，不是表格）。
 */
export function convertTableBrForDisplay(content: string): string {
    const lines = content.split("\n");
    let inFence = false;

    return lines
        .map((line) => {
            if (/^\s*(`{3,}|~{3,})/.test(line)) {
                inFence = !inFence;
                return line;
            }
            if (inFence) return line;
            // 表格行（行首 |，允许前导空白）且含 <br> 变体才替换；已有实体原样保留
            if (/^\s*\|/.test(line) && /<br\s*\/?>/i.test(line)) {
                return line.replace(/<br\s*\/?>/gi, "&#10;");
            }
            return line;
        })
        .join("\n");
}

/**
 * Frontmatter 更新组装：以当前文档内容为底，替换 YAML 头（正文不变，
 * webviewUri 还原为相对路径）。组装结果与现状相同返回 null（调用方跳过保存）。
 */
export function buildContentWithFrontmatter(
    currentContent: string,
    newFrontmatter: string,
    uriMap: Map<string, string>,
): string | null {
    const { body } = extractFrontmatter(currentContent);
    const newContent = restoreContentForSave(body, newFrontmatter, uriMap);
    return newContent === currentContent ? null : newContent;
}

/**
 * 图片语法匹配：src 允许空格与一层嵌套括号（Windows 常见路径如
 * "my image.png" / "my file (v2).png"）。
 * 回归：旧正则 `[^)\s"]+` 在空格/括号处截断 src → 图片显示破裂、
 * uriMap 登记截断值、保存往返把该行改写成畸形内容写回磁盘。
 */
const IMAGE_SYNTAX_RE = /!\[([^\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

export interface ImageSyntaxMatch {
    /** 完整匹配文本（`![alt](src)`），用于定位替换 */
    fullMatch: string;
    alt: string;
    src: string;
}

export function extractImageSyntaxes(markdown: string): ImageSyntaxMatch[] {
    const out: ImageSyntaxMatch[] = [];
    for (const m of markdown.matchAll(IMAGE_SYNTAX_RE)) {
        out.push({ fullMatch: m[0], alt: m[1], src: m[2] });
    }
    return out;
}
