# 项目指令 — epytor

## 项目概况

VS Code「所见即所得」Markdown 编辑器，基于 Milkdown（Crepe）。

* `src/` — Extension 端：`extension.ts`（入口，注册 CustomEditorProvider）、`MarkdownDocument.ts`（文档模型：内容 / 脏标记 / 保存原语）、`MarkdownEditorProvider.ts`（Provider 核心：消息路由 / 自动保存 / revert / 文件监听 / frontmatter）、`utils/`（路径越界防护、文件名净化、配置净化、行号映射、图片保存、外部变更判定等）
* `webview/` — WebView 端：`index.ts`（入口与消息路由）、`editor.ts`（CrepeBuilder：Milkdown 7.22.1 + Crepe 注册 + 顶栏定制）、`components/`（toc / imageView / findBar / pathLink / tableGridPicker / topBarOverflow / mermaidZoom / frontmatterPanel / codeBlockEnhance / imagePicker / topBar）、`utils/`（序列化、最小行改动、折叠、查找、请求生命周期、视口记账等）、`vendor/`（vendored 的上游 feature：latex / virtual-cursor）
* `shared/messages.ts` — Extension ↔ WebView 消息类型契约（**唯一真源**）；`shared/constants.ts`、`shared/tableWrap.ts` — 双端共享常量
* `webview/messaging.ts` — WebView ↔ Extension 的**唯一通道**
* `docs/` — `specs/`（功能 spec）、`checklists/`（手测清单）、`tech-debt.md`（技术债务）、`upstream-limits.md`（上游限制明细）

## 文档规范

> AGENTS 给开发 agent、README 给用户、CHANGELOG 给用户——写错读者是文档事故。

* `AGENTS.md`：中文一份；唯一 agent 指令文件（不留 CLAUDE.md 等其它厂商指令文件）
* `README.md` / `README.zh-CN.md`：功能介绍、安装方式、配置项、**已知限制**；中英双份、英文默认、顶部互链；**面向用户**——只写用法与行为，不写实现细节、私有 seam、开发历史
* `CHANGELOG.md` / `CHANGELOG.zh-CN.md`：Keep a Changelog 格式，中英双份、英文默认、顶部互链；**面向用户**——每条 = 一条用户可感知的变化（一句话、行为级）——**纯依赖版本除外**，那种版本按《运维》如实写「无用户可感知的变化」
* `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`：开发环境、提交流程、Bug 报告

## 工程管线（本仓库自含）

* **开发**：日常改动在 `dev`；`main` 只接受发布合并
* **验证**：`pnpm run verify`（= typecheck + test + 生产构建）；push 前必须通过
* **提交**：逐项提交，中文描述 + 英文类型前缀（feat:/fix:/refactor:/chore:/docs:）；一个 commit 只做一件事
* **推送**：日常目标 `dev`
* **合并**：dev → main（`--no-ff` 带发布说明）
* **发布**：按下方《发布流程》执行——**step0 是发布确认硬门禁**
* **运维**：依赖升级统一手动（security updates 与 dependabot.yml 关闭）；收到警报 → 手动升级 → **一律按发布流程走补丁版**；依赖不进产物时 CHANGELOG 如实写「无用户可感知的变化」
* **收尾**：发布后切回 `dev`

### 发布流程（严格按序）

* **step0 发布确认（硬门禁，owner 当次点头）**：`git tag` / 市场发布等**不可逆的对外发布动作**，执行前必须由 owner **当次明确确认**——「之前批准了整条发布流程」「按你建议走」「继续」**不构成**发布许可；agent 停在发布动作之前，一句话报出「要发什么、版本号、目标通道、影响范围」，未回话即视为未批准（根规范《发布（定版）》step5）
* **step1 内容确认（编辑前，逐项展示给用户确认）**：README 中英是否有本次改动；CHANGELOG 中英新版本 section 的完整内容；`docs/specs/` 里相关 spec 是否需标注完成；`package.json` 版本号；合并 commit message；tag annotation 内容
* **step2 编辑 & 验证**：确认改动已提交到 `dev` → 更新 CHANGELOG 双份（新版本 section 放文件最顶）→ 更新 `package.json` 版本号 → `pnpm test` → `pnpm build`
* **step3 最终确认**：把实际改动（CHANGELOG diff、版本号、commit message、tag annotation）再展示给用户确认
* **step4 发布**：`git checkout main && git merge dev --no-ff -m "chore: 合并 dev → main，发布 v<VERSION>"` → `git push origin dev main` → `git tag -a v<VERSION> -m "v<VERSION>: <简述>" && git push origin v<VERSION>` → `git checkout dev`

