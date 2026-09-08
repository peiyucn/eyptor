import * as esbuild from 'esbuild';
import path from 'path';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

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
    entryPoints: { webview: 'webview/index.ts' },
    outdir: 'dist',
    platform: 'browser',
    target: 'es2020',
    format: 'esm',
    // 代码分割：动态 import（CodeMirror 按语言加载、mermaid 等重库惰性化）拆分为
    // 独立 chunk，首次加载只拉入口 —— 回归：无分割时 esbuild 把全部动态 import
    // 内联进单文件（6.2MB），首次打开 md 的下载+解析+求值是首帧卡顿主因
    splitting: true,
    loader: {
        '.ttf': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
    },
    alias: {
        '@': path.resolve('./webview'),
    },
    define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
};

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
