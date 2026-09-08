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

---

## 一、Extension 侧（10 条：high 3 / medium 4 / low 3）

### 🔴 E1 · 全局 revealLine 拦截吞掉非 md 搜索跳转 + 行号广播给全部 md 面板

**位置**：`src/extension.ts:76-83,97-107`；`src/MarkdownEditorProvider.ts:72-75,123-137`

**当前机制**：拦截 VS Code 内置 `revealLine` 命令：先存全局兜底行号，再取所有已注册面板 `getAllMdFsPaths()`——只要任意 md 面板存在（注册即计入，不要求可见/激活），就把行号 `setPendingNavigation` 广播给**每一个** md 面板并提前 `return`。文本编辑器的 `revealRange` 兜底被门禁挡死（仅 md 面板数为 0 时可达）。

**为何过度**（③对抗平台 + ②层层状态机）：
- **真实功能 bug**：全局搜索点击 `.ts/.js` 等非 md 结果同样走 revealLine；只要开着任一 md 面板，拦截器就 return → 文本编辑器收不到 revealRange → **非 md 文件搜索跳转落到文件头**
- 广播把「搜 A 文档第 N 行」写进**所有** md 文档的 pending 表——B 文档面板 5 秒内激活即被错误滚动到 A 的行号
- 注释自曝其因（「避免仅靠 tab.isActive 判断（时序不确定）」）——用广播绕时序，而 viewState 立即消费 + 全局兜底本就覆盖该时序，广播是第三层冗余

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

**简化方案**：删监听器 + 删抑制标记/方法 + 删 `src/utils/expiryWindowMap.ts` 及其测试。净删 ~60 行 + 一个 49 行 util。

**风险**：低。残留收益为零（source 模式下无面板可消费；switchToPreview 显式读行号）。手测：source/wysiwyg 切换往返、全局搜索、多文档切换后行号定位。

### 🟠 E4 · 保存链路三条路径口径不一（saveCustomDocument 无 catch / _saveWithFeedback 有 catch / frontmatterUpdate 自建路径且注释理由已不成立）

**位置**：`src/MarkdownEditorProvider.ts:539-566,710-732,748-763`

**当前机制**：① saveCustomDocument 无 catch，失败原样抛给 VS Code；② _saveWithFeedback 有 catch + 提示 + 重标 dirty，返回 boolean；③ frontmatterUpdate 自建序列（requestContent → buildContentWithFrontmatter → update → _saveWithFeedback → lineMapUpdate），注释声明「不经过 saveCustomDocument（其内部会再次拉取 webview 正文并覆盖 frontmatter）」。`_lastSaveTimes/_lastDiskContents` 在两处重复记账。

**为何过度**（④重复路径 + ①注释与实现矛盾）：contentResponse 处理器已在 resolve 前执行 `_prepareContentForSave`，而 `_frontmatterMap` 在 frontmatterUpdate 一开始就已更新——经 saveCustomDocument 的拉取回包**自带新 frontmatter**，那条注释理由不成立（旧认知残留）。三条路径失败语义分裂：Cmd+S 是 VS Code 泛化提示、frontmatter 是定制提示+重标 dirty、切文本还要中止切换——同一关注点三套行为。

**简化方案**：把 `_saveWithFeedback` 提升为唯一内部保存原语 `_saveNow(document, uriKey, token)`（含记账、catch→markDirty→提示→rethrow/返回）；saveCustomDocument 改调用它并向 VS Code 传播异常；frontmatterUpdate 改为「更新 _frontmatterMap → _markDirty → await _saveNow」（不再单独 requestContent）；lineMapUpdate 统一由 _saveNow 成功路径发出。净删 ~20 行 + 修正误导注释。

**风险**：低-中。需补「frontmatter 更新经统一保存路径」回归用例；手测 Cmd+S 失败提示与关窗脏状态。

### 🟠 E5 · 导航消费侧六机制双层 TTL（pending 表 + 全局兜底 + 直接发送 + viewState 立即消费 + 1s 延迟复查 + ready 消费）

**位置**：`src/MarkdownEditorProvider.ts:29-32,72-75,83-94,123-137,154-161,342-364,506-507`

