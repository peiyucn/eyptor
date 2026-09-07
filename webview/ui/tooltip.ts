// ─── 常量 ────────────────────────────────────────────────────
const TOOLTIP_SPACING_PX = 6;
const TOOLTIP_VIEWPORT_MARGIN_PX = 4;

let tooltipEl: HTMLElement | null = null;

function getTooltip(): HTMLElement {
    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "custom-tooltip";
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

interface TooltipOptions {
    /** 显示位置：'below'（默认，工具栏用）或 'above' */
    placement?: "above" | "below";
    /** 仅在文本被截断（出现 ...）时才显示 */
    truncatedOnly?: boolean;
}

interface TooltipHandle {
    /** 动态更新 tooltip 文案（不影响显示状态） */
    setText(t: string): void;
    /** 主动显示 tooltip（用于点击后反馈等场景） */
    show(): void;
}

/** 横向钳制纯函数（可单测）：tooltip 左缘 x 钳制进视口，右侧超界贴右缘 */
export function clampTooltipX(x: number, width: number, viewportWidth: number): number {
    if (x + width > viewportWidth - TOOLTIP_VIEWPORT_MARGIN_PX) {
        return viewportWidth - width - TOOLTIP_VIEWPORT_MARGIN_PX;
    }
    if (x < TOOLTIP_VIEWPORT_MARGIN_PX) {
        return TOOLTIP_VIEWPORT_MARGIN_PX;
    }
    return x;
}

function position(
    tip: HTMLElement,
    el: HTMLElement,
    placement: "above" | "below",
): void {
    tip.style.visibility = "hidden";
    tip.style.display = "block";

    const elRect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let x = clampTooltipX(
        elRect.left + elRect.width / 2 - tipRect.width / 2,
        tipRect.width,
        window.innerWidth,
    );
    let y: number;

    if (placement === "above") {
        y = elRect.top - tipRect.height - TOOLTIP_SPACING_PX;
        if (y < TOOLTIP_VIEWPORT_MARGIN_PX) {
            y = elRect.bottom + TOOLTIP_SPACING_PX;
        } // 上方不够则降到下方
    } else {
        y = elRect.bottom + TOOLTIP_SPACING_PX;
        if (y + tipRect.height > window.innerHeight - TOOLTIP_VIEWPORT_MARGIN_PX) {
            y = elRect.top - tipRect.height - TOOLTIP_SPACING_PX;
        }
    }

    tip.style.left = `${x}px`;
    tip.style.right = "auto";
    tip.style.top = `${y}px`;

    // 读回校验兜底：任何测量/CSS 层误差导致仍超出视口时，改由 right 锚定（浏览器保证贴边）
    const finalRect = tip.getBoundingClientRect();
    if (finalRect.width > 0 && finalRect.right > window.innerWidth - TOOLTIP_VIEWPORT_MARGIN_PX) {
        tip.style.left = "auto";
        tip.style.right = `${TOOLTIP_VIEWPORT_MARGIN_PX}px`;
    } else if (finalRect.width > 0 && finalRect.left < TOOLTIP_VIEWPORT_MARGIN_PX) {
        tip.style.left = `${TOOLTIP_VIEWPORT_MARGIN_PX}px`;
        tip.style.right = "auto";
    }

    tip.style.visibility = "visible";
}

/** 立即隐藏当前显示的 tooltip（用于点击交互后主动清除） */
export function hideTooltip(): void {
    if (tooltipEl) {
        tooltipEl.style.display = "none";
    }
}

/** 命令式：立即在指定元素旁显示 tooltip，无需事件绑定 */
export function showTooltipAt(
    el: Element,
    text: string,
    placement: "above" | "below" = "above",
): void {
    const tip = getTooltip();
    tip.textContent = text;
    position(tip, el as HTMLElement, placement);
}

/** 替换原生 title，改用 VSCode 风格的自定义 tooltip */
export function applyTooltip(
    el: HTMLElement,
    text: string,
    options: TooltipOptions = {},
): TooltipHandle {
    const { placement = "above", truncatedOnly = false } = options;
    let currentText = text;

    el.removeAttribute("title");

    el.addEventListener("mouseenter", () => {
        if (!currentText) {
            return;
        }
        if (truncatedOnly && el.scrollWidth <= el.offsetWidth) {
            return;
        }
        const tip = getTooltip();
        tip.textContent = currentText;
        position(tip, el, placement);
    });

    el.addEventListener("mouseleave", () => {
        if (tooltipEl) {
            tooltipEl.style.display = "none";
        }
    });

    return {
        setText(t: string) {
            currentText = t;
        },
        show() {
            if (!currentText) {
                return;
            }
            const tip = getTooltip();
            tip.textContent = currentText;
            position(tip, el, placement);
        },
    };
}
