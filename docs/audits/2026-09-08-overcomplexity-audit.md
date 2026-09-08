# 过度设计（Over-Complexity）专项审计 — 2026-09-08

> 审计目标：找出「本该简单、却做复杂、绕了路」的设计。与 2026-09-08 全面代码审计（正确性/安全/竞态）互补——本审计只看复杂度，每条给出简化方案与风险。
>
> 审计方式：5 个审计域并行深度审计（Extension 核心 / WebView 核心 / 插件与组件 / 构建与配置 / 跨切面状态与消息），每条发现均以 read + grep 实证（文件:行号）；高优先级结论由主会话逐条复核后落盘。

## 审计标尺（本轮根治案例）

`package.json` 的 customEditors `priority: "option"`（md 先以文本 tab 打开）→ extension.ts 写了一个 `onDidChangeTabs` 监听器把文本 tab 关掉再 `openWith` 换成 WYSIWYG（70+ 行 + 配套抑制窗口机制）→ 而 `syncEditorAssociation` 的注释里却写着「依赖 package.json 的 priority:default」——**机制与其要解决的问题自相矛盾，补偿了一层又一层**，最终导致打开闪动、双 tab、焦点互抢。根治只需把 priority 改成 default 并删掉整套监听器（`1f6c8fa`，净删 72 行）。

## 六类模式定义

1. **补偿性机制**：机制的存在是为了弥补另一个机制的错误/不一致（注释与实现矛盾、配置与代码矛盾）
2. **层层状态机**：同一关注点叠了多个窗口/定时器/队列/标志位，每层都有独立理由但合起来已绕路
3. **对抗平台**：绕过 VS Code/Milkdown 官方 API，用 MutationObserver/DOM 刮削/自定义协议硬造，而上游有正路
4. **重复路径**：同一行为有两条实现路径且口径不一致（历史上已因此出过 bug 的优先）
5. **往返放大**：为一个小目标设计多次消息往返/多次落盘/多级兜底
6. **死重机制**：触发它的功能已删/已改，机制残留或只在边角触发

***

## 一、Extension 侧（10 条：high 3 / medium 4 / low 3）

### 🔴 E1 · 全局 revealLine 拦截吞掉非 md 搜索跳转 + 行号广播给全部 md 面板

**位置**：`src/extension.ts:76-83,97-107`；`src/MarkdownEditorProvider.ts:72-75,123-137`

**当前机制**：拦截 VS Code 内置 `revealLine` 命令：先存全局兜底行号，再取所有已注册面板 `getAllMdFsPaths()`——只要任意 md 面板存在（注册即计入，不要求可见/激活），就把行号 `setPendingNavigation` 广播给**每一个** md 面板并提前 `return`。文本编辑器的 `revealRange` 兜底被门禁挡死（仅 md 面板数为 0 时可达）。

**为何过度**（③对抗平台 + ②层层状态机）：

* **真实功能 bug**：全局搜索点击 `.ts/.js` 等非 md 结果同样走 revealLine；只要开着任一 md 面板，拦截器就 return → 文本编辑器收不到 revealRange → **非 md 文件搜索跳转落到文件头**
* 广播把「搜 A 文档第 N 行」写进**所有** md 文档的 pending 表——B 文档面板 5 秒内激活即被错误滚动到 A 的行号
* 注释自曝其因（「避免仅靠 tab.isActive 判断（时序不确定）」）——用广播绕时序，而 viewState 立即消费 + 全局兜底本就覆盖该时序，广播是第三层冗余

**简化方案**：删广播循环与 tab-group 扫描兜底（后者只在 `_webviewPanels` 为空时可达，而那时唯一可能的 md tab 是空页——死分支）；**把 revealRange 兜底改为无条件执行**（custom md tab 激活时 `activeTextEditor` 为 undefined，天然 no-op，无需 mdPaths 门禁）→ 非 md 搜索跳转恢复工作。

**风险**：低-中。md/ts 搜索点击 × 面板开/关 × 多 group 需手测矩阵；回退=逐层恢复，均为本地纯逻辑。

### 🔴 E2 · syncEditorAssociation 激活时静默删除用户全局 *.md 关联

**位置**：`src/extension.ts:16-30,38-41,150-156`

**当前机制**：activate() 无条件执行 sync：wysiwyg 模式删除用户**全局** `workbench.editorAssociations` 里的 `*.md`/`*.markdown` 键并写回；source 模式强制注入 `"default"`。

**为何过度**（①补偿性 + ③对抗平台）：注释写「wysiwyg → 删除条目，恢复 priority:default 生效」——priority 已是 default，这个 delete 分支对 epytor 自身行为零贡献，**唯一效果是删除用户自己的配置**；无法区分「epytor 上次注入的残留」与「用户经 VS Code 原生『Reopen With → Configure default editor』主动设置的关联」，每次激活都抹一次；editorAssociations 本就是官方机制，扩展每次激活改写用户全局配置是劫持官方开关。

**简化方案**：激活时不再写入。仅当用户**显式修改** `epytor.defaultMode` 时才写；且 wysiwyg 只删除「值恰为 epytor 曾注入的 `"default"`」的条目；更彻底：source 模式改为 README 文档化手动配置或一次性命令，停止自动改写用户全局配置。

**风险**：低（source 模式用户注入保留；需比对现值避免覆盖用户自定义值）。

### 🔴 E3 · onDidChangeActiveTextEditor 行号监听器 + ExpiryWindowMap 抑制窗口：互为存在理由的双生机制

**位置**：`src/extension.ts:48-62`；`src/MarkdownEditorProvider.ts:30,67-69,112-120,593`

**当前机制**：监听所有 .md 文本编辑器激活，把光标行写入 pending；配套一个 1.5s 按文档抑制窗口，在 switchToTextEditor 流程标记、在监听器里查询跳过。

**为何过度**（①补偿性 + ⑥死重）：监听器的存在理由是「捕获全局搜索时短暂出现的 .md 文本编辑器光标位置」——那是 priority:option 时代「文本 tab 先开再转换」的中间态；`1f6c8fa` 根治后该中间态已不存在。监听器唯一会触发的真实流程是 switchToTextEditor，而该流程又被自己配套的抑制窗口屏蔽掉——**互为对方存在的理由**。switchToPreview 已显式读取 activeTextEditor 行号，监听器数据在所有路径上都是死存储。删除后 ExpiryWindowMap 失去唯一生产使用方，可整体删除。

