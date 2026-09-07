import { describe, expect, it } from "vitest";
import { resolveTableWrapVars } from "../tableWrap";

describe("resolveTableWrapVars", () => {
    it("normal 档 应该 keep-all + normal + visible + auto 宽度", () => {
        expect(resolveTableWrapVars("normal")).toEqual({
            wordBreak: "keep-all",
            whiteSpace: "normal",
            overflowX: "visible",
            tableWidth: "auto",
        });
    });

    it("aggressive 档 应该 break-all 任意断行", () => {
        expect(resolveTableWrapVars("aggressive")).toEqual({
            wordBreak: "break-all",
            whiteSpace: "normal",
            overflowX: "visible",
            tableWidth: "auto",
        });
    });

    it("none 档 应该 nowrap + 横向滚动 + table max-content（回归：无行内滚动）", () => {
        expect(resolveTableWrapVars("none")).toEqual({
            wordBreak: "keep-all",
            whiteSpace: "nowrap",
            overflowX: "auto",
            tableWidth: "max-content",
        });
    });

    it("未知值 应该 安全回退 normal", () => {
        expect(resolveTableWrapVars("")).toEqual(resolveTableWrapVars("normal"));
        expect(resolveTableWrapVars("weird")).toEqual(resolveTableWrapVars("normal"));
    });
});
