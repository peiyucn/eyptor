import { describe, expect, it } from "vitest";
import { computeOverflow, type TopBarMeasuredItem } from "../utils/topBarOverflow";

function makeItems(widths: number[]): TopBarMeasuredItem[] {
    return widths.map((width, index) => ({ key: `item-${index}`, width }));
}

describe("computeOverflow", () => {
    it("容器足够宽时 应该 不收起任何项", () => {
        const items = makeItems([40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 200, moreBtnWidth: 30 });
        expect(hidden.size).toBe(0);
    });

    it("超出时 应该 从右往左收起", () => {
        const items = makeItems([40, 40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 140, moreBtnWidth: 30 });
        expect(hidden).toEqual(new Set(["item-3", "item-2"]));
    });

    it("极端窄容器 应该 全部收起", () => {
        const items = makeItems([40, 40, 40]);
        const hidden = computeOverflow({ items, containerWidth: 20, moreBtnWidth: 30 });
        expect(hidden.size).toBe(3);
    });

    it("固定项 应该 优先保留（跳过收起）", () => {
        const items: TopBarMeasuredItem[] = [
            { key: "heading", width: 60 },
            { key: "b", width: 40 },
            { key: "c", width: 40 },
            { key: "d", width: 40 },
        ];
        // 预算 130-30=100：heading(60)+b(40) 可容纳，d/c 收起
        const hidden = computeOverflow({
            items,
            containerWidth: 130,
            moreBtnWidth: 30,
            pinnedKeys: new Set(["heading"]),
        });
        expect(hidden.has("heading")).toBe(false);
        expect(hidden).toEqual(new Set(["d", "c"]));
    });
});
