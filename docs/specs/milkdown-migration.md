# Spec: Milkdown 升级迁移（7.5.x → 7.21.2 + Crepe）

> **状态**: ✅ 已完成（v1.1.0）

## 概述

将项目从旧 `@milkdown/*` 独立包体系迁移到 `@milkdown/kit@7.21.2` + `@milkdown/crepe@7.21.2`。

## 最终架构

```
依赖:     @milkdown/kit + @milkdown/crepe（2 个包，旧 8 个已移除）
入口:     CrepeBuilder → .addFeature(codeMirror) + .addFeature(table) + .addFeature(latex) + .addFeature(topBar) + .addFeature(toolbar) + .addFeature(linkTooltip)

功能层:
  LaTeX       ← Crepe feature/latex
  代码块       ← Crepe feature/code-mirror 内核 + 自定义增强（全屏按钮、复制反馈、样式）
  表格        ← Crepe feature/table（原生拖拽重排、插入/删除、列对齐），加 cellClickFixPlugin 修正单击行为
  图片        ← 自定义 NodeView（缩放 handle、Caption、lightbox、图片选择器、加载重试）
  工具栏       ← Crepe feature/top-bar + buildTopBar（Undo/Redo、图片、清除格式、设置）+ 自定义 tooltip 注入
  链接        ← Crepe feature/link-tooltip（删除原 linkPopup ~680 行）
  选中工具栏    ← 自定义 selectionToolbar（段落格式、内联格式、表格对齐/删除）
  TOC         ← 自定义
  搜索        ← 自定义 FindBar
  Mermaid     ← 自定义 codeMirror renderPreview 回调
  自动保存      ← Provider 层
  品牌标识      ← 纯 CSS ::after "EPYTOR🦖"
```

## 启用/未启用的 Crepe Feature

| Feature | 决策 | 说明 |
|---------|------|------|
| `feature/code-mirror` | ✅ | 内核，叠加自定义增强 |
| `feature/table` | ✅ | 原生拖拽重排 + 列对齐，单击行为通过 cellClickFixPlugin 修正 |
| `feature/latex` | ✅ | KaTeX 渲染 + CodeMirror 编辑 |
| `feature/top-bar` | ✅ | buildTopBar 注入自定义按钮 |
| `feature/toolbar` | ✅ | Crepe 选中浮动工具栏（与自定义 selectionToolbar 共存） |
| `feature/link-tooltip` | ✅ | 替代自定义 linkPopup |
| `feature/list-item` | ✅ | Crepe 列表项处理 |
| `feature/image-block` | ❌ | 未启用，保留自定义 imageView |

## 自定义功能清单

| 功能 | 文件 | 说明 |
|------|------|------|
| 图片 NodeView | `webview/components/imageView/` | 缩放、Caption、lightbox、工具栏 |
| 图片选择器 | `webview/components/imagePicker/` | 三 tab：上传/项目库/URL |
| 选中工具栏 | `webview/components/selectionToolbar/` | 段落格式 + 内联格式 + 表格操作 |
| 目录面板 | `webview/components/toc/` | 自动生成、可固定、拖拽宽度 |
| 搜索 | `webview/components/findBar/` | Cmd/Ctrl+F |
| 路径补全 | `webview/components/pathLink/` | @/、./、../ 触发 |
| Mermaid | webview/editor.ts renderPreview | 内联渲染、深浅主题 |
| 全屏代码 | webview/index.ts addFullscreenBtn | DOM 注入到 .tools-button-group |
| 顶栏 tooltip | webview/index.ts setupTopBarTooltips | DOM 扫描注入 i18n 提示 |
| 品牌标识 | webview/style.css | ::after 伪元素 |
| 表格单击修正 | webview/editor.ts cellClickFixPlugin | filterTransaction + appendTransaction |
| 主题总线 | webview/utils/themeBus.ts | MutationObserver 监听 body class |

## 技术债务

参见 [docs/tech-debt.md](../tech-debt.md) 技术债务清单。

## 代码减量

旧 8 个 `@milkdown/*` 包 → `@milkdown/kit` 统一。自定义表格/链接/工具栏代码由 Crepe 原生取代。净减约 2,400 行。

## 构建

`esbuild.mjs` 打包 KaTeX + CodeMirror + Vue（Crepe 已编译），输出 `dist/extension.js` + `dist/webview.js`。
