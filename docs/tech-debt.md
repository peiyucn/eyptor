# 技术债务

> 面向开发者的代码质量改进清单，不涉及用户可见功能变更。
> 最后更新：2026-09-11

***

## 待处理

### 🔴 高优先级（影响面大，独立处理）

（无待处理项）

### 🟡 中优先级（每次改一点）

* [ ] **代码块全屏按钮注入** — MutationObserver 改为 Crepe NodeView 扩展
* [ ] **CodeMirror 主题补配** — MutationObserver 改为 Compartment 初始化时传入
* [ ] **溢出菜单与官方 Vue 渲染的耦合点**（2026-09-04 新增，`components/topBarOverflow`）— ① 隐藏 class 依赖 MutationObserver 自愈（Vue patch 覆盖）② 按钮 meta 与官方 DOM 渲染顺序对齐（官方渲染顺序变更需同步）；上游 topBar 提供 item key 或 overflow 能力后移除
* [ ] **index.ts 剩余职责**（2026-09-08 审计）— 图片请求编排/滚动持久化/链接行为仍在入口文件，可再提 `linkBehavior`/`scrollPersistence` 模块（本轮已提取 codeBlockEnhance 与 topBarDecorations）
* [ ] **折叠光标进出防护**（2026-09-08 审计，需手测确认）— 折叠后方向键能否把光标移入 display:none 的隐藏块并不可见输入，jsdom 无法验证；实测可达则补方向键拦截
* [ ] **非激活面板的保存不拉取（`_panelActive` 闸门，2026-09-11 清账登记）** — 保活下非激活面板其实还活着、多半能回包，但 `_requestContent` 仍按保守口径短路，用 `_pushedContent`（最陈旧 400ms）或扩展内存内容落盘。README「停手后约 400ms 内切走标签，最后一次改动不会写入文件」正来自这条路径（失活落盘在置 `_panelActive=false` 之后触发）。放开闸门能否消除该窗口需真机验证：切标签 → 等自动保存 → 核对文件内容与 webview 内容是否一致；未验证前不改行为（回归 a4349cc 曾因等待不存在/未就绪的 webview 报「编辑器无响应」）

***

## 已清偿

### 🔴 高优先级

