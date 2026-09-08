import { describe, it, expect } from "vitest";
import {
    extractFrontmatter,
    restoreContentForSave,
    convertTableBrForDisplay,
    buildContentWithFrontmatter,
    normalizeImageDestination,
    rewriteImageSources,
} from "../../src/utils/contentTransform";
import { computeLineMap } from "../../src/utils/lineMap";

// ─────────────────────────────────────────────────────────────
// extractFrontmatter
// ─────────────────────────────────────────────────────────────
describe("extractFrontmatter", () => {
    it("标准 frontmatter 正确分离", () => {
        const content = "---\ntitle: Test\ndate: 2024-01-01\n---\n# Hello";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).toBe("---\ntitle: Test\ndate: 2024-01-01\n---\n");
        expect(body).toBe("# Hello");
    });

    it("无 frontmatter 时原样返回正文，frontmatter 为空字符串", () => {
        const content = "# Just a heading\n\nSome text.";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).toBe("");
        expect(body).toBe(content);
    });

    it("空文件返回空 frontmatter 和空 body", () => {
        const { frontmatter, body } = extractFrontmatter("");
        expect(frontmatter).toBe("");
        expect(body).toBe("");
    });

    it("frontmatter 仅含分隔符（无键值对）时不识别（正则要求至少一行内容）", () => {
        // 实现的正则 /^---\r?\n[\s\S]*?\r?\n---\r?\n?/ 需要两个 --- 之间至少有一个换行
        // 纯 ---\n---\n 不满足条件，作为正文返回
        const content = "---\n---\n# Body";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).toBe("");
        expect(body).toBe(content);
    });

    it("多层嵌套 YAML 正确分离", () => {
        const content = "---\nauthor:\n  name: Alice\n  email: a@b.com\ntags:\n  - md\n---\n# Doc";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(body).toBe("# Doc");
        expect(frontmatter).toContain("author:");
    });

    it("Windows CRLF 行尾 frontmatter 正确识别", () => {
        const content = "---\r\ntitle: Test\r\n---\r\n# Body";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).not.toBe("");
        expect(body).toBe("# Body");
    });

    it("frontmatter 中间含空行时正确匹配（贪婪最短）", () => {
        // 第一个 --- 结束符即为 frontmatter 的终止
        const content = "---\ntitle: A\n---\n# H1\n---\nNot frontmatter\n---\n";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).toBe("---\ntitle: A\n---\n");
        expect(body).toContain("# H1");
    });

    it("frontmatter 不在文件开头时不识别", () => {
        const content = "Some text\n---\ntitle: Test\n---\n";
        const { frontmatter, body } = extractFrontmatter(content);
        expect(frontmatter).toBe("");
        expect(body).toBe(content);
    });
});

