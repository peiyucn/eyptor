import { describe, it, expect } from "vitest";
import { CONFIG_BROADCASTS } from "../../src/extension";
import {
    DEFAULT_CODE_BLOCK_MAX_HEIGHT,
    DEFAULT_EDITOR_MAX_WIDTH,
} from "../../src/utils/webviewConfigSanitize";

/** 取某个配置段的广播项（表驱动，未登记即 fail） */
function broadcastFor(section: string) {
    const item = CONFIG_BROADCASTS.find((entry) => entry.section === section);
    if (!item) { throw new Error(`未登记的广播项：${section}`); }
    return item;
}

describe("CONFIG_BROADCASTS 配置变更广播表", () => {
    it("应该 登记全部随改随生效的配置项", () => {
        expect(CONFIG_BROADCASTS.map((entry) => entry.section)).toEqual([
            "epytor.serializationMode",
            "epytor.tableWrapMode",
            "epytor.editorMaxWidth",
            "epytor.codeBlockMaxHeight",
        ]);
    });

    it("editorMaxWidth 变更 应该 广播 editorMaxWidthChanged", () => {
        expect(broadcastFor("epytor.editorMaxWidth").message(1200))
            .toEqual({ type: "editorMaxWidthChanged", value: 1200 });
    });

    it("editorMaxWidth 非法值 应该 回退默认宽度", () => {
        expect(broadcastFor("epytor.editorMaxWidth").message("1200"))
            .toEqual({ type: "editorMaxWidthChanged", value: DEFAULT_EDITOR_MAX_WIDTH });
        expect(broadcastFor("epytor.editorMaxWidth").message(399))
            .toEqual({ type: "editorMaxWidthChanged", value: DEFAULT_EDITOR_MAX_WIDTH });
        expect(broadcastFor("epytor.editorMaxWidth").message(10001))
            .toEqual({ type: "editorMaxWidthChanged", value: DEFAULT_EDITOR_MAX_WIDTH });
    });

    it("codeBlockMaxHeight 变更 应该 广播 codeBlockMaxHeightChanged", () => {
        expect(broadcastFor("epytor.codeBlockMaxHeight").message(800))
            .toEqual({ type: "codeBlockMaxHeightChanged", value: 800 });
    });

    it("codeBlockMaxHeight 非法值 应该 回退默认高度", () => {
        expect(broadcastFor("epytor.codeBlockMaxHeight").message(undefined))
            .toEqual({ type: "codeBlockMaxHeightChanged", value: DEFAULT_CODE_BLOCK_MAX_HEIGHT });
        expect(broadcastFor("epytor.codeBlockMaxHeight").message(99))
            .toEqual({ type: "codeBlockMaxHeightChanged", value: DEFAULT_CODE_BLOCK_MAX_HEIGHT });
    });

    it("原有两类广播 应该 保持可用", () => {
        expect(broadcastFor("epytor.serializationMode").message("compatible"))
            .toEqual({ type: "setSerializationMode", mode: "compatible" });
        expect(broadcastFor("epytor.serializationMode").message("非法"))
            .toEqual({ type: "setSerializationMode", mode: "clean" });
        expect(broadcastFor("epytor.tableWrapMode").message("nowrap"))
            .toEqual({ type: "tableWrapModeChanged", mode: "nowrap" });
    });
});
