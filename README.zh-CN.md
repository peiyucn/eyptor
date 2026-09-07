# EPYTOR🦖

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![License](https://img.shields.io/github/license/peiyucn/epytor?style=for-the-badge)](https://github.com/peiyucn/epytor/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)]()
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)]()

简体中文 | [English](README.md) | [GitHub](https://github.com/peiyucn/epytor)

基于 [Milkdown](https://milkdown.dev/) 的 VSCode 所见即所得 Markdown 编辑器。富文本编辑 `.md` / `.markdown`，保存为标准 Markdown。

> 最初基于 [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) v0.1.6 开发。
>
> v1.0.0 / v1.0.1：适配 VS Code Marketplace，修复关键问题（粘贴空行累积、表格单元格回车）。
>
> v1.1.0：重构根基（Milkdown 7.21.2 + Crepe / CodeMirror 6），新增功能（LaTeX 公式、图片增强、工具栏、TOC）。
>
> **v1.1.3 起独立开发。** 详见 [CHANGELOG](CHANGELOG.zh-CN.md)。

## 功能

* **富文本编辑**：标题、粗斜体、删除线、行内代码、引用、分割线、有序/无序/任务列表
* **LaTeX 数学公式**：行内 `$...$` / 块级 `$$...$$`，KaTeX 渲染
* **表格**：GFM 表格，网格选择器（8×8），插入/删除行、列，拖拽重排，列对齐，换行三档（`normal` / `aggressive` / `none`），单元格内 Shift+Enter 软换行
* **代码块**：CodeMirror 6 语法高亮，语言选择，复制，全屏编辑
* **Mermaid 图表**：内联渲染，源码/预览切换，预览缩放（0.4×–3×）
* **图片**：粘贴/拖放/选择器插入，拖拽缩放，Caption 编辑，加载重试
* **目录面板**：自动生成，可固定，点击跳转
* **标题**：滚动时当前章节标题吸顶，同级折叠/展开（不修改文档）
* **查找栏**：`Ctrl/Cmd+F` 搜索，区分大小写 + 正则两种模式
* **Frontmatter**：面板内直接编辑 key/value
* **路径补全**：`@/`、`./`、`../` 触发，分级浏览
* **工具栏**：顶栏毛玻璃吸顶 + 选中浮动工具栏 + 窄窗口溢出菜单
* **自动保存**：停止编辑 1 秒后自动写盘
* **Clean Markdown 保存**：减少不必要的转义和表格冗余换行

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `epytor.defaultMode` | `"wysiwyg"` | 默认打开模式 |

> 自动保存使用 VS Code 内置设置 `files.autoSave`（`off` / `afterDelay` / `onFocusChange` / `onWindowChange`），EPYTOR 不再提供独立的自动保存设置。
| `epytor.editorMaxWidth` | `900` | 编辑器最大宽度（px） |
| `epytor.fontFamily` | `""` | 编辑器字体 |
| `epytor.codeBlockMaxHeight` | `600` | 代码块最大高度（px） |
| `epytor.tableWrapMode` | `"wrap"` | 表格单元格换行：`wrap`（任意字符断行）/ `nowrap`（不换行 + 横向滚动） |
| `epytor.imageStorage` | `"local"` | 图片存储：`local` / `server` |
| `epytor.imageLocalPath` | `""` | 本地图片路径 |
| `epytor.debugMode` | `false` | 调试模式 |
| `epytor.markdown.serializationMode` | `"clean"` | Markdown 保存模式：`clean` / `compatible` |

> 完整设置列表见 VSCode 设置面板（`epytor.*`）

## 环境

* VSCode **1.93.0**+

## 已知限制

* ⚠️ 上游 — 表格单击选中整格暂时关闭（Crepe 上游行为不稳定，改为单击直接编辑）
* ⚠️ 上游 — 有序列表多层级编号均为十进制（Milkdown 内核限制）
* ⚠️ 上游 — 行内样式尾部无后续内容时无法直接退出（[Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413)）
* 全局搜索跳转：多文件同时打开时可能无法精确定位
* 部分扩展语法（脚注等）尚未支持
* 段落/标题文字对齐不提供（标准 Markdown 无对应语法）

## 参与贡献

开发环境和提交流程见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。编码和测试规范见 [AGENTS.md](AGENTS.md)。