// ─────────────────────────────────────────────────────────────
// restoreContentForSave
// ─────────────────────────────────────────────────────────────
describe("restoreContentForSave", () => {
    it("将 webviewUri 替换为相对路径", () => {
        const uriMap = new Map([["vscode-resource://host/project/images/photo.png", "./images/photo.png"]]);
        const content = "![alt](vscode-resource://host/project/images/photo.png)";
        const result = restoreContentForSave(content, "", uriMap);
        expect(result).toBe("![alt](./images/photo.png)");
    });

    it("frontmatter 非空时拼接在正文前", () => {
        const frontmatter = "---\ntitle: A\n---\n";
        const result = restoreContentForSave("# Body", frontmatter, new Map());
        expect(result).toBe("---\ntitle: A\n---\n# Body");
    });

    it("多个 webviewUri 全部替换", () => {
        const uriMap = new Map([
            ["vscode-resource://host/img1.png", "./img1.png"],
            ["vscode-resource://host/img2.jpg", "./img2.jpg"],
        ]);
        const content = "![a](vscode-resource://host/img1.png) ![b](vscode-resource://host/img2.jpg)";
        const result = restoreContentForSave(content, "", uriMap);
        expect(result).toBe("![a](./img1.png) ![b](./img2.jpg)");
    });

    it("uriMap 为空时内容原样返回", () => {
        const content = "# Hello";
        const result = restoreContentForSave(content, "", new Map());
        expect(result).toBe(content);
    });

    it("未登记的 URI 保持原样（防止数据丢失）", () => {
        const uriMap = new Map([["vscode-resource://known.png", "./known.png"]]);
        const content = "![a](vscode-resource://unknown.png)";
        const result = restoreContentForSave(content, "", uriMap);
        expect(result).toContain("vscode-resource://unknown.png");
    });

    it("同一 webviewUri 多次出现时全部替换", () => {
        const uriMap = new Map([["vscode-resource://img.png", "./img.png"]]);
        const content = "![1](vscode-resource://img.png) ![2](vscode-resource://img.png)";
        const result = restoreContentForSave(content, "", uriMap);
        expect(result).toBe("![1](./img.png) ![2](./img.png)");
    });

    // ── 回归 E7：替换域收窄到图片语法内（此前全文 split/join） ──────────────
    it("代码围栏内的裸 webviewUri 字符串 应该 不被改写（回归：此前全文 split/join 会把代码块内容改掉）", () => {
        const uriMap = new Map([["vscode-resource://host/a.png", "./a.png"]]);
        const content = "```text\nvscode-resource://host/a.png\n```\n\n![alt](vscode-resource://host/a.png)";
        const result = restoreContentForSave(content, "", uriMap);
        expect(result).toBe("```text\nvscode-resource://host/a.png\n```\n\n![alt](./a.png)");
    });

    it("正文/链接里的 webviewUri 字符串 应该 不被改写", () => {
        const uriMap = new Map([["vscode-resource://host/a.png", "./a.png"]]);
        const content = "见 [说明](vscode-resource://host/a.png) 与纯文本 vscode-resource://host/a.png";
        expect(restoreContentForSave(content, "", uriMap)).toBe(content);
    });

    it("序列化把括号转义为 \\( 时 应该 仍能还原为相对路径（回归：此前 webviewUri 泄漏进磁盘文件）", () => {
        const uriMap = new Map([["vscode-resource://host/my (v2).png", "./images/my (v2).png"]]);
        const serialized = '![alt](vscode-resource://host/my \\(v2\\).png "ratio:0.5")';
        expect(restoreContentForSave(serialized, "", uriMap))
            .toBe('![alt](./images/my (v2).png "ratio:0.5")');
    });

    it("序列化把含空格路径包成 <...> 时 应该 仍能还原", () => {
        const uriMap = new Map([["vscode-resource://host/my file.png", "my file.png"]]);
        const serialized = "![alt](<vscode-resource://host/my file.png>)";
        expect(restoreContentForSave(serialized, "", uriMap)).toBe("![alt](my file.png)");
    });
});

// ─────────────────────────────────────────────────────────────
// computeLineMap
// ─────────────────────────────────────────────────────────────
describe("computeLineMap", () => {
    it("空内容返回空数组", () => {
        expect(computeLineMap("")).toEqual([]);
    });

    it("只有空行返回空数组", () => {
        expect(computeLineMap("\n\n\n")).toEqual([]);
    });

    it("单行内容返回 [1]", () => {
        expect(computeLineMap("# Hello")).toEqual([1]);
    });

    it("两个段落（中间空行分隔）返回各段起始行号", () => {
        const content = "# Heading\n\nSome paragraph text.";
        const lineMap = computeLineMap(content);
        expect(lineMap).toEqual([1, 3]);
    });

    it("代码块整体作为一个段落处理", () => {
        const content = "# H\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\n## H2";
        const lineMap = computeLineMap(content);
        // 期望：行1（标题）、行3（代码块）、行8（H2）
        expect(lineMap[0]).toBe(1);
        expect(lineMap[1]).toBe(3);
        expect(lineMap[2]).toBe(8);
    });

    it("波浪线代码块（~~~）同样正确处理", () => {
        const content = "~~~python\nprint('hello')\n~~~\n\n# After";
        const lineMap = computeLineMap(content);
        expect(lineMap.length).toBe(2);
    });

    it("行号从 1 开始（1-indexed）", () => {
        const content = "paragraph1\n\nparagraph2";
        const lineMap = computeLineMap(content);
        expect(lineMap[0]).toBe(1);
    });

    it("前导空行不计入行号", () => {
        const content = "\n\n# Heading";
        const lineMap = computeLineMap(content);
        expect(lineMap).toEqual([3]);
    });

    it("大文件（1000 行）计算耗时低于 100ms", () => {
        const content = Array.from({ length: 200 }, (_, i) => `## Heading ${i}\n\nContent ${i}`).join("\n\n");
        const start = performance.now();
        computeLineMap(content);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(100);
    });
});