* [x] **`resolveCustomEditor` 拆分**（2026-09-05）— 336 行提取为 `_registerPanelDisposeCleanup` / `_registerViewStateHandler` / `_handleWebviewMessage` / `_handleOpenFileMessage` / `_registerFileWatcher` 五个私有方法，行为零变化
* [x] **`setupSelectionToolbar` 拆分** — 提取 `createFormatDropdown` / `createAlignmentDropdown` / `createTableDeleteButtons` 三个模块函数（554→277 行）
* [x] **selectionToolbar 整体删除**（2026-09-04）— 官方 `feature/toolbar` 替代后遗留死代码（813 行 + 95 CSS + 7 个孤儿图标），连同空实现 `headingIds.ts` 一并清理（-1025 行）
* [x] **`initToc` 拆分** — 提取 `getHeadings` / `findHeadingElement` / `hasChildren` / `isHeadingVisible` 到模块级（406→338 行）
* [x] **`createImageView` 拆分** — 提取 `startToolbarInlineEdit` 通用内联编辑辅助，消除 `startCaptionEdit`/`startSrcEdit` 重复（~80 行共用），同步修复路径解析不存在的文件产生畸形 URL
* [x] **魔法数字常量化** — 新增 `shared/constants.ts`，提取 25 个命名常量，替换 ~55 处硬编码数字
* [x] **`buildTopBar` 类型安全与拆分** — 移除 14 处 `as any` 后，2026-09-08 审计又发现 8 处 any 与 290 行巨型回调；已提取 `components/topBar/buildTopBar.ts`（类型从官方 TopBarFeatureConfig 推导，8 any 全清）
* [x] **折叠期守卫真机复测：本版宿主下守卫从不生效，且折叠期内层画的东西不上屏**（2026-09-11，VS Code 1.137.0）— 用「外层 `Page.startScreencast` 逐帧 + 内层探针把读数画在页面上」两条线同时取证（`_poc/TEMP/vscode-flash-probe.mjs`）：**①** 3 轮「切走 → 切回」期间 webview 只收到 resize 事件 **0 次**、记到的视口最小仍是 **1047×712**、折叠判定（`isHostCollapsedViewport`）命中 **0 次** —— 本版宿主已不把 webview 容器摘出布局，`html[data-epytor-host-collapsed]` 永不写入，`style.css` 那整块折叠期守卫（滚动锚定 / 滚动条 / 顶栏与正文宽度钉定 / backdrop-filter / 固定 UI 不画）在本版宿主上**一行都不生效**，只为仍会摘挂 iframe 的旧宿主（1.136 实测 300×150）保留；**②** 把折叠期整个视口涂成品红（`html[data-epytor-host-collapsed] body::before`，已确认该规则进了产物 `dist/webview.css`）后逐帧回放，**一帧都找不到品红** —— 折叠期内层画什么都不会上屏，历次「空白 / 正文裁切 / 冻结版式」的取舍都不改变屏幕结果。**③** 用户实际看到的是宿主重新上屏 webview 之前的**空画面**（整个编辑区连顶栏一起无内容），稳态 **1–2 帧（约 10–40ms）**；另有一次 1615ms 的记录，经查是「md 编辑器在启动时从未真正上屏、切回才是它第一次加载」，属测量装置自身的冷启动，不是切标签开销。**结论**：切标签这条路径上，webview 内没有任何可再优化的着力点（画面不由内层决定）；后续若要继续压，只能从宿主侧（升级 / 上游 issue）走。**
* [x] **保活架构定案 + 折叠期机制清账**（2026-09-11，提交 `3aebc39` + `4b21977`，判据于 `a651345` 修正）— `retainContextWhenHidden: true` 是**正式架构**（切标签不销毁、不重建：撤销/重做历史、滚动位置、折叠状态、选区自然保留）；折叠期不隐藏正文（2026-09-11 追加的第 6 条只让固定 UI 不画、正文照常显示）、不冻结版式，守卫统一挂在 `<html data-epytor-host-collapsed>` 上（滚动锚定 / 滚动条 / 顶栏与正文宽度钉定 / backdrop-filter / 固定 UI 不画，见 `webview/style.css` 的「折叠期几何守卫」）。**判据必须是 JS 记账属性而非媒体查询**：Chromium 的媒体查询按窗口缩放后尺寸求值，`window.zoomLevel ≠ 0` 的机器上 `@media (width:300px) and (height:150px)` 在 `innerWidth=300` 时不匹配，曾使整块守卫静默失效（**注**：见上一条，本版宿主下该守卫整体不生效，判据正确性只在旧宿主上有意义）。`webview/utils/viewportFreeze.ts`（冻结状态机、`epytor-viewport-frozen/-shrunk`、折叠期 `body{visibility:hidden}`）已删除，由 `webview/utils/viewportLedger.ts`（折叠识别 + 折叠期外实测 body 宽度 → `--epytor-last-body-width` + `HOST_COLLAPSED_ATTRIBUTE`）取代。**销毁时代机制逐条 grep 复核后全部保留**——保活只取消了「切标签销毁」这一条路径，关标签 / 窗口重载 / 切源码再切回 / revert 重建实例仍在：`_pushedContent`+`unsavedContent`+`scheduleContentPush`（重建时恢复内容、问不到 webview 时兜底保存）、`_panelActive`（等不等回包的保守闸门，见「待处理」）、`_webviewDirty` / `_initializedPanels`、失活落盘、`restoreFoldState` + 折叠持久化（revert 与窗口重载两条路径）、init 滚动恢复。说谎注释（原话建立在 `retainContextWhenHidden:false` 上）已按新架构改写，现存职责写在各机制注释里
* [x] **顶栏溢出 resize 监听器未释放**（2026-09-11）— `components/topBarOverflow/index.ts` 的 `dispose()` 里 `removeEventListener("resize", schedule)` 与注册的 `scheduleUnlessCollapsed` 不是同一引用，监听器不释放（每次编辑器重建泄漏一个；切源码再切回、revert 都会走到）；已修 + 回归测试（修复前失败）
* [x] **2026-09-08 全面审计修复（33 项）** — 3 critical（保存拉取单槽竞态/外部写盘不采纳/frontmatter 丢行）+ 22 major + 8 minor/nit：状态机化（ExpiryWindowMap 抑制窗口/ContentRequestCoordinator 单飞队列/消息串行链/滚动定位合一）、生命周期（themeBus 退订/destroyEditor/NodeView.destroy/防抖 timer 释放）、安全（配置净化/URL 白名单/路径边界/大小上限/错误脱敏/保留设备名）、性能（折叠双指针/吸顶 posAtDOM/滚动节流/查找封顶）、抽象（补全核心合并/请求注册表/index.ts 拆分）、死代码（-500+ 行）、文档与测试对齐（i18n 一致性测试/l10n 同步/覆盖率底线编码/CHANGELOG 行为级改写）；详见 `docs/audits/2026-09-08-full-code-audit.md`

