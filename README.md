# Offline Table Analyzer

Offline Table Analyzer is a privacy-first table workbench that runs entirely in one HTML file. Paste or drop messy tabular data, inspect and filter it, build JOIN views, copy a selected range, and export clean Excel files—without uploading data or installing an application.

Version: **20.2.0**

## Why this project exists

Operational data rarely arrives as a perfect spreadsheet. It is often copied from a terminal, a browser, a Markdown document, an Excel sheet, or a diagnostic log. Offline Table Analyzer turns those inputs into a consistent table model and provides the practical tools needed to review and move the result elsewhere.

- Fully offline and dependency-free at runtime
- One portable `index.html`
- No accounts, telemetry, analytics, or network requests
- Designed for sensitive operational and troubleshooting data
- English documentation with a [Chinese guide](README.zh-CN.md)

## Features

### Import and normalization

Source text is parsed through a 10-parser pipeline tried in this priority order:

1. **CLI table-data** — legacy multi-table format with `table-data` and `validflag` markers
2. **HTML clipboard tables** — including `colspan`, `rowspan`, and `<br>`
3. **ASCII / terminal tables**
4. **Markdown / pipe tables** — including escaped pipes
5. **TSV / Excel paste**
6. **CSV** — quoted commas, escaped quotes, multiline cells
7. **Semicolon-delimited CSV**
8. **Fixed-width text** — columns separated by repeated spaces
9. **Aligned fixed-width text** — delimiter-free aligned output with character-position columns
10. **Whitespace-delimited plain text** (fallback)

Additional import capabilities:

- **Header modes**: automatic inference, forced first-row, or generated headers (`Column1`, `Column2`, …). CLI table-data uses `validflag` rows as headers. Duplicate and blank headers are normalized. Parse diagnostics are surfaced in the UI.
- **Aligned-table input**: recognizes pure `-` separator lines, supports separator lines above/below a table or between header and data, preserves multiple tables, and keeps cell text such as `--` unchanged.
- **Source input**: paste, drag-and-drop, or file picker. Format is auto-detected from file extension (`.csv` / `.tsv` / `.html` / `.htm` / `.md` / `.markdown`).
- **Editors**: resizable source textarea (120–600 px) and a fullscreen source editor for large inputs.
- 25 MB safety limit on source text and workspace files.

### Analysis workbench

- **Multiple named, reorderable analysis tabs**, each with independent state.
- **Three-level filtering**: global filter across all tables, per-table filter, and per-column filter. Rules support equals, contains, not-equal, numeric comparisons, regex, AND/OR logic, and quoted multi-word values.
- **Highlight rules** with a highlight-only (focus) mode that hides non-matching rows.
- **Per-table visible-column selection** and collapsible table cards.
- **Column-header and transposed row-header preview modes** for inspecting wide or tall tables.
- **Pagination**: 50, 100, 250, or 500 rows per page per table.
- **Persisted cell corrections** with undo/redo (`Ctrl`+`Z` / `Ctrl`+`Y`).
- Corrections are cleared with a visible notice when the source text, imported file, parser format, or header mode changes, preventing row-indexed edits from being applied to different records.

### JOIN views

- Six join types: **Inner**, **Left**, **Right**, **Full**, **Semi**, and **Anti**.
- **Multiple equality conditions** per view.
- Either side can be a raw parsed table or an existing view (chained JOINs).
- **Column search**, **aliases** (`col AS alias` or `col: alias`), and **drag-to-reorder** output columns.
- **Auto-match** same-name columns across left and right sources.
- **Dependency cycle detection** prevents circular view references.
- Real-time **match/unmatched row estimates** during design.
- **Collision-safe compound keys** and correct preservation of `0` and `false` values.

### Copy, export, and recovery

- **Copy formats**: TSV (default), CSV, Markdown, and ASCII. Every copy also includes an HTML clipboard payload for pasting into rich-text editors.
- **Spreadsheet formula injection protection**: cells starting with `=`, `+`, `@`, or a non-numeric `-` are prefixed to prevent accidental execution when pasting into spreadsheet applications.
- **Excel export**:
  - **Raw Excel** — the parsed tables as stored, before any filtering.
  - **Full Excel** — select which tables and views to include, with display-column projection.
  - **Preview Excel** — the currently filtered and paginated results.
