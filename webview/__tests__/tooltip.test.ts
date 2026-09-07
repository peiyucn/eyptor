import { describe, expect, it } from "vitest";
import { computeTooltipHorizontal } from "../ui/tooltip";

describe("computeTooltipHorizontal", () => {
    it("右半屏按钮 应该 右缘对齐按钮右缘（回归：findBar 末位按钮 tooltip 超出画面被遮挡）", () => {
        // 视口 800，按钮在右缘（right=792），tooltip 右缘 = 按钮右缘 → 不可能超屏
        const pos = computeTooltipHorizontal({ left: 766, right: 792 }, 800);
        expect(pos.left).toBeUndefined();
        expect(pos.right).toBe(`${800 - 792}px`);
    });

    it("左半屏按钮 应该 左缘对齐按钮左缘", () => {
        const pos = computeTooltipHorizontal({ left: 100, right: 126 }, 800);
        expect(pos.right).toBeUndefined();
        expect(pos.left).toBe("100px");
    });

    it("按钮贴右缘（right=视口） 应该 right 兜底为边距 4px", () => {
        const pos = computeTooltipHorizontal({ left: 774, right: 800 }, 800);
        expect(pos.right).toBe("4px");
    });

    it("按钮贴左缘 应该 left 兜底为边距 4px", () => {
        const pos = computeTooltipHorizontal({ left: 0, right: 26 }, 800);
        expect(pos.left).toBe("4px");
    });

    it("正中偏左按钮 应该 按左缘对齐（向右伸展）", () => {
        // right=400 恰好不超视口中线（400）→ 走左半屏分支
        const pos = computeTooltipHorizontal({ left: 375, right: 400 }, 800);
        expect(pos.left).toBe("375px");
        expect(pos.right).toBeUndefined();
    });
});
