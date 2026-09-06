/**
 * 顶栏溢出菜单纯逻辑（无 DOM 依赖，可单元测试）。
 */

export interface TopBarMeasuredItem {
    /** 与 DOM 顺序一致的元素 key（heading 下拉为 "heading-selector"） */
    key: string;
    width: number;
    /** 分隔线也算一项，key 为 "__divider__" */
    isDivider?: boolean;
}

export interface OverflowBudgetInput {
    items: TopBarMeasuredItem[];
    containerWidth: number;
    moreBtnWidth: number;
    /** 固定项 key（如 heading-selector / history 组），除非容器极窄否则优先保留 */
    pinnedKeys?: ReadonlySet<string>;
}

/**
 * 从右往左计算需要收起的元素（返回应隐藏的 key 集合）。
 * 固定项（pinnedKeys）从右侧收起时跳过，直到只剩固定项。
 */
export function computeOverflow(input: OverflowBudgetInput): Set<string> {
    const { items, containerWidth, moreBtnWidth } = input;
    const pinned = input.pinnedKeys ?? new Set<string>();
    const hidden = new Set<string>();

    const total = items.reduce((sum, item) => sum + item.width, 0);
    if (total <= containerWidth - moreBtnWidth) {
        return hidden;
    }

    let used = total;
    // 从右往左尝试收起（固定项优先保留）
    for (let i = items.length - 1; i >= 0; i--) {
        if (used <= containerWidth - moreBtnWidth) break;
        const item = items[i];
        if (pinned.has(item.key)) continue;
        hidden.add(item.key);
        used -= item.width;
    }
    // 兜底：预算仍不足时收起固定项，防止「⋯」按钮与剩余按钮重叠
    for (let i = items.length - 1; i >= 0; i--) {
        if (used <= containerWidth - moreBtnWidth) break;
        const item = items[i];
        if (hidden.has(item.key)) continue;
        hidden.add(item.key);
        used -= item.width;
    }
    return hidden;
}
