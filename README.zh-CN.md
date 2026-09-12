# 🦖EPYTOR

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![CI](https://img.shields.io/github/actions/workflow/status/peiyucn/epytor/ci.yml?branch=main)](https://github.com/peiyucn/epytor/actions/workflows/ci.yml)[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![License](https://img.shields.io/github/license/peiyucn/epytor)](https://github.com/peiyucn/epytor/blob/main/LICENSE)

简体中文 | [English](README.md) | [GitHub](https://github.com/peiyucn/epytor)

基于 [Milkdown](https://milkdown.dev/) 的 VSCode 所见即所得 Markdown 编辑器。富文本编辑 `.md` / `.markdown`，保存为标准 Markdown。

> 基于 [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) 的开源工作开发。版本历史见 [CHANGELOG](CHANGELOG.zh-CN.md)。

## 功能

* **富文本编辑**：标题、粗斜体、删除线、行内代码、引用、分割线、有序/无序/任务列表
* **LaTeX 数学公式**：行内 `$...$` / 块级 `$$...$$`，KaTeX 渲染
* **表格**：GFM 表格，网格选择器（8×8），插入/删除行、列，拖拽重排，列对齐，换行两档（`wrap` / `nowrap`），单元格内 Shift+Enter 软换行
* **代码块**：CodeMirror 6 语法高亮，语言选择，复制，全屏编辑
* **Mermaid 图表**：内联渲染，源码/预览切换，预览缩放（0.2×–3×）
* **图片**：粘贴/拖放/选择器插入，拖拽缩放，Caption 编辑，加载重试
* **目录面板**：自动生成，可固定，点击跳转
* **标题**：滚动时当前章节标题吸顶（最多三级），同级折叠/展开（不修改文档）
* **源码 ↔ 预览**：`Ctrl/Cmd+Shift+M` 在所见即所得与 VS Code 文本编辑器之间切换，并保持当前位置
* **查找栏**：`Ctrl/Cmd+F` 搜索，区分大小写 + 正则两种模式
* **Frontmatter**：面板内直接编辑 key/value
* **路径补全**：`@/`、`./`、`../` 触发，分级浏览
* **工具栏**：顶栏毛玻璃吸顶 + 选中浮动工具栏 + 窄窗口溢出菜单
* **自动保存**：跟随 VS Code 内置 `files.autoSave` 设置（`off` / `afterDelay` / `onFocusChange` / `onWindowChange`）
* **Clean Markdown 保存**：减少不必要的转义和表格冗余换行

## 设置

> 默认打开方式请用 VS Code 官方入口设置：右键 Markdown 文件 → **打开方式…** → **为「*.md」配置默认编辑器**。EPYTOR 不再自行管理编辑器关联。

设置面板分为 **epytor**（编辑器）与 **epytor › 图片** 两组；任一项改完立即生效，不必重开标签页。

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `epytor.tableWrapMode` | `"wrap"` | 表格单元格换行：`wrap`（任意字符断行）/ `nowrap`（不换行 + 横向滚动） |
| `epytor.codeBlockMaxHeight` | `600` | 代码块最大高度（px，100–10000） |
| `epytor.editorMaxWidth` | `900` | 编辑器内容区最大宽度（px，400–10000） |
| `epytor.serializationMode` | `"clean"` | Markdown 保存模式：`clean` / `compatible` |
| `epytor.imageStorage` | `"local"` | 图片存储：`local`（存本地）/ `server`（上传到你的图床） |
| `epytor.imageLocalPath` | `""` | 本地图片目录——相对工作区根目录（无工作区时相对 Markdown 文件）或绝对路径。留空则自动检测 `images/`、`imgs/`、`assets/images/`、`assets/`，都没有时用文件同级的 `images/` |
| `epytor.imageServer` | `{}` | 图床设置：`{ "url": "", "fieldName": "file", "extraParams": {}, "responsePath": "url" }` |

**图床**（`imageStorage` 为 `server` 时）：必须配置 `epytor.imageServer.url` 指向上传接口，否则上传会失败并说明原因。`fieldName`（默认 `file`）是图片在 multipart 表单中的字段名；`extraParams`（JSON 对象，值只支持字符串/数字/布尔）附加额外表单字段；`responsePath`（默认 `url`，如 `data.url`）是从响应 JSON 中提取图片 URL 的点分路径。明文 `http` 地址可用（内网场景），但会给一次警告。旧的 `epytor.imageServerUrl`、`epytor.imageServerFieldName`、`epytor.imageServerExtraParams`、`epytor.imageServerResponsePath` 仍作为兜底可用，但已弃用——建议迁移到 `epytor.imageServer`。

**图片路径安全**：工作区级 `.vscode/settings.json` 不能把 `epytor.imageLocalPath` 指向工作区之外——这类值会被忽略，保存与图库面板都改用 Markdown 文件同级的 `images/`。若工作区配置替你把上传打开（`epytor.imageStorage` 或图床地址来自工作区设置），上传会被跳过：图片存本地并给出提示。

> 自动保存使用 VS Code 内置设置 `files.autoSave`（`off` / `afterDelay` / `onFocusChange` / `onWindowChange`），EPYTOR 不再提供独立的自动保存设置。

> 完整设置列表见 VSCode 设置面板（`epytor.*`）

## 环境

* VSCode **1.93.0**+

## 已知限制

* ⚠️ 上游 — 表格单击选中整格暂时关闭（Crepe 上游行为不稳定，改为单击直接编辑）
* ⚠️ 上游 — 有序列表多层级编号均为十进制（Milkdown 内核限制）
* ⚠️ 上游 — 行内样式尾部无后续内容时无法直接退出（[Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413)）
* ⚠️ 上游 — 从别的标签切回 Markdown 时编辑区会空白一下：VS Code 在保活 webview 隐藏期间撤掉其内容尺寸、激活时再重设，那一帧属于宿主而不是编辑器。编辑器本身从不重建，也不会丢失任何状态
* ⚠️ 上游 — 复选框后面不写内容的空任务项（`- [ ] `）识别不了复选框，标记会显示成文本 `[ ]`
* ⚠️ 上游 — 多级列表的 `a)` / `i.` 与 ■ / ◆ 是**编辑器的显示效果**：Markdown 源码本身只支持数字编号与 `-`，保存后仍是 `1.` / `-`（已向上游提 [Milkdown#2475](https://github.com/Milkdown/milkdown/issues/2475)）
* **超大文档（万行级）**：WYSIWYG 编辑在约 3000 行内保持流畅，超过后编辑器引擎的文档树成本显著上升——此类文件建议用 VS Code 文本编辑器（源码模式）编辑
* 停手后约 400ms 内切走标签，最后一次改动不会写入文件
* 全局搜索跳转：多文件同时打开时可能无法精确定位
* 部分扩展语法（脚注、内联 HTML 等）尚未支持
* 段落/标题文字对齐不提供（标准 Markdown 无对应语法）

## 参与贡献

开发环境和提交流程见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。编码和测试规范见 [AGENTS.md](AGENTS.md)。
