# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

English | [简体中文](CHANGELOG.zh-CN.md)

## [1.2.0] - Unreleased

### Features

- **Clean Markdown serialization mode** (`epytor.markdown.serializationMode`: `clean` / `compatible`) — minimizes unnecessary escaping and redundant table breaks; default `clean` (#15, thanks @dongjha)
- **Source ↔ preview keeps your place** — switching between the WYSIWYG editor and the text/preview tab returns to the same position, from any entry point (menu, shortcut, command palette, search results)
- **Table grid picker**: an 8×8 grid on the insert-table button, any rows × columns
- **Regular-expression search** in the find bar (`.*` toggle) with invalid-pattern feedback and zero-width match protection
- **Heading sticky title (multi-level) with sibling folding** — the document itself is never modified
- **Table wrap modes** (`epytor.tableWrapMode`: `wrap` / `nowrap`) plus Shift+Enter soft breaks inside cells
- **Editable frontmatter panel** — edit key/value rows in place; lists, comments and blank lines are preserved
- **Toolbar overflow menu** — buttons collapse into a "⋯" menu on narrow windows
- **Mermaid preview zoom** (0.2×–3×, with reset and horizontal scroll)
- **Loading indicator** while a Markdown editor is opening or rebuilding

### Experience

- **Opening or returning to a Markdown tab no longer flashes** — the content no longer appears, disappears and reappears
- **Coming back to a tab restores your scroll position and your folded headings**
- **Sticky heading switching matches the built-in editor**: up to three levels, pinned as soon as the heading touches
- **TOC panel open/close reflows the sticky heading and toolbar immediately**
- **`.markdown` files get the same menu and `Ctrl/Cmd+Shift+M` shortcut as `.md`**
- **List keyboard behavior follows the official defaults**: Backspace on an empty item deletes it, on a non-empty item merges it into the previous one, and numbering reflows automatically
- **Auto save follows the built-in VS Code `files.autoSave`** (`off` / `afterDelay` / `onFocusChange` / `onWindowChange`); `epytor.autoSave` and `epytor.autoSaveDelay` are gone
- **Table cell padding, line spacing and the row/column selection toolbar** are unified with the rest of the editor
- **Toolbar overflow "⋯" no longer overlaps buttons**
- **Failures are no longer silent**: image upload, image rename, save and switch failures explain what went wrong, and several messages that stayed English in a Chinese UI are translated
- **Switching back to a tab restarts undo/redo history** — document content, scroll position and folded headings are restored; the undo stack is not

### Performance

- **Opening a Markdown file is significantly faster**: the editor payload loads on demand (Mermaid, KaTeX and per-language syntax support only when used) and post-open bookkeeping no longer blocks the first frame
- **Typing in large documents no longer stutters every few hundred milliseconds** — nothing is processed in the background while you type; the document is handed over after you stop
- **Large-document input lag** (#16, thanks @dongjha): editing stays smooth up to ~3000 lines (see Known Limitations)
- **Background Markdown tabs no longer hold an editor** — memory and CPU are released while a tab is hidden
- **Search stays responsive on huge files**: highlighting is capped instead of building tens of thousands of ranges

### Bug fixes

- **"The editor is not responding; the file was saved with possibly outdated content" no longer appears** — it used to show up even with several Markdown files open and no edits at all
- **Unsaved edits are no longer lost when you switch tabs**, and a restored tab shows what you last typed
- **External writes are no longer overwritten by auto save** — files changed by scripts or AI assistants keep their content
- **No more whole-window input stutter or flashing** while a Markdown page was open (other webviews flickered too)
- **Explorer clicks no longer make tabs flash**, and switching documents no longer leaves the editor unable to receive input
- **Source ↔ preview**: the cursor no longer jumps back to line 1 or to the wrong block, no duplicate tab is created, the view no longer stops at the top of the file, and large files no longer lose their position when switching back
- **Sticky heading**: no longer disappears entirely, is clickable again (the first heading included)
- **TOC**: the target heading is no longer hidden behind the sticky title, no sticky bar is left behind, and folded state is no longer shared between identically named headings or across documents
- **Documents no longer open scrolled to the first heading** (frontmatter pushed out of view)
- **Shift+Enter inside a table cell no longer turns the content into a paragraph**, and soft breaks survive save/reload
- **Images**: paths with spaces or parentheses no longer break or get mangled on save, an image title is no longer swallowed into the path (which caused 404s), rename failures are reported instead of silent, Windows reserved names are rejected, and upload failures, timeouts and oversized files are reported
- **Global search**: clicking a non-Markdown result no longer jumps to the top of the file or scrolls other Markdown documents
- **Your "Open With" choice for `.md` files is no longer silently removed**
- **Configuration changes (serialization mode, debug mode) are no longer reverted** by an external write
- **Find bar**: a closed find bar no longer runs the previous search, and invalid patterns are reported
- **Path and language autocomplete**: keyboard navigation keeps its highlight
- **Code blocks keep their syntax highlighting**
- **Inline code at the end of a block** keeps the code style (path completion for `./` `@/` stays usable); ArrowRight exits with an in/out indicator
- **Editor focus restored** when switching back from another file (cursor visible but input dead)
- **No false "unsaved" dot** — neither on the first frame nor when merely moving the cursor
- **Status bar word count updates**, and headings inside blockquotes show up in the TOC
- **Mermaid zoom baseline**: zooms relative to the original rendered size instead of the container width
- **Security**: external links are limited to http/https/mailto, workspace image paths and path links can no longer escape the workspace, and upload errors no longer echo the server response body
- **Milkdown** upgraded 7.22.0 → 7.22.1 (inline-code mark fix and a dompurify security update)

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
