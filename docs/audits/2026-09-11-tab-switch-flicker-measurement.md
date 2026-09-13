# 非 md → md 切换「闪动」真机复测（2026-09-11）

> 目的：把「切回 md 标签会闪」这件事从**猜测**变成**可复现的读数**，并据此判断还有没有可优化的着力点。
>
> **结论（第二版，已推翻第一版的乐观结论）**：
> 1. 折叠期几何守卫在 VS Code 1.137.0 下**一次都没生效过**（resize 0 次、视口最小 1047×712、判定命中 0 次）；折叠期内层画什么**都不上屏**（品红标记一帧都找不到）。历次围绕折叠期的改动全部落在死路径上。
> 2. **用户看到的是真的、而且比隔离复现严重得多。** 在**用户本人这台 VS Code**（不是我们另起的调试实例）上真机录屏逐帧看：点/按到 md 标签之后，编辑区有 **520–620ms** 是不对的（还停在上一个标签的内容，或者 md 出现了但顶栏是空的/旧的），到 **+620ms** 才变成终稿。隔离复现（轻量邻居标签 + 干净 profile）只有 1–2 帧，**低估了 30 倍**，第一版据此写下的「已到宿主地板」不成立。
> 3. 严重程度取决于**邻居标签与整体负载**：本机实测「md ↔ md」两帧即终稿（0 帧过渡），而「DSH webview ↔ md」和用户环境是 500–600ms。下一步必须按用户环境复现并定位那 620ms。

## 1. 复现装置

工作台是套 Electron 应用，webview 的 iframe 藏在 shadow root 里、并且是独立渲染进程：外层 `document.querySelectorAll('iframe')` 在只开一个 md 时抓不到它（返回 `[]`），`Target.setAutoAttach` 抓到的 `vscode-webview://` 目标其实是 service worker（`Page.enable` 报 "wasn't found"），`Runtime.executionContextCreated` 里也没有它的上下文。因此**内层探针只能由我们自己注入**——本次用的是「把读数画在页面上」这一招（临时补丁，已还原）。

| 装置 | 作用 |
| :--- | :--- |
| `_poc/TEMP/screen-record-now.mjs` | **真机录屏**：聚焦用户自己的 VS Code 窗口 → `ffmpeg gdigrab` 60fps 录整屏 → 鼠标点标签切走/切回若干轮（`screen-record-kbd.mjs` 是键盘 `Ctrl+PgUp/PgDn` 版） |
| `_poc/TEMP/screen-vs-ref.mjs` | 以每轮稳态帧为参考，逐帧打印「与终稿差异%」「墨迹%」与差异包围盒 |
| `_poc/TEMP/vscode-flash-probe.mjs` | 起独立 VS Code（`--extensionDevelopmentPath`）→ 外层 `Page.startScreencast` 逐帧 + 内层读数；窗口拉到前台 |
| 内层探针（临时写进 `viewportLedger.ts`） | 把「守卫命中次数 / resize 次数 / 见过的最小视口 / tinyReal 标记 / 最近两次读数」画成 `position:fixed` 徽标，靠截屏读回 |
| 折叠期品红标记（临时写进 `style.css`） | `html[data-epytor-host-collapsed] body::before { position:fixed; inset:0; background:#ff00ff }` |
| `_poc/TEMP/vscode-flash-2md.mjs` | md ↔ md 双标签对照（把邻居换成另一个 webview） |

隔离复现参数：`window.zoomLevel: 0.17`、侧栏在右、辅助栏（Chat）收起、窗口页 1395×826 CSS px、webview 视口 **1047×712**、文档 `_poc/TEMP/probe-ws/user-test.md`（71.5KB，即 `docs/checklists/2026-09-08-simplification-batch.md`）。

