/**
 * WebView 内一次性提示条（Extension → WebView 的 notice 消息）。
 *
 * 用例：图床目标来自工作区级配置时降级为本地存储——提示必须出现在用户正看着的
 * 编辑器里（宿主通知容易被忽略）；文案已由 Extension 用 vscode.l10n 本地化。
 * 文本走 textContent，不解析 HTML。
 */
import "./notice.css";

/** 自动消失时间（点击提示条可提前关闭） */
const NOTICE_VISIBLE_MS = 8000;

let current: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** 显示提示条（同一时刻只保留一条：新的顶掉旧的） */
export function showNotice(message: string): void {
    dismissNotice();
    const el = document.createElement("div");
    el.className = "epytor-notice";
    el.setAttribute("role", "status");
    el.textContent = message;
    el.addEventListener("click", dismissNotice);
    document.body.appendChild(el);
    current = el;
    hideTimer = setTimeout(dismissNotice, NOTICE_VISIBLE_MS);
}

/** 移除提示条并清理 timer（重复调用安全） */
export function dismissNotice(): void {
    if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    current?.remove();
    current = null;
}