### 🟡 中优先级

* [x] **下拉补全重复** — `pathComplete` / `imgPathComplete` → 提取 `closeDropdown`/`updateActiveItem` 到 `ui/dropdownComplete.ts`（~40 行重复消除）；2026-09-08 进一步提取 `ui/pathCompleteCore.ts`（渲染+键盘导航合一）；同日审计发现「剩余镜像全清」不成立——**请求生命周期**（id 生成 + pending Map + 超时清理）仍是两套手写实现，已统一到 `utils/pathSuggestionRequests.ts` 单一注册表（详见 `docs/audits/2026-09-08-overcomplexity-audit.md` P4/C4）；「防抖/过期守卫/关闭时机」因触发源与语义不同保留两份
* [x] **确认/取消编辑重复** — `startCaptionEdit` / `startSrcEdit` → 提取 `startToolbarInlineEdit` 到 `imageView/index.ts` 模块级
* [x] **顶栏 P 下拉菜单不显示** — `.top-bar-inner` 的 `overflow: hidden` 裁剪了 Crepe heading dropdown；改为 `overflow: visible` 并补充 CSS 回归测试
* [x] **空 catch 块**（12 处）— 已全部添加描述性注释（4 处已有充分注释未改，8 处补充）
* [x] **真实 300×150 被误判为宿主折叠**（2026-09-11）— 折叠判定只看「视口恰为 300×150」，用户真把编辑区缩到该尺寸时被当成宿主摘挂：顶栏按上次真实宽度钉住而溢出、视口测量被跳过。加回**基于用户输入**的区分（pointerdown / wheel / keydown / touchstart → `data-epytor-tiny-real`，尺寸离开 300×150 即清除；**不看计时**——计时版曾在宿主折叠期被打上标记，切回来「出现-消失-再出现」），只影响顶栏/正文钉定与记账（折叠期固定 UI 不画与正文版式钉定是另一条独立守卫）

### 配置项检修

