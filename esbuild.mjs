import * as esbuild from 'esbuild';
import path from 'path';
import { rmSync } from 'fs';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/**
 * KaTeX 惰性化（配合 webview/vendor/latexFeature.ts）：把「katex 代码路径在 epytor
 * 永不执行」的模块的 `import katex from 'katex'` 重定向到显式抛错 stub。
 *   - @milkdown/crepe：index 内联的 latex feature 从不执行（epytor 用 vendor 的惰性
 *     实现，已逐行核实 crepe 模块作用域零 katex 调用）。
 *   - micromark-extension-math（remark-math 的依赖）：其 html.js 的 katex.renderToString
 *     只在「输出 HTML」路径执行；epytor 只用 remark-math 解析 mdast，从不出 HTML。
 * 重定向后 480KB×2 的 katex 移出入口、随首个数学内容渲染按需加载。pnpm 下 importer
 * 是符号链接解析后的真实路径（.pnpm/@milkdown+crepe@...），两种形态都要匹配。
 */
const katexStubForCrepe = {
    name: 'katex-stub-for-crepe',
    setup(build) {
        build.onResolve({ filter: /^katex$/ }, (args) => {
            if (/@milkdown\+crepe@|@milkdown[\\/]crepe[\\/]|micromark-extension-math/.test(args.importer)) {
                return { path: path.resolve('./webview/vendor/katexLazyStub.ts') };
            }
            return null;
        });
    },
};

const commonOptions = {
    bundle: true,
    minify: isProduction,
    sourcemap: !isProduction,
    logLevel: 'info',
};

// Extension 主进程（Node.js）
const extensionBuild = {
    ...commonOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
};

// WebView 前端（Browser）
const webviewBuild = {
    ...commonOptions,
    entryPoints: {
        webview: 'webview/index.ts',
        // KaTeX 样式独立入口：字体 base64 内联进独立 CSS 文件，webview 运行时在
        // 首个数学内容渲染时才注入 <link>（vendor/latexFeature.ts）。不放进 JS
        // import 图的原因：esbuild 会把动态 import 的 CSS 同时复制进入口 CSS
        // 与惰性 chunk（实测），1.4MB 字体照样进首屏 webview.css。
        'katex-styles': 'katex/dist/katex.min.css',
    },
    outdir: 'dist',
    platform: 'browser',
    target: 'es2020',
    format: 'esm',
    // 代码分割：动态 import（CodeMirror 按语言加载、mermaid 等重库惰性化）拆分为
    // 独立 chunk，首次加载只拉入口 —— 回归：无分割时 esbuild 把全部动态 import
    // 内联进单文件（6.2MB），首次打开 md 的下载+解析+求值是首帧卡顿主因
    //
    // ⚠️ 发布时 vsce 会警告「249 个文件里 232 个是 JavaScript，建议打包成单文件」——
    // 那是**误报**：这 232 个 JS 就是本行 splitting 产出的惰性 chunk（58 个 chunk-* +
    // 语言/图表/公式按需块），首屏只加载 webview.js + webview.css，其余按需拉取。
    // **不要为消这条警告关掉 splitting**（会把 6.2MB 单文件的回归放回来）。
    splitting: true,
    loader: {
        '.ttf': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
    },
    alias: {
        '@': path.resolve('./webview'),
    },
    plugins: [katexStubForCrepe],
    define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
};

// 清理旧产物：esbuild 不清空 outdir，代码分割后 chunk 文件名随内容哈希变化，
// 旧 chunk 会残留在 dist 并被打进 VSIX（回归：开启 splitting 后 dist 混入陈旧 chunk）
rmSync('dist', { recursive: true, force: true });

if (isWatch) {
    const [ctx1, ctx2] = await Promise.all([
        esbuild.context(extensionBuild),
        esbuild.context(webviewBuild),
    ]);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('Watching for changes...');
} else {
    await Promise.all([
        esbuild.build(extensionBuild),
        esbuild.build(webviewBuild),
    ]);
}