**当前机制**：同一目标行最多被 4 处消费点竞争消费、2 套 TTL 裁决（pending 5s / 全局 10s）；直接发送路径不删表项（「作为面板重建时 ready 的备用」）→ 同一行号可能被发送两次；viewState 激活立即消费后还无条件设 1s 定时器再复查一遍。

**为何过度**（②层层状态机）：1s 延迟复查与「直接发送」及「ready 消费」重叠，只服务「面板已注册未初始化 + revealLine 晚于 viewState」的窄窗口，而全局兜底 10s TTL 已覆盖同一窗口。

**简化方案**：删 1s 复查定时器；合并双结构为单一 `_pendingLines: Map<uriKey,{line,ts}>` + 一个无 uri 孤儿槽；直接发送成功后删表项；两套 TTL 收敛为一个常量。

**风险**：中。需验证时序矩阵：搜索点击（已开/未开/未初始化）×（revealLine 先于/后于激活）× 多 group。

### 🟠 E6 · switchToTextEditor/switchToPreview 双向命令镜像重复 + 死分支 + 与已根治教训相反的「先关后开」

**位置**：`src/extension.ts:185-260`；`src/MarkdownEditorProvider.ts:579-625`

**当前机制**：两个命令各自写一份 tab groups 扫描（取 isPreview/viewColumn）；switchToTextEditor 命令侧 `if (provider)` 兜底——provider 激活后恒非 null，兜底不可达、面板不存在时命令**静默空转**；switchToPreview 仍「先关文本 tab 再 openWith」——恰是 `ec5a887` 刚根治过的反模式；switchToPreview 快捷键 when 只匹配 `.md`（package.json:84），`.markdown` 文件无法用（与 selector 的 `*.markdown` 不一致）。

**简化方案**：提取共享 `findMdTab(uri, kind)`/`captureTabState(uri)` 合并两份扫描；统一「先开后关」顺序；命令侧兜底改为 `provider.hasPanel(uri)` 真实命中检查；统一 when 为 `.md`/`.markdown`。

**风险**：低。手测：预览↔文本双向切换、preview（斜体）tab 状态保持、同一文件双 group。

### 🟠 E7 · 图片往返口径不对称：显示侧语法范围替换 vs 保存侧全文 split/join 全局替换；uriMap 五处写入三种 relPath 格式

**位置**：`src/utils/contentTransform.ts:22-32,86-113`；`src/MarkdownEditorProvider.ts:892-917,935-942,1005-1010,1151-1164,1188-1195`

**当前机制**：显示侧用 extractImageSyntaxes 只替换图片语法内的 src（两轮回归加固产物）；保存侧 `restoreContentForSave` 对全文做 `split(webviewUri).join(relPath)`——不限定语法位置，**代码围栏/正文里的 webviewUri 字符串也会被改写**。uriMap 由 **6** 处写入（显示预处理 :904、上传 :941、项目图库 :1010、重命名 :1076、路径补全 :1160、按需解析 :1194，已 grep 实证），relPath 归一化口径三种（'./x' / 无 './' / 调用方原样）。

**为何过度**（④重复路径）：该往返链路已两度真实回归（src 截断写畸形内容、title 被吞 404）——注释自己记录了；保存侧却用比显示侧**更宽**的替换域，是「保存往返改写内容」类事故的第三个潜在入口。webview 侧还镜像维护第二份 _uriToRel/_relToUri。

**简化方案**：保存侧与显示侧对齐——restoreContentForSave 复用 extractImageSyntaxes 语法范围替换；uriMap 写入收敛为单一 `registerImageMapping(uriKey, webviewUri, relPath)`（统一 path.relative 归一化）；补「代码围栏内 webviewUri 字符串不被保存改写」回归用例。

**风险**：低-中。需覆盖 URI 含括号/空格与序列化转义形态；回退=恢复 split/join。

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

---

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

### 🟠 F4 · 两套独立「用户交互」跟踪器（editor.ts 粘滞标志 vs index.ts 按请求重置标志）

**位置**：`webview/editor.ts:327-328,367-376,419,437`；`webview/index.ts:636-645,680-684`

