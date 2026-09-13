/**
 * 顶栏装饰（从 webview/index.ts 提取）：自定义 tooltip 注入 + EPYTOR 品牌标识注入。
 * 依赖 Crepe 顶栏 DOM 顺序渲染，用 MutationObserver 扫描（tech-debt 已登记的
 * DOM 刮削反模式：官方 TopBarItem 无 label/title 字段，无官方 API 可替代）。
 */
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";

/** 为 Crepe top-bar 按钮添加自定义 tooltip（i18n 翻译，无快捷键） */
export function setupTopBarTooltips(container: HTMLElement): void {
    const TOOLTIPS = [
        t('Table of Contents'), // toc
        t('Undo'),             // history: undo
        t('Redo'),             // history: redo
        t('Bold'),             // formatting: bold
        t('Italic'),           // formatting: italic
        t('Strikethrough'),    // formatting: strikethrough
        t('Inline Code'),      // formatting: code
        t('Clear Formatting'), // formatting: clear-format
        t('Bullet List'),      // list: bullet
        t('Ordered List'),     // list: ordered
        t('Task List'),        // list: task
        t('Insert/Edit Link'), // insert: link
        t('Insert Image'),     // insert: image
        t('Insert Table'),     // insert: table
        t('Code Block'),       // block: code-block
        t('Math Formula'),     // block: math
        t('Blockquote'),       // more: quote
        t('Horizontal Rule'),  // more: hr
        t('Settings'),         // settings
    ];

    const applyAll = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar) return;
        const items = topBar.querySelectorAll<HTMLElement>('.top-bar-item');
        items.forEach((item, idx) => {
            if (item.dataset.tip) return;
            const text = TOOLTIPS[idx];
            if (text) {
                item.dataset.tip = '1';
                applyTooltip(item, text, { placement: 'below' });
            }
        });
    };

    requestAnimationFrame(applyAll);
    new MutationObserver(() => requestAnimationFrame(applyAll))
        .observe(container, { childList: true, subtree: true });
}

/** 将 🦖EPYTOR 品牌标识注入为 top-bar 真实 flex 子元素（替代 CSS ::after） */
export function setupTopBarBrand(container: HTMLElement): void {
    const inject = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar || topBar.querySelector('.epytor-brand')) return;
        const brand = document.createElement('span');
        brand.className = 'epytor-brand';
        brand.textContent = '🦖EPYTOR';
        topBar.insertBefore(brand, topBar.firstChild);
    };
    requestAnimationFrame(inject);
    new MutationObserver(() => requestAnimationFrame(inject))
        .observe(container, { childList: true, subtree: true });
}
