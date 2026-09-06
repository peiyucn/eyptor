import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrontmatterPanel } from "../components/frontmatterPanel";

function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("frontmatterPanel 组件", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = "";
    });

    it("编辑 value 防抖后 应该 回调序列化结果", () => {
        const onChange = vi.fn();
        const handle = createFrontmatterPanel("---\ntitle: A\n---\n", onChange)!;
        document.body.appendChild(handle.panel);

        const valueInput = handle.panel.querySelector<HTMLInputElement>(".fm-val-input")!;
        valueInput.value = "B";
        valueInput.dispatchEvent(new Event("input"));

        expect(onChange).not.toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(onChange).toHaveBeenCalledWith("---\ntitle: B\n---\n");
    });

    it("面板重建前 dispose 旧实例 应该 取消旧防抖 timer（无竞态写回）", () => {
        const onChangeOld = vi.fn();
        const onChangeNew = vi.fn();

        // 旧面板：编辑后 300ms 内被替换
        const oldHandle = createFrontmatterPanel("---\ntitle: A\n---\n", onChangeOld)!;
        document.body.appendChild(oldHandle.panel);
        const oldInput = oldHandle.panel.querySelector<HTMLInputElement>(".fm-val-input")!;
        oldInput.value = "STALE";
        oldInput.dispatchEvent(new Event("input"));

        // revert：替换面板（先 dispose 旧的）
        oldHandle.dispose();
        const newHandle = createFrontmatterPanel("---\ntitle: A\n---\n", onChangeNew)!;
        document.body.appendChild(newHandle.panel);

        vi.advanceTimersByTime(300);
        expect(onChangeOld).not.toHaveBeenCalled();
        expect(onChangeNew).not.toHaveBeenCalled();
    });

    it("删除全部行 应该 回调空串（YAML 头消失）", () => {
        const onChange = vi.fn();
        const handle = createFrontmatterPanel("---\ntitle: A\n---\n", onChange)!;
        document.body.appendChild(handle.panel);

        const delBtn = handle.panel.querySelector<HTMLButtonElement>(".fm-del-btn")!;
        delBtn.click();
        vi.advanceTimersByTime(300);
        expect(onChange).toHaveBeenCalledWith("");
    });

    it("空 frontmatter 应该 返回 null（不创建面板）", () => {
        expect(createFrontmatterPanel("", vi.fn())).toBeNull();
    });

    it("点击 + 新增行并输入 应该 回调含新行的序列化结果", () => {
        const onChange = vi.fn();
        const handle = createFrontmatterPanel("---\ntitle: A\n---\n", onChange)!;
        document.body.appendChild(handle.panel);

        const addBtn = handle.panel.querySelector<HTMLButtonElement>(".fm-add-btn")!;
        addBtn.click();
        expect(handle.panel.querySelectorAll("tr.fm-row")).toHaveLength(2);

        const newKey = handle.panel.querySelector<HTMLInputElement>('tr:last-child .fm-key-input')!;
        const newVal = handle.panel.querySelector<HTMLInputElement>('tr:last-child .fm-val-input')!;
        newKey.value = "tags";
        newKey.dispatchEvent(new Event("input"));
        newVal.value = "a, b";
        newVal.dispatchEvent(new Event("input"));

        vi.advanceTimersByTime(300);
        expect(onChange).toHaveBeenCalledWith("---\ntitle: A\ntags: a, b\n---\n");
    });
});
