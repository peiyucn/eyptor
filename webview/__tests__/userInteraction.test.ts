import { describe, expect, it } from "vitest";
import { getUserInteractionEpoch } from "../utils/userInteraction";

describe("getUserInteractionEpoch", () => {
    it("未发生交互时 应该 保持不变", () => {
        const before = getUserInteractionEpoch();

        expect(getUserInteractionEpoch()).toBe(before);
    });

    it.each(["keydown", "mousedown", "paste", "drop", "cut", "wheel", "touchstart"])(
        "%s 事件 应该 递增纪元（回归 F4：两处事件集口径曾不一致）",
        (type) => {
            const before = getUserInteractionEpoch();

            document.dispatchEvent(new Event(type, { bubbles: true }));

            expect(getUserInteractionEpoch()).toBe(before + 1);
        },
    );

    it("事件发生在后代元素上时 应该 也被捕获（capture 阶段，ProseMirror 可能 stopPropagation）", () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const before = getUserInteractionEpoch();

        el.dispatchEvent(new Event("keydown", { bubbles: true }));

        expect(getUserInteractionEpoch()).toBe(before + 1);
        el.remove();
    });
});
