/**
 * 保存保真回归（真实 createEditor + getMarkdownForSave 链路）。
 *
 * 回归来源（2026-09-13 核对 README 时用真实保存路径跑往返发现）：保存会重写用户原文里
 * 只是**写法不同**的部分——`- one` 存完变 `* one`、`- [ ] todo` 变 `* [ ] todo`、
 * 4 空格嵌套（`    1. b`）变 3 空格。语义不变但每次保存都改用户文件（git 全是噪声），
 * 与「clean = 尽量少改」相悖。
 *
 * 两处修复各管一段：
 * - `detectListMarkerStyle`（markdownSerializer）→ 序列化沿用文件自己的标记符与分隔符；
 * - 行签名归一化（minimalDiff）→ 未改动的行逐字沿用原文（含缩进宽度、混合写法）。
 * 本文件断言两者合起来的用户可见结果：原文不动则保存结果与原文逐字一致。
 */
import { afterEach, describe, expect, it } from "vitest";

(window as unknown as Record<string, unknown>).__i18n = {
    translations: {},
    isMac: false,
    serializationMode: "clean",
};

if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
    };
}
if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (() => ({
        matches: false, media: "", onchange: null,
        addListener() { /* noop */ }, removeListener() { /* noop */ },
        addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
        dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
}

let disposeEditor: (() => void) | null = null;

/** 打开一个真实编辑器，返回保存结果读取器与编辑视图 */
async function openEditor(markdown: string) {
    const editor = await import("../editor");
    const container = document.createElement("div");
    document.body.appendChild(container);
    await editor.createEditor(container, markdown, () => { /* noop */ });
    disposeEditor = () => {
        editor.destroyEditor();
        container.remove();
    };
    return {
        save: () => editor.getMarkdownForSave(),
        view: () => editor.getEditorView(),
    };
}

afterEach(() => {
    disposeEditor?.();
    disposeEditor = null;
    document.body.innerHTML = "";
});

describe("保存保真（列表写法不被重写）", () => {
    it("未编辑时 `-` 项目符号列表 应该 逐字保存（回归：此前变 `*`）", async () => {
        const source = "- one\n- two\n";
        const { save } = await openEditor(source);

        expect(save()).toBe(source);
    }, 30_000);

    it("未编辑时任务列表 应该 逐字保存（回归：此前变 `* [ ]`）", async () => {
        const source = "- [ ] todo\n- [x] done\n";
        const { save } = await openEditor(source);

        expect(save()).toBe(source);
    }, 30_000);

    it("未编辑时 4 空格嵌套列表 应该 逐字保存（回归：此前缩进被改成 3 空格）", async () => {
        const source = "1. a\n    1. b\n        - bullet\n";
        const { save } = await openEditor(source);

        expect(save()).toBe(source);
    }, 30_000);

    it("空任务项（`- [ ] ` 后什么都不写）应该 识别成复选框并逐字保存", async () => {
        // 回归（2026-09-13，owner 在 ai_note 踩到）：上游 task-list 分词器要求标记后有内容，
        // 空复选框此前 checked 停在 null、`[ ]` 显示成正文、保存还被转义成 `- \[ ]`
        const source = "- [ ] \n- [x] done\n    - [ ] \n";
        const { save, view } = await openEditor(source);
        const editorView = view();
        expect(editorView).not.toBeNull();

        const checked: Array<boolean | null> = [];
        editorView!.state.doc.descendants((node) => {
            if (node.type.name === "list_item") { checked.push(node.attrs.checked as boolean | null); }
        });
        expect(checked).toEqual([false, true, false]);

        expect(save()).toBe(source);
    }, 30_000);

    it("改了某一行时 该行按新内容保存 且未改行的写法原样保留", async () => {
        // 末尾留一个段落：文档以列表结尾时上游 trailing 插件会补一个空段落（与本次修复无关），
        // 这里要断言的是「除改动那一行外逐字不变」，故避开该行为
        const source = "- one\n- two\n\ntail\n";
        const { save, view } = await openEditor(source);
        const editorView = view();
        expect(editorView).not.toBeNull();

        let insertAt = -1;
        editorView!.state.doc.descendants((node, pos) => {
            if (node.isText && node.text === "one") insertAt = pos + node.nodeSize;
        });
        expect(insertAt).toBeGreaterThanOrEqual(0);
        editorView!.dispatch(editorView!.state.tr.insertText("!", insertAt));

        expect(save()).toBe("- one!\n- two\n\ntail\n");
    }, 30_000);
});
