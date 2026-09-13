/**
 * 布局类 CSS 变量应用（WebView 侧，jsdom 可测）。
 *
 * editorMaxWidth / codeBlockMaxHeight 变更经 postMessage 到达后即时生效，无需重载
 * （照 tableWrapMode 的 applyTableWrapVars 范式）。值已在 Extension 侧按配置 schema
 * 的上下限净化（sanitizeCssNumber），此处再挡一次非法值。
 */
const VAR_EDITOR_MAX_WIDTH = "--editor-max-width";
const VAR_CODE_BLOCK_MAX_HEIGHT = "--code-block-max-height";

function applyPxVar(name: string, value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) { return; }
    document.documentElement.style.setProperty(name, `${Math.round(value)}px`);
}

/** 编辑器内容区最大宽度（px） */
export function applyEditorMaxWidth(value: number): void {
    applyPxVar(VAR_EDITOR_MAX_WIDTH, value);
}

/** 代码块最大显示高度（px） */
export function applyCodeBlockMaxHeight(value: number): void {
    applyPxVar(VAR_CODE_BLOCK_MAX_HEIGHT, value);
}