**简化方案**：删监听器 + 删抑制标记/方法 + 删 `src/utils/expiryWindowMap.ts` 及其测试。净删 \~60 行 + 一个 49 行 util。

**风险**：低。残留收益为零（source 模式下无面板可消费；switchToPreview 显式读行号）。手测：source/wysiwyg 切换往返、全局搜索、多文档切换后行号定位。

### 🟠 E4 · 保存链路三条路径口径不一 ✅ 2026-09-08 已修

**位置**：`src/MarkdownEditorProvider.ts`（`_saveNow` / `saveCustomDocument` / `frontmatterUpdate`）

**原机制**：① saveCustomDocument 无 catch，失败原样抛给 VS Code；② `_saveWithFeedback` 有 catch + 提示 + 重标 dirty；③ frontmatterUpdate 自建序列（requestContent → buildContentWithFrontmatter → update → `_saveWithFeedback` → lineMapUpdate），注释声明「不经过 saveCustomDocument（其内部会再次拉取 webview 正文并覆盖 frontmatter）」。`_lastSaveTimes/_lastDiskContents` 在两处重复记账。

**实际修复**：`_saveWithFeedback` 提升为唯一保存原语 `_saveNow(document, uriKey, token)`——写盘 + 记账 + 行号广播一处完成，失败统一「markDirty + 用户可见错误 + 返回 false」；saveCustomDocument 与 frontmatterUpdate 都改为「拉取最新内容 → update → `_saveNow`」，两条路径不再各自记账/广播。

**未采纳原方案的一点**：frontmatterUpdate 仍保留 `_requestContent` 拉取——原注释给的理由（saveCustomDocument 会覆盖 frontmatter）确实不成立，但**拉取本身是必要的**：拉取式架构下内存正文可能落后于 webview 未落盘编辑，直接重组会覆盖掉正文编辑。注释已按真实原因改写。

### 🟠 E5 · 导航消费侧六机制双层 TTL（pending 表 + 全局兜底 + 直接发送 + viewState 立即消费 + 1s 延迟复查 + ready 消费）

**位置**：`src/MarkdownEditorProvider.ts:29-32,72-75,83-94,123-137,154-161,342-364,506-507`

**当前机制**：同一目标行最多被 4 处消费点竞争消费、2 套 TTL 裁决（pending 5s / 全局 10s）；直接发送路径不删表项（「作为面板重建时 ready 的备用」）→ 同一行号可能被发送两次；viewState 激活立即消费后还无条件设 1s 定时器再复查一遍。

**为何过度**（②层层状态机）：1s 延迟复查与「直接发送」及「ready 消费」重叠，只服务「面板已注册未初始化 + revealLine 晚于 viewState」的窄窗口，而全局兜底 10s TTL 已覆盖同一窗口。

**简化方案**：删 1s 复查定时器；合并双结构为单一 `_pendingLines: Map<uriKey,{line,ts}>` + 一个无 uri 孤儿槽；直接发送成功后删表项；两套 TTL 收敛为一个常量。

**风险**：中。需验证时序矩阵：搜索点击（已开/未开/未初始化）×（revealLine 先于/后于激活）× 多 group。

### 🟠 E6 · switchToTextEditor/switchToPreview 兜底不可达 + 「先关后开」反模式 ✅ 2026-09-08 已修（C5 判定为必要复杂度）

**位置**：`src/extension.ts`（两个命令）；`src/MarkdownEditorProvider.ts`（`hasPanel`）

**实际修复**：
* switchToTextEditor 的 `if (provider)` 判据恒真（provider 注册后即非 null）→ 该文档无面板时命令静默空转；改为 `provider?.hasPanel(target)` 真实检查，无面板走「直接 openWith default」兜底。
* switchToPreview 仍「先关文本 tab 再 openWith」——与 `ec5a887` 根治「资源管理器点 md 狂闪」的反模式同源（先关会让 VS Code 先激活上一个文档、再被 openWith 激活新文档，两者互抢）；改为先开后关。

**复核更正**：原文「switchToPreview 快捷键 when 只匹配 .md」不成立——`package.json` 的 keybinding 与菜单 when 均为 `(resourceExtname == '.md' || resourceExtname == '.markdown')`。

**C5 判定为必要复杂度（不简化）**：Cmd+Shift+M 的两条入口服务的焦点场景不同——webview 内焦点走 `webview/index.ts` 的 window keydown（iframe 内按键不会到达 VS Code 键位服务），webview 外焦点（点过标签页/标题栏）走 keybinding → `requestSwitchToTextEditor` 往返；两者最终调用同一个 `notifySwitchToTextEditor`，无重复逻辑。删除任一条都会让另一场景失效，而两者都只值一个入口的量级。

### 🟠 E7 · 图片往返口径不对称：显示侧语法范围替换 vs 保存侧全文 split/join 全局替换 ✅ 2026-09-08 已修

**位置**：`src/utils/contentTransform.ts`；`src/MarkdownEditorProvider.ts`（`_prepareContentForDisplay` / `_registerImageMapping`）

**原机制**：显示侧用 extractImageSyntaxes 只替换图片语法内的 src（两轮回归加固产物）；保存侧 `restoreContentForSave` 对全文做 `split(webviewUri).join(relPath)`——不限定语法位置，代码围栏/正文里的 webviewUri 字符串也会被改写。uriMap 由 6 处写入，relPath 归一化口径三种。

**实际修复**：显示侧与保存侧共用单遍 `rewriteImageSources(markdown, resolve)`（唯一替换域 = 图片语法 src）；`extractImageSyntaxes`/`rebuildImageSyntax` 两个只被测试引用的死导出删除（其正则不变量改由 rewriteImageSources 的用例覆盖）。

**顺带修掉的真 bug（复核时实证）**：mdast 序列化会把含括号的目标写成 `\(`、含空格的目标包 `<...>`（probe 实测：`a_b(c).png` → `a_b\(c\).png`、`my file (v2).png` → `<my file (v2).png>`）。旧实现按字面量匹配 → 这两类路径的 webviewUri **会泄漏进磁盘文件**。新增 `normalizeImageDestination`（还原转义 + 去尖括号）用于比对；uriMap 值仍存文件原始写法，往返一字不差。

