# 技术债务

> 面向开发者的代码质量改进清单，不涉及用户可见功能变更。
> 最后更新：2026-09-08

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
* [x] **2026-09-08 全面审计修复（33 项）** — 3 critical（保存拉取单槽竞态/外部写盘不采纳/frontmatter 丢行）+ 22 major + 8 minor/nit：状态机化（ExpiryWindowMap 抑制窗口/ContentRequestCoordinator 单飞队列/消息串行链/滚动定位合一）、生命周期（themeBus 退订/destroyEditor/NodeView.destroy/防抖 timer 释放）、安全（配置净化/URL 白名单/路径边界/大小上限/错误脱敏/保留设备名）、性能（折叠双指针/吸顶 posAtDOM/滚动节流/查找封顶）、抽象（补全核心合并/请求注册表/index.ts 拆分）、死代码（-500+ 行）、文档与测试对齐（i18n 一致性测试/l10n 同步/覆盖率底线编码/CHANGELOG 行为级改写）；详见 `docs/audits/2026-09-08-full-code-audit.md`

### 🟡 中优先级

* [x] **下拉补全重复** — `pathComplete` / `imgPathComplete` → 提取 `closeDropdown`/`updateActiveItem` 到 `ui/dropdownComplete.ts`（~40 行重复消除）；2026-09-08 进一步提取 `ui/pathCompleteCore.ts`（渲染+键盘导航合一，剩余镜像全清）
* [x] **确认/取消编辑重复** — `startCaptionEdit` / `startSrcEdit` → 提取 `startToolbarInlineEdit` 到 `imageView/index.ts` 模块级
* [x] **顶栏 P 下拉菜单不显示** — `.top-bar-inner` 的 `overflow: hidden` 裁剪了 Crepe heading dropdown；改为 `overflow: visible` 并补充 CSS 回归测试
* [x] **空 catch 块**（12 处）— 已全部添加描述性注释（4 处已有充分注释未改，8 处补充）

### 配置项检修

* [x] 全部 13 个配置项已验证在代码中实际使用，无死配置。
  * ~~`autoSave` / `autoSaveDelay`~~ — 2026-09-07 移除：自动保存改用 VS Code 原生 `files.autoSave`（拉取式保存架构）
  * `codeBlockMaxHeight` / `editorMaxWidth` / `fontFamily` / `imageSelectionColor` → 注入 CSS 变量
  * `defaultMode` → `extension.ts` 编辑器关联同步
  * `debugMode` → 全局调试日志开关 + WebView 同步
  * `imageStorage` / `imageLocalPath` / `imageServer*` → `imageService.ts` 图片上传流程

### 测试补齐

* [x] **`webview/utils/themeBus.ts`** — `isDark()` / `onThemeChange()` 已补 jsdom 测试，行覆盖率 100%
* [x] **`webview/i18n/index.ts`** — `t()` / `kbd()` Mac/Win 分支已补测试，行覆盖率 100%
* [x] **`src/MarkdownDocument.ts`** — 已补 `saveAs` 取消与 `dispose` 边界，行覆盖率 100%
* [x] **`src/utils/imageService.ts`** — 已补目录读取失败、非文件目录项与上传超时边界，行覆盖率 100%

***

## 暂缓处理

以下项目已识别但当前不紧急，择机处理。

### 🔴 上游 workaround

* [ ] **`cellClickFixPlugin`**（~130 行，[editor.ts:236-363](../webview/editor.ts#L236)）— `filterTransaction` + `appendTransaction` + `requestAnimationFrame` 多层拦截，对抗 Crepe 表格单击行为不稳定。**需等 Milkdown 上游修复后移除。**
* [ ] **vendor latex feature 上游同步**（2026-09-08 新增，`webview/vendor/latexFeature.ts`）— 升级 `@milkdown/crepe` 时需按文件头「§上游对照」逐节 diff 上游 `src/feature/latex/*`；若上游 latex feature 改为惰性加载 katex，可移除本 vendor 与 esbuild.mjs 的 katex-stub-for-crepe 插件

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
