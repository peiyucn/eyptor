/**
 * 撤销/重做历史的跨实例快照（销毁重建架构的配套）。
 *
 * 背景：prosemirror-history 1.5 的 HistoryState / Branch / Item 都不从包里导出，
 * 内部条目存在 rope-sequence 的不可变序列里。这里不改库内部：
 *   - 捕获：只读公开字段（StepMap.ranges/inverted、Step.toJSON()、书签 anchor/head、
 *     mirrorOffset、eventCount），序列化成纯 JSON；
 *   - 恢复：先用一个临时 EditorState 拿到不可导出的 Item 构造器与空 rope，重建出
 *     Branch / HistoryState，再通过 `tr.setMeta(historyPluginKey, { historyState })` 注入
 *     —— applyTransaction 首行会直接采纳这个状态（无需替换插件）。
 *
 * 任何结构不符 / 解析异常 / 版本变化一律返回 false：调用方保持「空历史」（与销毁重建
 * 的原行为一致），绝不让可疑历史作用到文档上。
 */

import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { history } from "@milkdown/kit/prose/history";
import { Step, StepMap } from "@milkdown/kit/prose/transform";

/** 快照上限：超过就放弃恢复（大粘贴会让步骤 JSON 很大）——宁丢历史也不撑爆消息与内存 */
const MAX_HISTORY_BYTES = 512 * 1024;

interface SelJson { t: "text" | "node"; a: number; h?: number }
interface ItemJson {
    map: { ranges: number[]; inverted: boolean };
    step: unknown;
    sel: SelJson | null;
    mirror: number | null;
}
interface BranchJson { eventCount: number; items: ItemJson[] }
export interface HistorySnapshot {
    v: 1;
    done: BranchJson;
    undone: BranchJson;
    prevRanges: number[] | null;
    prevTime: number;
    prevComposition: number;
}

function findHistoryPlugin(state: any): any {
    return state?.plugins?.find?.((p: any) => typeof p?.key === "string" && p.key.startsWith("history"));
}

function bookmarkJson(bm: any): SelJson | null {
    if (!bm) return null;
    if (typeof bm.anchor === "number" && typeof bm.head === "number") {
        return { t: "text", a: bm.anchor, h: bm.head };
    }
    if (typeof bm.anchor === "number") return { t: "node", a: bm.anchor };
    return null;
}

function branchJson(branch: any): BranchJson | null {
    const rope = branch?.items;
    if (!rope || typeof rope.get !== "function" || typeof rope.length !== "number") return null;
    const items: ItemJson[] = [];
    for (let i = 0; i < rope.length; i++) {
        const item = rope.get(i);
        if (!item?.map || !Array.isArray(item.map.ranges)) return null;
        items.push({
            map: { ranges: item.map.ranges.map(Number), inverted: !!item.map.inverted },
            step: item.step ? item.step.toJSON() : null,
            sel: bookmarkJson(item.selection),
            mirror: Number.isFinite(item.mirrorOffset) ? item.mirrorOffset : null,
        });
    }
    return { eventCount: Number(branch.eventCount) || 0, items };
}

/** 捕获当前编辑器状态的历史；结构不符 / 超限 / 异常时返回 null（调用方跳过恢复） */
export function captureHistory(state: any): HistorySnapshot | null {
    try {
        const plugin = findHistoryPlugin(state);
        if (!plugin) return null;
        const hs: any = plugin.getState(state);
        if (!hs?.done || !hs?.undone || !hs.constructor) return null;
        const done = branchJson(hs.done);
        const undone = branchJson(hs.undone);
        if (!done || !undone) return null;
        const snapshot: HistorySnapshot = {
            v: 1,
            done,
            undone,
            prevRanges: Array.isArray(hs.prevRanges) ? hs.prevRanges.map(Number) : null,
            prevTime: Number(hs.prevTime) || 0,
            prevComposition: Number.isFinite(hs.prevComposition) ? hs.prevComposition : -1,
        };
        return JSON.stringify(snapshot).length <= MAX_HISTORY_BYTES ? snapshot : null;
    } catch {
        return null;
    }
}

function bookmarkFromJson(state: any, sel: SelJson): any {
    if (sel.t === "node") {
        return NodeSelection.create(state.doc, sel.a).getBookmark();
    }
    return TextSelection.between(
        state.doc.resolve(sel.a),
        state.doc.resolve(sel.h ?? sel.a),
    ).getBookmark();
}

/**
 * 把快照注入当前编辑器状态的历史插件；成功返回 true。
 * 调用方需保证：当前文档与捕获时**逐位一致**（位置/步骤才有效）——不一致时不要调用。
 */
export function restoreHistory(
    state: any,
    dispatch: (tr: any) => void,
    json: string | undefined,
): boolean {
    if (!json) return false;
    try {
        const snapshot = JSON.parse(json) as HistorySnapshot;
        if (snapshot?.v !== 1 || !snapshot.done || !snapshot.undone) return false;
        const plugin = findHistoryPlugin(state);
        if (!plugin?.spec?.key) return false;
        const hs: any = plugin.getState(state);
        if (!hs?.done?.constructor || !hs?.undone?.constructor || !hs.constructor) return false;

        // 临时 state：取不可导出的 Item 构造器与空 rope（rope-sequence 类同样不导出）
        const tmpBase = EditorState.create({ schema: state.schema, plugins: [history()] });
        const tmpEmpty: any = findHistoryPlugin(tmpBase)?.getState(tmpBase);
        const tmpEdited = tmpBase.apply(tmpBase.tr.insertText("x"));
        const tmpItems: any = findHistoryPlugin(tmpEdited)?.getState(tmpEdited);
        const ItemCtor = tmpItems?.done?.items?.get?.(0)?.constructor;
        const emptyRope = tmpEmpty?.done?.items;
        if (!ItemCtor || !emptyRope || typeof emptyRope.append !== "function") return false;

        const BranchCtor = hs.done.constructor;
        const HistoryStateCtor = hs.constructor;
        const buildBranch = (branch: BranchJson): any => new BranchCtor(
            emptyRope.append(branch.items.map((item) => new ItemCtor(
                new StepMap(item.map.ranges, item.map.inverted),
                item.step ? Step.fromJSON(state.schema, item.step) : undefined,
                item.sel ? bookmarkFromJson(state, item.sel) : undefined,
                item.mirror ?? undefined,
            ))),
            branch.eventCount,
        );
        const restored = new HistoryStateCtor(
            buildBranch(snapshot.done),
            buildBranch(snapshot.undone),
            snapshot.prevRanges,
            snapshot.prevTime,
            snapshot.prevComposition,
        );
        dispatch(state.tr.setMeta(plugin.spec.key, { redo: false, historyState: restored }));
        return true;
    } catch {
        return false;
    }
}
