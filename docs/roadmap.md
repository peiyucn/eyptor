# EPYTOR 路线图

> 最后更新：2026-09-04
> 技术债务清单见 [tech-debt.md](./tech-debt.md)

***

## v1.2.x 🚀（开发中，未发布）

### 上游参考

fork 上游 [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) v0.1.6 → v0.3.2，以下功能可参考移植：

* 标题吸顶 + 折叠（v0.2.0）— ✅ 已实现待发布（Decoration 折叠 + 吸顶推挤，spec 注明出处）
* 表格换行模式（v0.2.0）— ✅ 已实现待发布（Shift+Enter 软换行 + tableWrapMode 两档 wrap/nowrap，2026-09-07 用户决策三档简化为两档）
* 工具栏溢出菜单（v0.2.0）— ✅ 已实现待发布（独立设计：JS 测量 + 显示控制 + 外部面板，非 DOM 移动）
* Frontmatter 可视化面板（v0.2.0）— ✅ 已实现待发布（v1 简单行编辑：key/value + 行增删；嵌套/列表字段未做）
* 自定义主题（v0.2.0）— 不移植
* 颜色主题切换（v0.2.0）— 我们已通过 `--vscode-*` CSS 变量实现，无需移植

### 新功能（已实现待发布）

* [x] **标题吸顶 + 折叠** — 长文档滚动时当前章节标题 sticky 在顶栏下方，同级标题间可折叠/展开（Decoration，不修改文档）。
* [x] **表格换行模式** — 单元格内 Shift+Enter 软换行（序列化 `<br>`）+ `epytor.tableWrapMode` 两档（wrap/nowrap）。
* [x] **工具栏溢出菜单** — 窗口窄时按钮收进「⋯」面板，替代 container query + flex-wrap 方案。
* [x] **Frontmatter 可编辑面板** — 不切源码即可编辑 YAML 元数据（v1 简单行编辑）。
* [x] **FindBar 正则搜索** — `.*` 开关 + 无效正则错误态 + 零宽匹配防护（新增，非原 roadmap 项）。
* [x] **表格网格选择器** — 顶栏表格按钮弹出 8×8 网格，任意行列插入（官方 `insertTableCommand`）（新增，非原 roadmap 项）。
* [x] **Mermaid 预览缩放** — DOM 层缩放 0.4–3× + 悬浮控制条 + 横向滚动（新增，非原 roadmap 项）。

### 新功能（待决策/暂缓）

* [ ] **文字对齐** — 段落/标题左/中/右对齐。**评估结论（2026-09-04）：CommonMark 无段落对齐，任何实现需自定义序列化语法（如 kramdown IAL），其他编辑器不兼容，代价大于收益——倾向放弃，待最终决策。** 原「工具栏占位按钮」已随 selectionToolbar 死代码删除一并移除。

### 本批次说明

* 贡献合并：issue #15（Clean Markdown 序列化）、#16（大文档卡顿）已 review 合并至 dev，预计随 v1.2.0 发布
* 依赖升级：Milkdown 7.22.0 → 7.22.1（含 dompurify 安全升级）
* 死代码清理：selectionToolbar（813 行）、headingIds 等 -1025 行
* 实现依据：各功能 spec 见 `docs/specs/2026-09-04-*.md`；官方能力对照与正路性审查见 `2026-09-04-v1.2-editing-experience.md` 四·六节

***

## v1.1.x ✅（已发布：v1.1.0 \~ v1.1.3）

### 架构升级

* [x] Milkdown 7.5.x → 7.21.2 + Crepe
* [x] Prism → CodeMirror 6
* [x] 表格 / 链接 / 工具栏迁移至 Crepe 原生实现
* [x] Claude 集成移除

### 新功能

* [x] LaTeX 数学公式、图片缩放与 Caption、图片选择器、图片加载重试
* [x] 工具栏毛玻璃吸顶 + 品牌标识、Undo/Redo/清除格式/设置按钮
* [x] Mermaid 深浅主题、TOC 面板优化、编辑器上边距 52px
* [x] H1-H6 标题样式打磨：h1 字重 700、h4 1.15em、h6 字重 400 + 灰色

### 已修复 Bug

* [x] **清除格式不彻底** — `clear-format` 按钮只清粗体/斜体/删除线/行内代码，需验证链接是否也能清除
* [x] **TOC 点击定位不准** — `domAtPos(pos + 1)` 在标题有行内格式时可能找不到 `<h1>`-`<h6>` 元素

### 已完成功能

* [x] **引用块一键退出** — blockquote 工具栏按钮改为 toggle
* [x] **源代码/渲染切换行定位改进** — 段内比例插值滚动
* [x] **窄窗口工具栏换行** — container query + flex-wrap 方案（v1.2 已由溢出菜单替代）

### 设计决策

* 行定位方案：段内比例插值（方案 A），不改 `computeLineMap` 格式，改动最小
* 引用回退：用 ProseMirror 原生 `lift` 命令解包
