# 🦖EPYTOR

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode) [![CI](https://img.shields.io/github/actions/workflow/status/peiyucn/epytor/ci.yml?branch=main)](https://github.com/peiyucn/epytor/actions/workflows/ci.yml) [![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode) [![License](https://img.shields.io/github/license/peiyucn/epytor)](https://github.com/peiyucn/epytor/blob/main/LICENSE)

[简体中文](README.zh-CN.md) | English | [GitHub](https://github.com/peiyucn/epytor)

A WYSIWYG Markdown editor for VS Code, powered by [Milkdown](https://milkdown.dev/). Edit `.md` / `.markdown` as rich text, saved as standard Markdown.

> Based on the open-source work of [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT). Version history: [CHANGELOG](CHANGELOG.md).

## Features

* **Rich text**: headings, bold, italic, strikethrough, inline code, blockquote, horizontal rule, lists
* **Lists**: ordered / bullet / task lists; markers follow the nesting level (`1.` / `a)` / `i.` and ● / ■ / ◆, cycling at the fourth level); Backspace at the start of an item breaks the list and turns that item into a plain line
* **LaTeX math**: inline `$...$` / block `$$...$$`, KaTeX rendering
* **Tables**: GFM tables, grid picker (8×8), insert/delete rows & columns, drag reorder, column alignment, wrap modes (`wrap` / `nowrap`), Shift+Enter soft breaks inside cells
* **Code blocks**: CodeMirror 6 highlighting, language picker, copy, fullscreen
* **Mermaid diagrams**: inline rendering, source/preview toggle, preview zoom (0.2×–3×)
* **Images**: three ways to insert (paste / drag & drop / image picker); once inserted you can drag an edge to resize it and add a caption; paths containing spaces or parentheses display correctly; if loading fails you get a message and can retry
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

The Settings UI groups them into **epytor** (editor) and **epytor › Images**. Changing any of them takes effect immediately — no need to reopen the tab.

| Setting | Default | Description |
|---|---|---|
| `epytor.tableWrapMode` | `"wrap"` | Table cell wrapping: `wrap` (break anywhere) / `nowrap` (no wrap + horizontal scroll) |
| `epytor.codeBlockMaxHeight` | `600` | Code block max height in px (100–10000) |
| `epytor.editorMaxWidth` | `900` | Editor content max width in px (400–10000) |
| `epytor.serializationMode` | `"clean"` | Markdown save mode: `clean` / `compatible` |
| `epytor.imageStorage` | `"local"` | Image storage: `local` (save to disk) / `server` (upload to your image server) |
| `epytor.imageLocalPath` | `""` | Local image folder — relative to the workspace root (or to the Markdown file when there is no workspace) or an absolute path. Empty = auto-detect `images/`, `imgs/`, `assets/images/`, `assets/`, otherwise `images/` next to the file |
| `epytor.imageServer` | `{}` | Image server settings: `{ "url": "", "fieldName": "file", "extraParams": {}, "responsePath": "url" }` |

**Image server** (`imageStorage` = `server`): `epytor.imageServer.url` must point at the upload endpoint — without it the upload fails with an explanation. `fieldName` (default `file`) is the multipart form field of the image; `extraParams` (a JSON object; values must be strings, numbers or booleans) adds extra form fields; `responsePath` (default `url`, e.g. `data.url`) is the dot-notation path used to read the image URL from the JSON response. A plain-`http` endpoint is allowed (intranet servers) but you get one warning. The older `epytor.imageServerUrl`, `epytor.imageServerFieldName`, `epytor.imageServerExtraParams` and `epytor.imageServerResponsePath` settings still work as a fallback but are deprecated — please migrate to `epytor.imageServer`.

**Image path safety**: a workspace-level `.vscode/settings.json` may not point `epytor.imageLocalPath` outside the workspace — such a value is ignored and `images/` next to the Markdown file is used for saving and for the image picker. If a workspace turns uploads on for you (`epytor.imageStorage` or the image server URL coming from workspace settings), the upload is skipped, the image is saved locally and a notice is shown.

> Auto save uses the built-in VS Code setting `files.autoSave` (`off` / `afterDelay` / `onFocusChange` / `onWindowChange`). EPYTOR no longer ships its own auto-save setting.

> Four **deprecated** image-server keys still work as a fallback: `epytor.imageServerUrl`, `epytor.imageServerFieldName`, `epytor.imageServerExtraParams` and `epytor.imageServerResponsePath` — migrating to `epytor.imageServer` above is recommended (see below).

> See Settings UI for all options (`epytor.*`).

## Requirements

* VS Code **1.93.0**+

## Known Limitations

* ⚠️ Upstream — Table cell click-selection temporarily disabled (Crepe instability, clicks go to edit mode)
* ⚠️ Upstream — Inline styles at paragraph end cannot exit to normal text ([Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413))
* ⚠️ Upstream — Switching back to the Markdown tab briefly blanks the editor area: VS Code drops a kept-alive webview's content size while it is hidden and re-applies it on activation, so that frame belongs to the host rather than the editor. The editor itself is never rebuilt and nothing is lost
* ⚠️ Upstream — An empty task item (`- [ ] ` with nothing after the marker) is not recognised as a task item: the marker shows up as literal `[ ]` text
* ⚠️ Upstream — The `a)` / `i.` and ■ / ◆ multilevel markers are an **editor display effect**: plain Markdown only supports numbered and `-` markers, so saved files keep `1.` / `-` (reported upstream as [Milkdown#2475](https://github.com/Milkdown/milkdown/issues/2475))
* **Very large documents (10k+ lines)**: WYSIWYG editing stays smooth up to ~3000 lines; beyond that the document-tree cost of the editor engine grows — use the VS Code text editor (source mode) for such files
* If you switch tabs within ~400 ms of your last keystroke, that last change is not written to the file
* Global search may not scroll precisely with multiple `.md` files open
* Some extended Markdown syntax (footnotes, inline HTML, etc.) not yet supported
* Paragraph/heading text alignment is not provided (no standard Markdown syntax)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and submission guidelines. Coding and testing standards are maintained in [AGENTS.md](AGENTS.md).
