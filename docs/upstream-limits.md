# 上游限制（EPYTOR 无法自行修复）

以下限制来自 Milkdown / Crepe / ProseMirror 等上游依赖，以及 VS Code 的 webview 宿主行为，EPYTOR 无法自行修复。升级上游依赖 / 宿主版本时需逐项验证是否已解决。

> 最近验证：2026-09-13（Milkdown 7.22.1 / VS Code 1.137）——第 1、2、3、5 项对应的上游 issue 经 `gh` 复核**全部 open**（#2413 / #2414 / #2415 / #2475）；第 4 项是宿主行为，读数见下。
> **README 只镜像「用户能感知」的条目**（下表「用户可见」列）：用户看不到的内部细节留在本表，不进 README（README 里只在已知限制末尾留一句指向本文件的链接）。第 4 项（切标签闪一下）是宿主行为、扩展侧无法干预，owner 决定**不在 README 提**，本表保留读数作工程记录。

| # | 限制 | 用户可见 | 来源 | 追踪 |
|---|------|:---:|------|------|
| 1 | 行内样式（粗体、斜体、行内代码等）尾部无后续内容时无法退出 | ✘（**epytor 侧已解决**） | Milkdown | [Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413)（仍 open） — **已解决（2026-09-13 探针实测）**：段落末尾按 → 后 `storedMarks` 被清空，继续输入是普通文本；四类标记（strong / emphasis / strike_through / inlineCode）逐一验证。实现路径 = 自注册官方 cursor 插件 + vendored 虚拟光标（`webview/editor.ts`、`webview/vendor/prosemirrorVirtualCursor`）+ Milkdown 7.22.1 的 inlineCode `inclusive:false`。**升级 `@milkdown/*` 时必须复验**（回归断言 `webview/__tests__/inlineCodeArrowProbe.test.ts`、`upstreamRegression.test.ts`） |
| 2 | 有序列表多层级编号均为十进制（不区分 a.b.c. / i.ii.iii.） | ✔（显示层已 workaround） | Milkdown 内核 | [Milkdown#2415](https://github.com/Milkdown/milkdown/issues/2415) ／ [Milkdown#2475](https://github.com/Milkdown/milkdown/issues/2475)（已向上游提「把层级透出给 renderLabel」，2026-09-12） — **epytor 已有显示层 workaround（2026-09-12）**：`webview/listMarkerPlugin.ts` + `webview/listMarkers.css` 按层级重绘标记（`1.`/`a)`/`i.` 与 ●/■/◆ 三档循环，见 `docs/specs/2026-09-12-word-style-multilevel-markers.md`）。**升级 `@milkdown/*` 时必须复验**：workaround 依赖 Crepe 的 label 结构（`.label.ordered` / `.label.bullet` / `.label.checked`）与「装饰属性 + CSS 自定义属性」这一路径；若上游改为透出层级（例如 `listItemBlockConfig.renderLabel` 收到 depth），应改用它并删除本 workaround |
| 3 | 表格单元格单击进入编辑而不是选中整格 | ✘（**epytor 侧按设计改写**） | Crepe | [Milkdown#2414](https://github.com/Milkdown/milkdown/issues/2414)（仍 open） — epytor 的落点修正见 `webview/utils/cellClickState.ts`：单击 → 光标进格编辑，跨格/整行整列拖选仍保留多选；这是有意的交互选择，不再是已知限制（2026-09-13 从 README 已知限制中移除） |
| 4 | **保活 webview 切标签时「整块闪一下」**：激活初期屏幕上呈现的是**宿主**重绘的那一帧；页面侧贡献 0（对照实验：一个什么都不干的最小 webview 同样闪），扩展侧没有任何着力点 | ✘（owner 决定 README 不提） | VS Code webview 宿主 | [vscode#113188](https://github.com/microsoft/vscode/issues/113188)（ghost renders，2020 已关闭为 duplicate of #110450） — 平台行为，owner 决定不在 README 已知限制里提（2026-09-13）；本表与 `docs/audits/2026-09-11-tab-switch-flicker-measurement.md` 保留读数备查 |
| 5 | **复选框后不写内容的空任务项识别不了复选框**：`- [ ] `（标记后无内容）被解析成普通列表项，`[ ]` 留成正文文本（显示为「• [ ]」）；退格并项时这段文本还会漏进上一项；写回时 `[` 被转义，存成 `- \[ ]`（2026-09-13 实测） | ✔ | Milkdown / remark 任务列表解析 | 待提 issue（退格语义由 `webview/utils/listBackspace.ts` 按「实质为空」修正，渲染仍是上游行为） |

**第 4 项的实测口径**（2026-09-12，避免后人重复排查）：

* 真机逐帧（60fps 录屏，用户本人 VS Code 1.137）：切回 md 的屏幕序列是「内容（合成器留住的上一帧，约 230ms）→ 空（约 200ms）→ 内容」；
* 焦点时序（调试实例 + CDP，3 轮）：**鼠标点标签 / `Ctrl+PageDown` 时，焦点离开 webview 与 iframe 被撤尺寸在同一帧（0ms 空档）**；只有 `Ctrl+Tab`（MRU）有 135–160ms 空档 —— 所以「在被藏之前先把内容归成空」这类写法在鼠标路径上不成立；
* 对照实验（调试实例）：epytor（71KB 文档 / 314 块）激活后停留在 300×150 的时长 19/20/19ms，一个什么都不干的最小 webview 是 50/20/16ms —— **页面侧贡献 0，这段时长是宿主的**；实测台里整篇强制布局 0.6ms、加 `content-visibility` 也无量级改善；
* **两版宿主读数并不矛盾，各测一层**（2026-09-11 与 2026-09-12 两次取证的结论合并）：宿主侧能看到保活 iframe 被撤成 300×150（对照实验同上）；而页面侧在 VS Code 1.137 上**收不到 resize（0 次）、视口最小仍是 1047×712**，`html[data-epytor-host-collapsed]` 永不写入 —— 也就是说 `webview/style.css` 那整块折叠期守卫（滚动锚定 / 滚动条 / 顶栏与正文宽度钉定 / backdrop-filter / 固定 UI 不画）在 1.137 上**一行都不生效**，只为仍会摘挂 iframe 的旧宿主（1.136 实测 300×150）保留。内层结论（2026-09-11 品红标记逐帧实验）：**折叠期内层画什么都不会上屏**，历次「空白 / 正文裁切 / 冻结版式」的取舍都不改变屏幕结果。详见 `docs/audits/2026-09-11-tab-switch-flicker-measurement.md`；
* 因此扩展侧能做的只有「折叠期把那一小块画成纯背景」（`html[data-epytor-host-collapsed] body { visibility: hidden; opacity: 0 }`，opacity 必须——子元素的 `visibility: visible` 会翻回继承的 hidden），且仅在旧宿主上有意义；要彻底没有这一帧，只能 `retainContextWhenHidden: false`（宿主新建 iframe 时尺寸已正确），代价是切回要重建编辑器、状态需跨重建快照恢复——**已定案不采用**（2026-09-12，保活是正式架构）。

**已解决的历史条目**（按维护规则从表中移除，留档备查）：

* [Milkdown#2451](https://github.com/Milkdown/milkdown/issues/2451) 行内代码 mark 改为非 inclusive —— 7.22.1 已修，自动化断言见 `webview/__tests__/upstreamRegression.test.ts`；
* [Milkdown#2463](https://github.com/Milkdown/milkdown/issues/2463) 加载时保留单元格内手写 `<br>` —— 上游已 closed；epytor 侧仍有闭环 workaround（`convertTableBrForDisplay` + `withTableBreakHandler`），**下次升级 `@milkdown/*` 时复验能否回收**。

> 自动化回归断言只覆盖「可自动化」的部分（行内代码 mark 的 inclusive、列表编号重排），其余条目仍需手测，见 `webview/__tests__/upstreamRegression.test.ts` 文件头。
