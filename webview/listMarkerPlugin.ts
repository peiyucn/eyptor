import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { computeListMarker } from "./utils/listMarker";

/**
 * Word 式多级列表标记（显示层）：给每个列表项挂装饰，标出「层级」与「该显示的标记」。
 *
 * - 层级 → class（`epytor-li-level-N`）：CSS 据此换 ●/■/◆ 形状；
 * - 有序编号 → 自定义属性（`--epytor-marker: "a)"`）：CSS 用 `content: var(...)` 画出来。
 *   编号必须在这里算——它要尊重列表起始号（`order`，例如列表被退格断开后从 3 续号），
 *   CSS 计数器读不到这个值；层级也只有这里知道（CSS 没有层级选择器，第 4 层分不出回绕）。
 *
 * 不改文档：装饰不参与序列化。任务项（`checked` 非 null）一概跳过，勾选框保持原样。
 * 见 docs/specs/2026-09-12-word-style-multilevel-markers.md。
 */
export const listMarkerPluginKey = new PluginKey("epytor-list-marker");

/** 一个列表项该挂什么（纯数据，便于直测） */
export interface ListMarkerDecoration {
    from: number;
    to: number;
    cls: string;
    style: string;
}

const isList = (node: ProseNode): boolean =>
    node.type.name === "bullet_list" || node.type.name === "ordered_list";

const isTaskItem = (node: ProseNode): boolean =>
    node.attrs.checked !== null && node.attrs.checked !== undefined;

/**
 * 扫一遍文档，产出全部列表项的装饰数据（纯函数，不依赖 view）。
 * 深度优先：列表 → 逐项（第 depth 层）→ 项内继续下钻（depth + 1）。
 */
export function collectListMarkers(doc: ProseNode): ListMarkerDecoration[] {
    const out: ListMarkerDecoration[] = [];

    const walk = (node: ProseNode, offset: number, depth: number): void => {
        node.forEach((child, childOffset) => {
            const pos = offset + childOffset;
            if (isList(child)) {
                const kind = child.type.name === "ordered_list" ? "ordered" : "bullet";
                const order = Number(child.attrs.order ?? 1);
                let index = 0;
                child.forEach((item, itemOffset) => {
                    const itemPos = pos + 1 + itemOffset;
                    if (item.type.name === "list_item" && !isTaskItem(item)) {
                        const marker = computeListMarker(kind, depth, index, order);
                        // 标记内容与形状都走自定义属性：由最近的祖先决定，天然只作用于该项本身
                        // （层级 class + 层级选择器会在第 4 层回绕时误命中祖先层的规则）
                        const style = [
                            marker.text === null ? null : `--epytor-marker: "${marker.text}"`,
                            `--epytor-marker-size: ${marker.bullet.size}`,
                            `--epytor-marker-radius: ${marker.bullet.radius}`,
                            `--epytor-marker-rotate: ${marker.bullet.rotate}`,
                        ].filter((part): part is string => part !== null).join("; ");
                        out.push({
                            from: itemPos,
                            to: itemPos + item.nodeSize,
                            cls: `epytor-li-level-${marker.level}`,
                            style,
                        });
                    }
                    index += 1;
                    walk(item, itemPos + 1, depth + 1);
                });
                return;
            }
            walk(child, pos + 1, depth);
        });
    };

    walk(doc, 0, 1);
    return out;
}

export const listMarkerPlugin = $prose(() => {
    // 装饰只依赖文档内容：选中/滚动等不改文档的事务直接复用上一次结果，
    // 避免每次按键都全量扫一遍（大文档下这是热路径）。
    let cachedDoc: ProseNode | null = null;
    let cachedSet: DecorationSet | null = null;

    return new Plugin({
        key: listMarkerPluginKey,
        props: {
            decorations(state) {
                if (state.doc === cachedDoc && cachedSet) { return cachedSet; }
                cachedDoc = state.doc;
                cachedSet = DecorationSet.create(
                    state.doc,
                    collectListMarkers(state.doc).map((d) =>
                        Decoration.node(d.from, d.to, { class: d.cls, style: d.style }),
                    ),
                );
                return cachedSet;
            },
        },
    });
});
