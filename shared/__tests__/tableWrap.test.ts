import { describe, expect, it } from "vitest";
import { resolveTableWrapVars } from "../tableWrap";

describe("resolveTableWrapVars（两档）", () => {
    it("wrap 档 应该 break-all 任意字符断行", () => {
        expect(resolveTableWrapVars("wrap")).toEqual({
            wordBreak: "break-all",
            whiteSpace: "normal",
            overflowX: "visible",
            tableWidth: "auto",
        });
    });

    it("nowrap 档 应该 nowrap + 横向滚动 + table max-content", () => {
        expect(resolveTableWrapVars("nowrap")).toEqual({
            wordBreak: "keep-all",
            whiteSpace: "nowrap",
            overflowX: "auto",
            tableWidth: "max-content",
        });
    });

    it("旧档位迁移：aggressive / normal / 未知值 应该 落到 wrap", () => {
        expect(resolveTableWrapVars("aggressive")).toEqual(resolveTableWrapVars("wrap"));
        expect(resolveTableWrapVars("normal")).toEqual(resolveTableWrapVars("wrap"));
        expect(resolveTableWrapVars("")).toEqual(resolveTableWrapVars("wrap"));
        expect(resolveTableWrapVars("weird")).toEqual(resolveTableWrapVars("wrap"));
    });

    it("旧档位迁移：none 应该 落到 nowrap", () => {
        expect(resolveTableWrapVars("none")).toEqual(resolveTableWrapVars("nowrap"));
    });
});
