import { describe, expect, it } from "vitest";
import { buildWebviewHtml, type WebviewHtmlOptions } from "../utils/webviewHtml";

/** 主题背景内联声明的断言串（html 与 body 都必须自带，见下方用例注释） */
const EDITOR_BACKGROUND_DECL = "background-color: var(--vscode-editor-background)";

const OPTIONS: WebviewHtmlOptions = {
    language: "zh-cn",
    cspSource: "vscode-webview://epytor-test",
    nonce: "test-nonce",
    styleUri: "vscode-webview://epytor-test/dist/webview.css",
    scriptUri: "vscode-webview://epytor-test/dist/webview.js",
    i18nScript: 'window.__i18n={"translations":{},"isMac":false,"serializationMode":"clean"};',
    cssVars: {
        "--code-block-max-height": "600px",
        "--editor-max-width": "900px",
    },
};

/** 取标签自身的属性文本（首个匹配），用于断言内联 style 落在该标签上 */
function tagSource(html: string, tag: "html" | "body"): string {
    return html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
}

describe("WebView 首帧 HTML", () => {
    it("html 与 body 应该 都内联主题背景（重建期画的是主题色而不是白底）", () => {
        const html = buildWebviewHtml(OPTIONS);

        expect(tagSource(html, "html")).toContain(EDITOR_BACKGROUND_DECL);
        expect(tagSource(html, "body")).toContain(EDITOR_BACKGROUND_DECL);
    });

    it("生成的 HTML 应该 不含加载覆盖层（撤销点阵动画，中间态只留主题背景）", () => {
        const html = buildWebviewHtml(OPTIONS);

        expect(html).not.toContain("epytor-loading");
        expect(html).not.toContain("epytor-matrix");
        expect(html).not.toContain("epytor-dot-chase");
    });

    it("语言、CSP 与资源 URI 应该 注入 HTML", () => {
        const html = buildWebviewHtml(OPTIONS);

        expect(html).toContain('lang="zh-cn"');
        expect(html).toContain("style-src vscode-webview://epytor-test 'unsafe-inline'");
        expect(html).toContain("script-src 'nonce-test-nonce' vscode-webview://epytor-test");
        expect(html).toContain(`href="${OPTIONS.styleUri}"`);
        expect(html).toContain(`src="${OPTIONS.scriptUri}"`);
        expect(html).toContain(OPTIONS.i18nScript);
    });

    it("配置 CSS 变量 应该 按传入顺序注入 :root", () => {
        const html = buildWebviewHtml(OPTIONS);

        expect(html).toContain(
            "<style>:root { --code-block-max-height: 600px; --editor-max-width: 900px; }</style>",
        );
    });
});