* [x] **配置面收敛（2026-09-10 结论）**：v1.1.6 的 **14 项 → 7 项**（另有 4 个已弃用键仅作兜底，带 `deprecationMessage`，VS Code 设置面板默认隐藏）。
  * ~~`autoSave` / `autoSaveDelay`~~ — 2026-09-07 移除：自动保存改用 VS Code 原生 `files.autoSave`（拉取式保存架构）
  * ~~`defaultMode`~~ — 2026-09-10 移除：默认打开方式交回 VS Code 官方入口（打开方式… → 为 `*.md` 配置默认编辑器），扩展不再改写 `workbench.editorAssociations`
  * ~~`debugMode`~~（连命令 `epytor.toggleDebugMode`）— 2026-09-10 移除：调试日志管线整体下线
  * ~~`fontFamily`~~ — 2026-09-10 移除：编辑器字体统一跟随 VS Code 编辑器字体（`--vscode-editor-font-family`），保留 `--custom-font-family` 作为自定义 CSS 覆盖位
  * ~~`imageSelectionColor`~~ — 2026-09-10 移除：图片选中边框改用 VS Code 主题色（`--vscode-list-activeSelectionBackground`）
  * `markdown.serializationMode` → **改名** `serializationMode`（该键从未发布，零迁移成本；读取点与广播表同步）
  * `imageServerUrl` / `imageServerFieldName` / `imageServerExtraParams` / `imageServerResponsePath` → **合并**为对象 `imageServer`：解析集中在 `utils/imageServerConfig.ts` 纯函数（新键优先、旧键逐字段兜底，只读不改写 settings.json）；`extraParams` 由 JSON 字符串改为真正的 object，值仅接受字符串/数字/布尔，类型不对或出现嵌套给**用户可见**本地化警告；`fieldName` 走白名单 `^[A-Za-z0-9_.-]+$`（非法回退 `file`）；key/value 剥 CRLF 与引号
  * **实际生效 7 项**（逐项确认有消费方，无死配置）：`tableWrapMode`（2026-09-07 新增）/ `codeBlockMaxHeight` / `editorMaxWidth` / `serializationMode` / `imageStorage` / `imageLocalPath` / `imageServer`
    * `tableWrapMode` / `codeBlockMaxHeight` / `editorMaxWidth` → 注入 :root CSS 变量，且**配置变更实时广播**（`extension.ts` 的 `CONFIG_BROADCASTS` 表驱动 + `webview/utils/{tableWrap,layoutVars}.ts`）
    * `serializationMode` → WebView 序列化模式（init 载荷 + 变更广播）
    * `imageStorage` / `imageLocalPath` / `imageServer` → `imageService.ts` 图片保存/上传（目录解析与越界判定抽到 `utils/imageLocalDir.ts`，写入与图库列举两处共用）
  * **分组与排序**（2026-09-10）：`contributes.configuration` 由单节改为数组——*epytor*（tableWrapMode → codeBlockMaxHeight → editorMaxWidth → serializationMode）与 *epytor › 图片*（imageStorage → imageLocalPath → imageServer，随后 4–7 为弃用旧键）；分组标题走 nls（`config.group.images`）
  * **数值口径**：`codeBlockMaxHeight` / `editorMaxWidth` 的 schema `minimum`/`maximum`（100–10000 / 400–10000）与运行时 `sanitizeCssNumber(value, fallback, min, max)` 同一口径，越界一律回退默认值

### 测试补齐

* [x] **`webview/utils/themeBus.ts`** — `isDark()` / `onThemeChange()` 已补 jsdom 测试，行覆盖率 100%
* [x] **`webview/i18n/index.ts`** — `t()` / `kbd()` Mac/Win 分支已补测试，行覆盖率 100%
* [x] **`src/MarkdownDocument.ts`** — 已补 `saveAs` 取消与 `dispose` 边界，行覆盖率 100%
* [x] **`src/utils/imageService.ts`** — 已补目录读取失败、非文件目录项与上传超时边界，行覆盖率 100%

***

## 暂缓处理

以下项目已识别但当前不紧急，择机处理。

### 🔴 上游 workaround

