# 全面代码审计记录 — 2026-09-08

> 审计方式：6 个审计域并行子代理深度审计（Extension 核心 / WebView 核心与消息层 / 组件层 / 插件与工具层 / 安全与边界 / 文档对齐与测试），覆盖全部源码；每条发现均以 read + grep 实证（文件:行号）。
> 审计对象：v1.2.0 发布前代码基线（dev @ `1af9291`）。
> 严重级：critical = 数据丢失/安全/崩溃级；major = 竞态、泄漏、用户可见故障隐患、分层混乱；minor = 可维护性/质量；nit = 风格。

## 结论概览

| 级别 | 数量 |
| :--- | :--- |
| 🔴 critical | 3 |
| 🟠 major | 26 |
| 🟡 minor | 39 |
| ⚪ nit | 15 |

- **交叉验证**：保存拉取单槽竞态、openUrl 无白名单、themeBus 订阅泄漏 3 条被两个独立审计域分别命中。
- **现场复核**：`epytor.codeBlockMaxHeight` 死配置（CSS 变量零消费方）与 CHANGELOG.zh-CN.md 未提交 diff 均已由主 agent 独立 grep/git 复核确认。
- **系统性根因**：① 保存/面板/webview 会话无显式状态机，竞态治理靠散点布尔 + 裸 setTimeout；② 失败路径静默（多处无 catch 空回调）；③ 死代码/魔法数字/文档漂移以「批次清偿」方式治理，无机制性兜底。

## 修复波次计划

| 波次 | 范围 | 条目 |
| :--- | :--- | :--- |
| ① 数据安全 | critical + 静默失败 + 过期内容写盘 | A1-A3、B1-B3、C1 |
| ② 状态机主线 | 显式状态建模 | A4、B4-B6、E4（滚动定位三合一） |
| ③ 抽象/分层 | 拆模块 + 提抽象 | B7-B8、D1-D2、E1-E3 |
| ④ 清理收尾 | 死代码/魔法数字/i18n/文档 | 其余 minor/nit |

---

## 审计域 A：Extension 核心（状态机 / 竞态 / 资源生命周期）

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| A1 | 🔴 | MarkdownEditorProvider.ts L35/L474-481/L640-654 | 保存拉取单槽竞态：四路并发拉取互相覆盖，一次保存永不 resolve、不写盘、零提示 | per-document 单飞/等待队列 + requestId 关联回包；保存入口加 saving 锁 |
| A2 | 🔴 | MarkdownEditorProvider.ts L394-419 | 外部写盘永远不被采纳：「回退前内存快照 vs 新盘内容」未比较，静默置脏后覆盖外部写入 | 比较回退前内存快照与新盘内容决定采纳/保留；保留分支走 _markDirty；conflict 显式建模 |
| A3 | 🟠 | MarkdownEditorProvider.ts L648-652/L672-678/L701-707 | Save As / 热退出备份 / 拉取超时兜底三处用过期内存写盘，无「内容可能过期」信号 | 均先走 _requestContent；超时兜底触发时 showWarningMessage |
| A4 | 🟠 | MarkdownEditorProvider.ts L44-63/L98-101/L537-538 | 无显式状态机：dirty/saving/conflict 靠散点 Map/布尔/裸定时器猜；导航抑制全局单布尔殃及其他文档 | per-document 状态联合类型 + 转换表；导航抑制改 per-document token |
| A5 | 🟠 | extension.ts L102-146 | revealLine 全局拦截向所有 md 面板广播行号，分屏错文件滚动；非 md 编辑器定位被吞 | 仅转发当前活跃目标文档，其余委托原生 revealRange |
| A6 | 🟠 | MarkdownEditorProvider.ts L784-801 | 图片路径正则不支持含空格/括号路径（Windows），图片破裂 + 保存往返改坏该行 | 整体捕获 + 剥引号；解析失败原样保留并 debug 日志；仅在完整解析且文件存在时登记 uriMap |
| A7 | 🟠 | MarkdownEditorProvider.ts L500-509/L528-533 | frontmatterUpdate / switchToTextEditor 写盘失败无 catch，静默失败 + 脏标志滞留 | 统一带错误处理的保存出口 + 用户可见反馈 |
| A8 | 🟡 | MarkdownEditorProvider.ts L253-268/L387-423/L181-192 | _lastSaveTimes/_frontmatterMap/_pendingNavigations 无界累积；状态栏项永不 dispose；watcher 防抖 timer 与异步创建窗口泄漏 | dispose 清单补全；_pendingNavigations 加 TTL；Provider 实现 Disposable |
| A9 | 🟡 | messaging.ts L21-23 | notifyUpdate 与 Provider update case 仅测试引用，伪兼容路径带全套副作用 | 删除或降级为 debug 日志丢弃 |
| A10 | 🟡 | MarkdownEditorProvider.ts L512-516 | openUrl 无协议白名单直接 openExternal | http/https/mailto 白名单，白名单放 shared 常量 |
| A11 | 🟡 | MarkdownEditorProvider.ts L850-851/L1027/L1044 | CANDIDATE_DIRS/IMAGE_EXTS 两处重复定义；路径建议截断 15 裸写 | 提取到 imageService 导出；命名常量 |
| A12 | 🟡 | imageService.ts L263-268/L282-298 | 上传响应不校验 HTTP 状态码，服务端错误伪装成「非 JSON 响应」 | 非 2xx 直接 reject 并携带状态码 |
| A13 | ⚪ | MarkdownDocument.ts L53-57 | revert 忽略取消令牌（死参数） | 读取前/写内存前检查 isCancellationRequested |
| A14 | ⚪ | extension.ts L15-29/L36-40 | activate 无条件改写用户全局 editorAssociations，注释术语不一致，update 未 await/catch | 写入前 diff + await/catch 降级 |
| A15 | ⚪ | MarkdownEditorProvider.ts L627-634 | _markDirty 的 undo/redo 空实现，VS Code 菜单撤销无响应 | 转发 undo/redo 消息或明确写入已知限制 |

