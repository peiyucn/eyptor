# 首次渲染性能优化 Spec

> 日期：2026-09-08 · 目标版本：1.2.0
> 状态：已实现（v1.2.0，2026-09-13）

## 背景与问题

用户反馈：打开 md 文件时第一次渲染等待时间过长。

首次渲染的时间线（从点击文件到内容可见）：

```
Extension: resolveCustomEditor → 注入 HTML
  → WebView 下载/解析/求值 webview.js（整包）
  → 下载/解析 webview.css
  → index.ts 模块执行 → notifyReady
  → Extension 回 init 消息（content + lineMap + imageUriMap + frontmatter）
  → createEditor → Crepe create()（解析全文档 + 全量 DOM 渲染 + 各 feature 初始化）
  → 首帧绘制
```

## 基线测量（2026-09-08，jsdom 探针）

### 产物体积（构建期，瓶颈首要证据）

| 产物 | 优化前 |
| :--- | :--- |
| `dist/webview.js` | **6240.9 KB**（单文件） |
| `dist/webview.css` | **1500.0 KB**（KaTeX 三格式字体 base64 内联） |

bundle 构成（esbuild metafile，未压缩口径）：

| 依赖 | 体积 | 进入方式 |
| :--- | :--- | :--- |
| mermaid 系（core + parser 1.3MB + cytoscape 1.1MB + 各 diagram chunk） | ~3.4 MB | `editor.ts` 静态 `import mermaid` |
| KaTeX（0.16.47 Crepe 依赖 + 0.18.1 mermaid 依赖，双版本） | ~1.2 MB JS + ~1.4 MB 字体 | Crepe index 静态 `import katex` + `latex.css` 静态 `@import katex.min.css` |
| CodeMirror 系（view/state/language/autocomplete + language-data 140 种语言语法包） | ~1.3 MB | `@codemirror/language-data` 的 `load()` 是**动态 import**，但 esbuild 未开 `splitting`，动态 import 被全部内联成静态打包（lang-cpp/lang-php/lang-vue 等全数进包） |
| Vue runtime / ProseMirror / Milkdown / Crepe | ~1.2 MB | 编辑器核心，必需 |

### createEditor 耗时（jsdom 探针，`firstRender.bench.ts`）

| 文档 | create 耗时 | DOM 节点数 |
| :--- | :--- | :--- |
| 典型 ~500 行 | 1376 ms | 5017 |
| 典型 ~2500 行 | 4842 ms | 24297 |
| 典型 ~10000 行 | 22115 ms | 96597 |
| 代码密集 ~900 行 | 1021 ms | 997（CodeMirror 按 IntersectionObserver 懒初始化，天然轻） |

jsdom 无真实布局/合成，真实浏览器通常快一个数量级，但分布可信：**典型文档 DOM 全量渲染是规模敏感项**；代码块有上游懒初始化机制故便宜。

## 瓶颈结论

1. **6.2MB 单文件 JS**：下载 + 解析 + 求值全在首帧前，与文档大小无关的固定成本，是「打开就慢」的主因。其中 mermaid/KaTeX/language-data 三项合计 ~5.9MB，全部与「无 mermaid、无数学公式、无对应语言代码块的文档」无关。
2. **1.5MB CSS**：KaTeX 三种字体格式（.ttf/.woff/.woff2）全部 base64 内联，实际只需 woff2，且无数学公式的文档完全不需要。
3. **全文档同步 DOM 渲染**（规模敏感，10k 行 ~96k DOM 节点）：ProseMirror 架构限制，虚拟化不可行（contentEditable 窗口化无上游方案），保持已知限制。
4. **create() 之后的同步收尾工作**（TOC 全量重建、字数统计、溢出菜单初始化）阻塞首帧绘制。

## 优化方案

### ① esbuild 代码分割（`splitting: true`）

- language-data 140 种语言恢复运行时按需加载（首帧只加载用到的语言）。
- 为后续惰性化提供 chunk 机制。
- 风险：CSP 需放行动态 chunk（`script-src` 已含 `${webview.cspSource}`，同源 chunk 天然允许）；chunk 文件需在 `dist/` 内（已在 `localResourceRoots`）。

### ② mermaid 惰性加载

- `editor.ts` 静态 `import mermaid` → 首次渲染 mermaid 代码块时 `import("mermaid")`。
- 主题切换：仅当 mermaid 已加载时重放重绘；未加载则记录主题，加载时初始化。
- 期望收益：移除 ~1.3MB 压缩口径的 mermaid 系 + 0.18.1 版 katex。

### ③ KaTeX 惰性加载（vendor Crepe latex feature）

- 原因：`@milkdown/crepe` index 静态 `import katex` 且内联整份 latex feature，任何入口导入 CrepeBuilder 都会拉进 katex。
- 做法（沿用 prosemirror-virtual-cursor 的 vendor 先例，两个 `[epytor]` 修改点）：
  1. `webview/vendor/latexFeature.ts`：TS 重写 Crepe 7.22.1 latex feature，katex 全部改惰性——行内公式注册 NodeView（placeholder 显示原始 TeX 源码，katex 加载后异步渲染，带 token 防陈旧写回）；块级公式预览走 `renderPreview` 异步契约（返回 undefined + `applyPreview`）。
  2. `webview/vendor/katexLazyStub.ts` + esbuild 插件：把 **Crepe 模块**的 `import katex` 重定向到显式抛错的 stub（Crepe 内联 latex 代码路径在 epytor 永不执行——已逐行核实 katex 调用点全部位于该 feature 内部、模块作用域零调用），消除入口静态链。
  3. `webview/latex.css`：仅保留 latex.css 中的 Milkdown 样式（math_inline 间距 + 行内编辑浮层），`katex.min.css` 改为首次数学渲染时动态加载（字体随 lazy chunk 走）。
