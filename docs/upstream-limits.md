# 上游限制（EPYTOR 无法自行修复）

以下限制来自 Milkdown / Crepe / ProseMirror 等上游依赖，以及 VS Code 的 webview 宿主行为，EPYTOR 无法自行修复。升级上游依赖 / 宿主版本时需逐项验证是否已解决。

> 最近验证：2026-09-05（Milkdown 7.22.1）——1–3 仍全部 open，未解决；自动化回归断言见 `webview/__tests__/upstreamRegression.test.ts`。
> 2026-09-12 追加第 4 项（宿主行为，含真机逐帧 + 对照实验读数）。

| # | 限制 | 来源 | 追踪 |
|---|------|------|------|
| 1 | 行内样式（粗体、斜体、行内代码等）尾部无后续内容时无法退出 | Milkdown | [Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413) |
| 2 | 有序列表多层级编号均为十进制（不区分 a.b.c. / i.ii.iii.） | Milkdown 内核 | [Milkdown#2415](https://github.com/Milkdown/milkdown/issues/2415) |
| 3 | 表格单击选中整格暂时关闭 | Crepe | [Milkdown#2414](https://github.com/Milkdown/milkdown/issues/2414) |
| 4 | **保活 webview 切标签时「整块闪一下」**：隐藏期间宿主把 webview 的 iframe 撤成规范默认 300×150（实测对照：一个什么都不干的最小 webview 也一样），激活后再重设回真实尺寸；那一帧里受影响的编辑区只有 `编辑区左缘 + 300px` 属于我们，其余是宿主底板 | VS Code webview 宿主 | [vscode#113188](https://github.com/microsoft/vscode/issues/113188)（ghost renders，2020 已关闭为 duplicate） |

**第 4 项的实测口径**（2026-09-12，避免后人重复排查）：

* 真机逐帧（60fps 录屏，用户本人 VS Code 1.137）：切回 md 的屏幕序列是「内容（合成器留住的上一帧，约 230ms）→ 空（约 200ms）→ 内容」；
* 焦点时序（调试实例 + CDP，3 轮）：**鼠标点标签 / `Ctrl+PageDown` 时，焦点离开 webview 与 iframe 被撤尺寸在同一帧（0ms 空档）**；只有 `Ctrl+Tab`（MRU）有 135–160ms 空档 —— 所以「在被藏之前先把内容归成空」这类写法在鼠标路径上不成立；
* 对照实验（调试实例）：epytor（71KB 文档 / 314 块）激活后停留在 300×150 的时长 19/20/19ms，一个什么都不干的最小 webview 是 50/20/16ms —— **页面侧贡献 0，这段时长是宿主的**；实测台里整篇强制布局 0.6ms、加 `content-visibility` 也无量级改善；
* 因此扩展侧能做的只有「折叠期把那一小块画成纯背景」（`html[data-epytor-host-collapsed] body { visibility: hidden; opacity: 0 }`，opacity 必须——子元素的 `visibility: visible` 会翻回继承的 hidden），抑制到此为止；要彻底没有这一帧，只能 `retainContextWhenHidden: false`（宿主新建 iframe 时尺寸已正确），代价是切回要重建编辑器、状态需跨重建快照恢复。
