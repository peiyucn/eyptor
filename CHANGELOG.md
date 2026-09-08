# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

English | [简体中文](CHANGELOG.zh-CN.md)

## [1.2.0] - 2026-09-05

### Added

- **Clean Markdown serialization mode** (`epytor.markdown.serializationMode`: clean / compatible) — minimizes unnecessary escapes and placeholder table breaks; default `clean` (#15, thanks @dongjha)
- **Table grid picker**: 8×8 grid on the insert-table button with any row × column size
- **FindBar regular-expression search** (`.*` toggle) with invalid-pattern feedback and zero-width match protection
- **Heading sticky title with sibling folding** (Decoration-based; the underlying document is never modified)
- **Table wrap modes** (`epytor.tableWrapMode`: wrap / nowrap) and Shift+Enter soft breaks inside table cells (serialized as `<br>`)
- **Editable frontmatter panel** (key/value rows with add/remove)
- **Toolbar overflow menu**: buttons collapse into a "⋯" menu on narrow windows (replaces the old wrapping layout)
- **Mermaid preview zoom** (0.4×–3×, reset control, horizontal scroll)

### Fixed

- **Large-document editing lag on macOS IME input**: bounded-LCS diff + IME-aware scheduling (#16, thanks @dongjha)
- **Large-document input lag (10k-line scale)**: heading-fold decorations made single-pass and cached; zero serialization while typing (pull-based saving) — smooth up to ~3000 lines (see Known Limitations)
- **Table soft breaks survive save/reload**: Shift+Enter inside a cell serializes as GFM `<br>` and round-trips without loss
- **Inline code at the end of a block**: typing keeps the code style (path completion for `./` `@/` stays usable); ArrowRight exits with an in/out side indicator
- **Editor focus restored** when switching back from another file (cursor visible but input dead)
- **No false "unsaved" dot** when merely moving the cursor
- **Table row/column selection toolbar**: themed to match the editor and easier to reach (closer to the handle, larger buttons)
- **Toolbar overflow**: "⋯" no longer overlaps buttons (fixed right edge; Settings pinned to the menu)
- **Mermaid zoom baseline**: zooms relative to the original rendered size instead of the container width

### Changed

- **Milkdown** upgraded 7.22.0 → 7.22.1 (inline code mark fix + dompurify security update)
- **Pull-based saving**: edits only send a light dirty mark; the extension pulls content from the WebView and serializes once when saving (Cmd+S / auto save)
- **`epytor.tableWrapMode` simplified** from three modes to two (`wrap` / `nowrap`); old values migrate automatically (normal/aggressive → wrap, none → nowrap)

### Removed

- **Dead code**: `selectionToolbar` (~900 lines) and related leftovers after the official toolbar feature took over
- **`epytor.autoSave` / `epytor.autoSaveDelay`**: auto save now uses the built-in VS Code `files.autoSave` (off / afterDelay / onFocusChange / onWindowChange)

## [1.1.6] - 2026-08-06

### Added

- **List switching**: bullet/ordered/task buttons now switch between each other in-place (ordered numbering reflows); clicking the current type lifts back to paragraph

### Fixed

- **List/blockquote buttons broken after Milkdown 7.22.0**: multiple `prosemirror-model` versions coexisted in the dependency tree (1.25.4 / 1.25.9 / 1.25.11), breaking `tr.wrap` → pinned all prosemirror packages to a single version chain via `pnpm-workspace.yaml` overrides
- **Virtual cursor invisible inside blockquote/inline code**: cursor rendered by `prosemirror-virtual-cursor` lacked z-index, hidden behind node backgrounds
- **List wrap button no-op**: `wrapInBlockTypeCommand` import was missing in the toggle handler
- **List switch moved the cursor to a new line**: switching now uses `setNodeMarkup` (node size unchanged) instead of rebuilding the list node

### Changed

- **Packaging**: `.vscodeignore` excludes `pnpm-workspace.yaml`, `coverage/`, `scripts/`

## [1.1.5] - 2026-08-05

### Changed

- **Extension icon**: new logo
- **Dependencies**: upgraded to fix security vulnerabilities
  - Milkdown 7.21.3 → 7.22.0, Mermaid 11.15.0 → 11.16.1
  - vsce 2.32 → 3.9.2, Vitest 2 → 4, Vite 5 → 6, esbuild 0.24 → 0.28
- **Test config**: migrated `vitest.workspace.ts` to `projects` (Vitest 4)

### Fixed

- **Top bar heading dropdown clipped**: overflow clipping removed
- **Fullscreen code language XSS**: language name now safely injected via textContent

## [1.1.4] - 2026-08-05

### Changed

- **Extension icon**: new logo

## [1.1.3] - 2026-07-16

### Changed

- **Milkdown**: 7.21.2 → 7.21.3

### Fixed

- **Virtual cursor invisible inside inline code on light themes**: removed `mix-blend-mode: difference`, use direct foreground color

### Added

- **TOC leaf nodes**: headings without children now show `–` for visual consistency

## [1.1.2] - 2026-07-15

### Fixed

- **Virtual cursor not visible on some VSCode themes**: fallback CSS variable chain `--vscode-editorCursor-foreground` → `--vscode-editor-foreground` → `#fff` prevents transparent cursor on themes missing cursor color variable.

## [1.1.1] - 2026-07-14

### Fixed

- **Cursor Feature enabled**: `prosemirror-virtual-cursor` provides mark boundary cursor indicator with arrow key navigation across inline style boundaries.

### Known Limitations

- **Inline styles cannot exit at paragraph end**: Milkdown does not handle empty selection for inline marks. Inline styles (bold, italic, strikethrough, inline code, etc.) at paragraph end cannot exit to normal text input. [Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413), awaiting upstream fix.

## [1.1.0] - 2026-07-08

### Architecture

- **Milkdown**: 7.5.x → 7.21.2, `Editor.make()` → `CrepeBuilder`
- **Syntax Highlighting**: Prism → CodeMirror 6 (highlighting, search/replace, fullscreen)
- **Package size**: 8 MB → 3.1 MB (production build + code cleanup)

### Added

- **LaTeX math**: inline `$...$` / block `$$...$$`, KaTeX rendering
- **Code block enhancements**: preview toggle, copy feedback, fullscreen, light/dark theme
- **Image features**: drag resize, caption editing, picker (upload/library/URL), auto-retry on load failure
- **Toolbar**: backdrop blur, brand badge "EPYTOR🦖", clear formatting, settings button
- **TOC panel**: aligned below toolbar, backdrop blur, pinnable/resizable/collapsible, scrollbar
- **Mermaid**: unified light/dark theme, case-insensitive
- **Editor top margin**: 52px breathing room

### Fixes

- Code block language picker freeze
- Mermaid uppercase "Mermaid" not rendering preview
- Heading dropdown width misalignment
- Link clicks navigating within WebView
- Link tooltip not closing on scroll
- Image caption not syncing alt attribute after editing
- Toolbar button icons oversized
- Editor content covered by top bar
- Selection floating toolbar covered by top bar
- Clear formatting not removing links / partial removal causing split links
- TOC click positioning inaccurate (inline formatting offset)
- Source/render toggle line positioning inaccurate (proportional interpolation fix)
- Narrow window toolbar not wrapping, overlapping brand badge
- TOC panel appearing before toolbar on initial load

### Changed

- **Blockquote**: no longer nests — toggles instead (click inside to exit, outside to enter)
- **Table**: single-click row/col selection temporarily disabled (Crepe upstream instability — click goes to edit mode)
- **Send to Claude**: permanently removed

### Known Limitations

- Ordered list multi-level numbering: decimal only (no a.b.c. / i.ii.iii.) — Milkdown kernel limitation

## [1.0.1] - 2026-06-16

### Changed

- README: English is now the default language (Chinese → `README.zh-CN.md`)
- CHANGELOG: switched to English

## [1.0.0] - 2026-06-16

Initial release, forked from [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) v0.1.6 (MIT).

### Added

- **Word count** in the VS Code status bar (lines, words, characters), updated in real time
- **Enhanced TOC panel**: pin button, resizable width (200–500px), collapse/expand headings, state persistence

### Changed

- All identifiers (viewType, commands, config keys) migrated from `markdownWysiwyg.*` to `epytor.*`; can coexist with the original extension

### Fixed

- **Blank-line drift**: blank lines progressively drifting toward the top of the file during editing cycles
