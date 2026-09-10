import { describe, expect, it } from "vitest";
import { applyMinimalChanges } from "../utils/minimalDiff";

describe("minimalDiff", () => {
    it("单行编辑应该保留未修改行的原始源码", () => {
        const saved = "keep-a\n  original spacing  \nkeep-b";
        const serialized = "keep-a\nchanged\nkeep-b";

        expect(applyMinimalChanges(saved, serialized)).toBe(
            "keep-a\nchanged\nkeep-b",
        );
    });

    it("插入内容时应该复用前后未修改行", () => {
        const saved = "before\noriginal\nafter";
        const serialized = "before\ninserted\noriginal\nafter";

        expect(applyMinimalChanges(saved, serialized)).toBe(
            "before\ninserted\noriginal\nafter",
        );
    });

    it("重复行发生插入时应该在小范围内稳定匹配", () => {
        const saved = "before\nduplicate\nduplicate\nafter";
        const serialized = "before\nduplicate\ninserted\nduplicate\nafter";

        expect(applyMinimalChanges(saved, serialized)).toBe(serialized);
    });

    it("表格格式变化时应该保留原始行风格", () => {
        const saved = "| Field | Type |\n| --- | --- |\n| id | bigint |";
        const serialized = "| Field | Type |\n|---|---|\n| id | bigint |";

        expect(applyMinimalChanges(saved, serialized)).toBe(saved);
    });

    it("大范围重复内容无法安全匹配时应该快速使用新输出", () => {
        const saved = Array.from({ length: 500 }, () => "same").join("\n");
        const serialized = Array.from({ length: 500 }, () => "changed").join("\n");

        expect(applyMinimalChanges(saved, serialized)).toBe(serialized);
    });

    it("一万行文档只改一行时不应该执行超大规模全文 LCS", () => {
        const lineCount = 10_000;
        const lines = Array.from({ length: lineCount }, (_, index) => `paragraph ${index}`);
        const saved = lines.join("\n");
        lines[lineCount / 2] = `paragraph ${lineCount / 2} changed`;
        const serialized = lines.join("\n");

        // 挂钟断言对机器负载与覆盖率插桩敏感（测覆盖率时单轮会翻数倍）：改为「多轮取最小值 + 宽松上限」。
        // 实测（Node 24，1 万行改一行）：现实现约 30ms；去掉锚点与上限（= 全文 LCS）约 4s，相差约 120 倍，
        // 真回归仍会被抓住。
        applyMinimalChanges(saved, serialized); // 预热（首次调用含 JIT）
        let best = Number.POSITIVE_INFINITY;
        for (let round = 0; round < 3; round++) {
            const start = performance.now();
            const output = applyMinimalChanges(saved, serialized);
            best = Math.min(best, performance.now() - start);
            expect(output).toContain(`paragraph ${lineCount / 2} changed`);
        }
        expect(best).toBeLessThan(3_000);
    });
});

