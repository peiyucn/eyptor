# 项目指令 — epytor

## 项目概况

* VS Code「所见即所得」Markdown 编辑器，基于 Milkdown（Crepe）

### 关键文件速查

```
src/extension.ts                         — 扩展入口，注册 CustomEditorProvider
src/MarkdownEditorProvider.ts            — Provider 核心（消息路由、自动保存、revert、文件监听、frontmatter 更新）
src/utils/getNonce.ts                    — CSP nonce 生成
src/utils/imageService.ts               — 图片本地保存（MD5 去重）+ 服务器上传
src/i18n/webviewTranslations.ts         — WebView 翻译数据
webview/index.ts                         — WebView 入口（消息路由、DOM 事件委托、frontmatter 可编辑面板、品牌标识注入）
webview/editor.ts                        — CrepeBuilder 入口（Milkdown 7.22.1 + Crepe 原生功能注册、buildTopBar 定制、序列化配置）
webview/messaging.ts                     — WebView ↔ Extension 消息协议（唯一通信层）
webview/style.css                        — VSCode 主题全覆盖（--vscode-* CSS 变量，覆盖 Crepe 组件）
webview/i18n/index.ts                    — t() / kbd() 翻译函数
webview/ui/icons.ts                      — SVG 图标
webview/ui/tooltip.ts                    — Tooltip 组件
webview/utils/themeBus.ts               — Mermaid/CodeMirror 深浅主题统一事件总线
webview/headingFoldPlugin.ts             — 标题折叠插件（Decoration，不修改文档）
webview/headingStickyPlugin.ts           — 标题吸顶条（滚动跟随 + 推挤过渡）
webview/tableSoftBreakPlugin.ts          — 表格单元格 Shift+Enter 软换行（<br>）
webview/components/toc/index.ts         — 目录（TOC）面板（吸底工具栏下方、可固定、可拖拽宽度）
webview/components/imageView/index.ts   — 图片 NodeView（选中/lightbox/工具栏/缩放 handle）
webview/components/findBar/index.ts     — 编辑器内查找栏（Cmd/Ctrl+F，大小写 + 正则）
webview/components/pathLink/            — 路径链接自动补全
webview/components/tableGridPicker/     — 表格网格选择器（顶栏表格按钮弹出 8×8 网格）
webview/components/topBarOverflow/      — 工具栏溢出菜单（窄窗口按钮收进 ⋯ 面板）
webview/components/mermaidZoom/         — Mermaid 预览缩放（0.4–3× + 控制条）
docs/specs/                              — 功能 spec 文档（2026-09-04-* 为本批 v1.2 功能）
docs/checklists/                         — 手测清单
docs/roadmap.md                          — 项目路线图（面向用户的功能规划）
docs/tech-debt.md                        — 技术债务清单（面向开发者的代码改进）
```

## 文档规范

> 三份文档各司其职、各有读者：AGENTS 给开发 agent、README 给用户、CHANGELOG 给用户——写错读者是文档事故。

