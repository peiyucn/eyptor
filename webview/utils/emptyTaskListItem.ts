/**
 * 空任务项修复：让「标记后什么都不写」的复选框（`- [ ] ` / `- [x] `）也能识别成任务项。
 *
 * 背景（2026-09-13 实测，mdast 层取证）：GFM 任务项标记的识别要求 `[ ]` 之后**还有内容**——
 * `- [ ] ` / `- [ ]` / `- [x]` 三种空写法在 remark-gfm（micromark 的 task-list 分词器）里都
 * 不被识别成任务项：mdast 的 `checked` 停在 null，`[ ]` 原样留在正文里。于是用户笔记里大量
 * 「空复选框」在编辑器里显示成「• [ ]」，保存还会把 `[` 转义成 `\[`（2026-09-13 owner 在
 * ai_note 里踩到）。有内容的 `- [ ] a` 上游能正常识别，不受影响。
 *
 * 修法（不依赖上游改动）：解析完成后在 mdast 上补齐——列表项的**首块**若是「只含标记的段落」
 * （`[ ]` / `[x]` / `[X]`，标记后允许空白），就按标记设置 `checked`、只摘掉那段标记文本，
 * 得到与 `- [ ] a` 完全同构的任务项。这样上游什么时候支持了空写法，本修复会自动让位（`checked`
 * 已是布尔值时直接跳过）。
 */

/** mdast 最小结构：只声明本模块用到的字段，避免为类型引入 @types/mdast 依赖 */
export interface MdastNode {
    type?: string;
    checked?: boolean | null;
    value?: unknown;
    children?: MdastNode[];
}

/** 只含标记的空任务项：`[ ]` / `[x]` / `[X]`，标记之后只允许空白 */
const EMPTY_TASK_MARKER_RE = /^\[([ xX])\][ \t]*$/;

/** 就地修复整棵树（纯函数：不创建新节点，只改 `checked` 与 `children`） */
export function fixEmptyTaskListItems(root: unknown): void {
    walk(root as MdastNode | undefined);
}

function walk(node: MdastNode | undefined): void {
    if (!node || !Array.isArray(node.children)) { return; }
    for (const child of node.children) {
        if (child?.type === "listItem") { fixEmptyItem(child); }
        walk(child);
    }
}

function fixEmptyItem(item: MdastNode): void {
    // 上游已识别（`- [ ] a` 这类有内容的写法）→ 不动
    if (typeof item.checked === "boolean") { return; }
    const head = item.children?.[0];
    if (head?.type !== "paragraph" || head.children?.length !== 1) { return; }
    const text = head.children[0];
    if (text?.type !== "text" || typeof text.value !== "string") { return; }

    const match = EMPTY_TASK_MARKER_RE.exec(text.value);
    if (!match) { return; }
    item.checked = match[1].toLowerCase() === "x";
    // 只摘掉标记文本、**保留这个段落**：mdast 的任务项序列化要求首块是 paragraph，没有段落
    // 时复选框标记会被丢掉（实测 `- [ ] ` 存成 `-`）。空段落会被 serializer 补上 `<br />`
    // 占位，由 markdownSerializer.stripListItemBreakPlaceholder 在序列化文本上擦掉。
    head.children?.shift();
}

/**
 * remark 插件（供 `$remark` 注册）。
 * 必须在 remark-gfm **之后**注册：本修复读的是 gfm 解析出的 listItem 结构。
 */
export const emptyTaskListItemPlugin = () =>
    (tree: unknown): void => {
        fixEmptyTaskListItems(tree);
    };
