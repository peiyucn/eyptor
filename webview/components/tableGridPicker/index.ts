/**
 * 表格网格选择器：顶栏「插入表格」按钮弹出 8×8 网格，hover 预览、点击插入。
 * 纯逻辑见 utils/tableGrid.ts。
 */
import "./tableGridPicker.css";
import { TABLE_GRID_SIZE, gridIndexToCell, isCellHighlighted } from "@/utils/tableGrid";
import { t } from "@/i18n";

let _activePanel: HTMLElement | null = null;
let _onKey: ((e: KeyboardEvent) => void) | null = null;
let _onDocMousedown: ((e: MouseEvent) => void) | null = null;
let _onScroll: (() => void) | null = null;

function closeActivePanel(): void {
    _activePanel?.remove();
    _activePanel = null;
    if (_onKey) document.removeEventListener("keydown", _onKey);
    if (_onDocMousedown) document.removeEventListener("mousedown", _onDocMousedown, true);
    if (_onScroll) window.removeEventListener("scroll", _onScroll, true);
    _onKey = null;
    _onDocMousedown = null;
    _onScroll = null;
}

export function openTableGridPicker(
    anchor: HTMLElement,
    onPick: (rows: number, cols: number) => void,
): void {
    // 幂等：重复打开先关闭旧面板
    closeActivePanel();

    const panel = document.createElement("div");
    panel.className = "epytor-grid-picker";
    panel.setAttribute("role", "grid");
    panel.setAttribute("aria-label", t("Insert Table"));

    const label = document.createElement("div");
    label.className = "epytor-grid-picker__label";
    label.textContent = t("Insert Table");

    const grid = document.createElement("div");
    grid.className = "epytor-grid-picker__grid";

    const cells: HTMLElement[] = [];
    for (let i = 0; i < TABLE_GRID_SIZE * TABLE_GRID_SIZE; i++) {
        const cell = document.createElement("div");
        cell.className = "epytor-grid-picker__cell";
        cell.setAttribute("role", "gridcell");
        const { row, col } = gridIndexToCell(i);
        cell.setAttribute("aria-label", `${row} × ${col}`);
        grid.appendChild(cell);
        cells.push(cell);
    }

    panel.append(label, grid);
    document.body.appendChild(panel);

    // 定位：anchor 下方，贴边时收进视口
    const CELL_SIZE = 18;
    const GAP = 2;
    const panelWidth = TABLE_GRID_SIZE * CELL_SIZE + (TABLE_GRID_SIZE - 1) * GAP + 16;
    const panelHeight = TABLE_GRID_SIZE * CELL_SIZE + (TABLE_GRID_SIZE - 1) * GAP + 40;
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 6;
    if (top + panelHeight > window.innerHeight - 8) top = Math.max(8, rect.top - panelHeight - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    const updateHover = (hoverIdx: number) => {
        const { row, col } = gridIndexToCell(hoverIdx);
        cells.forEach((cell, idx) => {
            cell.classList.toggle(
                "epytor-grid-picker__cell--active",
                isCellHighlighted(idx, row, col),
            );
        });
        label.textContent = `${row} × ${col}`;
    };

    grid.addEventListener("mouseover", (e) => {
        const cell = (e.target as Element).closest(".epytor-grid-picker__cell") as HTMLElement | null;
        if (cell) updateHover(cells.indexOf(cell));
    });

    grid.addEventListener("click", (e) => {
        const cell = (e.target as Element).closest(".epytor-grid-picker__cell") as HTMLElement | null;
        if (!cell) return;
        const { row, col } = gridIndexToCell(cells.indexOf(cell));
        closeActivePanel();
        onPick(row, col);
    });

    _activePanel = panel;
    _onKey = (e) => {
        if (e.key === "Escape") closeActivePanel();
    };
    _onDocMousedown = (e) => {
        if (!panel.contains(e.target as Node)) closeActivePanel();
    };
    _onScroll = () => closeActivePanel();
    document.addEventListener("keydown", _onKey);
    document.addEventListener("mousedown", _onDocMousedown, true);
    window.addEventListener("scroll", _onScroll, true);
}
