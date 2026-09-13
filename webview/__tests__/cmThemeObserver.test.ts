import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView as CMEditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { CM_RECONFIGURE_DELAY_MS, observeCmEditorCount } from "../utils/cmThemeObserver";

/** 建一个容器，内含 count 个 .cm-editor */
function makeContainer(count: number): HTMLElement {
    const container = document.createElement("div");
    for (let i = 0; i < count; i++) {
        const cm = document.createElement("div");
        cm.className = "cm-editor";
        container.appendChild(cm);
    }
    document.body.appendChild(container);
    return container;
}

/** 等待 MutationObserver 回调（微任务）落地 */
async function flushMutations(): Promise<void> {
    await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
    });
}

describe("observeCmEditorCount", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("DOM 变更但 .cm-editor 数量不变时 应该 不触发补配（无限回环回归）", async () => {
        const container = makeContainer(1);
        const onChange = vi.fn();
        observeCmEditorCount(container, onChange);

        // 模拟 reconfigure 自身引起的 DOM 变更：数量不变
        const cm = container.querySelector<HTMLElement>(".cm-editor")!;
        cm.appendChild(document.createElement("div"));
        cm.setAttribute("class", "cm-editor cm-focused");
        container.appendChild(document.createElement("div"));
        await flushMutations();
        vi.advanceTimersByTime(CM_RECONFIGURE_DELAY_MS * 5);

        expect(onChange).not.toHaveBeenCalled();
    });

    it("新增 .cm-editor 时 应该 延迟触发一次补配", async () => {
        const container = makeContainer(0);
        const onChange = vi.fn();
        observeCmEditorCount(container, onChange);

        const cm = document.createElement("div");
        cm.className = "cm-editor";
        container.appendChild(cm);
        await flushMutations();
        expect(onChange).not.toHaveBeenCalled(); // 延迟到 Crepe 挂载完成后再补配

        vi.advanceTimersByTime(CM_RECONFIGURE_DELAY_MS);

        expect(onChange).toHaveBeenCalledOnce();
    });

    it("移除 .cm-editor 时 应该 触发补配", async () => {
        const container = makeContainer(1);
        const onChange = vi.fn();
        observeCmEditorCount(container, onChange);

        container.querySelector(".cm-editor")!.remove();
        await flushMutations();
        vi.advanceTimersByTime(CM_RECONFIGURE_DELAY_MS);

        expect(onChange).toHaveBeenCalledOnce();
    });

    it("断开监听后新增 .cm-editor 时 应该 不再触发", async () => {
        const container = makeContainer(0);
        const onChange = vi.fn();
        const disconnect = observeCmEditorCount(container, onChange);
        disconnect();

        const cm = document.createElement("div");
        cm.className = "cm-editor";
        container.appendChild(cm);
        await flushMutations();
        vi.advanceTimersByTime(CM_RECONFIGURE_DELAY_MS);

        expect(onChange).not.toHaveBeenCalled();
    });

    it("真实 reconfigure 引起 childList 变更时 应该 不再次排入补配（无限回环回归）", async () => {
        // 真实链路复现：CodeMirror 带语法高亮的 reconfigure 会重建内容 DOM
        // （childList 变更）→ 旧实现把它当成「新代码块」→ 再次 reconfigure → 无限回环
        vi.useRealTimers();
        const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const js = languages.find((l) => l.name === "JavaScript")!;
        const jsSupport = await js.load();
        const cmTheme = new Compartment();
        const container = document.createElement("div");
        document.body.appendChild(container);
        const view = new CMEditorView({
            state: EditorState.create({
                doc: "const a = 1;\nfunction f(x) { return x + a; }\n",
                extensions: [cmTheme.of(oneDark), jsSupport],
            }),
            parent: container,
        });
        const reconfigure = vi.fn(() => {
            view.dispatch({ effects: cmTheme.reconfigure(syntaxHighlighting(defaultHighlightStyle)) });
        });
        observeCmEditorCount(container, reconfigure);

        // 触发一次补配（模拟新出现的代码块），reconfigure 自身随即产生 childList 变更
        const newCm = document.createElement("div");
        newCm.className = "cm-editor";
        container.appendChild(newCm);
        await wait(CM_RECONFIGURE_DELAY_MS * 4);
        expect(reconfigure).toHaveBeenCalledOnce();

        // 回环条件已成立：若没有数量守卫，这里会持续累加
        await wait(CM_RECONFIGURE_DELAY_MS * 30);

        expect(reconfigure).toHaveBeenCalledOnce(); // 停在 1 次，不再回环
        view.destroy();
    }, 20000);
});
