/**
 * 顶栏构建（从 editor.ts createEditor 中提取，回归：290 行巨型回调内联 5 个业务块）：
 * 历史/清除格式/图片/引用切换/列表切换/目录/设置按钮组定制 + 组重排 +
 * 溢出菜单元数据快照。类型从 Crepe 官方 TopBarFeatureConfig 推导，无 any。
 */
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Attrs, Node as ProseNode, NodeType } from "@milkdown/kit/prose/model";
import { undo, redo } from "@milkdown/kit/prose/history";
import { lift, wrapIn } from "prosemirror-commands";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { wrapInBlockTypeCommand } from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import type { TopBarFeatureConfig } from "@milkdown/crepe/feature/top-bar";
import { TbUndo, TbRedo, TbEraser, TbImage, TbToc, TbGear } from "@/ui/icons";
import { findTopBarButtonEl, setTopBarButtonMeta } from "../topBarOverflow";
import { openTableGridPicker } from "../tableGridPicker";

type TopBarBuilder = NonNullable<TopBarFeatureConfig["buildTopBar"]> extends (
    builder: infer B,
) => void
    ? B
    : never;

type BuiltGroup = ReturnType<TopBarBuilder["build"]>[number];
type BuiltItem = BuiltGroup["items"][number];

export function buildTopBarConfig(builder: TopBarBuilder, onTocToggle?: () => void): void {
    // Undo/Redo — 最前面独立组
    builder.addGroup('history', '').addItem('undo', {
        icon: TbUndo,
        active: (ctx: Ctx) => undo(ctx.get(editorViewCtx).state),
        onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); undo(v.state, v.dispatch, v); },
    }).addItem('redo', {
        icon: TbRedo,
        active: (ctx: Ctx) => redo(ctx.get(editorViewCtx).state),
        onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); redo(v.state, v.dispatch, v); },
    });
    // 清除格式 — formatting 组末尾（行内代码后面）
    builder.getGroup('formatting').addItem('clear-format', {
        icon: TbEraser,
        active: (ctx) => {
            const v = ctx.get(editorViewCtx);
            const { from, to, empty } = v.state.selection;
            if (!empty) {
                let has = false;
                v.state.doc.nodesBetween(from, to, (n) => { if (n.marks.length) { has = true; return false; } return true; });
                return has;
            }
            // 无选区时：光标在链接内即为 active
            const linkType = v.state.schema.marks['link'];
            if (!linkType) return false;
            return linkType.isInSet(v.state.doc.resolve(from).marks()) !== undefined;
        },
        onRun: (ctx) => {
            const v = ctx.get(editorViewCtx);
            let { from, to, empty } = v.state.selection;
            const tr = v.state.tr;
            const linkType = v.state.schema.marks['link'];

            // 光标在链接内（无选区）→ 取消整个链接
            if (empty && linkType) {
                const $from = v.state.doc.resolve(from);
                if (linkType.isInSet($from.marks())) {
                    while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                    const docSize = v.state.doc.content.size;
                    while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
                    tr.removeMark(from, to, linkType);
                    v.dispatch(tr);
                    return;
                }
            }

            // 有选区 → 扩展链接边界后清除所有标记
            if (linkType) {
                while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                const docSize = v.state.doc.content.size;
                while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
            }

            v.state.doc.nodesBetween(from, to, (n, pos) => {
                if (n.marks.length) {
                    const s = Math.max(pos, from), e = Math.min(pos + n.nodeSize, to);
                    n.marks.forEach((m) => tr.removeMark(s, e, m.type));
                }
            });
            if (linkType) tr.removeMark(from, to, linkType);
            v.dispatch(tr);
        },
    });
    // 图片 — insert 组，link 和 table 之间（清空后按序重建）
    {
        const g = builder.getGroup('insert'); const items = g.group.items;
        const linkItem = items.find((i) => i.key === 'link');
        const tableItem = items.find((i) => i.key === 'table');
        g.clear();
        if (linkItem) g.addItem('link', linkItem);
        g.addItem('image', {
            icon: TbImage,
            active: () => false,
            onRun: (ctx) => {
                ctx.get(editorViewCtx).dom.dispatchEvent(new CustomEvent('epytor:insertImage', { bubbles: true }));
            },
        });
        if (tableItem) g.addItem('table', {
            ...tableItem,
            onRun: (ctx) => {
                // 网格选择器：hover 预览行列，点击插入（官方 insertTableCommand 支持任意行列）
                const viewDom = ctx.get(editorViewCtx).dom;
                const topBar = viewDom.parentElement?.querySelector<HTMLElement>('.milkdown-top-bar');
                const anchor = (topBar ? findTopBarButtonEl(topBar, 'table') : null) ?? topBar ?? viewDom;
                openTableGridPicker(anchor, (rows, cols) => {
                    ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
                });
            },
        });
    }
    // 引用块一键退出：在引用内点击 → lift 解包，否则 → 包裹
    {
        const isInBlockquote = (state: EditorState) => {
            const bqType = state.schema.nodes['blockquote'];
            if (!bqType) return false;
            const { $from } = state.selection;
            for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type === bqType) return true;
            }
            return false;
        };

        const moreG = builder.getGroup('more');
        const moreItems = moreG.group.items;
        const quoteItem = moreItems.find((i) => i.key === 'quote');
        const hrItem = moreItems.find((i) => i.key === 'hr');
        const quoteIcon = quoteItem?.icon ?? '';
        moreG.clear();
        moreG.addItem('quote', {
            icon: quoteIcon,
            active: (ctx) => isInBlockquote(ctx.get(editorViewCtx).state),
            onRun: (ctx) => {
                const v = ctx.get(editorViewCtx);
                if (isInBlockquote(v.state)) {
                    lift(v.state, v.dispatch);
                } else {
                    const bq = v.state.schema.nodes['blockquote'];
                    if (bq) wrapIn(bq)(v.state, v.dispatch);
                }
            },
        });
        if (hrItem) moreG.addItem('hr', hrItem);
    }
    // 列表切换：不在列表 → 包裹；在列表且类型不同 → 直接切换；类型相同 → 取消列表
    {
        const findListItems = (state: EditorState) => {
            const liType = state.schema.nodes['list_item'];
            const { from, to } = state.selection;
            const items: Array<{ pos: number; node: ProseNode }> = [];
            state.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type === liType) items.push({ pos, node });
            });
            if (!items.length) {
                const { $from } = state.selection;
                for (let d = $from.depth; d >= 0; d--) {
                    if ($from.node(d).type === liType) {
                        items.push({ pos: $from.before(d), node: $from.node(d) });
                        break;
                    }
                }
            }
            return items;
        };
        // 找到包含这些 list_item 的顶层列表节点（去重）
        const findTopLists = (state: EditorState, items: Array<{ pos: number; node: ProseNode }>) => {
            const lists: Array<{ pos: number; node: ProseNode }> = [];
            const seen = new Set<number>();
            items.forEach(({ pos }) => {
                const $pos = state.doc.resolve(pos);
                for (let d = $pos.depth; d >= 0; d--) {
                    const node = $pos.node(d);
                    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
                        const listPos = $pos.before(d);
                        if (!seen.has(listPos)) {
                            seen.add(listPos);
                            lists.push({ pos: listPos, node });
                        }
                        break;
                    }
                }
            });
            return lists;
        };
        const listKind = (state: EditorState): 'bullet' | 'ordered' | 'task' | null => {
            const items = findListItems(state);
            if (!items.length) return null;
            const attrs = items[0].node.attrs;
            if (attrs.checked != null) return 'task';
            return attrs.listType === 'ordered' ? 'ordered' : 'bullet';
        };
        const toggleList = (target: 'bullet' | 'ordered' | 'task') => (ctx: Ctx) => {
            const v = ctx.get(editorViewCtx);
            const { state, dispatch } = v;
            const schema = state.schema;
            const kind = listKind(state);
            if (!kind) {
                // 不在列表 → 原包裹行为
                let nodeType: NodeType | null = null;
                let attrs: Attrs | null = null;
                if (target === 'bullet') nodeType = schema.nodes['bullet_list'];
                else if (target === 'ordered') nodeType = schema.nodes['ordered_list'];
                else { nodeType = schema.nodes['list_item']; attrs = { checked: false }; }
                if (nodeType) ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType, attrs });
                return;
            }
            if (kind === target) {
                // 同类型 → 取消/降级（lift 一层）
                const liType = schema.nodes['list_item'];
                liftListItem(liType)(state, dispatch);
                return;
            }
            // 不同类型 → 换外层列表类型 + 更新 list_item attrs
            // 用 setNodeMarkup（不改变节点大小，光标位置自动保留，不会跳行）
            const items = findListItems(state);
            const lists = findTopLists(state, items);
            if (!lists.length) return;
            const tr = state.tr;
            lists.forEach(({ pos, node }) => {
                const newType = target === 'ordered'
                    ? schema.nodes['ordered_list']
                    : schema.nodes['bullet_list'];
                const newAttrs = { ...node.attrs };
                if (target === 'ordered') newAttrs.order = 1;
                // 换外层类型（content 保留）
                tr.setNodeMarkup(pos, newType, newAttrs);
                // 逐个 list_item 更新 attrs
                let order = 1;
                node.forEach((item: ProseNode, _off: number, itemPos: number) => {
                    const itemAttrs = { ...item.attrs };
                    if (target === 'bullet') {
                        itemAttrs.listType = 'bullet';
                        itemAttrs.label = '•';
                        itemAttrs.checked = null;
                    } else if (target === 'ordered') {
                        itemAttrs.listType = 'ordered';
                        itemAttrs.label = `${order}.`;
                        itemAttrs.checked = null;
                        order++;
                    } else { // task
                        itemAttrs.checked = false;
                        itemAttrs.listType = 'bullet';
                        itemAttrs.label = '•';
                    }
                    tr.setNodeMarkup(pos + itemPos + 1, undefined, itemAttrs);
                });
            });
            dispatch(tr);
        };
        const listG = builder.getGroup('list');
        const listItems = listG.group.items;
        const bulletItem = listItems.find((i) => i.key === 'bullet-list');
        const orderedItem = listItems.find((i) => i.key === 'ordered-list');
        const taskItem = listItems.find((i) => i.key === 'task-list');
        if (bulletItem || orderedItem || taskItem) {
            listG.clear();
            if (bulletItem) listG.addItem('bullet-list', {
                icon: bulletItem.icon,
                active: (ctx: Ctx) => listKind(ctx.get(editorViewCtx).state) === 'bullet',
                onRun: toggleList('bullet'),
            });
            if (orderedItem) listG.addItem('ordered-list', {
                icon: orderedItem.icon,
                active: (ctx: Ctx) => listKind(ctx.get(editorViewCtx).state) === 'ordered',
                onRun: toggleList('ordered'),
            });
            if (taskItem) listG.addItem('task-list', {
                icon: taskItem.icon,
                active: (ctx: Ctx) => listKind(ctx.get(editorViewCtx).state) === 'task',
                onRun: toggleList('task'),
            });
        }
    }
    // 目录切换 — 设置前独立组
    builder.addGroup('toc', '').addItem('toc', {
        icon: TbToc,
        active: () => false,
        onRun: () => {
            onTocToggle?.();
        },
    });
    // 设置 — 末尾独立组
    builder.addGroup('settings', '').addItem('settings', {
        icon: TbGear,
        active: () => false,
        onRun: () => {
            document.dispatchEvent(new CustomEvent('epytor:openSettings', { bubbles: true }));
        },
    });
    // 将 toc、history 组移到最前面
    const groups = builder.build();
    const tocGroup = groups.find((g) => g.key === 'toc');
    if (tocGroup) {
        const idx = groups.indexOf(tocGroup);
        groups.splice(idx, 1);
        groups.unshift(tocGroup);
    }
    const historyGroup = groups.find((g) => g.key === 'history');
    if (historyGroup) {
        const idx = groups.indexOf(historyGroup);
        groups.splice(idx, 1);
        groups.splice(1, 0, historyGroup);
    }
    // 顶栏溢出菜单按钮元数据（key/icon/onRun 快照，供溢出面板渲染副本）
    setTopBarButtonMeta(
        groups.flatMap((g: BuiltGroup) =>
            g.items.map((item: BuiltItem) => ({
                key: item.key,
                icon: (item.icon as string) ?? "",
                onRun: item.onRun ?? (() => undefined),
            })),
        ),
    );
}
