import { describe, expect, it } from "vitest";
import { resolveTableWrapVars } from "../tableWrap";

describe("resolveTableWrapVars", () => {
    it("normal 档 应该 keep-all + normal + visible", () => {
        expect(resolveTableWrapVars("normal")).toEqual({
            wordBreak: "keep-all",
            whiteSpace: "normal",
            overflowX: "visible",
        });
    });

    it("aggressive 档 应该 break-all 任意断行", () => {
        expect(resolveTableWrapVars("aggressive")).toEqual({
            wordBreak: "break-all",
            whiteSpace: "normal",
            overflowX: "visible",
        });
    });

    it("none 档 应该 nowrap + 横向滚动", () => {
        expect(resolveTableWrapVars("none")).toEqual({
            wordBreak: "keep-all",
            whiteSpace: "nowrap",
            overflowX: "auto",
        });
    });

    it("未知值 应该 安全回退 normal", () => {
        expect(resolveTableWrapVars("")).toEqual(resolveTableWrapVars("normal"));
        expect(resolveTableWrapVars("weird")).toEqual(resolveTableWrapVars("normal"));
    });
});
