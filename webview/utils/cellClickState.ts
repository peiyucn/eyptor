/**
 * 表格单元格点击修正（纯状态机，供 editor.ts 的 cellClickFixPlugin 调用）。
 *
 * 背景（原生行为的两处不顺手）：数组表格里单击一个单元格，ProseMirror 会给出
 * `NodeSelection`（选中整个单元格段落）或单格 `CellSelection`，而不是用户预期的光标；
 * 而拖选跨格时又必须保留 `CellSelection`（多格选中），不能一并转成光标。
 *
 * 原实现把 9 个可变标志（pendingClickPos / cellClickTarget / clickIsPlain / wasCrossCell /
 * lastGoodCellSelection / multiSelectCount / lastMouseX / lastMouseY / capturedView）散在
 * 插件的三个回调里互相读写——正是审计清单点名的「散落布尔标志互相覆盖」。这里收成一个
 * 状态对象 + 具名转移函数，回调只负责把事件翻译成转移调用。
 *
 * 状态与转移的对应：
 *   mousedown  → beginClick(pos, x, y)         开始追踪一次点击
 *   mousemove  → markDragged(x, y)             超过阈值即认定拖拽（不再是「纯单击」）
 *   mouseup    → endClick()                     收尾；跨格拖选要延迟清掉选区记忆
 *   appendTransaction(出现 CellSelection) → noteCellSelection(...)
 */

/** 认定「拖拽」的位移阈值（曼哈顿距离，px）：小于它算纯单击 */
const DRAG_THRESHOLD_PX = 4;

/** 跨格拖选结束后，延迟清掉「上次整格选区」——等后续 click 事件走完再判定 */
const CELL_SELECTION_CLEAR_DELAY_MS = 200;

export interface ClickPoint {
    pos: number;
    x: number;
    y: number;
}

export interface CellClickState {
    /** 最近一次 mousedown 在文档中的落点（null = 本次点击不追踪） */
    pendingClickPos: number | null;
    /** 单击位置，不受 mouseup 清理影响（appendTransaction 里可能晚于 mouseup 到达） */
    cellClickTarget: number | null;
    /** 本次按下是否始终没有明显移动（纯单击） */
    clickIsPlain: boolean;
    /** 本次是否发生了跨格拖选 */
    wasCrossCell: boolean;
    /** 最近一次「整格/多格」选区（用于把随后的单击转成光标） */
    lastGoodCellSelection: unknown;
    /** 最近一次指针位置（拖拽结束位置，用于把选区转成锚点/焦点） */
    lastMouseX: number;
    lastMouseY: number;
}

export function createCellClickState(): CellClickState {
    return {
        pendingClickPos: null,
        cellClickTarget: null,
        clickIsPlain: true,
        wasCrossCell: false,
        lastGoodCellSelection: null,
        lastMouseX: 0,
        lastMouseY: 0,
    };
}

/** mousedown：开始追踪；`point` 为空（不在表格里 / 带修饰键）则本次不追踪并**清掉落点记忆** */
export function beginClick(state: CellClickState, point: ClickPoint | null): void {
    if (!point) {
        state.pendingClickPos = null;
        // 一并清掉落点：留着上一次的值会让随后到达的 filterTransaction 用旧位置补光标
        // （原实现只清 pendingClickPos，是同一处状态机的隐性残留）
        state.cellClickTarget = null;
        return;
    }
    state.pendingClickPos = point.pos;
    state.cellClickTarget = point.pos;
    state.clickIsPlain = true;
    state.wasCrossCell = false;
    state.lastGoodCellSelection = null;
    state.lastMouseX = point.x;
    state.lastMouseY = point.y;
}

/** mousemove：超过阈值即认定拖拽；返回是否已判定为拖拽（调用方无需再用返回值） */
export function markDragged(state: CellClickState, x: number, y: number, originX: number, originY: number): void {
    state.lastMouseX = x;
    state.lastMouseY = y;
    if (Math.abs(x - originX) + Math.abs(y - originY) > DRAG_THRESHOLD_PX) {
        state.clickIsPlain = false;
    }
}

/**
 * mouseup：收尾。
 * - 拖过跨格：保留选区记忆，但延迟清掉（等后续 click 事件走完，见常量注释）；
 * - 普通单击：微任务里清掉 pending（让同一次事件循环内到达的 appendTransaction 仍能看到）。
 */
export function endClick(state: CellClickState): void {
    if (state.wasCrossCell) {
        state.pendingClickPos = null;
        state.clickIsPlain = true;
        state.wasCrossCell = false;
        const saved = state.lastGoodCellSelection;
        setTimeout(() => {
            if (state.lastGoodCellSelection === saved) { state.lastGoodCellSelection = null; }
        }, CELL_SELECTION_CLEAR_DELAY_MS);
        return;
    }
    Promise.resolve().then(() => {
        state.pendingClickPos = null;
        state.clickIsPlain = true;
    });
}

/** appendTransaction 见到单格 CellSelection 时的处理决定 */
export type CellSelectionDecision =
    /** 整行/整列选中：不干预 */
    | { kind: "ignore" }
    /** 跨格拖选：记住选区，不转光标 */
    | { kind: "rememberCrossCell" }
    /** 单格：应转成光标（调用方负责算具体位置） */
    | { kind: "toCursor" };

export function decideCellSelection(
    state: CellClickState,
    info: { isRowOrCol: boolean; anchorCellPos: number; headCellPos: number },
): CellSelectionDecision {
    if (info.isRowOrCol) { return { kind: "ignore" }; }
    if (info.anchorCellPos !== info.headCellPos) {
        state.wasCrossCell = true;
        return { kind: "rememberCrossCell" };
    }
    return { kind: "toCursor" };
}

/** 清掉「单击位置」记忆（转光标路径用过后不再复用） */
export function consumeCellClickTarget(state: CellClickState): number | null {
    const pos = state.cellClickTarget;
    state.cellClickTarget = null;
    return pos;
}
