/**
 * 表格网格选择器纯逻辑（无 DOM 依赖，可单元测试）。
 */
export const TABLE_GRID_SIZE = 8;

/** 网格扁平索引 → 1-based (row, col) */
export function gridIndexToCell(index: number): { row: number; col: number } {
    return {
        row: Math.floor(index / TABLE_GRID_SIZE) + 1,
        col: (index % TABLE_GRID_SIZE) + 1,
    };
}

/** hover (r, c) 时，扁平索引 idx 的单元格是否应高亮（左上角 r×c 区域） */
export function isCellHighlighted(idx: number, hoverRow: number, hoverCol: number): boolean {
    const { row, col } = gridIndexToCell(idx);
    return row <= hoverRow && col <= hoverCol;
}