**uriMap 写入收敛**：6 处 `get-or-create + set` 样板合并为 `_registerImageMapping(uriKey, webviewUri, displayPath)`。未做「统一 path.relative 归一化」——各调用方的 displayPath 语义本就不同（显示预处理存文件原文、上传/图库/补全/解析存待插入的相对路径），强行归一反而破坏往返。

### ⚪ E8 · 死机制残留三件：scrollPanelToLine / _pinnedDocuments / ExpiryWindowMap.purgeExpired

**位置**：`src/MarkdownEditorProvider.ts:56-57,146-152,291`；`src/utils/expiryWindowMap.ts:38-43`

scrollPanelToLine 零调用（被 setPendingNavigation 直接发送分支取代）；_pinnedDocuments 只有 delete 无 add（keepEditor pin 机制已删）；purgeExpired 生产无调用（惰性删除已保证有界）。

**简化方案**：三个纯删除。**风险**：零（typecheck+test 即验证）。若 E3 落地，ExpiryWindowMap 整体删除时一并处理。

### ⚪ E9 · 状态栏字数 show/hide 散落四层 + viewState 内 setTimeout(0) 延迟判定

**位置**：`src/MarkdownEditorProvider.ts:196,302,321-341,677-689`

**简化方案**：提取 `_refreshStatusBar()` 单一刷新函数（取任一 active 面板字数 → show/hide），四处调用改走它；失活分支直接调用（另一面板的激活事件会随后纠正，无需 setTimeout(0)）。**风险**：极低。

### ⚪ E10 · 配置广播四个雷同监听 + 调试开关双命令/双状态面

**位置**：`src/extension.ts:122-181`；`src/MarkdownEditorProvider.ts:184-191`

**简化方案**：用一张表驱动单监听（defaultMode/debugMode/serializationMode/tableWrapMode 四段同构分支合一）；debugMode 的 setContext 与 postToAll 统一走同一 `_applyDebugMode(next)` 函数。**风险**：低。

***

## 二、WebView 核心（8 条：high 1 / medium 3 / low 4）

### 🔴 F1 · 序列化模式/调试开关双载体 + revert 重置：运行期配置被静默回滚

**位置**：`webview/editor.ts:329-338,415-418`；`webview/index.ts:78,334,707-711,774-779`

**当前机制**：`_serializationMode/_serializationDebug` 模块级单例。启动值走 `window.__i18n` 快照；createEditor 每次执行 `_serializationMode = initialSerializationMode`、`_serializationDebug = window.__i18n?.debugMode ?? false`；运行期变更走一次性消息 setter。**init 与 revert 都进 createEditor**——revert（外部写盘）后配置被启动快照静默覆盖：用户中途把 serializationMode 改成 compatible，一次外部文件变更触发 revert，模式退回 clean。`_debugLog` 与 `_serializationDebug` 是同一设置的第二标志位，且启动行为不一致（一个只由消息置位、一个读快照）。

**简化方案**：删 createEditor 里两行重置与参数；Extension 在 init 消息携带当前 serializationMode/debugMode（与 active 字段同模式），webview 在 handleEditorLifecycleMessage 统一调 setter；`_debugLog` 与 `_serializationDebug` 合并为一个调试标志。

**风险**：低。手测「改配置 → 外部修改文件触发 revert → 确认模式未回退」。

### 🟠 F2 · 同一「延迟滚动」两套重试计划（常量 4 段 vs 内联 9 段，无注释解释差异）

**位置**：`webview/index.ts:71-72,676-696,728-742,761-771`

**简化方案**：定义单一 `SCROLL_RETRY_DELAYS_MS`（取 0→2000 细粒度版），删内联数组；若确有场景差异，在常量旁写注释而非内联第二份。**风险**：极低（已 done 的短路 timer 无副作用）。

### 🟠 F3 · CodeMirror 主题补配 MutationObserver：每次 DOM 变更全量重配所有代码块

**位置**：`webview/editor.ts:459-473,476,555`；`docs/tech-debt.md:17`

**当前机制**：容器级 MutationObserver（childList+subtree）回调里 `setTimeout(reconfigureAllCM, 10)`——只要文档有代码块，**每次结构性 DOM 变更（回车/粘贴/加粗）都触发一次全局 querySelector + 对所有 CM 编辑器 dispatch reconfigure**（即使主题值没变）。初始 theme 传亮色而 `isDark = true`，启动错位靠观察器兜底修正。tech-debt 已登记「改为 Compartment 初始化时传入」且属内部可修——本审计建议升级执行。

**简化方案**：落地 tech-debt.md:17：删观察器 + setTimeout(10)，在 Crepe codeMirror 创建 CM 实例时注入当前主题（onThemeChange 立即回调的真实值，顺带修 555 行初始常量与 isDark 矛盾）。若短期无法注入，退而加 guard（仅当 .cm-editor 数量变化才重配 + 10 改命名常量）。

**风险**：中。需确认 Crepe codeMirror 内部创建 CM EditorView 的钩子位置。

### 🟠 F4 · 两套独立「用户交互」跟踪器 ✅ 2026-09-08 已修

**位置**：`webview/utils/userInteraction.ts`（新）；`webview/editor.ts`；`webview/index.ts`

**原机制**：editor.ts 用 document capture 的 keydown/mousedown/paste/drop/cut + 粘滞标志（createEditor 时重置）；index.ts 用 window 的 wheel/mousedown/keydown/touchstart + 按请求重置标志。事件集不一致（滚轮在两处口径相反），语义靠各自注释口头约定。

**实际修复**：提取 `utils/userInteraction.ts`——模块级单调递增 epoch + 一次性注册 7 类事件（capture 阶段，保留原语义）；调用方取快照比较即可判断「期间是否交互过」，不再有「何时重置」的约定。editor.ts 的 `_hasUserInteracted`/`_interactionListenerAdded`/`setupInteractionTracking` 与 index.ts 的 `_userInteracted` 及监听循环全部删除。测试 `webview/__tests__/userInteraction.test.ts`（9 例）+ `updateNotifyDirtyProbe.test.ts` 保持通过。

### ⚪ F5 · visibilitychange 处理器与 window focus 监听器职责重叠，滚动恢复存在第三条无守卫路径

**位置**：`webview/index.ts:584-630,733-741`

