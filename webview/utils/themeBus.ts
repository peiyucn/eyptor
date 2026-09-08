type ThemeListener = (isDark: boolean) => void;

const listeners = new Set<ThemeListener>();

function isDark(): boolean {
    return document.body.classList.contains("vscode-dark")
        || document.body.classList.contains("vscode-high-contrast");
}

/** 订阅主题切换。立即回调当前值，之后每次切换触发。返回取消函数。 */
export function onThemeChange(fn: ThemeListener): () => void {
    fn(isDark());
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 当前订阅者数量（测试观测口：编辑器重建泄漏回归断言「重建 N 次后数量不变」） */
export function getThemeListenerCount(): number {
    return listeners.size;
}

// 单例 Observer 监听 body class 变化
let started = false;
function start(): void {
    if (started) return;
    started = true;
    let prev = isDark();
    new MutationObserver(() => {
        const now = isDark();
        if (now === prev) return;
        prev = now;
        listeners.forEach((fn) => fn(now));
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
start();
