import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory, history, redo, undo } from "@milkdown/kit/prose/history";
import { captureHistory, restoreHistory } from "../utils/historySnapshot";

const schema = new Schema({
    nodes: {
        doc: { content: "paragraph+", toDOM: () => ["div", 0] },
        paragraph: { content: "text*", toDOM: () => ["p", 0] },
        text: {},
    },
});

/** 建一个真实 EditorView（jsdom），dispatch 走 view.updateState */
function mount(doc?: unknown) {
    const dom = document.createElement("div");
    document.body.appendChild(dom);
    const state = doc
        ? EditorState.create({ doc: doc as never, plugins: [history()] })
        : EditorState.create({ schema, plugins: [history()] });
    let view: EditorView;
    view = new EditorView(dom, {
        state,
        dispatchTransaction: (tr) => view.updateState(view.state.apply(tr)),
    });
    return { view, dom };
}

describe("historySnapshot", () => {
    it("捕获 → 新实例重建 → 注入后撤销/重做与后续编辑都正确（回归：销毁重建丢撤销）", () => {
        // 两次 closeHistory 强制拆成两个撤销事件，验证粒度没有被压平
        const a = mount();
        a.view.dispatch(closeHistory(a.view.state.tr.insertText("hello")));
        a.view.dispatch(closeHistory(a.view.state.tr.insertText(" world")));
        expect(a.view.state.doc.textContent).toBe("hello world");
        const snapshot = captureHistory(a.view.state);
        expect(snapshot).toBeTruthy();
        const historyJson = JSON.stringify(snapshot);

        // 新实例：同文档（对应销毁后重建）
        const b = mount(a.view.state.doc);
        expect(JSON.stringify(b.view.state.doc.toJSON())).toBe(JSON.stringify(a.view.state.doc.toJSON()));
        expect(restoreHistory(b.view.state, (tr) => b.view.dispatch(tr), historyJson)).toBe(true);

        expect(undo(b.view.state, (tr) => b.view.dispatch(tr))).toBe(true);
        expect(b.view.state.doc.textContent).toBe("hello");
        expect(undo(b.view.state, (tr) => b.view.dispatch(tr))).toBe(true);
        expect(b.view.state.doc.textContent).toBe("");
        expect(redo(b.view.state, (tr) => b.view.dispatch(tr))).toBe(true);
        expect(b.view.state.doc.textContent).toBe("hello");

        // 恢复出的历史要能与新编辑接上
        b.view.dispatch(closeHistory(b.view.state.tr.insertText("!")));
        expect(b.view.state.doc.textContent).toBe("hello!");
        expect(undo(b.view.state, (tr) => b.view.dispatch(tr))).toBe(true);
        expect(b.view.state.doc.textContent).toBe("hello");

        a.view.destroy(); b.view.destroy(); a.dom.remove(); b.dom.remove();
    });

    it("没有 history 插件 / 非法快照 应该 安全返回（绝不冒险）", () => {
        const plain = EditorState.create({ schema });
        expect(captureHistory(plain)).toBe(null);

        const c = mount();
        expect(restoreHistory(c.view.state, (tr) => c.view.dispatch(tr), undefined)).toBe(false);
        expect(restoreHistory(c.view.state, (tr) => c.view.dispatch(tr), "not json")).toBe(false);
        expect(restoreHistory(c.view.state, (tr) => c.view.dispatch(tr), JSON.stringify({ v: 2 }))).toBe(false);
        c.view.destroy(); c.dom.remove();
    });
});