**简化方案**：提取单一 `webview/utils/userInteraction.ts`（模块级 epoch 计数器 + 一次性注册 5 事件监听，保留 capture 语义）；scheduleDelayedScroll 快照 epoch 比较；updateNotifyPlugin 比较 epoch 与建实例快照。删两处注册与两个标志。**风险**：低（注意保留 capture——ProseMirror 可能 stopPropagation；updateNotifyDirtyProbe.test.ts 需通过）。

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

---

## 三、插件与组件（7 条：high 2 / medium 3 / low 2）

### 🔴 P1 · 标题子系统四套枚举 + 两次签名计算 + 三套身份口径，口径不一致且历史已因此出过回归

**位置**：`webview/headingFoldPlugin.ts`、`webview/utils/headingFold.ts`、`webview/headingStickyPlugin.ts`、`webview/components/toc/index.ts`、`webview/index.ts`

**当前机制**：同一份标题信息被四个模块各自构建：① headingFold 用 `doc.forEach` 只遍历顶层块（utils/headingFold.ts:80），每事务现算 computeHeadingSignature 并缓存装饰；② index.ts 为 TOC 刷新**独立再算一遍同一签名**存 `_lastTocSignature`（index.ts:323）；③ headingSticky 用 DOM `querySelectorAll` + posAtDOM 反查 + 自建 cachedHeadings 矩形缓存；④ TOC 用 `doc.nodesBetween` 枚举**全部深度**标题（toc/index.ts:24），点击时再 `findHeadingPosByText` 全树重查。**已逐一 grep 实证：三处枚举口径确实不一致。**

**为何过度**（④重复路径 + ①补偿）：fold/sticky 只认顶层标题，TOC 却无 depth 过滤 → TOC 里可点击跳转的嵌套标题永不出现折叠箭头、也永不吸顶；签名有两份独立缓存；sticky 与 fold 之间以 **CSS class 字符串**（`.heading-fold-hidden`/`.heading-fold-heading--foldable`）为跨插件契约——类名是样式细节，改样式即可静默打断吸顶；身份键三套并存（pos / level:text / DOM class）。D7 回归与 TOC pos 漂移回归都源于各口径各自演化。

**简化方案**：在 utils/headingFold 增加导出的 `buildHeadingIndex(doc)`（一趟遍历产出 level/text/pos/foldRange）；fold 插件导出签名/隐藏判定；sticky 的 getVisibleHeadings 改由索引过滤（删 class 嗅探与 posAtDOM 反查）；TOC 消费同一索引并统一口径（建议与 fold 一致只收顶层）；index.ts 删 `_lastTocSignature` 与签名重算，改问插件暴露的签名。CSS class 回归纯样式职责。

**风险**：中。涉及 4 文件与三个用户可见功能；「TOC 不再显示嵌套标题」是行为变更需入 CHANGELOG。分两步落地（先共享索引、再统一口径），每步独立 commit。

### 🔴 P2 · tableSoftBreakPlugin 对抗平台：上游 7.22.1 已自带可配置 hardbreakFilterNodes（已查上游源码实证）

**位置**：`webview/tableSoftBreakPlugin.ts`（注册于 editor.ts:637）；上游 `@milkdown/preset-commonmark@7.22.1`

**当前机制**：自定义 keymap 在 Shift-Enter 时手写祖先遍历判 inCell，再 `replaceSelectionWith(hardbreak.create())` 直接插入，不设置上游命令的 "hardbreak" meta，从而绕过上游 filterTransaction。

