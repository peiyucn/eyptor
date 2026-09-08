/**
 * 代码块增强（从 webview/index.ts 提取）：复制按钮 ✔ 反馈、全屏灯箱按钮注入、
 * 语言搜索框键盘导航。全屏/导航依赖 Crepe 代码块 DOM 结构，用 MutationObserver
 * 扫描（tech-debt 已登记的 DOM 刮削反模式，等官方 API 后移除）。
 */
import { applyTooltip } from "@/ui/tooltip";
import { IconMaximize2 } from "@/ui/icons";
import { t } from "@/i18n";

const COPY_FEEDBACK_RESET_MS = 1500;

export function enhanceCodeBlocks(container: HTMLElement): void {
    // ── 复制按钮：点击后弹 ✔ 提示 ────────────────────────────────────
    container.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('.copy-button') as HTMLElement | null;
        if (!btn) return;
        setTimeout(() => {
            const tip = applyTooltip(btn, '✔ ' + t('Copied!'));
            tip.show();
            setTimeout(() => tip.setText(t('Copy Code')), COPY_FEEDBACK_RESET_MS);
        }, 100);
    });

    // ── 全屏按钮（我们的自定义功能，不是 Crepe 的，直接创建）─────────────
    const addFullscreenBtn = (block: Element): void => {
        const copyBtn = block.querySelector('.copy-button') as HTMLElement | null;
        if (copyBtn && !copyBtn.dataset.tip) { copyBtn.dataset.tip = '1'; applyTooltip(copyBtn, t('Copy Code')); }
        const previewBtn = block.querySelector('.preview-toggle-button') as HTMLElement | null;
        if (previewBtn && !previewBtn.dataset.tip) { previewBtn.dataset.tip = '1'; applyTooltip(previewBtn, t('Toggle preview')); }

        if (block.querySelector('.epytor-fullscreen-btn')) return;
        const btnGroup = block.querySelector('.tools-button-group');
        if (!btnGroup) return;

        const fsBtn = document.createElement('button');
        fsBtn.className = 'epytor-fullscreen-btn';
        fsBtn.innerHTML = IconMaximize2;
        applyTooltip(fsBtn, t('View Fullscreen'));
        fsBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const cmEditor = block.querySelector('.cm-editor') as HTMLElement | null;
            const cmHost = block.querySelector('.codemirror-host') as HTMLElement | null;
            const previewPanel = block.querySelector('.preview-panel') as HTMLElement | null;
            if (!cmEditor) return;
            const langBtn = block.querySelector('.language-button');
            const lang = langBtn?.textContent?.trim() || '';

            const lb = document.createElement('div');
            lb.className = 'epytor-fs-lightbox';
            const header = document.createElement('div');
            header.className = 'epytor-fs-header';
            const langSpan = document.createElement('span');
            langSpan.className = 'epytor-fs-lang';
            langSpan.textContent = lang;  // 安全注入，避免 XSS
            const closeBtn = document.createElement('button');
            closeBtn.className = 'epytor-fs-close';
            closeBtn.textContent = '✕';
            header.appendChild(langSpan);
            header.appendChild(closeBtn);
            const body = document.createElement('div');
            body.className = 'epytor-fs-body';
            lb.appendChild(header);
            lb.appendChild(body);
            document.body.appendChild(lb);
            body.appendChild(cmEditor);
            if (previewPanel) body.appendChild(previewPanel);

            const close = () => {
                if (cmHost && cmEditor.parentElement !== cmHost) cmHost.appendChild(cmEditor);
                if (previewPanel && previewPanel.parentElement !== block) block.appendChild(previewPanel);
                if (document.body.contains(lb)) document.body.removeChild(lb);
                document.removeEventListener('keydown', onKey);
            };
            const onKey = (ke: KeyboardEvent) => {
                if (ke.key === 'Escape') { ke.preventDefault(); close(); }
            };
            document.addEventListener('keydown', onKey);
            lb.querySelector('.epytor-fs-close')!.addEventListener('mousedown', (me) => { me.preventDefault(); close(); });
            lb.addEventListener('mousedown', (me) => { if (me.target === lb) close(); });
        });
        btnGroup.appendChild(fsBtn);
    };

    // 初次 + 后续代码块都加上全屏按钮
    const scanBlocks = () => container.querySelectorAll('.milkdown-code-block').forEach(addFullscreenBtn);
    requestAnimationFrame(scanBlocks);
    new MutationObserver(() => requestAnimationFrame(scanBlocks))
        .observe(container, { childList: true, subtree: true });

    // 语言搜索框键盘导航：{activeIndex} 显式状态（WeakMap 按输入框隔离）。
    // 回归：以 DOM .focused class 为唯一状态源——输入过滤重渲染后高亮丢失、ArrowDown/Up
    // 从头开始；无 Escape 取消；Enter 无高亮时静默无操作
    const navStates = new WeakMap<HTMLElement, { activeIndex: number }>();
    container.addEventListener('keydown', (e) => {
        const input = e.target as HTMLElement;
        if (!input.closest('.search-box')) return;
        const list = input.closest('.list-wrapper')?.querySelector<HTMLElement>('.language-list');
        if (!list) return;
        const items = list.querySelectorAll<HTMLElement>('.language-list-item');
        if (items.length === 0) return;
        const state = navStates.get(input) ?? { activeIndex: -1 };
        navStates.set(input, state);
        const clamp = (i: number) => Math.max(-1, Math.min(i, items.length - 1));
        const apply = () => {
            items.forEach(el => el.classList.remove('focused'));
            const el = items[state.activeIndex];
            if (el) {
                el.classList.add('focused');
                el.scrollIntoView({ block: 'nearest' });
            }
        };
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.activeIndex = clamp(state.activeIndex + 1);
            apply();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.activeIndex = clamp(state.activeIndex - 1);
            apply();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // 无高亮时选第一项（回归：此前静默无操作）
            const target = items[Math.max(state.activeIndex, 0)];
            target?.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            state.activeIndex = -1;
            input.blur(); // 取消搜索
        }
    });
}