- 期望收益：移除 480KB katex JS + 1.4MB 字体 CSS。

### ④ 首帧后延迟非关键收尾

- `initEditor` 中 create() 之后的 TOC 重建、字数统计、溢出菜单初始化推迟到首帧绘制后（`requestAnimationFrame`），首帧只出正文。
- 验收：内容可见时间提前；TOC/字数在下帧补齐（用户无感知）。

### ⑤ 基线基建

- `vitest.bench.config.ts` + `webview/__tests__/firstRender.bench.ts`：手动运行的规模探针（不参与 verify/CI，与现有 bench 同口径）。

## 验收标准

- [x] 生产构建：`dist/webview.js`（入口）体积显著下降（目标 < 1.5 MB 压缩口径）——实测 **1036.3 KB**
- [x] `dist/webview.css` < 200 KB——实测 **74.7 KB**
- [x] `pnpm run verify` 全绿（typecheck + 40 文件 / 303 测试 + 生产构建）
- [ ] 回归：含 mermaid/数学公式/各语言代码块的文档渲染结果与优化前一致（自动化已绿；行为一致性待手测确认）
- [x] 首帧基准：jsdom `firstRender.bench.ts` 前后对照已记录（create 耗时同量级、测试模块求值 3.31s→2.38s；真实首屏收益来自 6.2MB→1.4MB 负载）
- [x] 数学公式：行内公式渲染为 KaTeX（NodeView 异步）；块级公式预览走异步契约；$…$ 输入规则、toolbar 数学按钮（FeaturesCtx 标志）、序列化往返——5 条回归测试覆盖
- [ ] Mermaid：代码块预览、缩放、深/浅主题切换重绘（代码路径已惰性化，行为待手测确认）

## 实施记录（2026-09-08）

### 产出对比

| 指标 | 优化前 | 优化后 | 提交 |
| :--- | :--- | :--- | :--- |
| `dist/webview.js`（入口，压缩） | 6240.9 KB 单文件 | **1036.3 KB** | `279fcb5` `0990fff` `9428a4e` |
| 首屏急切闭包 JS（压缩，含共享 chunk） | ~6.2 MB | **1441 KB**（6 文件） | 同上 |
| `dist/webview.css` | 1500.0 KB | **74.7 KB** | `9428a4e` |
| KaTeX 样式（惰性，首个数学渲染时 <link> 注入） | 混在入口 CSS | 1425.5 KB 独立 `katex-styles.css` | `9428a4e` |
| VSIX | 2.83 MB（23 文件） | 2.91 MB（255 文件，chunk 化） | — |

### 关键实现决策（偏离原方案的记录）

1. **KaTeX 样式不进 JS import 图**：esbuild 会把动态 import 的 CSS 同时复制进入口 CSS 与惰性 chunk（最小实验实证）——改为独立 CSS 入口 `katex-styles`，运行时用 `import.meta.url` 解析注入 `<link>`（与 CSP cspSource 同源）。
2. **vendor 不 import `codeBlockConfig`**：pnpm 下 `@milkdown/components` 存在多个 peer 变体实例（根 `@milkdown/kit` 与 crepe 内部 kit 解析到不同实例），其 SliceType symbol 分裂——跨上下文 `ctx.update(codeBlockConfig.key)` 抛 contextNotFound（探针实证：`isInjected=false` 但上游 latex 同链路成功）。块级公式预览改由 editor.ts 的 `renderPreview` 统一接管（与 mermaid 同路径），vendor 仅导出 `renderLatexPreview`。
3. **katex stub 覆盖两个上游死路径**：@milkdown/crepe index 内联 latex feature + micromark-extension-math 的 html.js（remark-math 的 HTML 输出路径，epytor 只用于 mdast 解析）——均已逐行核实模块作用域零 katex 调用，stub 被调用时显式抛错（宁可暴露不静默）。
4. **直接依赖对齐 crepe 7.22.1**：katex ^0.18.0、remark-math ^6.0.0、unist-util-visit ^5.0.0、vue ^3.5.20（vendor 模块的显式依赖声明）。
5. **esbuild 构建前清理 dist**：chunk 文件名随内容哈希变化，esbuild 不清空 outdir，旧 chunk 会残留并混进 VSIX。

### 回归测试

- `webview/__tests__/latexFeature.test.ts`（5 条）：$…$ 解析与序列化往返、$$…$$ 块公式往返、ToggleLatex 双向切换、katex 加载未决时源码占位 + 就绪后按 token 只渲染最新值、样式 <link> 幂等。
- 全量 `pnpm test`：40 文件 / 303 测试全绿（含全部既有回归）。

### 手测清单

1. 打开含 mermaid 代码块的文档 → 预览、缩放、深/浅主题切换重绘正常
2. 打开含行内/块级数学公式的文档 → 公式渲染为 KaTeX；编辑器中输入 `$…$` 转公式、toolbar 数学按钮可用
3. 打开含 cpp/php/vue 等语言的代码块文档 → 语法高亮正常（chunk 按需加载）
4. 首次打开感受：中等/大文档打开时间显著缩短
5. 查找替换、图片上传、表格编辑、折叠、TOC、frontmatter 面板——全功能回归抽查
6. 中文界面下数学预览 loading 等无英文原文回归

## 不做的事（明确边界）

- ProseMirror 全文档渲染的虚拟化（无上游方案，保持已知限制）
- CodeMirror feature 的进一步拆包（代码块是核心功能，CM 本体保留在入口）
- Vue/ProseMirror/Milkdown 核心（编辑器地基）
