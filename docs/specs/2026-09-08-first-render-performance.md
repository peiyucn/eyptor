# 首次渲染性能优化 Spec

> 日期：2026-09-08 · 状态：进行中 · 目标版本：1.2.0

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

- [ ] 生产构建：`dist/webview.js`（入口）体积显著下降（目标 < 1.5 MB 压缩口径）；`dist/webview.css` < 200 KB
- [ ] `pnpm run verify` 全绿
- [ ] 回归：含 mermaid/数学公式/各语言代码块的文档渲染结果与优化前一致（手测清单）
- [ ] 首帧基准：jsdom `firstRender.bench.ts` 记录优化前后对照
- [ ] 数学公式：行内公式最终渲染为 KaTeX；块级公式预览正常；编辑器内 $…$ 输入规则、toolbar 数学按钮、序列化往返（`$...$`/`$$...$$`）保持
- [ ] Mermaid：代码块预览、缩放、深/浅主题切换重绘保持

## 不做的事（明确边界）

- ProseMirror 全文档渲染的虚拟化（无上游方案，保持已知限制）
- CodeMirror feature 的进一步拆包（代码块是核心功能，CM 本体保留在入口）
- Vue/ProseMirror/Milkdown 核心（编辑器地基）