// ─────────────────────────────────────────────────────────────
// convertTableBrForDisplay
// ─────────────────────────────────────────────────────────────
describe("convertTableBrForDisplay", () => {
    it("表格行内 <br> 应该 转为 &#10; 实体（GFM 合法、解析渲染换行）", () => {
        expect(convertTableBrForDisplay("| A |\n| --- |\n| x<br>z |")).toBe(
            "| A |\n| --- |\n| x&#10;z |",
        );
    });

    it("<br/> 与 <br /> 变体、大小写 应该 全部转换", () => {
        expect(convertTableBrForDisplay("| a<br/>b |\n| c<br />d |\n| e<BR>f |")).toBe(
            "| a&#10;b |\n| c&#10;d |\n| e&#10;f |",
        );
    });

    it("代码围栏内的 |...<br>... 行 应该 不转换", () => {
        const input = "```html\n| a<br>b |\n```\n\n| x<br>y |\n";
        const output = convertTableBrForDisplay(input);
        // 围栏内保持原样；围栏外的表格行转换
        expect(output).toBe("```html\n| a<br>b |\n```\n\n| x&#10;y |\n");
    });

    it("普通段落中的 <br> 应该 不转换", () => {
        expect(convertTableBrForDisplay("line one<br>line two\n")).toBe(
            "line one<br>line two\n",
        );
    });

    it("已有 &#10; 实体 应该 原样保留", () => {
        expect(convertTableBrForDisplay("| x&#10;z |")).toBe("| x&#10;z |");
    });

    it("无 <br> 的表格 应该 原样返回", () => {
        const input = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
        expect(convertTableBrForDisplay(input)).toBe(input);
    });
});

// ─────────────────────────────────────────────────────────────
// buildContentWithFrontmatter
// ─────────────────────────────────────────────────────────────
describe("buildContentWithFrontmatter", () => {
    it("新增 frontmatter 行 应该 替换 YAML 头且正文不变", () => {
        const current = "---\ntitle: A\n---\n# Body\n";
        const result = buildContentWithFrontmatter(current, "---\ntitle: A\ntags: x\n---\n", new Map());
        expect(result).toBe("---\ntitle: A\ntags: x\n---\n# Body\n");
    });

    it("frontmatter 与现状相同 应该 返回 null（跳过保存）", () => {
        const current = "---\ntitle: A\n---\n# Body\n";
        expect(buildContentWithFrontmatter(current, "---\ntitle: A\n---\n", new Map())).toBeNull();
    });

    it("无 frontmatter 文档新增 YAML 头 应该 前置插入", () => {
        const result = buildContentWithFrontmatter("# Body\n", "---\ntitle: A\n---\n", new Map());
        expect(result).toBe("---\ntitle: A\n---\n# Body\n");
    });

    it("webviewUri 应该 还原为相对路径", () => {
        const current = "---\ntitle: A\n---\n![alt](vscode-webview://img.png)\n";
        const result = buildContentWithFrontmatter(
            current,
            "---\ntitle: A\n---\n",
            new Map([["vscode-webview://img.png", "img.png"]]),
        );
        expect(result).toBe("---\ntitle: A\n---\n![alt](img.png)\n");
    });
});