### 发布约定

* publish job 挂 `environment: marketplace-publish`（Deployments 留记录）；**不设审批门禁**（tag 即发布）；**无 release-control**；发布凭据 `VSCE_PAT` 配在该环境级 secret，仓库级不保留
* **发布红线**：已发布版本与 tag 不可覆盖、不可挪动；市场同版本重发被拒——错误只能**发新版本修正**；tag 一律 annotated

## 代码审计（发布前 / 全面检查时）

* **文档对齐**：README 中英 Settings 表与 `package.json` contributes.configuration 一一对应；文件路径 / 行为描述与实现一致；CHANGELOG 双份覆盖本版全部用户可感知改动
* **死代码**：grep 每个导出符号与常量确认调用方；清未使用 import / 导出 / 变量 / 类型字段 / CSS 类
* **高危 BUG**：状态一致性（异步动作由显式状态驱动，动作开始瞬间即置状态）；竞态（自动保存 / revert / 消息往返并发不撞车，定时器动作结束后清理）；路径与引号（Windows 参数转义含空格路径）；资源 / 内存泄漏（timer / watcher / AbortController 在成功与失败路径都释放；缓存与累积状态有界；编辑器实例 / Webview 消息订阅 / DOM 引用不滞留）；部分失败（图片保存 / 上传中途失败状态诚实并校验结果）；环境边界（首装 / 离线 / 断网 / 权限不足降级不挂死、有提示）
* **安全热点**：Webview CSP 已设置、动态注入转义；Extension ↔ WebView 消息载荷边界校验；用户配置路径先校验再使用；API key / 文件路径不写日志、不进面板 HTML；fetch 带超时 + AbortController；外部 URL 走白名单
* **代码异味**：单一职责（Provider 消息路由 / 自动保存 / revert 各归其位）；可变状态经函数封装；命名达意；同类对称；无超长函数 / 重复逻辑 / 魔术字符串
* **魔法数字**：语义数字（超时 / 防抖间隔 / 阈值 / 步长 / 缓存时长）命名常量（`*_MS`）
* **鲁棒性**：外部调用（网络 / 文件）有超时或 best-effort 处理；解析 / 格式化对异常输入返回安全默认值；失败路径用户可见
* **性能**：编辑热路径无 O(n²) / 重复计算；Webview 高频事件防抖节流（自动保存延迟、选区回调）；长文档 / 大量节点渲染不卡顿；重活缓存化（图片 MD5 去重等）
* **并发与防御**：UI 入口连点防护（锁 / debounce / disabled / 幂等）；保存 / 上传可被打断且状态一致
* **测试与验证**：纯逻辑改动补测试；覆盖率底线见「测试 · 覆盖率要求」；`pnpm run verify` 通过 + `git diff --check` 干净

## 安全基线（本仓库自含要点）

* 已开启（2026-09 逐项核验）：Dependabot alerts（仅报警）、CodeQL default setup（weekly，JS/TS + actions）、secret scanning + push protection、Private vulnerability reporting、根 `SECURITY.md`
* 分支保护三层（2026-09 逐项核验）：经典保护 ✓（main：要求对话解决 + 不允许绕过）；ruleset 轻保护 ✓（默认分支 + dev 各一条）；合并设置 **Squash-only** ✓；owner 保留 fast-forward 直推，**CI 会跑但不设硬门禁**
* 外部 PR / Issue 一律开放，owner 审核合并（Squash-only）；核验按根规范《统一安全基线 · 逐项检查命令》逐项跑

## CI 与自动发布

* **ci.yml**（push / PR 到 main、dev）：`typecheck` → `test`（覆盖率门槛，Vitest Job Summary + 覆盖率 artifact）→ `build` → `package`（vsce）
* **publish.yml**（push `v*.*.*` tag）：打包 VSIX → 发布 VS Code Marketplace → 建 GitHub Release（说明拼两份 CHANGELOG 当前版本条目）

## GitHub 与网络

* 一律 `gh` CLI（已登录 peiyucn）；仓库 <https://github.com/peiyucn/epytor>；非 Bug 功能讨论引导至 Discussions
* 向上游提 issue 的注意事项见「上游限制」

## 项目专属章节

### 扩展与宿主兼容（硬约束）