* [ ] **切标签「整块闪一下」= 宿主行为，扩展侧抑制已到顶**（2026-09-12 查清）— 结论与全部读数见 [`docs/upstream-limits.md`](upstream-limits.md) 第 4 项。要点：① 隐藏期间宿主把保活 webview 的 iframe 撤成 300×150、激活后重设（对照实验：一个什么都不干的最小 webview 同样如此，页面侧贡献 0ms）；② 鼠标路径上「焦点离开」与「撤尺寸」**同帧**（0ms 空档），所以 `blur` / `panelActiveState` 驱动的「提前归空」不可能生效——本会话一度照这个思路实现过，副作用是「点一下标签就闪一次」，已拆（`5fee083`）；③ 折叠期只能画那 300×150，已改为**纯背景**（`visibility: hidden` + `opacity: 0`；opacity 必须，否则子元素的 `visibility: visible` 会翻回继承的 hidden，屏幕上残留「孤零零一个目录面板」）。
  **loading 盖不住它**（2026-09-12 定论）：loading 能治的是「过渡时画布归谁」，而保活下那一帧的画布不归我们——实测切换帧里属于我们的只有 `编辑区左缘 + 300px`（最右侧墨迹停在 x=629），其余是宿主底板。
  **销毁路线已评估并否决**（同日）：做了 A/B 探针包（`retainContextWhenHidden: false` + 延迟 150ms 的加载覆盖层）——用户实测「B 明显好，成功抑制了闪动」，**技术上成立**；但**产品上不可用**：本产品是编辑器而非只读预览，切标签不能销毁会话（撤销历史只能从快照「恢复」而不是「天然在」，最后 ≤400ms 的编辑还有丢失窗口，超长历史会降级）。因此**保活是产品原则**，本条目按「平台行为，接受」结案，不再尝试抑制。撤销历史快照实现仍保留在 `858518a`。
* [ ] **`cellClickFixPlugin`**（~130 行，[editor.ts:236-363](../webview/editor.ts#L236)）— `filterTransaction` + `appendTransaction` + `requestAnimationFrame` 多层拦截，对抗 Crepe 表格单击行为不稳定。**需等 Milkdown 上游修复后移除。**
* [ ] **vendor latex feature 上游同步**（2026-09-08 新增，`webview/vendor/latexFeature.ts`）— 升级 `@milkdown/crepe` 时需按文件头「§上游对照」逐节 diff 上游 `src/feature/latex/*`；若上游 latex feature 改为惰性加载 katex，可移除本 vendor 与 esbuild.mjs 的 katex-stub-for-crepe 插件
* [ ] **表格 `<br>` 往返闭环（四层）**（2026-09-08 过度设计审计 P11 登记）— `convertTableBrForDisplay`（加载转换 `src/utils/contentTransform.ts`）+ `withTableBreakHandler`（序列化 handler）+ `cleanTableBreaks` + `preserveTableBreakStyle`（`webview/utils/markdownSerializer.ts`），四层全部绕上游 [Milkdown#2463](https://github.com/Milkdown/milkdown/issues/2463)（remark-gfm 丢弃表格内 `<br>`）。**上游修复后整链移除**；关联回归测试 `webview/__tests__/tableBrRoundtrip.test.ts`、`tableSoftBreak.test.ts` 随链退役

### 🔴 官方无替代（已查证）

* [ ] **顶栏 button tooltip 注入**（`setupTopBarTooltips`，MutationObserver 扫描）— 2026-09-04 查证：官方 `TopBarItem` 类型仅 `{ active, icon, selector? }`，无 label/title 字段，**无官方 API 可替代**；MutationObserver 注入为唯一可行手段，保留（上游提供文案字段后移除）。

### 🟠 DOM 刮削 / MutationObserver 反模式（剩余）

* [ ] **语言列表键盘导航**（[index.ts:608-635](../webview/index.ts#L608)）— 操作 `.language-list-item` 内部 DOM。影响面小，暂缓。

### 🟡 类型安全（剩余）

* [ ] **119 处** **`!important`**（[style.css](../webview/style.css)）— 量大，需逐个分析替代方案。

### 🟢 脆弱事件处理

* [ ] **`capture: true` 事件监听**（5 处）— Milkdown 短期不会大改事件机制，暂不处理。
* [ ] **链接点击 `stopImmediatePropagation`**（[index.ts:371](../webview/index.ts#L371)）— 运行稳定，暂不处理。

### 工具链

* [ ] **集成测试**：`@vscode/test-electron + Mocha` 未搭建 — 主要覆盖 `extension.ts` + `MarkdownEditorProvider.ts`，单测无法触及的 wiring 逻辑