* `AGENTS.md`：中文一份（面向开发 agent；唯一 agent 指令文件，不保留 CLAUDE.md 等其它厂商指令文件）
* `README.md` / `README.zh-CN.md`：用户文档——功能介绍、安装方式、配置项、**已知限制**；功能变更或发现新限制时更新
* `CHANGELOG.md` / `CHANGELOG.zh-CN.md`：版本变更记录（[Keep a Changelog](https://keepachangelog.com/) 格式；中英双份、英文为默认、顶部互链）；**发布新版本时**更新
* `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`：贡献指南——开发环境、提交流程、Bug 报告；开发流程或分支策略变更时更新
* `docs/specs/`（功能 spec）、`docs/roadmap.md`（路线图）、`docs/tech-debt.md`（技术债务）：开发过程文档，维护规则见下文「项目专属章节」

## 工程管线（本仓库自含）

* **开发**：日常改动在 `dev`；`main` 只接受发布合并
* **验证**：本地一键 `pnpm run verify`（= typecheck + test + 生产构建）；push 前必须通过
* **提交**：逐项提交，中文描述 + 英文类型前缀（feat:/fix:/refactor:/chore:/docs:）；禁止多任务混一个 commit；不确定的事直接说"不确定"，禁止编造事实性信息
* **推送**：日常目标 `dev`；`git push/fetch` 需要代理 127.0.0.1:7897
* **合并**：dev → main（`--no-ff` 带发布说明）
* **发布**：按下方「发布流程」四阶段执行
* **运维**：依赖升级统一手动（security updates 与 dependabot.yml 关闭）；收到警报 → 判断影响面（运行时/产物依赖才影响用户）→ 手动升级 → 影响用户的按发布流程发版
* **收尾**：发布后切回 `dev`

### 发布流程（必须严格按顺序）

**阶段一：内容确认**（编辑前）

执行任何编辑操作前，必须将以下内容逐项展示给用户确认：

1. `README.md` + `README.zh-CN.md` 是否有本次发布相关的改动
2. `CHANGELOG.md` + `CHANGELOG.zh-CN.md` 新版本 section 的完整内容
3. `docs/roadmap.md` 是否有条目需要标记完成或调整
4. `package.json` 版本号
5. 合并 commit message
6. Tag annotation 内容

**阶段二：编辑 & 验证**

1. **确认所有改动已提交到** **`dev`** **分支**
2. **更新** **`CHANGELOG.md`** **和** **`CHANGELOG.zh-CN.md`**：新版本 section 放在文件最顶部
3. **更新** **`package.json`** **版本号**
4. **运行** **`pnpm test`** **确认全部通过**
5. **运行** **`pnpm build`** **确认编译无误**

**阶段三：最终确认**（编辑后、发布前）

所有编辑完成后，**再次将实际改动展示给用户确认**（CHANGELOG diff、版本号、commit message、tag annotation），用户确认后方可继续。

**阶段四：发布**

1. **合并** **`dev`** **→** **`main`**：`git checkout main && git merge dev --no-ff -m "chore: 合并 dev → main，发布 v<VERSION>"`
2. **推送两个分支**：`git push origin dev main`
3. **打 tag 触发发布**：`git tag -a v<VERSION> -m "v<VERSION>: <简述>" && git push origin v<VERSION>`
4. **切回** **`dev`**：`git checkout dev`

### 发布约定

* publish job 已挂 `environment: marketplace-publish`——Deployments 页留每次发布记录；**不设审批门禁**（tag 即发布）；**无 release-control**；发布凭据 `VSCE_PAT` 配在 `marketplace-publish` **环境级** secret（市场管理页 → Personal Access Tokens → `Marketplace: Manage` 权限），仓库级不保留
* **发布红线**：已发布版本与 tag **不可覆盖、不可挪动**；市场同版本重发会被拒，错误只能**发新版本修正**；tag 一律 **annotated**（`git tag -a` 带一句话说明）

## 代码审计（发布前 / 全面检查时）

* **文档对齐**：README 中英 Settings 表与 `package.json` contributes.configuration 一一对应；文件路径、行为描述与实现一致；CHANGELOG 双份当前版本条目覆盖本版全部用户可感知改动
* **死代码**：grep 每个导出符号与常量确认调用方；删除未使用的 import/导出/变量/类型字段/CSS 类
* **高危 BUG**：状态一致性（散落布尔标志互相覆盖；异步动作由显式状态驱动，动作开始瞬间即置状态）；竞态（自动保存/revert/消息往返并发不撞车，定时器动作结束后清理）；路径与引号（Windows 参数转义含空格路径；临时/缓存目录与持久数据目录区分）；资源/内存泄漏（timer/watcher/AbortController 在成功与失败路径都释放；缓存与累积状态有界——上限/淘汰/随生命周期释放；编辑器实例/Webview 消息订阅/DOM 引用不滞留）；部分失败（图片保存/上传中途失败状态诚实并校验结果）；环境边界（首装/离线/断网/权限不足降级不挂死、有提示）
* **安全热点**：Webview CSP 已设置、动态注入转义；Extension ↔ WebView 消息载荷边界校验；用户配置路径先校验再使用；API key/文件路径不写日志、不进面板 HTML；fetch 带超时 + AbortController；打开的外部 URL 白名单内
* **代码异味**：单一职责（Provider 消息路由/自动保存/revert 各归其位）；可变状态经函数封装；命名表达意图；同类代码结构对称；无超长函数/重复逻辑/魔术字符串
* **魔法数字**：有语义数字（超时/防抖间隔/阈值/步长/缓存时长）命名常量（`*_MS`）
* **鲁棒性**：外部调用（网络/文件）有超时或 best-effort 错误处理；解析/格式化对异常输入返回安全默认值；失败路径用户可见反馈
* **性能**：编辑热路径无 O(n²)/重复计算（文档变更事件按需处理）；Webview 高频事件防抖节流（自动保存延迟、选区回调）；长文档/大量节点渲染不卡顿；重活缓存化（图片 MD5 去重等）
* **并发与防御**：UI 入口连点防护（锁/debounce/disabled/幂等）；保存/上传可被打断且状态一致
* **测试与验证**：纯逻辑改动补测试；覆盖率底线（见「项目专属章节 · 测试」）；`pnpm run verify` 通过 + `git diff --check` 干净

## 安全基线（本仓库自含要点）

* 已开启：Dependabot alerts（仅报警）、CodeQL default setup、secret scanning + push protection、Private vulnerability reporting、根 `SECURITY.md`；检查命令 `gh api repos/peiyucn/epytor --jq .security_and_analysis`
* 分支保护：main 禁强推/删/重建、Squash-only、owner 保留 fast-forward 直推；dev rulesets 轻保护（禁强推+禁删+禁重建）；**CI 会跑但不设硬门禁**——合并外部 PR 前 owner 自己确认 CI 绿
* 外部 PR / Issue 一律开放、不设交互限制，owner 审核合并（Squash-only），不想收的直接关闭

## CI 与自动发布

* **ci.yml**（push/PR 到 `main`/`dev`）：真实过程 `typecheck` → `test`（覆盖率门槛，Vitest Job Summary + 覆盖率 artifact）→ `build` → `package`（vsce），配置见 `.github/workflows/ci.yml`
* **publish.yml**（推送 `v*.*.*` tag）：打包 VSIX → 发布 VS Code Marketplace → 创建 GitHub Release（Release 说明由 publish.yml 拼接两份 CHANGELOG 当前版本条目），配置见 `.github/workflows/publish.yml`

## GitHub 与网络

* 仓库：https://github.com/peiyucn/epytor
* 非 Bug 功能的讨论引导至 [Discussions](https://github.com/peiyucn/epytor/discussions)
* GitHub 操作一律走 `gh` CLI（已登录 peiyucn）；`gh api` 直连、`git push/fetch` 需要代理 127.0.0.1:7897；向上游提 issue 的注意事项见[上游限制](#上游限制)

## 项目专属章节

### 开发

#### 基本规则

* **包管理器**：必须用 `pnpm`，禁止 npm/yarn
* **语言**：全部 TypeScript；Extension 端 `tsconfig.json`，WebView 端 `tsconfig.webview.json`
* **双目标构建**：`dist/extension.js`（Node.js）+ `dist/webview.js`（Browser），由 `esbuild.mjs` 完成
* **调试**：F5 启动扩展调试实例（`.vscode/launch.json`）
* **spec 先行**：新功能先写 spec（`docs/specs/YYYY-MM-DD-<功能名>.md`，明确需求范围、交互边界、验收标准）再开发；配置项参考见[配置参考](#配置参考)
* **诚实原则**：不确定的事直接说"不确定"，禁止编造 URL、issue 编号、API 接口、文档引用或任何事实性信息
* **优雅原则**：禁止 hack 或补丁式写法，优先用框架/库官方 API、CSS 变量、配置回调等正路方案
* **自检原则**：代码移动/提取后**必须**搜索确认旧位置已删除，不留死代码或同名遮蔽；标记 roadmap 条目完成前逐项列出实际完成项与未完成项，不得把部分完成标记为整体完成
* **查证原则**：引用文件位置、函数名、调用关系时，不确定先 grep 确认再写，禁止凭记忆编造

#### 架构约束

* WebView ↔ Extension 通信**只通过** `webview/messaging.ts` 中封装的函数
* WebView 侧不直接 `import` VSCode API，通过 `acquireVsCodeApi()` 获取句柄
* CSS 必须使用 `--vscode-*` 变量以适配亮/暗主题
* 不在模块外部维护全局状态（单例除外，如 editor view）

#### 配置参考

| 设置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `epytor.autoSave` | boolean | `true` | 编辑后自动写盘 |
| `epytor.autoSaveDelay` | number | `1000` | 防抖延迟（ms） |

### 测试

#### 技术栈

| 层次 | 框架 | 适用范围 |
| :--- | :--- | :--- |
| Extension 单元测试 | **Vitest 2.x**（Node 环境） | `src/utils/`、`src/MarkdownDocument.ts` |
| WebView 单元测试 | **Vitest 2.x + jsdom 24.x** | `webview/utils/`、`webview/messaging.ts` |
| 集成测试（计划中） | **@vscode/test-electron + Mocha** | 需真实 VSCode Extension Host |

`vscode` 模块通过 `__mocks__/vscode.ts` 统一 mock，由 `vitest.config.ts` 的 `resolve.alias` 注入，禁止在单个测试文件中 `vi.mock("vscode")`。

#### 命令

```bash
pnpm test              # 一次性运行全部单元测试
pnpm test:watch        # 监听模式（开发期间使用）
pnpm test:coverage     # 运行测试并生成覆盖率报告（coverage/）
```

#### 目录与命名

```
src/__tests__/           — Extension 侧单元测试（Node 环境）
webview/__tests__/       — WebView 侧单元测试（jsdom 环境）
webview/__tests__/setup.ts  — jsdom 全局 setup（注入 acquireVsCodeApi）
shared/__tests__/        — 共享类型测试
__mocks__/vscode.ts      — vscode API 统一 mock
```

* 测试文件命名：`<模块名>.test.ts`，与被测文件同名
* 测试结构遵循 **AAA 原则**（Arrange / Act / Assert），`describe` → `it` 两层
* `it` 描述格式：`输入条件 应该 期望结果`（中文）

#### 覆盖率要求

| 模块 | 行覆盖率下限 |
| :--- | :--- |
| `src/utils/imageService.ts` | ≥ 85% |
| `src/utils/getNonce.ts` | 100% |
| `src/MarkdownDocument.ts` | ≥ 80% |
| `src/utils/contentTransform.ts` | ≥ 90% |
| `src/utils/lineMap.ts` | ≥ 90% |
| `webview/utils/slug.ts` | ≥ 90% |
| **整体** | ≥ 70% |

#### 强制流程

* **一键验证入口**：`pnpm run verify`（= typecheck + test + 生产构建）

**每次代码改动**（bug 修复、新功能、重构还债）必须完整走完：

```
代码改动 → pnpm run verify → 输出手测清单 → vscode_askQuestions 逐项确认 → git commit
```

**阶段一：自动化验证**

1. 运行 `pnpm run verify` 确认全部通过
2. 任一失败则先修复，不得跳过

**阶段二：人工验收**

1. **输出手测清单**：列出受影响的交互路径和验收点，每条一行，编号排序
2. **逐项确认**：通过 `vscode_askQuestions` 弹出确认框（每屏 ≤4 项，超过则分屏）
3. 开发者逐项选择「✅ 通过」或「🛑 有问题」
4. 全部通过 → 进入阶段三；有任一未通过 → 修复后重新从阶段一开始

**阶段三：提交**：方可 `git commit`（逐项提交，见上文「工程管线」）

**附加要求**：

* **功能开发后**：编写对应单元测试（核心逻辑、边界值、异常路径各至少一个用例）
* **Bug 修复后**：先补充**能复现该 bug 的测试用例**（写在修复同一 commit 内），确认该用例在修复前失败、修复后通过
* **git push 前**：**必须**执行 `pnpm run verify`，全部通过才允许推送

#### 测试失败处理

```
测试失败
  │
  ├─ 是新引入的失败？→ 定位代码变更，修复后重新运行
  │
  ├─ 是测试预期不符实现（实现已有意变更）？→ 同步更新测试
  │
  └─ 是环境/依赖问题？→ 检查 jsdom 版本、vscode mock 是否完整
```

**禁止行为**：

* 禁止跳过（`it.skip`）或注释失败的测试用例来让 CI 通过
* 禁止修改测试预期值来掩盖 bug（除非实现有意变更且经过评审）
* 禁止在未运行测试的情况下 push 到 `main` 或 `dev` 分支
* 分支保护与安全开关见上方「安全基线」小节

#### Mock 规范

* 每个 `describe` 块在 `beforeEach` 中调用 `vi.clearAllMocks()` 重置 mock 状态
* 文件系统操作统一 mock `vscode.workspace.fs`（禁止使用真实 fs 写磁盘）
* 依赖时间的逻辑使用 `vi.useFakeTimers()` / `vi.useRealTimers()`，禁止 `setTimeout` 真实等待
* 禁止测试 `private` 类方法，通过公共接口验证行为

### Issue 管理

**标签体系**：

| 标签 | 用途 |
| :--- | :--- |
| `bug` | 已确认的 bug |
| `bug` + `known-limitation` | 已知限制（开发完成后仍未修复的问题） |
| `enhancement` + `roadmap` | 计划功能（处于路线图中） |
| `enhancement` | 其他功能改进 |

**与路线联动**：

* Issue 状态变化影响路线时，同步更新 `docs/roadmap.md`
* 路线图中的条目如有对应 Issue，在 roadmap 中标注 issue 编号

**模板**：

Issue 使用 `.yml` Issue Forms（结构化表单），模板文件见 `.github/ISSUE_TEMPLATE/`：

| 模板 | 文件 | 自动标签 |
|------|------|----------|
| Bug 报告 | `bug_report.yml` | `bug` |
| 功能需求 | `feature_request.yml` | `enhancement` |

* `blank_issues_enabled: false`（`config.yml`），强制使用模板，不允许空白 issue
* 标签由模板 `labels:` 字段自动设置，用户无需手动选择
* **开发过程中触发**：出现以下情况时，主动提醒用户创建 Issue：
  * 发现无法在本次修复的 bug
  * 产生新功能想法但暂不开发
  * 发现需要记录的技术债务
  * 提示语示例："这个 bug 暂时修不了，需要创建一个 Issue 记录吗？"

### 路线

* 项目路线图见 `docs/roadmap.md`，**仅记录未来计划**，不写已发布的版本内容
* 规划新功能或阶段进度有变化时同步更新

### 上游限制

以下限制来自 Milkdown / Crepe / ProseMirror 等上游依赖，EPYTOR 无法自行修复。升级上游依赖时需逐项验证是否已解决。

> 最近验证：2026-09-05（Milkdown 7.22.1）——三项仍全部 open，未解决；自动化回归断言见 `webview/__tests__/upstreamRegression.test.ts`。

| # | 限制 | 来源 | 追踪 |
|---|------|------|------|
| 1 | 行内样式（粗体、斜体、行内代码等）尾部无后续内容时无法退出 | Milkdown | [Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413) |
| 2 | 有序列表多层级编号均为十进制（不区分 a.b.c. / i.ii.iii.） | Milkdown 内核 | [Milkdown#2415](https://github.com/Milkdown/milkdown/issues/2415) |
| 3 | 表格单击选中整格暂时关闭 | Crepe | [Milkdown#2414](https://github.com/Milkdown/milkdown/issues/2414) |

**维护规则**：

* 发现新的上游限制时追加到此表，同时在各 `README` 已知限制中标记 `⚠️ 上游` / `⚠️ Upstream`
* 升级依赖版本时对照此表逐项验证，已解决的条目从表中移除，写入 CHANGELOG 的 Fixed
* 优先在对应上游仓库提 issue，将链接填入"追踪"列
* **向上游提 issue 时必须遵循对方模板规范**：标题带 `[Bug]` 或 `[Feature]` 前缀，正文结构化（复现步骤 / 期望行为 / 实际行为 / 运行环境）。若对方使用 `.yml` Issue Forms，`gh issue create` CLI 无法触发模板校验，需手动对齐模板要求的字段