> 本仓库宿主 = VS Code。根规范《扩展与宿主兼容（fail-safe）》在此落地：

* **版本门走清单，不在 `activate()` 手搓探针**：`package.json` 的 `engines.vscode`（当前 `^1.93.0`）是声明式版本门——VS Code 在激活前自行判定，不满足即不激活；**依赖到新 API 时必须同步抬它**
* **无「格式门」**：本扩展不拥有持久化数据格式（编辑的是用户自己的 md 文件），根规范的格式 / 版本门一项不适用
* **停用靠容器**：VS Code 捕获 `activate` 抛出的异常并把扩展标为「激活失败」，不拖垮 VS Code 本体与其它扩展——`activate` 抛错即安全的自停用手段
* **不得带病运行**：不在不认识的契约上做不可逆操作；现有护栏：`src/utils/pathGuard.ts`（路径越界）、`safeBasename.ts`（文件名净化）、`webviewConfigSanitize.ts`（注入 WebView 前净化）
* **运行期不冒泡**：扩展自有入口（webview 消息路由、命令注册、文件监听、DOM 操作）须内部兜住异常。**当前出入（2026-09 核）**：`src/MarkdownEditorProvider.ts` 的 `onDidReceiveMessage` → `_handleWebviewMessage` 没有整体兜底（switch，仅个别分支有局部 try/catch），未覆盖分支抛错会成为未处理的 Promise 拒绝——待修
* **模块顶层不依赖易变导出**：只用稳定的 `vscode` 命名空间 API，不 import VS Code 内部模块

### 开发

* **包管理器**：必须用 `pnpm`，禁止 npm / yarn
* **语言**：全部 TypeScript；Extension 端 `tsconfig.json`，WebView 端 `tsconfig.webview.json`
* **双目标构建**：`dist/extension.js`（Node.js）+ `dist/webview.js`（Browser），由 `esbuild.mjs` 完成
* **调试**：F5 启动扩展调试实例（`.vscode/launch.json`）
* **spec 先行**：新功能先写 spec（`docs/specs/YYYY-MM-DD-<功能名>.md`：需求范围、交互边界、验收标准）再开发
* **诚实原则**：不确定的事直接说"不确定"，禁止编造 URL、issue 编号、API 接口、文档引用或任何事实性信息
* **优雅原则**：禁止 hack 或补丁式写法，优先用框架 / 库官方 API、CSS 变量、配置回调
* **自检原则**：代码移动 / 提取后**必须**搜索确认旧位置已删除，不留死代码或同名遮蔽；标记 spec 条目完成前逐项列出实际完成项与未完成项，不得把部分完成当整体完成
* **查证原则**：引用文件位置、函数名、调用关系前先 grep 确认，禁止凭记忆编造

#### 架构约束

* WebView ↔ Extension 通信**只通过** `webview/messaging.ts` 封装的函数
* WebView 侧不直接 `import` VSCode API，通过 `acquireVsCodeApi()` 获取句柄
* CSS 必须用 `--vscode-*` 变量以适配亮 / 暗主题
* 不在模块外部维护全局状态（单例除外，如 editor view）

#### 配置参考

> 自动保存用 VS Code 内置 `files.autoSave`（off / afterDelay / onFocusChange / onWindowChange），epytor 不提供独立自动保存配置。保存是**拉取式**：webview 变更只发脏标记，保存时（Cmd+S / 原生 autoSave）Extension 发 `requestContent`，webview 序列化一次回传（输入期间零序列化）。

### 测试

| 层次 | 框架 | 适用范围 |
| :--- | :--- | :--- |
| Extension 单元测试 | Vitest 4.x（Node 环境） | `src/utils/`、`src/MarkdownDocument.ts` |
| WebView 单元测试 | Vitest 4.x + jsdom 30.x | `webview/utils/`、`webview/messaging.ts` |
| 集成测试（计划中） | @vscode/test-electron + Mocha | 需真实 VSCode Extension Host |

* `vscode` 模块通过 `__mocks__/vscode.ts` 统一 mock，由 `vitest.config.ts` 的 `resolve.alias` 注入；**禁止**在单个测试文件里 `vi.mock("vscode")`
* 命令：`pnpm test`（一次性）、`pnpm test:watch`（监听）、`pnpm test:coverage`（覆盖率报告）
* 目录：`src/__tests__/`（Node）、`webview/__tests__/`（jsdom，`setup.ts` 注入 `acquireVsCodeApi`）、`shared/__tests__/`、`__mocks__/vscode.ts`
* 命名：`<模块名>.test.ts` 与被测文件同名；结构遵循 AAA，`describe` → `it` 两层；`it` 描述用中文「输入条件 应该 期望结果」