- Safe numeric serialization keeps long identifiers, unsafe leading-zero values, high-precision numeric-looking strings, and non-finite values as Excel text.
- **Versioned workspace backup** (JSON): export the entire workspace and restore it later, choosing to **replace** the current workspace or **append** each tab as a new analysis.
- **Configuration export / import**: rules and views only, no raw data. 5 MB file limit. Useful for sharing analysis setups without exposing underlying data.
- **Temporary data mode**: disable raw-text persistence so source data stays only in the current page session. Rules and preferences are still saved.
- **Visible storage status** in the footer with a usage meter and clear failure reporting when `localStorage` quota is exceeded.

## Quick start

1. Download or clone this repository.
2. Open `index.html` in a current desktop browser.
3. Paste data, drop a supported text file, or choose **Load sample**.
4. Select a format/header strategy if automatic detection needs correction.
5. Choose **Parse data**.

No server is required. A local static server is useful only during development.

## Browser support

The release target is the latest two versions of Chrome, Edge, and Firefox on Windows, macOS, and Linux, plus the latest Safari on macOS. Mobile layouts provide a usable fallback, but dense editing and JOIN design are best on a desktop-sized screen.

The application uses modern browser APIs including `localStorage`, `FileReader`, `DOMParser`, `Blob`, `TextEncoder`, and the Clipboard event API.

## Privacy and local storage

All parsing, filtering, JOIN processing, copying, and Excel generation happen in the browser. The application contains no external resources or network API calls.

By default, the current workspace is stored in browser `localStorage` under the key `ota_v20_workspace` so it can survive a refresh. Disable **Save raw data on this device** to keep source text only in the current page session. The **Clear local data** button removes all stored workspace data. A storage usage meter in the status bar helps monitor quota consumption. When saving fails (e.g., quota exceeded), the status bar reports the failure and the in-memory data remains available for backup.

Read [PRIVACY.md](PRIVACY.md) before using the tool with sensitive data.

## Recommended limits

- Maximum accepted source/workspace file: 25 MB
- Default rendered page: 100 rows per table (switchable to 50, 250, or 500)
- For very large datasets, keep raw-data persistence disabled and export a workspace backup before closing the page
- XLSX files can be exported but are not imported
- JOIN conditions are equality-based; data types are compared as represented in the parsed table

## Other features

- **Dark / light theme** toggle, persisted across sessions.
- **Responsive sidebar**: collapses to a drawer on viewports narrower than 760 px.
- **Keyboard shortcuts**:
  - `Ctrl`+`Enter` — parse current source
  - `Ctrl`+`N` — new analysis tab
  - `Ctrl`+`O` — open local data file
  - `Ctrl`+`S` — save workspace
  - `Ctrl`+`Z` / `Ctrl`+`Y` — undo/redo cell edits
  - `Ctrl`+`A` — select all in current preview table
  - `F2` — rename current tab
  - `?` — help and shortcut reference
- **Reduced motion** support via `prefers-reduced-motion: reduce`.
- **ARIA semantics** across the UI, including roles, labels, and live regions for assistive technology.

## Development

Runtime dependencies are intentionally zero. Node.js is used only for validation.

```bash
npm test              # runs all 7 test suites
npm run build:release # rebuilds the single-file release from src/
npm run validate:release  # release readiness check
```

The test suite covers parser formats, copy serialization, state/storage behavior, JOIN correctness, syntax checks, UI contracts, accessibility markers, and offline release constraints.

## Documentation

- [User guide](docs/user-guide.md)
- [Requirements and scope](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Refactor requirements](docs/refactor-requirements.md)
- [Refactor architecture](docs/refactor-architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and keep the runtime offline, dependency-free, and distributable as one self-contained HTML file.

## License

[MIT](LICENSE)
