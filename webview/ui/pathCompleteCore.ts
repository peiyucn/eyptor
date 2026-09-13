/**
 * 路径补全下拉核心（渲染 + 键盘导航 + 点击选择），供 pathComplete / imgPathComplete
 * 两处复用。回归：两份实现曾几乎逐行镜像（ul/li 构建、mouseover 抑制、Escape/方向键/
 * Enter/Tab 导航），修键盘行为需改两处且已产生不对称。
 */
import {
    closeDropdown as closeDropdownState,
    updateActiveItem,
    type DropdownState,
} from "@/ui/dropdownComplete";

export interface PathDropdownOptions<T> {
    listClass: string;
    itemClass: string;
    activeClass: string;
    /** 条目内部 HTML（图标/缩略图 + 标签，由调用方拼装） */
    renderItem: (item: T) => string;
    getTitle: (item: T) => string;
    /** 条目选中（mousedown / Enter / Tab） */
    onSelect: (item: T) => void;
    /** 关闭时附加清理（如保存的选区范围复位） */
    onClose?: () => void;
}

export interface PathDropdown<T> {
    isOpen(): boolean;
    /** 下拉是否包含该节点（外部点击关闭判定） */
    contains(node: Node): boolean;
    /** 在绝对坐标处渲染下拉（调用方计算 anchor，如输入框底部 + 滚动偏移） */
    show(anchor: { left: number; top: number }, items: T[], listMinWidth?: string): void;
    close(): void;
    /** 键盘导航（capture 阶段注册于 document）：Escape 关闭，方向键循环，Enter/Tab 选中 */
    handleKeydown(e: KeyboardEvent): void;
}

export function createPathDropdown<T>(opts: PathDropdownOptions<T>): PathDropdown<T> {
    const state: DropdownState = { el: null, activeIndex: -1 };
    let lastItems: T[] = [];
    let suppressMouseover = false;

    function close(): void {
        closeDropdownState(state);
        lastItems = [];
        opts.onClose?.();
    }

    function show(anchor: { left: number; top: number }, items: T[], listMinWidth?: string): void {
        close();
        if (items.length === 0) return;
        lastItems = items;

        const ul = document.createElement("ul");
        ul.className = opts.listClass;
        ul.style.top = `${anchor.top}px`;
        ul.style.left = `${anchor.left}px`;
        if (listMinWidth) {
            ul.style.minWidth = listMinWidth;
        }

        items.forEach((item, i) => {
            const li = document.createElement("li");
            li.className = opts.itemClass;
            li.innerHTML = opts.renderItem(item);
            li.title = opts.getTitle(item);

            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                state.activeIndex = i;
                opts.onSelect(item);
            });
            li.addEventListener("mousemove", () => { suppressMouseover = false; });
            li.addEventListener("mouseover", () => {
                if (suppressMouseover) return;
                state.activeIndex = i;
                updateActiveItem(state, opts.activeClass);
            });
            ul.appendChild(li);
        });

        document.body.appendChild(ul);
        state.el = ul;
        state.activeIndex = 0;
        updateActiveItem(state, opts.activeClass);
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (!state.el) return;

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex >= lastItems.length - 1 ? 0 : state.activeIndex + 1;
            updateActiveItem(state, opts.activeClass);
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex <= 0 ? lastItems.length - 1 : state.activeIndex - 1;
            updateActiveItem(state, opts.activeClass);
            return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
            if (state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                e.preventDefault();
                e.stopPropagation();
                opts.onSelect(lastItems[state.activeIndex]);
            }
            return;
        }
    }

    function contains(node: Node): boolean {
        return state.el !== null && state.el.contains(node);
    }

    return { isOpen: () => state.el !== null, contains, show, close, handleKeydown };
}
