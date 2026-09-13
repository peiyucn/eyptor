# 技术路线评估：Markdown WYSIWYG 流派与「Typora 体验复刻」难度拆解

> 创建日期：2026-09-06
> 状态：评估文档（研究结论存档；**不含实施计划，未立项**）
> 范围：epytor 技术路线决策的输入材料——假设新建「epytor plus」完全复刻 Typora 编辑体验（光标进出源码显示、跟手度、万行流畅、保真），评估难度与需攻克的问题

## 背景与目的

epytor 当前基于 Milkdown 7.22.1（Crepe，ProseMirror 内核），编辑表现与行业标杆 Typora 存在可感知差距。本文回答两个问题：

1. Markdown WYSIWYG 编辑器有几条技术流派，各自的事实源与固有代价是什么？
2. 若走 Typora 流派重建编辑器，难度多大、需攻克哪些问题？

---

## 一、流派全景：以「事实源」为判别轴

所有流派的根本分水岭只有一个问题：**编辑发生时，磁盘上的 markdown 文本和编辑器里的内容，谁是真相？**

| # | 流派 | 事实源 | 机制 | 代表 | 核心代价 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ① | 源码即时渲染 | **源码文本** | 光标行显示源码，其余行渲染为富文本视图 | **Typora**、Obsidian Live Preview、Zettlr、iA Writer | 结构化编辑弱（源码↔渲染映射难） |
| ② | 渲染 AST + contenteditable 覆盖 | 两者之间 | 解析渲染成 DOM，直接在 DOM 上编辑，变更反推源码 | Joplin WYSIWYG、MarkText（Muya） | DOM↔源码双向映射复杂度爆炸，无成功主流产品 |
| ③ | 文档模型 | **模型（schema/AST）** | 编辑=模型事务，markdown 只是导入导出格式 | **Milkdown**、TipTap、Notion、Lexical 系 | 序列化往返损失 + 全量 DOM 性能 + 语法可见性弱 |
| ④ | 块编辑器 | 模型 | ③ 的 UI 变体，块为显式概念，slash 驱动 | Notion、BlockNote | 与 markdown 关系最远，对 epytor 无参考价值 |

epytor 当前在 ③，Typora 在 ①。差距的根源是流派选择，而非单一引擎的优劣。

---

## 二、Typora 架构核实

