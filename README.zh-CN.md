# 🦖EPYTOR

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![CI](https://img.shields.io/github/actions/workflow/status/peiyucn/epytor/ci.yml?branch=main)](https://github.com/peiyucn/epytor/actions/workflows/ci.yml)[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![License](https://img.shields.io/github/license/peiyucn/epytor)](https://github.com/peiyucn/epytor/blob/main/LICENSE)

简体中文 | [English](README.md) | [GitHub](https://github.com/peiyucn/epytor)

基于 [Milkdown](https://milkdown.dev/) 的 VSCode 所见即所得 Markdown 编辑器。富文本编辑 `.md` / `.markdown`，保存为标准 Markdown。

> 基于 [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) 的开源工作开发。版本历史见 [CHANGELOG](CHANGELOG.zh-CN.md)。

## 功能

* **富文本编辑**：标题、粗斜体、删除线、行内代码、引用、分割线、有序/无序/任务列表
* **列表**：有序 / 无序 / 任务列表；标记按层级显示（`1.` / `a)` / `i.` 与 ● / ■ / ◆，第四层回绕）；列表项行首 Backspace 断开列表、把该项变成普通行
* **LaTeX 数学公式**：行内 `$...$` / 块级 `$$...$$`，KaTeX 渲染
* **表格**：GFM 表格，网格选择器（8×8），插入/删除行、列，拖拽重排，列对齐，换行两档（`wrap` / `nowrap`），单元格内 Shift+Enter 软换行
* **代码块**：CodeMirror 6 语法高亮，语言选择，复制，全屏编辑
* **Mermaid 图表**：内联渲染，源码/预览切换，预览缩放（0.2×–3×）
* **图片**：粘贴/拖放/选择器插入，拖拽缩放，Caption 编辑，加载重试
* **目录面板**：自动生成并跟随阅读位置——滚动时高亮当前章节、自动滚入可视区；打开即常驻并把正文推开（不遮挡），关闭后不再自动出现（关闭是最高优先级）；窗口变窄自动收起，阈值随 `epytor.editorMaxWidth` 变化（编辑页宽度 + 100）；边缘把手是方向箭头（› 展开 / ‹ 收起）
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

设置面板分为 **epytor**（编辑器）与 **epytor › 图片** 两组；任一项改完立即生效，不必重开标签页。EPYTOR 只读取这些设置，绝不改写你的 `settings.json`。

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `epytor.tableWrapMode` | `"wrap"` | 表格单元格换行：`wrap`（任意字符断行）/ `nowrap`（不换行 + 横向滚动） |
| `epytor.codeBlockMaxHeight` | `600` | 代码块最大显示高度（px，100–10000），超出后在块内滚动 |
| `epytor.editorMaxWidth` | `900` | 编辑器内容区最大宽度（px，400–10000）；目录面板的自动收起阈值随它变化（该宽度 + 100） |
| `epytor.serializationMode` | `"clean"` | Markdown 保存模式：`clean`（减少不必要的转义与表格换行）/ `compatible` |
| `epytor.imageStorage` | `"local"` | 图片存储：`local`（存本地）/ `server`（上传到你的图床） |
| `epytor.imageLocalPath` | `""` | 本地图片目录——相对工作区根目录（无工作区时相对 Markdown 文件）或绝对路径。留空则自动检测 `images/`、`imgs/`、`assets/images/`、`assets/`（先看工作区根目录，再看文件所在目录），都没有时用文件同级的 `images/` |
| `epytor.imageServer` | `{}` | 图床设置：`{ "url": "", "fieldName": "file", "extraParams": {}, "responsePath": "url" }` |
| `epytor.imageServerUrl` | `""` | *已弃用*——`epytor.imageServer.url` 的兜底 |
| `epytor.imageServerFieldName` | `"file"` | *已弃用*——`epytor.imageServer.fieldName` 的兜底 |
| `epytor.imageServerExtraParams` | `""` | *已弃用*——`epytor.imageServer.extraParams` 的兜底（JSON 字符串） |
| `epytor.imageServerResponsePath` | `"url"` | *已弃用*——`epytor.imageServer.responsePath` 的兜底 |

**图床**（`imageStorage` 为 `server` 时）：必须配置 `epytor.imageServer.url` 指向上传接口，否则上传会失败并说明原因。`fieldName`（默认 `file`）是图片在 multipart 表单中的字段名，只允许字母、数字、点、短横线与下划线，其它值回退为 `file`。`extraParams`（JSON 对象，值只支持字符串/数字/布尔——嵌套对象与数组会被忽略并给出提示）附加额外表单字段。`responsePath`（默认 `url`，如 `data.url`）是从响应 JSON 中提取图片 URL 的点分路径。明文 `http` 地址可用（内网场景），但会给一次警告。四个已弃用键仍作为兜底可用——`epytor.imageServer` 里填了值就以它为准。

**图片路径安全**：工作区级 `.vscode/settings.json` 不能把 `epytor.imageLocalPath` 指向工作区之外——这类值会被忽略，保存与图库面板都改用 Markdown 文件同级的 `images/`。若工作区配置替你把上传打开（`epytor.imageStorage` 或图床地址来自工作区设置），上传会被跳过：图片存本地并给出提示。

> 自动保存使用 VS Code 内置设置 `files.autoSave`（`off` / `afterDelay` / `onFocusChange` / `onWindowChange`），EPYTOR 不再提供独立的自动保存设置。

## 环境

* VSCode **1.93.0**+

## 已知限制

* **超大文档存在性能上限**：流畅到什么规模取决于你的电脑（CPU、内存）与文档结构的复杂度——当你感觉某个文档编辑起来开始变卡，建议改用 VS Code 文本编辑器（源码模式）
* 复选框后不写内容的空任务项（`- [ ] `）不会被识别成任务项：它显示成普通项目符号加一行字面文本 `[ ]`
* 原始 HTML 会原样保留在文件里，但不会被渲染——你看到的是标签本身；其它非 GFM 扩展（`==高亮==`、定义列表、`> [!NOTE]` 提示块…）同样只是纯文本
* 不提供段落 / 标题的文字对齐（Markdown 没有对应语法）

> 我们跟踪的上游问题（扩展侧无法修复）见 [docs/upstream-limits.md](docs/upstream-limits.md)。

## 参与贡献

开发环境和提交流程见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。编码和测试规范见 [AGENTS.md](AGENTS.md)。
