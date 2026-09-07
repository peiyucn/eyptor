import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTableWrapVars } from "../../shared/tableWrap";
import { applyTableWrapVars } from "../utils/tableWrap";

describe("applyTableWrapVars", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.documentElement.removeAttribute("style");
    });

    it("三档映射 应该 写到 :root CSS 变量（配置变更即时生效）", () => {
        applyTableWrapVars(resolveTableWrapVars("none"));

        expect(document.documentElement.style.getPropertyValue("--epytor-table-word-break")).toBe("keep-all");
        expect(document.documentElement.style.getPropertyValue("--epytor-table-white-space")).toBe("nowrap");
        expect(document.documentElement.style.getPropertyValue("--epytor-table-overflow-x")).toBe("auto");

        applyTableWrapVars(resolveTableWrapVars("aggressive"));
        expect(document.documentElement.style.getPropertyValue("--epytor-table-word-break")).toBe("break-all");
        expect(document.documentElement.style.getPropertyValue("--epytor-table-white-space")).toBe("normal");
    });
});