**为何过度**（③对抗平台 + ⑥死重的陈旧动机）：**已查上游源码实证**：GFM 7.22.1 的 tableKeymap 只含 NextCell（Mod-]/Tab）/PrevCell（Mod-[/Shift-Tab）/ExitTable（Mod-Enter/Enter）——**已无 Shift-Enter 绑定**；commonmark 7.22.1 自带 `hardbreakKeymap`（Shift-Enter → insertHardbreakCommand）与可配置 ctx `hardbreakFilterNodes = $ctx(["table", "code_block"], ...)`，其 filterTransaction 遍历祖先阻止 table/code_block 内 hardbreak。插件的最初动机（官方 tableKeymap 把 Shift+Enter 绑 goToNextCell）在 7.22.1 已不存在。插件不仅重复实现上游键位，还因缺 meta 跳过上游 hardbreakClearMarkPlugin 的收尾。

**简化方案**：删除 tableSoftBreakPlugin.ts 与注册；在 editor.ts 的 config 回调里加一行 `ctx.update(hardbreakFilterNodes, (nodes) => nodes.filter((n) => n !== "table"))`（保留 code_block 拦截），上游自带 Shift-Enter→hardbreak 即在表格内生效。序列化侧 withTableBreakHandler 与加载侧 convertTableBrForDisplay 不动（那是上游 #2463 的真实边界）。同步改写 tableSoftBreak.test.ts 为该配置的断言并更新过时注释。

**风险**：低-中。行为差异仅一处：上游在「行尾已有 hardbreak 再按 Shift+Enter」时替换为段落（旧实现连插两个）；需手测确认可接受。回退=revert 单 commit。

### 🟠 P3 · findBar 关闭不清防抖 timer：关闭后 150ms 内搜索照常执行（幽灵高亮/滚动）

**位置**：`webview/components/findBar/index.ts:114-118,166,203-206,254-261`

**当前机制**：input 150ms 防抖；close() 只摘 class、清高亮、置空 matchRanges，**不清 clearTimeout**；search() 无 visible 守卫，执行时可能 scrollToMatch(0) 与重注册 CSS.highlights。

**为何过度**（⑤往返放大 + ②状态机缺口的最小化实例）：「关闭」状态与「防抖窗口」两层状态没对齐——close 的清理清单漏了同文件自己创建的 timer。

**简化方案**：close() 加 `clearTimeout(debounceTimer)`；search() 开头加 `if (!visible) return;`。两行改动；补一条「关闭后 pending 搜索不再执行」测试。

**风险**：极低。

### 🟠 P4 · 补全下拉请求生命周期仍双份逐行镜像（防抖/超时/过期守卫/retrigger/失焦关闭）；pathSuggestions 双派发；tech-debt「剩余镜像全清」账实不符

**位置**：`webview/components/pathLink/pathComplete.ts` vs `webview/components/imageView/imgPathComplete.ts`；`webview/ui/pathCompleteCore.ts`；`webview/index.ts:820-822`；`docs/tech-debt.md:39`

**当前机制**：pathCompleteCore 只收敛了「下拉渲染 + 键盘导航」；两个调用方各自保留逐字相同的 PATH_PREFIX_REGEX、id 生成 + pending map + 5s 超时清理、50ms retrigger、200ms 防抖、blur/doc-mousedown 关闭（约 100 行/文件镜像）。index.ts 对每条 pathSuggestions 同时派发两个模块。

**为何过度**（④重复路径）：修一处（过期守卫/超时值/防抖时长）必须改两处；tech-debt.md:39 记录的「剩余镜像全清」与代码事实不符；双派发是 ps_/ips_ 前缀命名空间硬造出的补偿。

**简化方案**：提取 `createSuggestionRequester({ idPrefix, filter, onItems })` 到 pathCompleteCore，两调用方只留 input 绑定与差异化渲染；删双派发改单注册表；修正 tech-debt 记录口径。

**风险**：低-中。纯重构、行为零变化；全量跑 imgPathComplete.test.ts + 补全手测。

### 🟠 P5 · 表格换行一个关注点在加载/序列化/后处理三层共 4 个全文件遍历（含手写 GFM 行解析器 splitTableCells）

**位置**：`src/utils/contentTransform.ts:43-61`；`webview/utils/markdownSerializer.ts:122-207,219-258`；`webview/editor.ts:340-355`

**当前机制**：① 加载 convertTableBrForDisplay 全文件替换 <br>→&#10;；② 序列化 withTableBreakHandler 覆盖 break+text handler；③ 保存后处理 cleanTableBreaks 用**自带 splitTableCells（手写 GFM 单元格切分，含转义追踪）**扫掉「展示性尾部 <br>」；④ preserveTableBreakStyle 再全文件正则统一 <br> 拼写。clean 保存链 = 序列化 → ④ → ③ → applyMinimalChanges。

**为何过度**（⑤往返放大 + ③对抗平台）：①与②是上游 #2463 的真实边界，应保留；但③④是「空单元格被序列化成尾部 <br>」的事后擦除——mdast-util-to-markdown 的 handler 机制本可在 tableCell 层一次性输出正确形态，却选择序列化完成后再用自造解析器反向清洗；④还会把源文件任意一处的 <br> 拼写风格套到全部新 break 上。

**简化方案**：保留①②；将③移入 tableCell/empty-cell handler（删 splitTableCells 与 cleanTableBreaks 全文件扫描）；评估删除④（统一输出规范 <br> 并写入 README）。先写复现用例锁定现有往返行为（tableBrRoundtrip.test.ts 已在）。

**风险**：中。表格序列化是历史 bug 高发区，必须逐项过 tableBrRoundtrip/tableSoftBreak 测试并手测空表/转义管道/多行单元格；分两步：先 handler 化③，观察稳定后再议④。

### ⚪ P6 · TOC 折叠键 level:text 与文档折叠 pos 键两套体系；level:text 键跨文档复用（同名同级标题共享折叠态、折叠状态跨文档继承）

**位置**：`webview/components/toc/index.ts:13-14,27,147-155,195-202`；`webview/headingFoldPlugin.ts:20`

**为何过度**（①补偿性机制）：level:text 键是补偿「pos 键跨文档误折叠」旧 bug 的方案，但补偿引入新问题：同一文档两个同名同级标题共享一个折叠开关；状态无文档身份维度——文档 A 折叠的「## 简介」会静默折叠文档 B 的同名标题。

**简化方案**：二选一：a) 折叠态仅会话内保留、不写 setState（删持久化，彻底消除跨文档继承）；b) 若要持久化，键加入文档身份（init 消息带 docUri，键 = `${docId}:${idx}:${level}:${text}`）。文件头写明：TOC 折叠与文档折叠是独立功能、不合并。