**覆盖率下限**

| 模块 | 行覆盖率 |
| :--- | :--- |
| `src/utils/getNonce.ts` | 100% |
| `src/utils/contentTransform.ts`、`src/utils/lineMap.ts` | ≥ 90% |
| `src/utils/imageService.ts` | ≥ 85% |
| `src/MarkdownDocument.ts` | ≥ 80% |
| **整体** | ≥ 70% |

**强制流程**（每次代码改动：bug 修复、新功能、重构还债）

* **验证**：`pnpm run verify` 全绿；任一失败先修复，不得跳过
* **人工验收**：输出手测清单（受影响的交互路径与验收点，一行一条、编号排序）→ 用 `vscode_askQuestions` 逐项确认（每屏 ≤4 项，超过分屏）→ 全部通过才进提交；有未通过则修复后从验证重来
* **提交**：通过后方可 `git commit`
* **功能开发后**补单测（核心逻辑、边界值、异常路径各至少一个用例）；**Bug 修复后**先补能复现该 bug 的用例（写在修复同一 commit 内），确认修复前失败、修复后通过
* **git push 前必须** `pnpm run verify` 全绿
* **禁止**：跳过（`it.skip`）或注释失败的用例让 CI 通过；改测试预期值掩盖 bug（除非实现有意变更且经过评审）；未跑测试就 push 到 `main` / `dev`
* **Mock 规范**：每个 `describe` 在 `beforeEach` 调 `vi.clearAllMocks()`；文件系统统一 mock `vscode.workspace.fs`（禁止真实 fs 写盘）；依赖时间的逻辑用 `vi.useFakeTimers()` / `vi.useRealTimers()`；禁止测 `private` 方法，通过公共接口验证

### Issue 管理

* 标签：`bug`（已确认的 bug）、`enhancement`（新功能 / 改进），其余用 GitHub 默认标签；**不设自定义标签**（2026-09-13 删除 `known-limitation` 与 `planned`，两者从未被任何 issue 用过）——已知限制记在 `docs/upstream-limits.md` + `docs/tech-debt.md`，计划记在讨论结论与 spec，都不用标签追
* 规划只在两处留痕：**讨论结论**（Issue / 对话）与 **spec**（`docs/specs/`）；没有路线图文档，spec 里有对应 issue 就标注编号
* **不用 Issue 模板**（2026-09-13 删除 `bug_report.yml` / `feature_request.yml`，owner 决定：模板没用）：`.github/ISSUE_TEMPLATE/config.yml` 只留 Discussions 入口，并把 `blank_issues_enabled` 放开为 `true`（否则删了模板就建不了 issue）；新 issue 一律空白表单、标签手动打
* **主动提醒用户建 issue** 的时机：发现本次修不了的 bug、有新功能想法但暂不开发、发现需记录的技术债务

### 路线

* 规划方式：**先讨论 → 达成一致 → 写 spec**（`docs/specs/YYYY-MM-DD-<功能名>.md`：需求范围、交互边界、验收标准），spec 落地后才开发
* **不维护路线图文档**（`docs/roadmap.md` 已于 2026-09-13 删除）：计划只存在于「讨论结论」与「spec」两处，别去维护不存在的清单
* Bug 修复、行为对齐、内部重构不写 spec，按《测试 · 强制流程》走（先补能复现的用例）

### 上游限制

> 明细表见 [`docs/upstream-limits.md`](docs/upstream-limits.md)。

**维护规则**：

* 发现新的上游限制时追加到该表；**只有用户能感知的**才在 README 已知限制里如实写一句（不带 issue 编号——追踪细节留在本表），用户看不见的内部细节不进 README
* 升级依赖版本时对照该表逐项验证，已解决的条目从表中移除，写入 CHANGELOG 的 Fixed
* 优先在对应上游仓库提 issue，将链接填入该表的「追踪」列
* **向上游提 issue 必须遵循对方模板规范**：标题带 `[Bug]` 或 `[Feature]` 前缀，正文结构化（复现步骤 / 期望行为 / 实际行为 / 运行环境）；对方用 `.yml` Issue Forms 时 `gh issue create` 不触发模板校验，需手动对齐字段
