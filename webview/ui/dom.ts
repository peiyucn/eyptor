import { applyTooltip } from '@/ui/tooltip';

/**
 * 通用按钮工厂。
 * onClick 自动包装 e.preventDefault() + e.stopPropagation()。
 */
export function createButton(options: {
    className: string;
    icon?: string;
    label?: string;
    title?: string;
    tabIndex?: number;
    tooltipPlacement?: 'above' | 'below';
    onClick?: () => void;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = options.className;
    if (options.tabIndex !== undefined) btn.tabIndex = options.tabIndex;
    if (options.icon) btn.innerHTML = options.icon;
    if (options.label) btn.textContent = options.label;

    const tipText = options.title ?? options.label;
    if (tipText) {
        applyTooltip(btn, tipText, { placement: options.tooltipPlacement ?? 'below' });
    }

    if (options.onClick) {
        const handler = options.onClick;
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handler();
        });
    }

    return btn;
}

/**
 * 通用分隔线工厂。
 * 取代各组件的 sep() / sSep() / makeSep()。
 */
export function createSeparator(className: string, tag: 'div' | 'span' = 'div'): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    return el;
}

/**
 * 为输入框绑定 Enter/Escape 键盘处理。
 * 自动处理 isComposing、stopPropagation、preventDefault。
 */
export function setupInputKeyboard(
    input: HTMLInputElement,
    onEnter: () => void,
    onEscape: () => void,
): void {
    input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
        }
    });
}
