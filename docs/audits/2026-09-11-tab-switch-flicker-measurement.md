# 非 md → md 切换「闪动」真机复测（2026-09-11）

> 目的：把「切回 md 标签会闪」这件事从**猜测**变成**可复现的读数**，并据此判断还有没有可优化的着力点。
> 结论先行：**在用户当前这台机器上（VS Code 1.137.0），折叠期几何守卫一次都没生效过；折叠期内层画什么都不会上屏；真正上屏的是宿主重新上屏 webview 期间的「部分光栅化」画面，稳态 1–2 帧（9–40ms），webview 首次创建时是 1.5s 全空。** 详见下文逐条证据。

## 1. 复现装置

工作台是套 Electron 应用，webview 的 iframe 藏在 shadow root 里、并且是独立渲染进程：外层 `document.querySelectorAll('iframe')` 抓不到它（返回 `[]`），`Target.setAutoAttach` 抓到的 `vscode-webview://` 目标其实是 service worker（`Page.enable` 报 "wasn't found"），`Runtime.executionContextCreated` 里也没有它的上下文。因此**内层探针只能由我们自己注入**——本次用的是「把读数画在页面上」这一招（临时补丁，已还原）。

| 装置 | 作用 |
| :--- | :--- |
| `_poc/TEMP/vscode-flash-probe.mjs` | 起真实 VS Code（`--extensionDevelopmentPath`）→ 外层 `Page.startScreencast` 逐帧 PNG + 每帧 PTS；驱动切标签；窗口拉到前台 |
| 内层探针（临时写进 `viewportLedger.ts`） | 把「守卫命中次数 / resize 事件次数 / 见过的最小视口 / tinyReal 标记 / 最近一次折叠与非折叠读数」画成一个 `position:fixed` 徽标，靠截屏读回来 |
| 折叠期品红标记（临时写进 `style.css`） | `html[data-epytor-host-collapsed] body::before { position:fixed; inset:0; background:#ff00ff }` —— 折叠期内层只要上屏就一定是品红 |
| `_poc/TEMP/framelist.mjs` / `firstframe.mjs` / `rounds.mjs` | 逐帧非底色像素占比、与参考帧的逐像素差异、按轮统计空白帧 |
| `_poc/TEMP/vscode-flash-record.mjs` | 试过 ffmpeg gdigrab 录真实桌面；本机桌面捕获恒为全黑（会话不可见），已弃用，改用 CDP screencast |

复现参数：`window.zoomLevel: 0.17`、`workbench.sideBar.location: right`、辅助栏（Chat）收起、窗口页 1395×826 CSS px、编辑区 webview 视口 **1047×712**、文档 `_poc/TEMP/probe-ws/user-test.md`（71.5KB，即 `docs/checklists/2026-09-08-simplification-batch.md`）。

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

### 2.3 真正上屏的是「部分光栅化」的过渡帧

以 `probe-focus` 为例（每轮点击后逐帧非底色像素占比，全编辑区）：

| 轮次 | 帧序列（相对点击 md 的时刻） |
| :--- | :--- |
| 1（md webview **首次创建**） | `34ms 0.23%` … `1556ms 0.23%` → `1615ms 26.95%`（**1.5s 全空**） |
| 2（保活热路径） | `58ms 1.06%` → `73ms 26.95%`（**1 帧空**，约 15ms） |
| 3（保活热路径） | `113ms 26.97%` → `142ms 1.07%` → `151ms 26.97%`（**内容出来之后又空 1 帧**，约 9ms） |

逐像素核对：第 3 轮的 `f-0138`(+113ms) 与 `f-0140`(+151ms) **差异 0.01%**（仅 x[130,131] y[206,228] 两个像素列），即两张都是终稿；夹在中间的 `f-0139`(+142ms) 只有顶栏 + 标题左半截（`y204-225 x[130,335]`）——典型的**光栅化只画了一部分**。热路径因此是「完整 → 半张 → 完整」的一次眨眼。

对照组：`probe-wide`（编辑区 1047 宽）轮 2 是 `74ms 空 → 84ms 全文`；`probe-noblur`（去掉顶栏 `backdrop-filter`）轮 2 是 `87ms/96ms 两帧空 → 107ms 全文`。**去掉 backdrop-filter 没有改善**，说明不是它。

### 2.4 顺带排除的假设

| 假设 | 结论 |
| :--- | :--- |
| 折叠期「正文按 300px 折行的小框」 | **否**。见 2.1：视口从未变过；2.2：折叠期画面不上屏 |
| 折叠期「整块隐藏 → 一片空白」 | **否**。同上，折叠期画什么与屏幕无关 |
| 顶栏 `backdrop-filter` 推迟首帧 | 去掉后空白帧数没有下降（2 帧 vs 1–2 帧，属噪声） |
| 窗口没有前台焦点导致 VS Code 推迟 webview 加载 | **否**。加 `AppActivate` 拉前台后 1.5s 冷启动照旧 |
| 内容先窄后宽（重排） | **否**。这是我看帧拼图时的误判；`rowprofile` 逐行比对显示两侧帧完全一致 |

## 3. 判断

* **切标签这条路径已经到宿主地板**：屏幕上出现什么完全由宿主「重新上屏 webview → 光栅化」决定，webview 内没有任何着力点——不显示时内层根本不参与渲染（`rsz=0` 就是证据：连 resize 都不派发），显示时那一帧是不是画得完也与内层无关。稳态残余 1–2 帧（9–40ms）。
* **唯一量到的「严重」是 webview 首次创建的 1.5s 全空**：启动时 md 标签没被激活（或「切源码 → 切回预览」重建 webview）时，点回来要等约 1.5s 才有内容。这与折叠守卫无关，是 Milkdown 冷启动（2MB bundle 加载解析 + 70KB 文档构建）的代价。
* 因此：**用户侧「改了这么多版还是没变化」是必然的**——这几版改动全部落在一条从不执行的路径上。

## 4. 待决

1. 折叠守卫还要不要留：它在 1.137 上不生效，只为仍会摘挂 iframe 的旧宿主（1.136）保留；留着是纯维护成本，删掉会丢旧宿主的行为。**需要 owner 定。**
2. 1.5s 冷启动要不要治：这是目前唯一可复现的「严重」项，但属性能工程（bundle 体积 / 首次渲染），不是“闪动”修复。**需要 owner 定优先级。**
3. 若用户侧仍能看到更严重的闪动，那必然是本次环境复现不到的另一种触发条件——最有效的下一步是拿一段**高帧率屏幕录制**（Win+Alt+R）来逐帧定位，而不是继续盲猜。