**风险**：低。a 方案是删代码（失去「跨会话记住 TOC 折叠」这一未在 README 承诺的行为）。

### ⚪ P7 · frontmatterPanel 加行按钮三重聚焦保险（同步 + setTimeout(0) + rAF）在补偿从未定位的焦点抢夺者

**位置**：`webview/components/frontmatterPanel/index.ts:183-202`

mousedown 已 preventDefault+stopPropagation 防夺焦，click 里仍叠三层聚焦。对照同仓库 imageView 的 startToolbarInlineEdit 只 focus 一次。

**简化方案**：删二三层保险（保留同步 focus），实测若焦点仍被夺回再单层补回并注释定位到的抢夺者。**风险**：低（前端交互细节）。

## 四、构建与配置（主会话补审）

本域逐文件复核结论：**无独立高优先级发现**。已知问题归入 E2（syncEditorAssociation）/ E6（命令与 when 口径）/ E10（配置广播与调试开关双状态面），不重复报告。其余判定为必要复杂度：

- **esbuild.mjs**（splitting + katex stub 插件 + katex-styles 独立 CSS 入口 + dist 清理）：每一层都有实测依据（6.2MB→1.0MB 入口、1.5MB CSS→75KB、动态 CSS 复制实证、陈旧 chunk 混入 VSIX 实证），已是最简表达；替代方案（pnpm patch）反而更绕
- **l10n 三件套**（package.nls 双份 + webviewTranslations + i18n 词典）：三处消费者不同（Extension 命令/配置文案、webview 运行时词典），词典已有静态一致性测试防漂移——各司其职
- **.github/workflows**：ci.yml 四 job（typecheck→test→build→package）与 publish.yml（marketplace-publish 环境 + 双份 CHANGELOG 拼接 Release 说明）与 AGENTS 管线定义逐项一致，无冗余 job
- **vitest 配置**：extension/webview 双 project + 分模块覆盖率底线（AGENTS 已编码）+ bench 独立配置——与测试规范一致
- **package.json**：customEditors 已在 `1f6c8fa` 简化为 priority:default；命令/快捷键结构问题归 E6/E10

## 五、跨切面状态与消息（主会话补审）

全量消息面盘点：`shared/messages.ts` 共 35 种消息（ToWebviewMessage 21 + ToExtensionMessage 14）。多数是请求-响应配对的固有形态；重叠部分已由 E4（内容拉取重复）、E5（行号三通道）覆盖。本域独立发现：