**简化方案**：删 visibilitychange 内的 restoreEditorFocus 调用（恒被守卫短路）；滚动恢复改走 scheduleDelayedScroll（复用交互守卫），或与 init 恢复合并为唯一 restoreScrollY(target)。**风险**：低。

### ⚪ F6 · prepareMarkdownForSave 对不可抛函数做 try/catch 兜底 + phase1 残留标签

**位置**：`webview/editor.ts:340-365`；`webview/utils/markdownSerializer.ts:205-207`

serializeCleanMarkdown 全是 split/map/replace 纯字符串操作，无 throw 路径；catch 分支不可达，却制造「clean→compatible 多级回退」的假象；"phase1-whole-document" 是分阶段上线历史的残语。

**简化方案**：删 try/catch 与 catch 分支；容错下沉到 markdownSerializer 内部（异常时安全默认返回 serialized）。**风险**：极低。

### ⚪ F7 · 链接 tooltip 滚动关闭的双重机制（合成 pointerleave + rAF 强写 data-show）

**位置**：`webview/index.ts:390-409`

**简化方案**：二选一（保留直接属性控制，或保留合成事件、删属性强写）并加注释说明选择理由；补「滚动关闭 tooltip」回归测试。**风险**：低（UI 细节）。

### ⚪ F8 · 旧自定义表格时代残留死代码（logTableSel 死标志 + getLineMap/getMarkdownSource 无消费者导出）

**位置**：`webview/editor.ts:27-31`；`webview/index.ts:26,88-96,774-777`

**简化方案**：纯删除。**风险**：零。

***

## 三、插件与组件（7 条：high 2 / medium 3 / low 2）

### 🔴 P1 · 标题子系统四套枚举 + 两次签名计算 + 三套身份口径，口径不一致且历史已因此出过回归

**位置**：`webview/headingFoldPlugin.ts`、`webview/utils/headingFold.ts`、`webview/headingStickyPlugin.ts`、`webview/components/toc/index.ts`、`webview/index.ts`

**当前机制**：同一份标题信息被四个模块各自构建：① headingFold 用 `doc.forEach` 只遍历顶层块（utils/headingFold.ts:80），每事务现算 computeHeadingSignature 并缓存装饰；② index.ts 为 TOC 刷新**独立再算一遍同一签名**存 `_lastTocSignature`（index.ts:323）；③ headingSticky 用 DOM `querySelectorAll` + posAtDOM 反查 + 自建 cachedHeadings 矩形缓存；④ TOC 用 `doc.nodesBetween` 枚举**全部深度**标题（toc/index.ts:24），点击时再 `findHeadingPosByText` 全树重查。**已逐一 grep 实证：三处枚举口径确实不一致。**

**为何过度**（④重复路径 + ①补偿）：fold/sticky 只认顶层标题，TOC 却无 depth 过滤 → TOC 里可点击跳转的嵌套标题永不出现折叠箭头、也永不吸顶；签名有两份独立缓存；sticky 与 fold 之间以 **CSS class 字符串**（`.heading-fold-hidden`/`.heading-fold-heading--foldable`）为跨插件契约——类名是样式细节，改样式即可静默打断吸顶；身份键三套并存（pos / level:text / DOM class）。D7 回归与 TOC pos 漂移回归都源于各口径各自演化。

**简化方案**：在 utils/headingFold 增加导出的 `buildHeadingIndex(doc)`（一趟遍历产出 level/text/pos/foldRange）；fold 插件导出签名/隐藏判定；sticky 的 getVisibleHeadings 改由索引过滤（删 class 嗅探与 posAtDOM 反查——补跑审计指出 sticky 已 import 却未使用 `findHeadingFoldRange`（headingStickyPlugin.ts:13），foldable 判定本可直接用它从 doc+pos 算出，绕道 DOM class 纯属多余）；TOC 消费同一索引并统一口径（建议与 fold 一致只收顶层）；index.ts 删 `_lastTocSignature` 与签名重算，改问插件暴露的签名。CSS class 回归纯样式职责。

**风险**：中。涉及 4 文件与三个用户可见功能；「TOC 不再显示嵌套标题」是行为变更需入 CHANGELOG。分两步落地（先共享索引、再统一口径），每步独立 commit。

### 🔴 P2 · tableSoftBreakPlugin 对抗平台：上游 7.22.1 已自带可配置 hardbreakFilterNodes（已查上游源码实证）

**位置**：`webview/tableSoftBreakPlugin.ts`（注册于 editor.ts:637）；上游 `@milkdown/preset-commonmark@7.22.1`

**当前机制**：自定义 keymap 在 Shift-Enter 时手写祖先遍历判 inCell，再 `replaceSelectionWith(hardbreak.create())` 直接插入，不设置上游命令的 "hardbreak" meta，从而绕过上游 filterTransaction。

