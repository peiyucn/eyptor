/**
 * 构建期替身：以下模块内部的 `import katex from 'katex'` 被 esbuild.mjs 的
 * katex-stub-for-crepe 插件重定向到这里（见该插件注释）：
 *   - @milkdown/crepe：index 内联的 latex feature 在 epytor 从不执行（epytor 使用
 *     webview/vendor/latexFeature.ts 的惰性 KaTeX 实现）；
 *   - micromark-extension-math（remark-math 依赖）：html.js 只在「输出 HTML」路径
 *     使用 katex，epytor 只用 remark-math 解析 mdast、从不出 HTML。
 * 均已逐行核实：模块作用域零 katex 调用，全部位于不执行的函数内部。若不替换，
 * 480KB×2 的 katex 会随入口静态加载——这正是首帧要消除的。
 *
 * 若此 stub 被调用，说明存在遗漏的执行路径：显式抛错（宁可暴露、不静默降级），
 * 便于定位。
 */
const fail = (): never => {
    throw new Error(
        "[epytor] katex stub 被意外调用——@milkdown/crepe 内联 latex feature 不应在 epytor 执行（epytor 使用 vendor/latexFeature.ts 的惰性 KaTeX 实现）。若看到此错误，说明有 crepe 内部 latex 代码路径被遗漏。"
    );
};

export default new Proxy({} as Record<PropertyKey, unknown>, {
    get: fail,
    apply: fail,
});