### ⚪ C1 · init 与 revert 消息同构双类型：webview 侧同一个 handler 处理，类型仅差一个可选字段

**位置**：`shared/messages.ts:46-48`；`webview/index.ts:713-718`

**当前机制**：`init` = {content, active?, lineMap?, scrollToLine?, frontmatter?, imageUriMap?}，`revert` = 同样的载荷减去 active/scrollToLine——两个类型、一份载荷；webview 侧 `if (msg.type === "init" || msg.type === "revert")` 合流进同一 handler，再在内部按 type 分流三个 if。

**为何过度**（④重复路径的小型实例）：类型层面的差异没有行为语义——真正驱动行为的三个 if（active 设置 / window.focus / scrollToLine）都可改为「字段存在即生效」或由 Extension 侧决定。

**简化方案**：合并为单一 `loadDocument` 消息（active/scrollToLine 可选字段语义化：`focusOnLoad`/`scrollToLine`），webview 删三个 type 分流 if；或至少把两个类型定义合并为带 `isInit` 判别——后者收益太小，建议前者。

**风险**：低。纯消息契约重构，行为等价；messaging.test.ts 需同步。

### 判定为必要复杂度（跨切面视角）

- **消息驱动 + 事件驱动并存**（焦点三路：window 事件 / panelActiveState / init.active）：panelActiveState 是多 webview 焦点互抢的根治（VS Code #61489 同类），window 事件是 64d5064 实证的激活信号，init.active 是首帧初值——三层各覆盖一个真实时序，非冗余（F5 已指出唯一可删的 visibilitychange 分支）
- **定时器/防抖全景**（14 个 *_MS 常量 + 各处 setTimeout）：逐个对过用途，300ms 脏标记与 800ms TOC 双防抖各自服务不同延迟目标（autoSave 延迟 vs UI 重建），不合并；冗余的仅 F2（两套重试数组）与 E5（导航多层），已单列
- **webviewState 持久化**（scrollY + toc 状态合并写）：单一 setWebviewState 合并写有注释依据，正当

---

## 执行顺序建议（草案，待全部域返回后定稿）

按「低风险高收益优先、每步独立提交 + verify + 手测」分四批：

**第一批（零风险纯删除，先行清场）**：E8 死机制三件、F8 死代码、P7 三重聚焦保险（保留一层）、E3 死重双生机制（若与第二批 E1/E5 联动需排序，建议先 E8/F8）

**第二批（低风险行为修复，各含真实 bug）**：E1 搜索跳转拦截修复、E2 停止改写用户全局配置、F1 配置双载体统一、P2 tableSoftBreak 删插件改上游配置、P3 findBar timer 清理

**第三批（结构性收敛，需手测矩阵）**：E4 保存路径统一、E5 导航机制收敛、E7 图片往返口径对齐、F2 重试数组合一、F4 交互跟踪合一、P4 补全生命周期合一、P5 表格换行 handler 化、E6 双向命令合并

**第四批（大重构，单独排期）**：P1 标题子系统统一索引、F3 cmObserver 走正路、P6 TOC 折叠键定方案、E9/E10 状态栏与配置广播收敛

---

## 判定为必要复杂度、不报告（已复核）

- **ContentRequestCoordinator 单飞队列**：有「保存 Promise 悬挂、零提示」的真实回归依据
- **fs.watch → 防抖 → SAVE_COOLDOWN → _lastDiskContents 快照 → decideExternalChange 链条**：每层均有数据丢失/外部写盘不采纳的真实回归背书
- **webviewConfigSanitize 与路径边界校验**：安全依据
- **vendor 惰性加载（mermaid/KaTeX）**：首帧性能实测依据（7.7MB→1.5MB）
- **_editorLifecycleChain / releaseDocTimers / 防抖 timer 释放 / themeBus 退订**：均有文档化回归依据（双 createEditor 孤儿化、旧回调污染新文档、监听器泄漏）
- **字数/TOC 双 rAF 延迟 + 签名缓存**：firstRender.bench 首帧依据
- **PendingRequestRegistry**：已完成的样板统一（替代三处手写不一致）
- **cellClickFixPlugin**：已登记 tech-debt「上游修复后移除」类 workaround，不重复报告
