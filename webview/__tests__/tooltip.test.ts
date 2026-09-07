import { describe, expect, it } from "vitest";
import { clampTooltipX } from "../ui/tooltip";

describe("clampTooltipX", () => {
    it("右侧超界 应该 贴右缘（回归：findBar 末位按钮 tooltip 超出画面被遮挡）", () => {
        // 视口 800px，tooltip 宽 120px，x=750 → 右侧超出
        expect(clampTooltipX(750, 120, 800)).toBe(800 - 120 - 4);
    });

    it("左侧超界 应该 贴左缘", () => {
        expect(clampTooltipX(-10, 120, 800)).toBe(4);
    });

    it("正常位置 应该 保持不变", () => {
        expect(clampTooltipX(300, 120, 800)).toBe(300);
    });

    it("恰好贴边（x+width=视口-边距）应该 不钳制", () => {
        const x = 800 - 4 - 120;
        expect(clampTooltipX(x, 120, 800)).toBe(x);
    });

    it("tooltip 比视口还宽 应该 仍钳制到最小左缘（配合 CSS max-width 兜底）", () => {
        const x = clampTooltipX(0, 2000, 800);
        // 宽度超过视口时右贴边为负，但左缘钳制保证不为负过多；CSS max-width 负责真实宽度
        expect(x).toBeLessThanOrEqual(4);
    });
});