真机参数：用户自己的 VS Code 1.137.0，1440×900 屏、窗口最大化（-7,-7)–(1446,858），两个标签：DSH 面板（webview）+ 上面那份 md。

## 2. 证据

### 2.1 折叠判定一次都没命中（`on=0`）

3 轮「切到 .txt → 切回 md」之后，内层徽标读回：

```
on=0  rsz=0  min=1047x712  tinyReal=0  lastOn=never  lastOff=1047x712
```

* `on` = `isHostCollapsedViewport()` 命中次数 = **0**；
* `rsz` = `window` 的 `resize` 事件次数 = **0**（整场会话，含 3 轮切走/切回）；
* `min` = 记账见过的**最小视口** = **1047×712**，从没掉到过 300×150。

即：**VS Code 1.137.0 不再把 webview 容器摘出布局**，`html[data-epytor-host-collapsed]` 永不写入，`style.css` 里整块折叠期守卫（滚动锚定 / 滚动条 / 顶栏与正文宽度钉定 / backdrop-filter / 固定 UI 不画）在这版宿主上**一行都不生效**。1.136 时代实测到的 300×150 假视口已不复现——这也解释了为什么围绕折叠期的几版改动（`6989ae3` / `513a596` / `a651345` / `73767b6`）用户侧都看不出差别。

### 2.2 折叠期内层画的东西不上屏

把折叠期整个视口涂成 `#ff00ff`（已确认该规则进了产物 `dist/webview.css`）后逐帧回放，**一帧都找不到品红**（`_poc/TEMP/probe-mag/`）。也就是说：历次在「空白 / 正文裁切 / 冻结版式」之间的取舍，**都不改变屏幕上出现什么**。

### 2.3 真机：编辑区有 520–620ms 是错的（**用户是对的**）

键盘切换（`Ctrl+PageDown`，`screen-kbd` 第 1 轮，`screen-vs-ref.mjs` 口径）：

| 相对按下的时刻 | 与终稿差异 | 编辑区内容 |
| :--- | :--- | :--- |
| −113 … +520ms | 36.05% | **仍是上一个标签（DSH）的画面** |
| +537 … +587ms | 9.31%（差异区 `y[110,218]`） | md 出现了，但**顶栏那一条是空的**（截图为证：面包屑下面的工具栏整条没画） |
| +620ms 起 | 0.00% | 终稿 |

鼠标切换（`screen-now` 第 2 轮）：md 在 +55ms 就出现，但**顶栏那一条是旧的**（还停着一个上一轮的路径选择浮层），差异区 `x[388,1080] y[158,308]`；到 **+623ms** 才归零。第 1 轮更明显：+55…+505ms 停在文档靠前的位置（差异区覆盖整个正文 `y[320,834]`），+539…+705ms 跳动，**+739ms** 归零。

两种切换方式、两个不同轮次，**最后一次变化都落在 +620～+740ms**；而内容出现的时刻差 480ms。这个「结束时刻固定、开始时刻浮动」的形状指向一个**从标签激活起算的定时器**（600ms 量级），而不是纯粹的光栅化抖动。

### 2.4 隔离复现为什么只有 1–2 帧

| 场景 | 切回后过渡 |
| :--- | :--- |
| 独立实例 + `.txt` 邻居（`probe-focus`） | 1–2 帧（9–40ms） |
| 独立实例 + `md` 邻居（`vscode-flash-2md.mjs`） | **0 帧**（首帧差异 0.01%） |
| 用户真机 + DSH webview 邻居 | **520–620ms** |

所以过渡长度由**邻居标签与整体负载**决定；轻量邻居下的读数不能代表用户环境。

### 2.5 顺带排除的假设

| 假设 | 结论 |
| :--- | :--- |
| 折叠期「正文按 300px 折行的小框」 | **否**。见 2.1 / 2.2 |
| 折叠期「整块隐藏 → 一片空白」 | **否**。同上 |
| 顶栏 `backdrop-filter` 推迟首帧 | 去掉后空白帧数没下降（属噪声） |
| 窗口没有前台焦点导致 VS Code 推迟 webview 加载 | **否**。`AppActivate` 拉前台后 1.5s 冷启动照旧 |
| 内容先窄后宽（重排） | **否**。`rowprofile` 逐行比对显示两侧帧完全一致，是看拼图时的误判 |
| 桌面录制不可用 | **否**（第一版结论错误）。`ffmpeg gdigrab` 一开始录到全黑是当时桌面取不到（会话不可见），后来同一命令正常，真机录屏因此可用 |

## 3. 代码里的两条具体线索（未定论）

按「600ms 量级、从激活时刻起算」这条线，`webview/index.ts` 里有两个候选：

1. `INITIAL_VIEWPORT_LINE_REPORT_DELAY_MS = 600`（`index.ts:83`，用于 `setTimeout(reportViewportLine, ...)`，`index.ts:966`）——只在生命周期（init）路径上跑。
2. `SCROLL_RETRY_DELAYS_MS = [0, 250, 500, 750, 1000, …]`（`index.ts:78`）——`applyPendingScrollLine` / `scheduleDelayedScroll` 的重试梯；其中 **500ms 那一档**与观测到的「+539…+739ms 内容跳一下」在时间上吻合。
3. 扩展侧 `_registerViewStateHandler`（`MarkdownEditorProvider.ts:419-424`）在**面板激活**时按「显式导航 > 全局兜底 > 文本编辑器上次视口行」三级取一个行号并发 `scrollToLine`；在保活下 webview 根本没重建、滚动位置本来就对，这条消息一旦发出就会把已正确的视口推走。

**尚未定论**：这三条都只在特定条件下触发，我还没有把它们与用户环境里的 620ms 对上（缺少内层时间线——真机里跑的是用户安装的扩展，注入不了探针）。要定论必须按用户环境复现（DSH webview 作邻居 + 同一份文档 + 同一套扩展），再注入内层记账。

## 4. 待办

1. **按用户环境复现**：邻居标签换成重型 webview，复现 520–620ms，然后注入内层探针，确认那 620ms 里内层跑了什么（上面三条线索逐条验证）。
2. 折叠守卫的去留：它在 1.137 上不生效，只为仍会摘挂 iframe 的旧宿主（1.136）保留；留着是维护成本，删掉会丢旧宿主行为。**需要 owner 定。**
3. webview 首次创建的 1.5s 全空（Milkdown 冷启动）是否要治：属性能工程，**需要 owner 定优先级。**
