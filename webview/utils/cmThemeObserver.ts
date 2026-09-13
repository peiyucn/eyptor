/** .cm-editor 数量变化后补配主题的延迟（等待 Crepe 完成挂载） */
export const CM_RECONFIGURE_DELAY_MS = 10;

function countCmEditors(container: HTMLElement): number {
    return container.querySelectorAll(".cm-editor").length;
}

/**
 * 监听 container 内 `.cm-editor` **数量**变化，变化时延迟触发一次 onChange。
 *
 * 用途：Crepe 的 codeMirror feature 只在注册时求值一次 `theme.of(...)`，主题切换后
 * 新出现的代码块仍持有旧主题，需要补配（reconfigure）。
 *
 * 回归（用户实测：开着 md 页面时整个 VS Code 输入卡顿、切换别的 webview 时整窗口闪动，
 * 关闭 md 页面后消失）：此前任何 DOM 变更都排一次 onChange，而 onChange
 * （`Compartment.reconfigure`）本身引起 CodeMirror 重渲染产生新的 DOM 变更
 * → 10ms 一次的无限回环，后台 webview 持续烧 CPU。数量守卫切断回环：
 * 重配自身引起的 DOM 变更不改变数量，直接返回。
 *
 * @returns 断开监听的函数（编辑器重建前必须调用，避免观察器累积）
 */
export function observeCmEditorCount(container: HTMLElement, onChange: () => void): () => void {
    let lastCount = countCmEditors(container);
    const observer = new MutationObserver(() => {
        const count = countCmEditors(container);
        if (count === lastCount) return; // 重配自身引起的 DOM 变更不改变数量 → 回环断于此
        lastCount = count;
        setTimeout(() => {
            lastCount = countCmEditors(container);
            onChange();
        }, CM_RECONFIGURE_DELAY_MS);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
}