### A 域亮点

- 拉取式保存单点拉取 + 3s 超时兜底 + 面板销毁时挂起请求兜底；语义常量集中命名（*_MS）；fs.watch 绕过 Extension Host 写盘不可见 + 200ms 防抖 + 自写抑制；切换文本编辑器前强制 flush；图片上传失败双通道反馈；纯函数分层可单测；CSP nonce + localResourceRoots 收敛。

## 审计域 B：WebView 核心与消息层（分层 / 抽象 / 全局状态）

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| B1 | 🟠 | editor.ts L465-480 | updateNotifyPlugin 首帧 prevDoc=null 假脏标记：点击定位光标即出脏点 | create 完成时初始化 prevDoc；或 dirty 状态机双条件驱动 |
| B2 | 🟠 | index.ts L280-284/L348-354 | revert 重建编辑器不清 _docChangedTimer/_tocRefreshTimer，旧防抖回调把已还原文档标脏 | 销毁路径统一 releaseTimers；防抖归属编辑器生命周期 |
| B3 | 🟠 | editor.ts L520-534 | onThemeChange 退订函数被丢弃：每次 init/revert 泄漏监听器 + 旧文档 mermaidCodeMap 滞留 | 保存退订句柄随编辑器销毁调用；补「重建 N 次 listeners.size 不变」回归测试 |
| B4 | 🟠 | index.ts L836-847/L343-356 | 消息处理器可重入：init/revert 并发可创建双编辑器实例并孤儿化 | 消息处理串行化队列或生命周期状态机（idle/creating/ready） |
| B5 | 🟠 | index.ts L132-250/L453-459/L571-735/L772-818 | index.ts 999 行混装 8 类职责，与 components/ 分层惯例断裂 | 拆分 codeBlockEnhance/topBarBrand/scrollPersistence/linkBehavior 模块 |
| B6 | 🟠 | editor.ts L574-866 | buildTopBar 290 行巨型配置函数 + 8 处 any（tech-debt「类型安全已清偿」未达成） | 按按钮组拆 webview/components/topBar/*；类型从 Crepe 上下文推导 |
| B7 | 🟠 | index.ts L156-250/L453-459 | 请求/响应关联样板复制 3 份且不一致：imagePicker 内联版无超时、id 无随机后缀；handleGetProjectImages 死代码 | requestWithTimeout 工厂统一；删除死代码 |
| B8 | 🟡 | index.ts L858-924 | 滚动定位重试状态机三份复制粘贴 + 硬编码延迟数组两遍 | pendingScroll 单一状态机 + 延迟策略表 |
| B9 | 🟡 | index.ts L650-676 | 语言列表键盘导航以 DOM class 为唯一状态源，重渲染丢高亮、无 Escape | {open, activeIndex} 显式状态 + 重渲染恢复 |
| B10 | 🟡 | messaging.ts L91-95 | onMessage 无运行时校验，event.data 直接断言 + 未知类型静默丢弃 | source/形状最小守卫 + 未知 type warn + 载荷校验 |
| B11 | 🟡 | index.ts 多处 | 语义数字大量裸写（超时 15000/10000/30000、防抖 300/800、重试序列等） | 收编 shared/constants.ts（*_MS 命名） |
| B12 | 🟡 | utils.ts L1-44 | webview/utils.ts 整文件死代码；另有 getCellCoords/showTooltipAt/onOutsideMousedown/selection 空回调 | 删除；灯箱关闭逻辑与 bindLightboxDismiss 同构需评估复用 |
| B13 | 🟡 | ui/icons.ts L17-72 | 约 20 个孤儿图标导出（selectionToolbar 清理后的第二批） | 删除零引用导出；引入 lint 规则防再生成 |
| B14 | 🟡 | index.ts L430-440 | 滚动热路径无节流：每事件全量 querySelectorAll + 合成 pointerleave 派发 | 无打开浮层直接 return；rAF 节流；与滚动保存共用基础设施 |
| B15 | ⚪ | index.ts L406-407/L445 | 重复注释 + 无注释空 catch（图片选择器路径静默吞错，与拖拽/粘贴路径口径不一） | 删重复注释；空 catch 补注释或统一错误处理函数 |

### B 域亮点

- 33 处 postMessage 全收敛于 messaging.ts（唯一通信层契约）；脏标记 300ms/TOC 800ms 分层防抖 + 标题签名跳过重建（有实测依据注释）；frontmatterPanel 状态封装范例（disposed+防抖+flushSave）；滚动定位的用户交互保护（_userInteracted）；tooltip 横向定位抽纯函数可测；cellClickFixPlugin 上游 workaround 台账登记。

## 审计域 C：组件层（重复代码 / 单一职责 / 鲁棒性 / 死代码）

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| C1 | 🟠 | imagePicker/index.ts L80/L101 | attachImgPathComplete 的 detach 被丢弃：每开一次对话框泄漏 document 监听；关闭后防抖回调可让下拉游离复活 | 保存 detach 并在 close() 调用；showDropdown 前校验 input.isConnected |
| C2 | 🟠 | imgPathComplete.ts L167-178 | 补全响应无过期守卫：晚到旧请求覆盖当前下拉（pathComplete 至少有元素守卫） | 请求 id 校验 latestId；过期丢弃 |
| C3 | 🟠 | imagePicker/index.ts L55-58/L105 | fileInput 嵌套在 dropZone 内且 click 无 stopPropagation：合成 click 冒泡回 dropZone 递归 | input 移出 dropZone 或 stopPropagation；label 语义关联 |
| C4 | 🟠 | imageView/index.ts L463-468 | 图片重命名失败被 .catch(() => {}) 吞掉：输入框复位，用户以为成功实际未变 | catch 恢复原值 + 可见错误提示 |
| C5 | 🟠 | imagePicker/index.ts L112-117 | 上传失败静默：选完文件立即关对话框，上传失败无任何反馈 | 对话框 loading 态，成功才 close；失败展示错误 |
| C6 | 🟠 | findBar/index.ts L191-194/L242-249 | close() 不清防抖 timer：关闭后高亮与滚动「复活」 | clearTimeout + search() 入口 visible 守卫 |
| C7 | 🟠 | toc/index.ts L130-135/L175-182 | 折叠状态以文档 pos 为键且跨文档持久化：切换文件/编辑后错误折叠、跳转错位 | 稳定标识（签名/序号）作键；revert/init 时重建或清空 |
| C8 | 🟠 | pathComplete.ts L13-18/L110-159/L186-220 | pathComplete 与 imgPathComplete 结构性重复仍是主体（下拉渲染/键盘导航逐行镜像、常量三对双份），已产生行为不对称 | 抽 ui/pathCompleteCore 共享模块，参数化差异 |
| C9 | 🟡 | imageView/index.ts L296-312/L343-350/L654-663 | NodeView.destroy() 清理不完整：重试 timer/拖拽 window 监听/lightbox keydown 不释放 | destroy 内 clearTimeout + 移除监听 + 复用 close 清理 |
| C10 | 🟡 | imageView/index.ts L635/L638-642 | image-toolbar--below 类无任何 CSS 定义且不对称残留 | 删除或补 CSS/对称移除 |
| C11 | 🟡 | mermaidZoom/index.ts L12/L30/L76 | dataset.mermaidZoomKey 与 _seq 只写不读，纯死代码 | 删除；防重复挂载改查已有 bar |
| C12 | 🟡 | index.ts L190-225/L453-459 | handleGetProjectImages 死代码；内联版丢失 10s 超时兜底，Extension 不响应时永久 Loading | 复用或删除；组件侧竞速超时 |
| C13 | 🟡 | toc/index.ts L369-370 | TOC 36px 与 DEFAULT_TOPBAR_HEIGHT=40/findBar 40px 口径矛盾，JS/CSS 四处硬编码 | 查证实际值统一 TOPBAR_HEIGHT 单一来源 |
| C14 | 🟡 | imageView/index.ts L288 | 加载占位硬编码英文 "Loading..."（翻译键已存在未使用） | 走 t("Loading...") |
| C15 | 🟡 | imagePicker/index.ts L120-133 | imagesLoaded 请求前置 true 且失败不复位：失败后无法重试 | pending/loaded/failed 三态 + 重试 |

### C 域亮点

- topBarOverflow 防御最强（measure 期间 disconnect observer 防自触发循环、rafId 去重、dispose 全释放）；frontmatterPanel 生命周期契约（含回归测试）；startToolbarInlineEdit 抽象方向正确；findBar 可访问性（CSS Custom Highlight API 不污染 DOM）；tableGridPicker 单例管理规范；toc 的 clamp/拖拽阈值/钉住守卫。

## 审计域 D：插件与工具层（性能 / 死代码 / 魔法数字 / 边界）

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| D1 | 🔴 | utils/frontmatter.ts L15-23 | 嵌套/多行 YAML frontmatter 经面板编辑后静默丢失内容并立即写盘 | 解析保留非键值行为 raw 段，序列化原样拼接；或检测不支持结构时禁用编辑 |
| D2 | 🟠 | utils/findMatches.ts L38-47 | 查找匹配数无上限，病态正则数十万匹配冻结 WebView | 匹配上限（如 5000）+ 正则按查询缓存 + 分批注册 Highlight |
| D3 | 🟠 | headingStickyPlugin.ts L38-45 | findHeadingPos 全文档遍历且无提前退出，缓存失效后滚动退化 O(H×N) | posAtDOM 反查（O(depth)）或单遍建映射 |
| D4 | 🟡 | headingStickyPlugin.ts L186-194 | update 对纯选区事务也触发缓存失效与全量测量 | 比较 doc.eq(prevState.doc) |
| D5 | 🟡 | headingStickyPlugin.ts L63/L83-86/L273-289 | 点击吸顶条后滚动条交互无法解除 suppressSticky（需人工确认） | suppress 加超时或按滚动来源解除 |
| D6 | 🟡 | headingFoldPlugin.ts L115-124 | 折叠隐藏判定 O(块数×折叠数) some 扫描 | 区间排序合并 + 双指针 O(N+H) |
| D7 | 🟡 | utils/headingFold.ts L36-41 | 折叠（doc.forEach 仅顶层）与吸顶（DOM 全层级）标题口径不一致（需确认 schema） | 共用 descendants 标题收集器 |
| D8 | 🟡 | headingFoldPlugin.ts L178-214 | 折叠隐藏内容缺乏光标进出防护（需人工确认） | 实测后补方向键拦截 + 手测清单 |
| D9 | 🟡 | utils/mermaidZoom.ts L4 | MERMAID_ZOOM_MIN=0.2 与 spec/AGENTS/roadmap 的 0.4 漂移（需确认最终区间） | 统一口径或改代码 |
| D10 | 🟡 | shared/tableWrap.ts L4 | TableWrapMode 联合类型死导出，参数退化为宽 string | 收窄签名或在边界白名单校验 |
| D11 | 🟡 | utils/slug.ts L15-24 | slugify 生产死代码（唯一引用是自身测试） | 删除或恢复用途 |
| D12 | ⚪ | utils/topBarOverflow.ts L10 | TopBarMeasuredItem.isDivider 只写不读 | 删除字段或让 computeOverflow 消费 |
| D13 | ⚪ | headingStickyPlugin.ts L190-193 | 缓存重建防抖 300 裸魔法数字 | CACHE_REBUILD_DEBOUNCE_MS |
| D14 | ⚪ | utils/tableWrap.ts L11 | 「三档映射」注释与已简化两档矛盾 | 修正注释 |

### D 域亮点

- headingFold 单遍 O(n) 栈式算法 + 签名缓存 + bench 文件；headingSticky 文档坐标缓存 + rAF 合并 + 完整 destroy；minimalDiff 有界 LCS（Uint16Array + 4 万上限 + 唯一锚点分段）；cleanTextHandler 与官方序列化器逐行一致；vendor 虚拟光标 [epytor] 标记治理规范；utils 全部无 DOM 依赖可 jsdom 单测。

## 审计域 E：安全与边界

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| E1 | 🟠 | MarkdownEditorProvider.ts L742/L756/L761 | 工作区配置值未经转义拼入 WebView HTML，恶意仓库设置可注入任意 HTML/CSS | 插值前白名单/转义（CSS 校验、枚举映射），或 setProperty 运行时注入 |
| E2 | 🟠 | MarkdownEditorProvider.ts L640-654 | 保存拉取单槽竞态（与 A1 交叉验证） | 同 A1 |
| E3 | 🟡 | Provider L512-516 / index.ts L423-427 | openExternal 前无协议白名单（与 A10 交叉验证） | 同 A10 |
| E4 | 🟡 | Provider L574-584 / imageService.ts L245/L263-268 | 上传载荷与响应体无大小上限 | 上传前 byteLength 校验 + 响应累积上限 |
| E5 | 🟡 | imageService.ts L284-296 / Provider L835-839 | 错误消息回显服务器响应体前 200 字符（可能含 token） | 只保留错误类型与状态码，不回显响应体 |
| E6 | 🟡 | imageService.ts L83-98 / Provider L849-863 | imageLocalPath 无路径边界校验，可被 workspace 设置指向任意目录 | 越界降级默认目录并提示 |
| E7 | 🟡 | Provider L326-376 / pathLink L6-7 | openFile 可打开任意本地文件（绝对路径与 .. 逃逸），钓鱼/隐私边界 | 归一化后工作区/文档目录前缀校验 |
| E8 | 🟡 | extension.ts L65 等 | debugMode 日志落绝对路径（轻度隐私） | 改 basename/相对路径 |
| E9 | ⚪ | Provider L938-947 | safeBasename 未拦截 Windows 保留设备名（CON/PRN/…） | 追加保留名检查 |

### E 域亮点

- CSP default-src 'none' + nonce（128 位熵）+ localResourceRoots 收敛；上传 30s 超时 + destroy + 失败清理；imageServerExtraParams 不进日志/面板；动态 UI 全 DOM API 构建（无 innerHTML 拼接）；pending 回调 map 均有超时清理与 settled 幂等；重命名防覆盖 + 非法字符过滤；消息协议单一权威来源。

## 审计域 F：文档对齐与测试质量

| # | 级别 | 位置 | 问题 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| F1 | 🟠 | Provider L711/L756 + style.css | epytor.codeBlockMaxHeight 死配置：CSS 变量零消费方；回退 500 ≠ 默认 600（已复核） | 补消费规则 + 统一回退值 + 更新 tech-debt 结论 |
| F2 | 🟠 | README.md/zh L35 | Features 仍宣传已移除的「1 秒防抖自动保存」，与同文件 L44 自相矛盾 | 改为原生 files.autoSave 口径 |
| F3 | 🟠 | webviewTranslations.ts L2-102 | 4 个在用键缺翻译（Add/More/Expand/Collapse）+ 39 个死键（41%） | 补 4 键 + 删 39 死键 + verify 加词典一致性校验 |
| F4 | 🟡 | README.md/zh L25 | 仍写已废弃三档换行 normal/aggressive/none | 改两档 wrap/nowrap |
| F5 | 🟡 | l10n/bundle.l10n.json | 缺 3 个在用键、多 1 个死键，zh 下 3 条错误提示回退英文 | 重新导出 + 加导出校验步骤 |
| F6 | 🟡 | mermaidZoom.ts L4-6 | CHANGELOG/README/AGENTS 写 0.4×，代码 0.2×（与 D9 同一问题） | 统一 |
| F7 | 🟡 | vitest.config.ts L41-44 | AGENTS 分模块覆盖率底线未编码，本地 verify 不跑覆盖率 | per-file thresholds + verify 带 coverage |
| F8 | 🟡 | tech-debt.md L52-55 | 「行覆盖率 100%」与可见未测分支矛盾（imageService） | 补用例后按实际数字修正 |
| F9 | 🟡 | imageService.test.ts L97-103 等 | 多处测试名不副实（断言不验证标题承诺） | 修正断言或标题 |
| F10 | 🟡 | tableLinkDomProbe.test.ts L70-78 vs style.test.ts L86-91 | 两个回归测试对 .milkdown-table-block 存在性断言互相矛盾 | 补行/列选中后 DOM probe 定真伪 |
| F11 | 🟡 | CHANGELOG.md L8-42 | 漏报 listLiftPlugin 移除（用户可感知键盘行为变更） | 补 Changed/Fixed 条目 + 发布流程加逐提交比对 |
| F12 | 🟡 | CHANGELOG.md L15/L23-24/L36/L41 | 多条写内部实现机制，违反「面向用户」口径；IME-aware 已随重构移除 | 改写行为级表述；死代码清理条目移 tech-debt |
| F13 | ⚪ | README.md/zh L13-19 | 顶部整段开发历史（含版本号），写错读者 | 删除，保留上游致谢 + CHANGELOG 链接 |
| F14 | ⚪ | CHANGELOG.md L8 | 日期早于所含改动、zh-CN 有未提交 diff（已复核确认） | 发布时更新日期 + 提交未提交 diff |
| F15 | ⚪ | frontmatterPanel.test.ts L4-6 | flushPromises 死助手（真实 setTimeout + fake timers 下埋雷）；mock 清理缺口 | 删除死助手 + 补 clearAllMocks |

### F 域亮点

- 双份 nls 26 键 100% 对称；14 项配置 13 项有完整使用链（README 设置表与 package.json 逐项一致）；CHANGELOG 1.2.0 双份完全对称且几乎每条有代码支撑；测试套件无 it.skip/真实等待；关键模块错误路径测试深度到位。

---

## 附：与 tech-debt 的关系

- 本记录中标注「已复核」的条目推翻或补充了 tech-debt 旧结论：F1 推翻「无死配置」、A6/B6 补充「类型安全未达成」、D1 补充 slug.ts 连带清理。
- 修复完成后，已清偿条目按项目惯例移入 `docs/tech-debt.md` 已清偿区，未修条目登记待处理区。
- 用户未跟踪的 `docs/specs/2026-09-06-typora-replication-assessment.md` 不属本审计范围，未读取未改动。

## 修复进度（2026-09-08 起按波次推进）

| 条目 | 状态 | 提交 |
| :--- | :--- | :--- |
| A1 保存拉取单槽竞态（critical） | ✅ 单飞+等待队列 ContentRequestCoordinator | `a3df75e` |
| A2 外部写盘永不采纳（critical） | ✅ 已知盘快照判定 + _markDirty + 写盘完成锚定 | `427e90c` |
| A3 过期内存写盘三路径 | ✅ SaveAs/备份先拉取 + 超时警告（l10n 双语） | `4cb0f06` |
| A7 自建保存失败静默 | ✅ _saveWithFeedback 统一出口 | `cf22d87` |
| D1 frontmatter 面板丢行（critical） | ✅ kv/raw 有序条目模型 | `95e2d17` |
| E1 配置注入 WebView HTML | ✅ webviewConfigSanitize 净化 | `68e23ca` |
| C1 补全 detach 泄漏 | ✅ 保存并调用 detach | `0e755f8` |
| C2 补全响应无过期守卫 | ✅ latestId 守卫 + isConnected 双保险 | `0e755f8` |
| C3 fileInput 点击递归 | ✅ 移出 dropZone | `5a0eeeb` |
| C5 上传失败静默 | ✅ 成功才关闭 + 失败提示 + 可重试 | `5a0eeeb` |
| C4 重命名失败静默 | ✅ tooltip 显示宿主侧本地化错误 | `b1767d7` |
| D2 查找匹配无上限 | ✅ MAX_MATCHES=5000 截断 + N+ 计数 | `4f2ed91` |
| B1 首帧假脏标记 | ✅ settle 时初始化 prevDoc 基准 | `a4281b0` |
| B2 revert 不清防抖 timer | ✅ 重建前 releaseDocTimers | `ae3618b` |
| B3 themeBus 订阅泄漏 | ✅ destroyEditor 统一销毁出口（退订+观察器断开） | `ae3618b` |
| B4 消息处理器可重入 | ✅ init/revert 串行链 + 其余消息并行分发 | `de2f96c` |
| B8 滚动定位三份复制 | ✅ scheduleDelayedScroll 状态机合一 | `13a7687` |
| D3 findHeadingPos O(H×N) | ✅ view.posAtDOM DOM 反查 | `e9456cc` |
| D4 纯选区事务触发重建 | ✅ update 仅 doc/折叠状态变化重建 | `e9456cc` |
| D5 吸顶抑制无法解除 | ✅ 400ms 定时兜底解除 + destroy 清理 | `35f9a1a` |
| A4 导航/切换抑制全局化 | ✅ ExpiryWindowMap 按文档时间戳窗口（含 6 测试）；保存态形式化由 A1/A2 结构化解法覆盖 | `8d72086` |
| F2 README 过时自动保存 | ✅ 改为原生 files.autoSave 口径 | `58ed9e4` |
| F4 README 三档换行 | ✅ 改两档 wrap/nowrap | `58ed9e4` |
| F6/D9 Mermaid 缩放漂移 | ✅ 文档统一 0.2×–3× | `58ed9e4` |
| B12 utils.ts 死文件 | ✅ 整文件删除 | `33c6197` |
| A9 notifyUpdate 伪兼容路径 | ✅ 发送/接收/类型/测试全删 | `33c6197` |
| 孤儿图标 22 个 / C10 / C11 / D11 / D12 | ✅ 全删（slug.ts、image-toolbar--below、mermaidZoomKey/_seq、isDivider、getCellCoords、selectionPlugin 空回调链） | `33c6197` |
| B7 请求样板复制三份 | ✅ PendingRequestRegistry 统一（内联版补 10s 超时） | `3f01a47` |
| C7 TOC 折叠 pos 键跨文档污染 | ✅ 稳定键 level:text + 点击实时重查 | `cc80716` |
| F1 codeBlockMaxHeight 死配置 | ✅ 补 .cm-editor 消费规则 + style 回归断言 | `9522e6f` |
| E9 保留设备名未拦截 | ✅ sanitizeBasename 纯函数 + 6 组测试 | `777d407` |
| E3 openUrl 无白名单 | ✅ OPEN_URL_SCHEMES 双端校验 | `a356666` |
| E4 载荷/响应无上限 | ✅ 20MB 载荷拒绝 + 1MB 响应封顶 + 测试 | `f8ae067` |
| E5 错误回显响应体 | ✅ 不再回显（token 泄露风险） | `c388d10` |
| E8 debug 日志绝对路径 | ✅ 改 basename | `d3cedcf` |
| F3 i18n 词典 4 缺 39 死 | ✅ 补 4 删 34 + 静态一致性测试（零死零缺） | `01762a7` |
| A6 图片路径正则不支持空格/括号 | ✅ extractImageSyntaxes（空格 + 一层括号）+ 逐图完整替换 | `9e53ddd` |
| E7 openFile 路径越界 | ✅ isPathWithinBase 工作区边界（独立文件保持现状） | `8e81309` |
| E6 imageLocalPath 越界 | ✅ 工作区级配置越界降级默认目录（用户级信任放行） | `c067365` |
| B10 onMessage 无运行时校验 | ✅ 来源/形状/type 守卫 + 未知类型 debug 可见 | `e5f82d4` |
| C9 NodeView.destroy 清理不完整 | ✅ 重试 timer/拖拽监听/lightbox keydown 全释放 | `d225305` |
| D6 折叠隐藏 O(N×F) | ✅ 区间排序合并 + 双指针单遍 | `a09f182` |
| B14 滚动热路径无节流 | ✅ rAF 节流 + 无浮层零工作 | `9f801f1` |
| F7 覆盖率底线未编码 | ✅ vitest.config per-file thresholds（CI 强制） | `9f801f1` |
| F8 tech-debt 100% 声明 | ✅ 实测复核：imageService 行覆盖确为 100%，原存疑不成立 | `9f801f1` |
| F9 测试名不副实 | ✅ 唯一性测试改真断言（部分） | `9f801f1` |
| F15 flushPromises 死助手 | ✅ 删除 + 补 clearAllMocks | `9f801f1` |
| 其余（波次③分层拆分、B9/B11/B15、D7/D8/D13、F5/F10-F14 收尾） | ⬜ 待续 | — |