**证据**：2026-09-06 用 obscura-web（走代理 127.0.0.1:7897）抓取 Typora [官方致谢页](https://support.typora.io/Acknowledgement/)，在列的第三方库中确认：

| 库 | 作用 | 结论 |
| :--- | :--- | :--- |
| **CodeMirror**（Marijn Haverbeke, MIT） | 文本缓冲 | 编辑内核确认为 CodeMirror 系（此前「业界公认 CM 定制 fork」获官方背书） |
| **morphdom**（MIT） | DOM diff/patch | **关键证据**：源码变化后重新渲染 + diff 更新视图——渲染视图是**可随时丢弃重建的投影**，不是事实源 |
| **rangy**（MIT） | 跨 DOM 选区映射 | 光标在「源码行↔渲染块」间跳转的胶水 |
| DOMPurify / markdown-it-emoji / MathJax / Mermaid | 渲染与净化 | markdown-it 生态痕迹 |

**结论**：Typora = 源码即真相 + 可随时丢弃重建的渲染投影。

- 保真免费：源码就是源码，从不序列化，渲染只是投影
- 要复刻 Typora，真正难的**不是** CM（MIT 开源），而是 rangy + morphdom 那一层**源码↔渲染的位置/选区/更新胶水**——闭源自研、十年打磨

---

## 三、路线可行性参照（四个项目）

| 项目 | 路线 | 状态 | 对评估的意义 |
| :--- | :--- | :--- | :--- |
| [md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) | **同为 Milkdown（ProseMirror）** | 活跃（v0.3.2） | 其 README「已知限制」明确写出「表格行号偏差，根因是 **ProseMirror 节点索引与源码行号映射不对齐**」——证明 epytor 踩的坑是**流派通病**，不是 Milkdown 独有的锅 |
| [MarkFlow](https://github.com/pprp/MarkFlow) | **CM6 inline decoration，明言「借 Typora 核心创意」** | 早期（Phase 1 完成） | **MIT 协议**。已实现 heading/bold/italic/code/link/image/quote/task/hr 的语法隐藏 + 源码开关；**Phase 2 未做：表格、数学**——难点的诚实告白；是 fork 候选 |
| HyperMD（laobubu，CM5 时代） | CM5 + Typora 式 write/read 模式 | 停更多年 | 开源先例：reveal 状态机逻辑可参考，技术底座已过时 |
| Obsidian Live Preview | CM6 块级 widget 渲染 | 产品级（闭源） | 公开信息显示核心团队仅数人、约一年做到产品级——**证明小团队可行**，但胶水层闭源 |

**关键事实**：2026 年市面上的 VS Code「所见即所得 .md」扩展（含 epytor 与 md-wysiwyg-editor）主流都在 Milkdown 路线上；CM6 路线上最接近的可复用开源物是 MarkFlow（早期阶段）。

---

## 四、四个体验支柱的难度真相

| 体验支柱 | 难度真相 |
| :--- | :--- |
| **保真** | **免费**。缓冲区即磁盘文件，无序列化、无往返。epytor 的 #15（clean markdown）、#16（最小 diff）问题集直接蒸发；外部同步变成「文本整体替换」 |
| **万行流畅** | CM6 视口虚拟化免费给 80%，剩 20% 在渲染缓存（见 H2） |
| **跟手度** | CM6 文本层免费（epytor #16 的 IME 延迟补丁不需要）；难点只在渲染层增量 parse |
| **光标进出源码** | MarkFlow 已证明 CM6 inline decoration 可实现；Typora 级的「逐元素 reveal 规则 + 无缝切换」是主要工作量（见 H3） |

---

## 五、需攻克的硬问题（按难度排序）

### H1 源码↔渲染的位置映射胶水 —— 最难，Typora 的闭源核心

- **问题**：点击渲染行 → 光标落到正确源码 offset；选区跨越「源码行/渲染行」边界；链接 hover 弹窗定位；IME 候选框定位；**行高切换时视口不跳**（一行从渲染态变源码态，高度剧变，滚动必须锚定）。渲染行内容与源码非 1:1（软换行、符号隐藏、表格管道符），映射必须自研
- **参照**：Typora 用 rangy + 闭源胶水；Obsidian 自研；MarkFlow 未到 Typora 级（点击渲染行取光标行为需实测）
- **估时**：2–3 个月，且全程穿插打磨
- **历史教训**：MarkText 停更、Joplin WYSIWYG 半成品的死因都在这层胶水欠账，而非引擎选错

### H2 增量 markdown 解析 + 块级缓存 —— 10k 行的胜负手

- **问题**：每键不能全文档 re-parse；**块上下文级联失效**——改一行可能改变后面所有块的解析语境（code fence 开合、列表嵌套、引用层级）
- **现状**：lezer lang-markdown 给语法增量；渲染用的 markdown-it 无增量 → 需自建「块缓存 + 失效传播规则」；Obsidian 为此自研了解析器
- **估时**：1–2 个月 + 性能调优 1–2 个月

### H3 reveal 状态机 —— 逐元素的源码显示规则

- **问题**：Typora 规则逐元素定制——标题显示 `##`、列表显示 `-`、表格显示 `|`、光标进链接显示 `[x](y)`、行内 code 显示反引号、图片选中显示 `![alt](src)`；另需覆盖选区跨多块全量 reveal、空行、块边缘。规则不深奥，难在**全元素覆盖 + 零闪烁**
- **参照**：MarkFlow 已做基础元素，**缺 table、缺 math**
- **估时**：1–2 个月 + 长期打磨

### H4 结构化操作在文本层重做 —— CM6 路线比 Milkdown **变贵**的部分

- 表格全家桶：单元格增长自动补齐 pipe 对齐（Typora 招牌细节）、行列插删、Tab/Enter 导航、网格选择器——全部写成文本变换。MarkFlow 至今没有表格，侧面印证这是最重部分。**1.5–2 个月**
- 任务列表 checkbox 翻转 `[ ]`/`[x]` 并重渲染；块拖拽 = 文本 range 移动。**0.5–1 个月**
- 折叠反而更简单：CM6 原生 line hiding（epytor 现有 PM Decoration 折叠的映射迁移问题不需要了）
- 数学（KaTeX）：MarkFlow 也未做的第二个大缺口，LaTeX 源码 reveal 自带一层新映射

### H5 IME 与 undo —— 基本免费，只剩边角

- CM6 原生 composition + 原子事务 history，天然好于 PM
- 残余：composition 与 reveal 切换的边界、VS Code webview 内 input 层 undo 被 Electron 拦截（md-wysiwyg-editor 已知限制同款，可绕）
- **估时**：0.5–1 个月

### H6 epytor 存量功能移植审计

- **便宜的**：FindBar 正则（CM6 自带 search+正则）、Frontmatter 面板（编辑文本 range）、Mermaid 缩放/lightbox（DOM 覆盖层）、主题、外部文件同步
- **贵的**：表格全家桶、代码块语言选择、图片重命名/上传（后两者独立于编辑器，多数可复用）
- **估时**：0.5–1 个月审计，按清单取舍

---

## 六、工作量粗估

| 里程碑 | 范围 | 估时（单人全职） |
| :--- | :--- | :--- |
| MVP | 4 支柱 + 基础元素（MarkFlow Phase 1 水平） | 3–4 个月 |
| 「Typora 90%」 | + 表格、数学、H1/H2 打磨 | 9–12 个月 |
| 「Typora 100% 打磨感」 | 每个边角都丝滑 | 2 年+ |

- 难度定级：工程量大、细节坑深，但**无未知科学问题**；起点远好于 Typora 当年（CM5 时代装饰/视口都要自造，如今 CM6 免费提供）
- 风险定性：历史上死在这条路的项目都死在 H1/H2 胶水欠账

---

## 七、与 Milkdown 路线净对比

| 维度 | CM6（Typora 路线） | Milkdown（模型路线） |
| :--- | :--- | :--- |
| 保真 / 万行 / IME / undo | **碾压**（免费或近似免费） | 永久付费 |
| 结构化操作（表格、模型语义） | 永久付费 | **碾压**（epytor v1.2 批次二全靠它） |
| 语法可见性 | 天然（源码就是本体） | 装饰模拟，永远差一层 |

**一句话结论**：若「保真 + 流畅 + 源码感」是产品核心价值，CM6 路线长期更对；若「结构化操作丰富度」是核心，Milkdown 路线更对。两者无法兼得——事实源只有一个。

---

## 八、建议验证路径（风险前置，不做一锤子买卖）

1. **阶段 0（1–2 周）**：MarkFlow 代码审计 + 10k 行压测 + 表格缺口确认 → 决定 fork 它还是 clean-room 重写（MIT 协议下 fork 是合法捷径）
2. **阶段 1（4–6 周）**：补 reveal 状态机全元素 + H1 映射最小闭环，塞进 epytor 的 VS Code 壳里跑起来
3. **阶段 2（6–8 周）**：H2 增量解析 + 10k 行基准线
4. **阶段 3**：表格文本操作层
5. **每阶段设退出条件**：不达预期就回 Milkdown 路线，损失可控

---

## 九、待决策点

1. **epytor plus 定位**：仍是 VS Code 扩展（受 webview + 双编辑器共存约束），还是独立桌面应用（约束更少、更接近 Typora）？——影响 H5 与外部同步设计
2. **fork MarkFlow 还是 clean-room**：前者省 2–3 个月但吃它的架构决策，后者干净但慢
3. **是否立项**：本文仅存档研究结论；立项需另写实施 spec（需求范围、交互边界、验收标准）

---

## 附：证据与引用

| 引用 | 说明 | 核实方式 |
| :--- | :--- | :--- |
| [Typora Acknowledgement](https://support.typora.io/Acknowledgement/) | CodeMirror / morphdom / rangy 在列 | 2026-09-06 obscura-web 抓取（需代理） |
| [md-wysiwyg-editor README](https://github.com/git-xing/md-wysiwyg-editor) | 「基于 Milkdown（ProseMirror）」+ 行号映射已知限制 | 2026-09-06 web_fetch raw |
| [MarkFlow](https://github.com/pprp/MarkFlow) | CM6 inline decoration 复刻 Typora 创意，MIT | 2026-09-06 obscura-web 抓取 raw README |
| Milkdown 7.22.1 现状 | 上游限制 #2413/#2414/#2415 仍 open | epytor AGENTS 上游限制表（2026-09-05 验证） |

> 诚实性说明：Obsidian「核心团队数人、约一年做成 Live Preview」为公开信息口径，未经本文作者逐项核证；MarkFlow「点击渲染行取光标未达 Typora 级」为基于其 Phase 1 范围与 README 描述的推断，fork 前需实测确认。