// ─────────────────────────────────────────────────────────────
// rewriteImageSources（显示侧与保存侧共用的唯一图片替换域）
// ─────────────────────────────────────────────────────────────
describe("rewriteImageSources", () => {
    const replaceWith = (target: string, newSrc: string) => (src: string) =>
        src === target ? newSrc : undefined;

    it("应该 仅替换 src 并保留 alt 与 title（回归：重建丢 title 导致 ratio 宽高比失效）", () => {
        expect(rewriteImageSources('![alt](./img/a.png "ratio:0.36")', replaceWith("./img/a.png", "U")))
            .toBe('![alt](U "ratio:0.36")');
    });

    it("单引号 title 应该 原样保留引号风格", () => {
        expect(rewriteImageSources("![alt](./img/a.png 'ratio:0.36')", replaceWith("./img/a.png", "U")))
            .toBe("![alt](U 'ratio:0.36')");
    });

    it("无 title 应该 不加多余引号", () => {
        expect(rewriteImageSources("![alt](./img/a.png)", replaceWith("./img/a.png", "U")))
            .toBe("![alt](U)");
    });

    it("含空格路径 应该 完整捕获（回归：旧正则 [^)\\s\"]+ 在空格处截断，显示破裂 + 保存往返改写畸形内容）", () => {
        expect(rewriteImageSources('![alt](my image.png "r")', replaceWith("my image.png", "U")))
            .toBe('![alt](U "r")');
    });

    it("含括号路径（一层嵌套） 应该 完整捕获（回归：旧正则在 ) 处截断）", () => {
        expect(rewriteImageSources("![alt](my file (v2).png)", replaceWith("my file (v2).png", "U")))
            .toBe("![alt](U)");
    });

    it("含空格路径 + title 应该 两者都正确处理", () => {
        expect(rewriteImageSources('![alt](my image.png "ratio:0.5")', replaceWith("my image.png", "U")))
            .toBe('![alt](U "ratio:0.5")');
    });

    it("含括号路径 + title 应该 两者都正确处理", () => {
        expect(rewriteImageSources('![alt](my file (v2).png "ratio:0.5")', replaceWith("my file (v2).png", "U")))
            .toBe('![alt](U "ratio:0.5")');
    });

    it("同一行多个图片 应该 各自独立替换（未命中的保持原样）", () => {
        expect(rewriteImageSources("![a](x.png) and ![b](y z.png)", replaceWith("y z.png", "U")))
            .toBe("![a](x.png) and ![b](U)");
    });

    it("http 图片 应该 同样参与替换判定（由调用方决定是否跳过）", () => {
        expect(rewriteImageSources("![alt](https://example.com/a.png)", () => undefined))
            .toBe("![alt](https://example.com/a.png)");
    });

    it("无图片 应该 原样返回", () => {
        const md = "# 正文\n\n无图";
        expect(rewriteImageSources(md, () => "U")).toBe(md);
    });

    it("同一图片语法重复出现 应该 全部替换", () => {
        expect(rewriteImageSources("![1](a.png) ![2](a.png)", replaceWith("a.png", "U")))
            .toBe("![1](U) ![2](U)");
    });
});

describe("normalizeImageDestination", () => {
    it("反斜杠转义 应该 还原（mdast 序列化把括号写成 \\(）", () => {
        expect(normalizeImageDestination("my \\(v2\\).png")).toBe("my (v2).png");
    });

    it("尖括号包裹 应该 去除（mdast 序列化含空格目标时）", () => {
        expect(normalizeImageDestination("<my file.png>")).toBe("my file.png");
    });

    it("普通路径 应该 原样返回", () => {
        expect(normalizeImageDestination("./images/a.png")).toBe("./images/a.png");
    });

    it("Windows 反斜杠路径 应该 不被当作转义（仅标点转义生效）", () => {
        expect(normalizeImageDestination("images\\a.png")).toBe("images\\a.png");
    });
});
