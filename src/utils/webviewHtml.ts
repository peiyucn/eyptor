/**
 * WebView 首帧 HTML 生成（纯函数，无 vscode 依赖——便于单测守护首帧行为）。
 *
 * 首帧只画主题背景：重建期不放任何加载动画/覆盖层，观感对齐 VS Code 官方 Markdown 预览
 * （背景 → 正文，中间没有吸引注意的中间态）。
 *
 * 调用方保证各值已净化：配置值经 webviewConfigSanitize，i18nScript 由 JSON.stringify 生成。
 */
export interface WebviewHtmlOptions {
    /** 宿主语言，原样写进 <html lang>（调用方传 vscode.env.language） */
    language: string;
    /** WebView CSP source（webview.cspSource） */
    cspSource: string;
    /** CSP nonce（getNonce()） */
    nonce: string;
    /** 样式表 URI */
    styleUri: string;
    /** 入口脚本 URI */
    scriptUri: string;
    /** window.__i18n 注入脚本（含 JSON 载荷） */
    i18nScript: string;
    /** 注入 :root 的 CSS 变量 */
    cssVars: Record<string, string>;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
    const { language, cspSource, nonce, styleUri, scriptUri, i18nScript, cssVars } = options;
    const cssVarDecls = Object.entries(cssVars)
        .map(([name, value]) => `${name}: ${value};`)
        .join(" ");

    return `<!DOCTYPE html>
<html lang="${language}" style="background-color: var(--vscode-editor-background);">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${cspSource};
             img-src ${cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Editor</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>:root { ${cssVarDecls} }</style>
</head>
<body style="margin: 0; background-color: var(--vscode-editor-background);">
  <div class="editor-topbar"></div>
  <div id="editor"></div>
  <script nonce="${nonce}">${i18nScript}</script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
