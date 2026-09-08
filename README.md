# EPYTOR🦖

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![License](https://img.shields.io/github/license/peiyucn/epytor?style=for-the-badge)](https://github.com/peiyucn/epytor/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)]()
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)]()

[简体中文](README.zh-CN.md) | English | [GitHub](https://github.com/peiyucn/epytor)

A WYSIWYG Markdown editor for VS Code, powered by [Milkdown](https://milkdown.dev/). Edit `.md` / `.markdown` as rich text, saved as standard Markdown.

> Originally based on [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) v0.1.6.
>
> v1.0.0 / v1.0.1: adapted for VS Code Marketplace, fixed critical issues (blank-line accumulation, table-cell enter).
>
> v1.1.0: rebuilt foundations (Milkdown 7.21.2 + Crepe / CodeMirror 6), new features (LaTeX math, image enhancements, toolbar, TOC).
>
> **v1.1.3 onwards: independently developed.** See [CHANGELOG](CHANGELOG.md).

## Features

* **Rich text**: headings, bold, italic, strikethrough, inline code, blockquote, horizontal rule, lists
* **LaTeX math**: inline `$...$` / block `$$...$$`, KaTeX rendering
* **Tables**: GFM tables, grid picker (8×8), insert/delete rows & columns, drag reorder, column alignment, wrap modes (`normal` / `aggressive` / `none`), Shift+Enter soft breaks inside cells
* **Code blocks**: CodeMirror 6 highlighting, language picker, copy, fullscreen
* **Mermaid diagrams**: inline rendering, source/preview toggle, preview zoom (0.4×–3×)
* **Images**: paste/drag/picker insert, drag resize, caption, load retry
* **TOC**: auto-generated, pinnable, click to navigate
* **Headings**: sticky current-section title while scrolling, sibling folding (document unchanged)
* **FindBar**: `Ctrl/Cmd+F` search with match-case and regular-expression modes
* **Frontmatter**: editable key/value panel
* **Path autocomplete**: `@/`, `./`, `../` triggers directory browsing
* **Toolbars**: sticky top bar + floating selection toolbar + overflow menu on narrow windows
* **Auto save**: writes to disk 1s after editing stops
* **Clean Markdown save**: minimizes unnecessary escaping and redundant table breaks

## Settings

| Setting | Default | Description |
|---|---|---|
| `epytor.defaultMode` | `"wysiwyg"` | Default open mode |

> Auto save uses the built-in VS Code setting `files.autoSave` (`off` / `afterDelay` / `onFocusChange` / `onWindowChange`). EPYTOR no longer ships its own auto-save setting.
| `epytor.editorMaxWidth` | `900` | Editor max width (px) |
| `epytor.fontFamily` | `""` | Editor font family |
| `epytor.codeBlockMaxHeight` | `600` | Code block max height (px) |
| `epytor.tableWrapMode` | `"wrap"` | Table cell wrapping: `wrap` (break anywhere) / `nowrap` (no wrap + horizontal scroll) |
| `epytor.imageStorage` | `"local"` | Image storage: `local` / `server` |
| `epytor.imageLocalPath` | `""` | Local image path |
| `epytor.imageServerUrl` | `""` | Image upload endpoint URL (used when `imageStorage` is `server`) |
| `epytor.imageServerFieldName` | `"file"` | Form field name for the image file in the upload request |
| `epytor.imageServerExtraParams` | `""` | Extra upload request parameters as a JSON object string, e.g. `{"token":"xxx"}` |
| `epytor.imageServerResponsePath` | `"url"` | Dot-notation path to extract the image URL from the upload response JSON, e.g. `data.url` |
| `epytor.imageSelectionColor` | `"rgba(52, 211, 153, 0.6)"` | Border color when an image is selected in the editor |
| `epytor.debugMode` | `false` | Debug mode |
| `epytor.markdown.serializationMode` | `"clean"` | Markdown save mode: `clean` / `compatible` |

> See Settings UI for all options (`epytor.*`).

## Requirements

* VS Code **1.93.0**+

## Known Limitations

* ⚠️ Upstream — Table cell click-selection temporarily disabled (Crepe instability, clicks go to edit mode)
* ⚠️ Upstream — Ordered list multi-level numbering: decimal only (Milkdown kernel limitation)
* ⚠️ Upstream — Inline styles at paragraph end cannot exit to normal text ([Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413))
* **Very large documents (10k+ lines)**: WYSIWYG editing stays smooth up to ~3000 lines; beyond that the document-tree cost of the editor engine grows — use the VS Code text editor (source mode) for such files
* Global search may not scroll precisely with multiple `.md` files open
* Some extended Markdown syntax (footnotes, inline HTML, etc.) not yet supported
* Paragraph/heading text alignment is not provided (no standard Markdown syntax)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and submission guidelines. Coding and testing standards are maintained in [AGENTS.md](AGENTS.md).
