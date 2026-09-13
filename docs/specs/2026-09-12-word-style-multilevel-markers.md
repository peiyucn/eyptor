# Word 式多级列表标记

> 状态：已实现（v1.2.0，2026-09-13）｜需求来源：手测反馈「编号列表和圆点列表，现在 milkdown 不支持子级变换，但我觉得这个功能我是需要的，可以模仿 word 的默认做法」

## 需求

列表标记按**层级**变换形式，与 Word 默认方案一致（用户提供截图为准）：

| 层级 | 有序 | 无序 |
|---|---|---|
| 1 | `1.` | ● 实心圆 |
| 2 | `a)` | ■ 实心方块 |
| 3 | `i.` | ◆ 实心菱形 |
| 4+ | 回到第 1 档，循环 | 回到第 1 档，循环 |

## 范围

* **只改显示**：Markdown 源码不变（`1.` / `-` 照旧），序列化、往返、兼容模式一概不受影响。
* **任务列表不动**：`- [ ]` / `- [x]` 保持勾选框。
* 不做：自定义编号格式的设置项、`a.` / `(1)` 等其它风格（需要时另开 spec）。

## 交互边界

* 有序列表的**第 1 层**沿用 Milkdown 算出的编号文本——它尊重 `order`（如「从 3 开始」的列表、跨列表续号），换成 CSS 计数器会丢掉这个语义。
* 第 2 层及更深用 CSS 计数器重绘（嵌套列表的起始号在实践中恒为 1）。
  *已知取舍*：若某个**嵌套**列表显式从非 1 开始，界面会从 1 显示（源码仍正确）。
* 圆点列表三层形状用 CSS 画（不依赖字体里的 ●■◆ 字形），尺寸对齐现有图标。
* 标记宽度沿用现有 `.label-wrapper` 的尺寸，因此**行内文字左缘不变**（不产生新的缩进偏移）。

## 实现

* `webview/listMarkers.css`（新增，由 `webview/index.ts` 在 `style.css` 之后引入）
  * 层级：后代选择器逐层收窄（`.ProseMirror ol > .milkdown-list-item-block` 为第 1 层，再嵌一层为第 2 层……）——DOM 结构为 `ul/ol > div.milkdown-list-item-block > li.list-item > (.label-wrapper > .label + .children)`。
  * 类型：`.label.ordered` / `.label.bullet` / `.label.checked` / `.label.unchecked`（Crepe 已写在 label 元素的 class 上，实测确认）。
  * 有序：隐藏原文本（`color: transparent`，保留盒尺寸），用 `::before` + `counter(epytor-li-N, lower-alpha|lower-roman)` 绘制。
  * 无序：隐藏原 SVG，用 `::before` 画圆 / 方 / 菱形。
* 回归测试：`webview/__tests__/style.test.ts` 增加断言（三层选择器、计数器名、`lower-alpha` / `lower-roman`、任务项不被覆盖）。

## 验收标准

1. 三级有序列表显示为 `1.` / `a)` / `i.`，第四层回到 `1.`；
2. 三级圆点列表显示为 ● / ■ / ◆，第四层回到 ●；
3. 任务列表勾选框不变；
4. 行内文字左缘与改造前一致（不引入新缩进）；
5. 源码与保存结果不变（`pnpm run verify` + 手测另存一次比对）。