**为何过度**（③对抗平台 + ⑥死重的陈旧动机）：**已查上游源码实证**：GFM 7.22.1 的 tableKeymap 只含 NextCell（Mod-]/Tab）/PrevCell（Mod-[/Shift-Tab）/ExitTable（Mod-Enter/Enter）——**已无 Shift-Enter 绑定**；commonmark 7.22.1 自带 `hardbreakKeymap`（Shift-Enter → insertHardbreakCommand）与可配置 ctx `hardbreakFilterNodes = $ctx(["table", "code_block"], ...)`，其 filterTransaction 遍历祖先阻止 table/code_block 内 hardbreak。插件的最初动机（官方 tableKeymap 把 Shift+Enter 绑 goToNextCell）在 7.22.1 已不存在。插件不仅重复实现上游键位，还因缺 meta 跳过上游 hardbreakClearMarkPlugin 的收尾。

**简化方案**：删除 tableSoftBreakPlugin.ts 与注册；在 editor.ts 的 config 回调里加一行 `ctx.set(hardbreakFilterNodes.key, ["code_block"])`（import 自 `@milkdown/kit/preset/commonmark`，上游导出实证 index.js:2142）——该 ctx 语义即「哪些节点类型禁 hardbreak」，正是为配置而设的扩展点。序列化侧 withTableBreakHandler 与加载侧 convertTableBrForDisplay 不动（那是上游 #2463 的真实边界，见 P11）。同步改写 tableSoftBreak.test.ts 为该配置的断言并更新过时注释。补跑审计补充：旧插件还**丢失**了上游命令的 `setMeta("hardbreak", true)`（驱动 hardbreakClearMarkPlugin 清 marks），改走后一并恢复。

**风险**：低-中。行为差异仅一处：上游在「行尾已有 hardbreak 再按 Shift+Enter」时替换为段落（旧实现连插两个）；需手测确认可接受。回退=revert 单 commit。

### 🟠 P3 · findBar 关闭不清防抖 timer：关闭后 150ms 内搜索照常执行（幽灵高亮/滚动）

**位置**：`webview/components/findBar/index.ts:114-118,166,203-206,254-261`

**当前机制**：input 150ms 防抖；close() 只摘 class、清高亮、置空 matchRanges，**不清 clearTimeout**；search() 无 visible 守卫，执行时可能 scrollToMatch(0) 与重注册 CSS.highlights。

**为何过度**（⑤往返放大 + ②状态机缺口的最小化实例）：「关闭」状态与「防抖窗口」两层状态没对齐——close 的清理清单漏了同文件自己创建的 timer。

**简化方案**：close() 加 `clearTimeout(debounceTimer)`；search() 开头加 `if (!visible) return;`。两行改动；补一条「关闭后 pending 搜索不再执行」测试。

**风险**：极低。

### 🟠 P4/C4 · 补全请求生命周期两套手写实现 + pathSuggestions 双派发 ✅ 2026-09-08 已修（请求生命周期部分）

**位置**：`webview/utils/pathSuggestionRequests.ts`（新）；`webview/components/pathLink/pathComplete.ts`；`webview/components/imageView/imgPathComplete.ts`；`webview/index.ts`；`shared/constants.ts`

**原机制**：两个调用方各自保留「手写 id 生成 + pending Map + 5s 超时清理」——与 `PendingRequestRegistry` 是同一套逻辑的第三、第四份实现（且更弱：无 settled 双保险）；`PATH_PREFIX_REGEX`、防抖/超时常量双份；index.ts 对每条 pathSuggestions 同时派发给两个模块。

**实际修复**：新增 `utils/pathSuggestionRequests.ts`——单一 `PendingRequestRegistry<PathSuggestionItem[]>` + 单一回包入口 `resolvePathSuggestionRequest(id, items)`；两处手写 Map/setTimeout 删除；index.ts 双派发变单调用；`PATH_PREFIX_REGEX`/`PATH_SUGGESTION_TIMEOUT_MS`/`PATH_COMPLETE_DEBOUNCE_MS`/`PATH_COMPLETE_RETRIGGER_DELAY_MS` 收编 `shared/constants.ts`。

**未做（记录理由）**：原方案还要求提取 `createSuggestionRequester({idPrefix, filter, onItems})` 把两个组件的「防抖 / 过期守卫 / retrigger / 失焦关闭」也合一。复核后判定不划算：两者触发源不同（ProseMirror 选区 inlineCode vs `<input>`）、过期守卫语义不同（比对 DOM 元素 vs 比对请求 id）、关闭时机不同（blur + 文档 mousedown vs 仅文档 mousedown），强行合并会引入回调参数与分支，反而比两份各自 40 行的直白实现更难读。请求生命周期（真正重复的部分）已合一。

**回归测试**：`imgPathComplete.test.ts` 6 例（含 P8 新增 2 例）——回包结算改为微任务后，断言前统一 `await flush()`。

### 🟠 P5 · 表格换行一个关注点跨三层 4 个全文件遍历 ✅ 2026-09-08 已修（③ handler 化）

**位置**：`src/utils/contentTransform.ts`（convertTableBrForDisplay，①保留）；`webview/utils/markdownSerializer.ts`（withTableBreakHandler ②③、preserveTableBreakStyle ④）

**原机制**：① 加载时 `<br>` → `&#10;`（保留）；② 序列化 break/text handler 输出 `<br>`（保留）；③ 保存后 `cleanTableBreaks` 自带 `splitTableCells`（手写 GFM 单元格切分，含转义追踪）全文件扫描擦除「展示性尾部 `<br>`」；④ `preserveTableBreakStyle` 再全文件正则统一 `<br>` 拼写（保留）。

**根因实证**：展示性 `<br />` 的来源不是 mdast handler，而是 **Milkdown 的 paragraph `toMarkdown` runner**——空段落被追加 `html` 节点 `<br />`（`@milkdown/preset-commonmark/lib/index.js:490`，`remarkPreserveEmptyLinePlugin` 在场时）。所以「移进 tableCell handler」不可行（该 handler 由 `handleTable` 走 matrix 路径，根本不被调用）；可行的官方接缝是 mdast 的 **html handler**（上游默认实现只有 `return node.value || ''`）。

**实际修复**：`withTableBreakHandler` 新增两个就地规则——`html` handler 在 tableCell 内把裸 `<br />` 输出为空（③ 的等价物，不再需要事后扫描）；`break` handler 在 tableCell 内对「段落最后一个子节点」输出空（覆盖「尾部换行写出去、重载又被 remark 裁掉」的不一致）。`cleanTableBreaks` / `cleanTableCellBreak` / `splitTableCells` 整体删除（约 50 行），`serializeCleanMarkdown` 只剩 `preserveTableBreakStyle`。

**顺带改善**：空单元格不再泄漏占位串，列宽不再被 ` <br /> ` 的长度撑开（旧管线 `| A      | B      |` → 新管线 `| A | B |`）。真实管线（加载转换 → 编辑 → 序列化 → Clean）逐例两趟往返稳定：空单元格 / 多个空单元格 / 中间换行（`<br>` 与 `<br/>` 拼写）/ 转义竖线 + 空单元格 / 全空行。

### ⚪ P6 · TOC 折叠键 level:text 让同一文档同名同级标题共享折叠态 ✅ 2026-09-08 已修

**位置**：`webview/components/toc/index.ts:13-14,27,147-155,195-202`；`webview/headingFoldPlugin.ts:20`

**为何过度**（①补偿性机制）：level:text 键是补偿「pos 键随编辑漂移」的方案，但补偿引入新问题：同一文档两个同名同级标题共享一个折叠开关。

**复核更正**：本条原写「折叠状态跨文档继承」——**不成立**。webview 状态是 `vscode.setState()`（每文档独立 webview，`supportsMultipleEditorsDocument: false`），文档 A 的折叠集合不会进文档 B。真实问题只有「同文档同名同级共享」这一条。

**实际修复**：键加「第几次出现」序号（`level:text#nth`，`assignFoldKeys` 纯函数 + 4 例测试）；恢复持久化状态时丢弃旧格式键（一次性迁移）。未采用「折叠态仅会话内保留」方案——折叠状态记住是本仓库既有行为，删掉是功能回退。

### ⚪ P7 · frontmatterPanel 加行按钮三重聚焦保险（同步 + setTimeout(0) + rAF）在补偿从未定位的焦点抢夺者

**位置**：`webview/components/frontmatterPanel/index.ts:183-202`

mousedown 已 preventDefault+stopPropagation 防夺焦，click 里仍叠三层聚焦。对照同仓库 imageView 的 startToolbarInlineEdit 只 focus 一次。

**简化方案**：删二三层保险（保留同步 focus），实测若焦点仍被夺回再单层补回并注释定位到的抢夺者。**风险**：低（前端交互细节）。

### 🟠 P8 · imageView webview 侧 uriMap 双份镜像与 Extension 不同步（重命名后即陈旧）✅ 2026-09-08 已修

**位置**：`webview/components/imageView/index.ts:29-46,593-604`；`webview/index.ts:697,796-822`

**原机制**：Extension 单份 `_imageUriMaps` 全量下发；webview 收到后拆成 `_uriToRel`/`_relToUri` 双向两张 Map；确认路径时三级回退链（dataset 缓存 → 查 _relToUri → `resolveToWebviewUri` 异步解析）。**imageRenamed 处理器只改 ProseMirror 文档 src、不更新这两张 Map**——重命名后 _relToUri 旧映射保留到下次 init/revert 才刷新，陈旧镜像靠第③级异步解析兜底。

**实际修复**：删 `_relToUri` 与 `toWebviewUri`、删回退分支②——webview 只保留展示用的 `_uriToRel`，确认时一律 `resolveToWebviewUri()`（已有 3s 超时回退）。补 `resolveToWebviewUri` 两例单测（回包解析 + 超时回退原值）。

### 🟠 P9 · TOC 点击跳转按「level+全文」反查 pos：补偿陈旧 pos 且同文标题必跳错（每次点击 O(n) 扫描）

**位置**：`webview/components/toc/index.ts:44-57,261-268`

**当前机制**：列表项存 pos，但注释自认「pos 会随编辑漂移」，于是点击时 `findHeadingPosByText` 全文档 descendants 按 level:text 重查——两个同文同层标题（如两个「## 安装」）永远命中第一个，且这是每次点击的 O(n) 扫描。

**为何过度**（①补偿性机制）：用「按文本反查」补偿「存 pos 会漂移」，而更简且语义正确的方式是**存 DOM 元素引用**：refresh() 重建列表时经 `view.nodeDOM(pos)` 关联 heading 元素，点击时 `view.posAtDOM(el, 0)` 直接得当前 pos——无漂移、无歧义、无全量扫描；findHeadingElement 的 fallback 链一并退役。

**简化方案**：refresh() 存 el 引用；点击分支改 posAtDOM + `view.dom.contains(el)` 守卫；删 findHeadingPosByText/findHeadingElement。**风险**：低（posAtDOM 异常时 try/catch 忽略即可）。

### ⚪ P10 · TOC updatePanelPosition 死重函数 + 硬编码 36px 与共享常量 40px 打架

**位置**：`webview/components/toc/index.ts:390-409`；`shared/constants.ts:5`

`updatePanelPosition()` 每次调用都设置相同两个常量值（`top='36px'`、`height='calc(100vh - 36px)'`），注释却写「动态对齐到 topbar 底部」；被 rAF 初始化与 resize 重复调用，永不产生不同结果；且 36px 与同文件点击跳转处使用的 `DEFAULT_TOPBAR_HEIGHT = 40` 不一致。

**简化方案**：删函数与 resize 调用（保留 checkAutoShow）；两条 style 移入 toc.css 静态声明；36px 对齐 DEFAULT_TOPBAR_HEIGHT。**风险**：无（纯样式落位）。

### ⚪ P11 · 表格 `<br>` 四层往返链路未登记 tech-debt（上游修复后无移除清单）

**位置**：`src/utils/contentTransform.ts:43-61`；`webview/utils/markdownSerializer.ts:219-258,122-160,199-207`；`docs/tech-debt.md`

加载转换 → 序列化双 handler → clean 后处理 → 风格统一，共 4 层全部绕同一个上游 bug（remark-gfm 丢弃表格内 `<br>`，Milkdown#2463）——判定为**有真实依据的必要复杂度**（P5 建议 handler 化③；本条的独特发现是**登记缺口**）：该 workaround 未进入 tech-debt，AGENTS「上游限制」表也没有 #2463，上游合并后无人知道该删哪几层、回归测试应随哪层退役。

**简化方案**：tech-debt 增补「表格 `<br>` 往返闭环（四层）——上游 Milkdown#2463 修复后整链移除」+ 关联测试标注。代码不动。**风险**：零。

## 四、构建与配置（主会话补审）

本域逐文件复核结论：**无独立高优先级发现**。已知问题归入 E2（syncEditorAssociation）/ E6（命令与 when 口径）/ E10（配置广播与调试开关双状态面），不重复报告。其余判定为必要复杂度：

* **esbuild.mjs**（splitting + katex stub 插件 + katex-styles 独立 CSS 入口 + dist 清理）：每一层都有实测依据（6.2MB→1.0MB 入口、1.5MB CSS→75KB、动态 CSS 复制实证、陈旧 chunk 混入 VSIX 实证），已是最简表达；替代方案（pnpm patch）反而更绕
* **l10n 三件套**（package.nls 双份 + webviewTranslations + i18n 词典）：三处消费者不同（Extension 命令/配置文案、webview 运行时词典），词典已有静态一致性测试防漂移——各司其职
* **.github/workflows**：ci.yml 四 job（typecheck→test→build→package）与 publish.yml（marketplace-publish 环境 + 双份 CHANGELOG 拼接 Release 说明）与 AGENTS 管线定义逐项一致，无冗余 job
* **vitest 配置**：extension/webview 双 project + 分模块覆盖率底线（AGENTS 已编码）+ bench 独立配置——与测试规范一致
* **package.json**：customEditors 已在 `1f6c8fa` 简化为 priority:default；命令/快捷键结构问题归 E6/E10

## 五、跨切面状态与消息（后台审计域已返回，并入本报告）

全量消息面盘点：`shared/messages.ts` 共 31 种（ToExtension 14 + ToWebview 17）；6 对请求-响应中**注册表机制竟有 3 套**（ContentRequestCoordinator + PendingRequestRegistry×3 + 两处手写 Map+setTimeout）。为补偿「另一侧无法得知状态」而存在的消息多数必要（panelActiveState/requestContent/wordCount/lineMapUpdate），只有 requestSwitchToTextEditor 与行号多通道属于绕路。

### 🔴 C1 · 同一「行号」目标八通道：4 生产者 × 2 存储 × 2 TTL × 5 投递点 × 4 消费点 + 抑制窗口（E1+E5 的跨切面全景，两域独立确认）

**位置**：`src/extension.ts:50-62,67-110,227-230`；`src/MarkdownEditorProvider.ts:29-32,69,72-75,83-94,123-137,146-161,312-365,500-521`；`webview/index.ts:72,728-742,761-771`

生产者 4 个（revealLine 拦截 / onDidChangeActiveTextEditor / switchToPreview / openFile 链接）、存储 2 套（pending Map 5s + 全局兜底 10s + 抑制窗口 1.5s）、投递 5 点（直发不删表项 / ready / viewState 立即 / viewState 1s 复查 / 死代码 scrollPanelToLine）、webview 消费 4 点（init 与消息两套重试计划 / scrollY 恢复 / visibilitychange 恢复）。E1（广播吞掉非 md 搜索跳转）与 E5（六机制收敛）均落在这个全景里，**简化方案合并执行**：删全局兜底+10s TTL、删 viewState 立即/延迟消费、删广播与 tab 扫描兜底、revealRange 无条件执行、两套重试计划合一、删 scrollPanelToLine——只保留 `_pendingNavigations` 单存储 + ready 消费 + initialized 直发（发后删除）。

**风险**：中。手测时序矩阵（已开/未开/未初始化）×（revealLine 先/后于激活）× 多 group。

### 🔴 C2 · onDidChangeActiveTextEditor + ExpiryWindowMap 抑制窗口双生机制（与 E3 独立确认，未修复）

与 E3 同结论，补充一个关键对照：抑制窗口的存在恰与 switchToPreview 的**刻意捕获**行为相反（同一「离开/进入文本编辑器时的行号」关注点，一边故意记（extension.ts:226-230）、一边专门拦（extension.ts:56 + provider:593））。合并执行 E3 的删除方案。

### 🟠 C3 · init/revert 同构消息：Provider 三处 payload 构造逐字重复 + webview 冗余分支重查

**位置**：`shared/messages.ts:45-48`；`src/MarkdownEditorProvider.ts:479,510-520,790-796`；`webview/index.ts:698-744`

init 与 revert 的语义差异真实存在（init=恢复滚动/抢焦点，revert=内容重载不抢焦点不滚），**不建议合并类型**；但 Extension 侧把几乎相同的 payload 字面量写了**三遍**（watcher revert :479 / ready→init :510-520 / revertCustomDocument :790-796），webview 侧 handleEditorLifecycleMessage 已收窄类型后又在函数体内重查 `msg.type === "init" || msg.type === "revert"`、再按 type 分三处 if。

**简化方案**：Provider 提取 `_buildLifecyclePayload(uriKey, content, opts)` 单工厂（三处调用改一行）；index.ts 删冗余重查，init-only 分支改为对解构出的 `msg.active/msg.scrollToLine` 判空。**风险**：极低。

### 🟠 C4 · 请求-响应注册表三套机制并存 + pathSuggestions 单消息双分发

**位置**：`webview/utils/pendingRequest.ts:25-97`；`webview/index.ts:148-158,821-822`；`webview/components/pathLink/pathComplete.ts:20,127-147`；`webview/components/imageView/imgPathComplete.ts:16-38,46-55,137-159`

PendingRequestRegistry 已是成熟样板（settled 双保险 + 超时结算，index.ts 3 实例），但路径补全两条链仍手写等价且更弱的 Map + 手写 id + 手写 setTimeout（P4 的镜像问题在**记账层**的具体形态）；index.ts 把同一 pathSuggestions 回包分发给两个注册表各查一遍；PATH_* 三对常量双份。

**简化方案**：pathComplete/imgPathComplete 改用 PendingRequestRegistry<T>；三对常量收编 shared/constants.ts；双分发随注册表合一消失。**风险**：低（相关测试随接口微调）。

### ⚪ C5 · Cmd+Shift+M 快捷键双实现：webview keydown + keybinding 命令两条路径，requestSwitchToTextEditor 往返只服务菜单

**位置**：`package.json:74-79`；`webview/index.ts:561-568,755-760`；`src/extension.ts:184-214`

同一手势两条实现：webview keydown 直接发 notifySwitchToTextEditor；package.json keybinding → 命令 → requestSwitchToTextEditor 往返。webview 监听器无条件 preventDefault → 焦点在 webview 时 keybinding 永不触发——命令路径实际只服务菜单/命令面板。

**简化方案**：二选一删其一（建议删 package.json keybinding，webview keydown 已覆盖聚焦场景；菜单仍走命令往返）。**风险**：低（手测三入口行号定位一致）。

### ⚪ C6 · visibilitychange 处理器与其注释的诊断结论自相矛盾（「visibility 恒 visible」却仍写滚动恢复）

**位置**：`webview/index.ts:575-582,584-630,733-741`

注释自证 VS Code 切 tab 时 visibilitychange 不触发，处理器却仍在滚滚动位置并调 restoreEditorFocus；标题写「不滚动」其下却 scrollTo。滚动恢复三条路径中仅 init 路径有交互守卫。

**简化方案**：删 visibilitychange 处理器（或仅留 restoreEditorFocus 删滚动段）；滚动恢复收敛为唯一 restoreScrollY(target) 走 scheduleDelayedScroll；修正注释。**风险**：低（手测重启恢复标签页滚动位置、最小化恢复）。

### 判定为必要复杂度（跨切面视角）

* **消息驱动 + 事件驱动并存**（焦点三路：window 事件 / panelActiveState / init.active）：panelActiveState 是多 webview 焦点互抢的根治（VS Code #61489 同类），window 事件是 64d5064 实证的激活信号，init.active 是首帧初值——三层各覆盖一个真实时序，非冗余（F5 已指出唯一可删的 visibilitychange 分支）
* **定时器/防抖全景**（14 个 *_MS 常量 + 各处 setTimeout）：逐个对过用途，300ms 脏标记与 800ms TOC 双防抖各自服务不同延迟目标（autoSave 延迟 vs UI 重建），不合并；冗余的仅 F2（两套重试数组）与 E5（导航多层），已单列
* **webviewState 持久化**（scrollY + toc 状态合并写）：单一 setWebviewState 合并写有注释依据，正当

***

## 执行顺序建议（四批，每步独立提交 + verify + 手测）

**第一批（零风险清场）✅ 2026-09-08 完成**：

* ✅ **B2** `.vscodeignore` 补排除 `.github/**`、`test*.md`、`releases/**`、`*.vsix`（VSIX 256→250 文件；test-5000.md 349KB 与 5 个工作流/模板文件不再进包）
* ✅ **E8** 删 `scrollPanelToLine` / `_pinnedDocuments` / `ExpiryWindowMap.purgeExpired`（+ 其测试）
* ✅ **F8** 删 `logTableSel`/`setLogTableSel` / `getLineMap` 导出 / `getMarkdownSource` 导出
* ✅ **P10** 删 TOC `updatePanelPosition` 死重函数（面板位置回归 toc.css 静态声明，零视觉变化）
* ✅ **B7** `switchToTextEditor` 注释与实现对齐

**第二批（低风险行为修复，各含真实 bug）✅ 2026-09-08 完成**：F1（revert 不再回滚配置，含复现测试）、E1（搜索跳转拦截 + 同文档直接投递补漏）、E2（不再删用户全局关联）、P2（tableSoftBreak → 上游 hardbreakFilterNodes 一行配置）、P3（findBar 关闭清 timer，含复现测试）

**第三批（结构性收敛）部分完成 2026-09-08**：E3/C2（双生机制整套删除，净删 ~110 行）、E5 部分（1s 复查定时器 + directOnly 语义）、F2（重试计划统一）、C3（生命周期 payload 工厂）、C6/F5（visibilitychange 删除）、E9（状态栏统一刷新）、E10（配置广播表驱动）、P7（聚焦层数）、P9（TOC 改存 DOM 引用）、B4（.markdown 对齐）、B6（CI Job Summary + 文档修正）、B3（debugMode 单命令）、B5（onStartupFinished）、P11（tech-debt 登记）

**剩余（下轮继续，本轮有意未做）**：

* **P1 标题子系统统一索引**——需要拆两步（先共享 `buildHeadingIndex`、再统一 TOC 的深度口径），而第二步是**用户可见行为变更**（TOC 不再列出嵌套标题，按审计要求须进 CHANGELOG）。放在同一轮手测里会与另外 9 项改动混在一起、回归无法归因，故留到独立一轮，先与用户确认口径。
* **B1 katex 双版本对齐**——需要在真实浏览器里验证 mermaid 数学标签的渲染结果，当前环境无法验证，不凭猜测改动。

**第四批（用户实测反馈的两项严重问题 + 复核中新发现）**：

* ✅ **F3** CodeMirror 主题补配观察器无限回环（2026-09-08）——观察器抽到 `webview/utils/cmThemeObserver.ts` 并加数量守卫；回归测试 `webview/__tests__/cmThemeObserver.test.ts`（含真实 CodeMirror + 语法高亮的回环复现）。用户反馈「开着 md 页面时整个 VS Code 输入卡顿、切换别的 webview 时整窗口闪动，关闭 md 页面后消失」的根因：观察器对任何 childList 变更都排重配，而 reconfigure 自身产生 childList 变更 → 10ms 一次无限回环。
* ✅ **P6** TOC 折叠键同名同级共享（2026-09-08）——键加出现序号 `level:text#nth`。
* ✅ **P8** 图片 uriMap 反向镜像删除（2026-09-08）——确认路径统一走 Extension 解析。
* ✅ **E7** 图片往返替换域统一（2026-09-08）——并修掉「括号/空格路径的 webviewUri 泄漏进磁盘」真 bug。
* ✅ **E4** 保存链路统一为唯一原语 `_saveNow`（2026-09-08）。
* ✅ **E6** switchToTextEditor 兜底改真实面板检查 + switchToPreview 改先开后关（2026-09-08）；**C5** 复核后判定为必要复杂度。
* ✅ **F4** 用户交互跟踪统一为 `utils/userInteraction.ts` 的 epoch（2026-09-08）。
* ✅ **P5** 表格换行后处理 handler 化，删除 cleanTableBreaks/splitTableCells（2026-09-08）。
* ✅ **P4/C4** 补全请求生命周期统一到单一注册表 + 单派发（2026-09-08）。

***

## 判定为必要复杂度、不报告（已复核）

* **ContentRequestCoordinator 单飞队列**：有「保存 Promise 悬挂、零提示」的真实回归依据
* **fs.watch → 防抖 → SAVE_COOLDOWN → _lastDiskContents 快照 → decideExternalChange 链条**：每层均有数据丢失/外部写盘不采纳的真实回归背书
* **webviewConfigSanitize 与路径边界校验**：安全依据
* **vendor 惰性加载（mermaid/KaTeX）**：首帧性能实测依据（7.7MB→1.5MB）
* **_editorLifecycleChain / releaseDocTimers / 防抖 timer 释放 / themeBus 退订**：均有文档化回归依据（双 createEditor 孤儿化、旧回调污染新文档、监听器泄漏）
* **字数/TOC 双 rAF 延迟 + 签名缓存**：firstRender.bench 首帧依据
* **PendingRequestRegistry**：已完成的样板统一（替代三处手写不一致）
* **cellClickFixPlugin**：已登记 tech-debt「上游修复后移除」类 workaround，不重复报告
* **topBarOverflow MutationObserver 自愈 / setupTopBarTooltips / codeBlockEnhance**：已登记 tech-debt；补跑审计实证上游 7.22.1 确无 per-item hidden/overflow 能力（crepe top-bar 硬编码 class、groupInfo computed 重建），观察器为必需补偿
* **headingFold 签名缓存 + 折叠区间双指针 / headingSticky 缓存与抑制兜底**：均有万行文档实测回归依据
* **findBar MAX_MATCHES 封顶与防抖本身**：必要（仅 close 清理缺失见 P3）

