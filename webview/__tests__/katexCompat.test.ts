/**
 * katex 单一版本守卫（回归 B1）。
 *
 * mermaid 的数学标签（`$$...$$`）与 epytor 的数学公式共用同一个 katex——此前
 * mermaid 走嵌套的 katex@0.16.47、epytor 走根依赖 katex@0.18.1：产物里出现
 * 两个 261KB 的 katex chunk，且 mermaid 生成的 HTML 用的是 0.16 的 class 名、
 * 加载的样式表却是 0.18 的（样式错配）。已在 pnpm-workspace.yaml 用 overrides
 * 收敛为单一版本。
 *
 * 本测试锁住「mermaid 用到的 katex API 在当前版本可用」，升级 katex 时若 API 变动
 * 会直接失败（比等到真实浏览器里 mermaid 数学标签渲染异常更早暴露）。
 */
import { describe, expect, it } from "vitest";
import katex from "katex";

describe("katex API 兼容性（mermaid 数学标签 + epytor 公式共用）", () => {
    it.each(["mathml", "htmlAndMathml"] as const)(
        "renderToString 应该 支持 mermaid 使用的 output=%s",
        (output) => {
            const html = katex.renderToString("x^2 + \\frac{1}{2}", {
                throwOnError: true,
                displayMode: true,
                output,
            });

            expect(html).toContain("<math");
        },
    );

    it("版本 应该 为 0.18.x（与 epytor 根依赖一致）", () => {
        expect(katex.version).toMatch(/^0\.18\./);
    });
});
