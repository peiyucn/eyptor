import { describe, it, expect, beforeEach } from "vitest";
import { applyCodeBlockMaxHeight, applyEditorMaxWidth } from "../utils/layoutVars";

describe("layoutVars 布局 CSS 变量", () => {
    beforeEach(() => {
        document.documentElement.removeAttribute("style");
    });

    it("applyEditorMaxWidth 应该 写入 --editor-max-width（px）", () => {
        applyEditorMaxWidth(1234);

        expect(document.documentElement.style.getPropertyValue("--editor-max-width")).toBe("1234px");
    });

    it("applyCodeBlockMaxHeight 应该 写入 --code-block-max-height（px）", () => {
        applyCodeBlockMaxHeight(750);

        expect(document.documentElement.style.getPropertyValue("--code-block-max-height")).toBe("750px");
    });

    it("小数 应该 四舍五入", () => {
        applyEditorMaxWidth(899.6);

        expect(document.documentElement.style.getPropertyValue("--editor-max-width")).toBe("900px");
    });

    it("非法值 应该 不写入（保留既有值）", () => {
        applyEditorMaxWidth(1000);
        applyEditorMaxWidth(Number.NaN);
        applyCodeBlockMaxHeight(0);

        expect(document.documentElement.style.getPropertyValue("--editor-max-width")).toBe("1000px");
        expect(document.documentElement.style.getPropertyValue("--code-block-max-height")).toBe("");
    });
});
