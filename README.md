# 🦖EPYTOR

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor?color=007ec6)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![CI](https://img.shields.io/github/actions/workflow/status/peiyucn/epytor/ci.yml?branch=main&label=ci)](https://github.com/peiyucn/epytor/actions/workflows/ci.yml)[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)[![License](https://img.shields.io/github/license/peiyucn/epytor)](https://github.com/peiyucn/epytor/blob/main/LICENSE)

[简体中文](README.zh-CN.md) | English | [GitHub](https://github.com/peiyucn/epytor)

A WYSIWYG Markdown editor for VS Code, powered by [Milkdown](https://milkdown.dev/). Edit `.md` / `.markdown` as rich text, saved as standard Markdown.

> Started from [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) and developed independently since — **no longer a fork of it**. A few vendored files under `webview/vendor/` note their sources in-file, and the upstream copyright is kept in [LICENSE](LICENSE). Version history: [CHANGELOG](CHANGELOG.md).

## Features

* **Rich text**: headings, bold, italic, strikethrough, inline code, blockquote, horizontal rule, lists
* **Lists**: ordered / bullet / task lists (including `- [ ] ` checkboxes with nothing after the marker); markers follow the nesting level (`1.` / `a)` / `i.` and ● / ■ / ◆, cycling at the fourth level); Backspace at the start of an item breaks the list and turns that item into a plain line; saving keeps your own marker style (`-` / `*`, `1.` / `1)`) and indentation
* **LaTeX math**: inline `$...$` / block `$$...$$`, KaTeX rendering
* **Tables**: GFM tables, grid picker (8×8), insert/delete rows & columns, drag reorder, column alignment, wrap modes (`wrap` / `nowrap`), Shift+Enter soft breaks inside cells
* **Code blocks**: CodeMirror 6 highlighting, language picker, copy, fullscreen
* **Mermaid diagrams**: inline rendering, source/preview toggle, preview zoom (0.2×–3×)
* **Images**: insert by paste, drag & drop or the image picker; resize by dragging an edge, add a caption, and retry if loading fails
* **Outline panel**: generated automatically and follows your reading position — it highlights the current section and scrolls itself into view; opening it keeps it there and pushes the text aside (never covering it), while closing it means it will not come back on its own (closing wins above everything); it collapses automatically on narrow windows, with the threshold following `epytor.editorMaxWidth` (editor width + 100); the edge handle is a direction arrow (› to open, ‹ to close)
* **Headings**: sticky section title while scrolling (up to 3 levels), sibling folding (document unchanged)
* **Source ↔ preview**: `Ctrl/Cmd+Shift+M` switches between the WYSIWYG editor and the VS Code text editor, keeping your position
* **FindBar**: `Ctrl/Cmd+F` search with match-case and regular-expression modes
* **Frontmatter**: editable key/value panel
* **Path autocomplete**: `@/`, `./`, `../` triggers directory browsing
* **Toolbars**: sticky top bar + floating selection toolbar + overflow menu on narrow windows
* **Auto save**: follows the built-in VS Code `files.autoSave` setting (`off` / `afterDelay` / `onFocusChange` / `onWindowChange`)
* **Clean Markdown save**: minimizes unnecessary escaping and redundant table breaks

## Settings

> To choose how `.md` files open by default, use the built-in VS Code entry: right-click a Markdown file → **Reopen Editor With…** → **Configure default editor for '*.md'**. EPYTOR does not manage editor associations itself.

The Settings UI groups them into **epytor** (editor) and **epytor › Images**. Changing any of them takes effect immediately — no need to reopen the tab. EPYTOR only reads these settings; it never rewrites your `settings.json`.

| Setting | Default | Description |
|---|---|---|
| `epytor.tableWrapMode` | `"wrap"` | Table cell wrapping: `wrap` (break anywhere) / `nowrap` (no wrap + horizontal scroll) |
| `epytor.codeBlockMaxHeight` | `600` | Code block max height in px (100–10000); taller code blocks scroll inside the block |
| `epytor.editorMaxWidth` | `900` | Editor content max width in px (400–10000); the outline panel's auto-collapse threshold follows it (this width + 100) |
| `epytor.serializationMode` | `"clean"` | Markdown save mode: `clean` (fewer unnecessary escapes and table breaks) / `compatible` |
| `epytor.imageStorage` | `"local"` | Image storage: `local` (save to disk) / `server` (upload to your image server) |
| `epytor.imageLocalPath` | `""` | Local image folder (relative to the workspace root or to the Markdown file, or absolute). Empty = auto-detect `images/`, `imgs/`, `assets/images/`, `assets/`; if none exists, `images/` next to the file is used |
| `epytor.imageServer` | `{}` | Image server settings: `{ "url": "", "fieldName": "file", "extraParams": {}, "responsePath": "url" }` |
| `epytor.imageServerUrl` | `""` | *Deprecated* — fallback for `epytor.imageServer.url` |
| `epytor.imageServerFieldName` | `"file"` | *Deprecated* — fallback for `epytor.imageServer.fieldName` |
| `epytor.imageServerExtraParams` | `""` | *Deprecated* — fallback for `epytor.imageServer.extraParams` (a JSON string) |
| `epytor.imageServerResponsePath` | `"url"` | *Deprecated* — fallback for `epytor.imageServer.responsePath` |

**Images**: with `epytor.imageStorage` = `server` the image goes to your image server (`epytor.imageServer.url` must be set, otherwise the upload fails with an explanation); with `local` it is saved to `epytor.imageLocalPath` or an auto-detected folder. Each field is described in the Settings UI. For safety, a workspace-level `.vscode/settings.json` can neither point `epytor.imageLocalPath` outside the workspace nor turn uploads on for you — in both cases the image is saved locally and a notice is shown.

> Auto save uses the built-in VS Code setting `files.autoSave` (`off` / `afterDelay` / `onFocusChange` / `onWindowChange`). EPYTOR no longer ships its own auto-save setting.

## Requirements

* VS Code **1.93.0**+

## Known Limitations

* **Very large documents**: how far the WYSIWYG editor keeps up depends on your machine (CPU, memory and how complex the document structure is) — when a document starts to feel slow, use the VS Code text editor (source mode)
* Raw HTML is kept in your file but not rendered — you see the tags themselves; other non-GFM extensions (`==highlight==`, definition lists, `> [!NOTE]` callouts…) are plain text too
* Paragraph and heading text alignment is not offered (Markdown has no syntax for it)

> Upstream issues we are tracking (not fixable on our side) are listed in [docs/upstream-limits.md](docs/upstream-limits.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and submission guidelines. Coding and testing standards are maintained in [AGENTS.md](AGENTS.md).
