import { describe, expect, it } from "vitest";
import {
    beginClick,
    consumeCellClickTarget,
    createCellClickState,
    decideCellSelection,
    endClick,
    markDragged,
    type CellClickState,
} from "../utils/cellClickState";

/** 走一遍 mousedown → mouseup（默认不移动） */
function clickAt(state: CellClickState, pos: number, x = 0, y = 0): void {
    beginClick(state, { pos, x, y });
}

describe("表格单元格点击状态机", () => {
    it("mousedown 落在表格外 应该 停止追踪", () => {
        const s = createCellClickState();
        clickAt(s, 42);
        expect(s.pendingClickPos).toBe(42);
        beginClick(s, null); // 落在非单元格上
        expect(s.pendingClickPos).toBeNull();
        expect(s.cellClickTarget).toBeNull();
    });

    it("mousedown 应该 重置上一次的拖拽标记", () => {
        const s = createCellClickState();
        clickAt(s, 5, 0, 0);
        markDragged(s, 100, 100, 0, 0);
        expect(s.clickIsPlain).toBe(false);
        clickAt(s, 9, 50, 50); // 新一次点击
        expect(s.clickIsPlain).toBe(true);
        expect(s.wasCrossCell).toBe(false);
        expect(s.lastGoodCellSelection).toBeNull();
    });

    it("位移未超阈值 应该 仍算纯单击；超过阈值 应该 算拖拽", () => {
        const s = createCellClickState();
        clickAt(s, 5, 0, 0);
        markDragged(s, 2, 2, 0, 0); // 曼哈顿距离 4，未超过
        expect(s.clickIsPlain).toBe(true);
        markDragged(s, 3, 2, 0, 0); // 距离 5，超过
        expect(s.clickIsPlain).toBe(false);
    });

    it("跨格拖选 应该 记住选区并在收尾后延迟清掉", async () => {
        const s = createCellClickState();
        clickAt(s, 5);
        s.wasCrossCell = true;
        s.lastGoodCellSelection = { fake: "selection" };
        endClick(s);
        // 收尾后立刻仍保留（等后续 click 事件）
        expect(s.lastGoodCellSelection).not.toBeNull();
        expect(s.pendingClickPos).toBeNull();
        await new Promise((r) => setTimeout(r, 260));
        expect(s.lastGoodCellSelection).toBeNull();
    });

    it("普通单击 应该在微任务里清掉追踪（同一次事件循环内仍可见）", async () => {
        const s = createCellClickState();
        clickAt(s, 7);
        let seenDuringSync = 0;
        endClick(s);
        seenDuringSync = s.pendingClickPos === null ? 0 : 1;
        expect(seenDuringSync).toBe(1); // 同步阶段还没清
        await Promise.resolve();
        await Promise.resolve();
        expect(s.pendingClickPos).toBeNull();
    });

    it("整行/整列选中 应该 不干预", () => {
        const s = createCellClickState();
        expect(decideCellSelection(s, { isRowOrCol: true, anchorCellPos: 1, headCellPos: 2 }).kind).toBe("ignore");
        expect(s.wasCrossCell).toBe(false);
    });

    it("跨格 应该 记住并标记 wasCrossCell", () => {
        const s = createCellClickState();
        const d = decideCellSelection(s, { isRowOrCol: false, anchorCellPos: 1, headCellPos: 9 });
        expect(d.kind).toBe("rememberCrossCell");
        expect(s.wasCrossCell).toBe(true);
    });

    it("同格 应该 决定转光标", () => {
        const s = createCellClickState();
        expect(decideCellSelection(s, { isRowOrCol: false, anchorCellPos: 3, headCellPos: 3 }).kind).toBe("toCursor");
        expect(s.wasCrossCell).toBe(false);
    });

    it("单击位置 应该 只能被取用一次", () => {
        const s = createCellClickState();
        clickAt(s, 11);
        expect(consumeCellClickTarget(s)).toBe(11);
        expect(consumeCellClickTarget(s)).toBeNull();
    });
});
