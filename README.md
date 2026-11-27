# Offline Table Analyzer

Offline Table Analyzer is a privacy-first table workbench that runs entirely in one HTML file. Paste or drop messy tabular data, inspect and filter it, build JOIN views, copy a selected range, and export clean Excel files—without uploading data or installing an application.

Version: **23.2.0**

[100,000-row performance results and recovery checks](docs/planning/large-data-23.1-results.md) are measured automatically in desktop Chromium CI; development can remain on a Termux phone.

## Why this project exists

Operational data rarely arrives as a perfect spreadsheet. It is often copied from a terminal, a browser, a Markdown document, an Excel sheet, or a diagnostic log. Offline Table Analyzer turns those inputs into a consistent table model and provides the practical tools needed to review and move the result elsewhere.

- Fully offline and dependency-free at runtime
- One portable `index.html`
- No accounts, telemetry, analytics, or network requests
- Designed for sensitive operational and troubleshooting data
- English documentation with a [Chinese README](README.zh-CN.md)

## Features

### Import and normalization

Automatic detection checks explicit structures, validates bounded candidate samples, and passes the full source only to the selected parser. Supported formats include:

1. **CLI table-data** — legacy multi-table format with `table-data` and `validflag` markers
2. **Data-Block structured text** — multiple `data <table> [...]` blocks with named tables
3. **HTML clipboard tables** — including `colspan`, `rowspan`, and `<br>`
4. **CLI multi-block fixed-width tables** — repeated CLI blocks with aligned headers
5. **ASCII / terminal tables**
6. **Markdown / pipe tables** — including escaped pipes
7. **TSV / Excel paste**
8. **CSV** — quoted commas, escaped quotes, multiline cells
9. **Semicolon-delimited CSV**
10. **Fixed-width text** — columns separated by repeated spaces
11. **Aligned fixed-width text** — delimiter-free aligned output with character-position columns
12. **JSON tables** — arrays of records, two-dimensional arrays, object records, and named table arrays
13. **Whitespace-delimited plain text** (fallback)

Additional import capabilities:

- **Header modes**: automatic inference, forced first-row, or generated headers (`Column1`, `Column2`, …). CLI table-data uses `validflag` rows as headers. Duplicate and blank headers are normalized. Parse diagnostics are surfaced in the UI.
- **Aligned-table input**: recognizes `-` or `-`/`+` separator lines, supports separator lines above/below a table or between header and data, preserves multiple tables, and keeps cell text such as `--` unchanged.
- **Source input**: paste, drag-and-drop, or file picker. Format is auto-detected from file extension (`.csv` / `.tsv` / `.html` / `.htm` / `.md` / `.markdown`).
- **Editors**: resizable source textarea (120–600 px) and a fullscreen source editor for large inputs.
- Large text uses a bounded read-only source preview, cancellable background parsing/filtering/JOIN/export, and asynchronous raw-data recovery.
- Source budget: 128 MiB UTF-16 estimate; workspace raw budget: 256 MiB. See the resource budgets below.

### Analysis workbench

- **Multiple named, reorderable analysis projects**, each with independent state and multiple source cards. Each card keeps its own source and parse options; visible cards form the project's table pool.
- **Three-level filtering**: global filter across all tables, per-table filter, and per-column filter. Rules support equals, contains, not-equal, numeric comparisons, regex, AND/OR logic, and quoted multi-word values.
- **Highlight rules** with a highlight-only (focus) mode that hides non-matching rows.
- **Per-table visible-column selection** and collapsible table cards.
- **Column-header and transposed row-header preview modes** for inspecting wide or tall tables.
- **Pagination**: 50, 100, 250, or 500 rows per page per table.
- **Large-dataset preview**: when many tables or cells are present, only the selected table is rendered; switch tables from the summary selector without flooding the page with simultaneous table DOM.
- **Persisted cell corrections** with undo/redo (`Ctrl`+`Z` / `Ctrl`+`Y`).
- Corrections are cleared with a visible notice when the source text, imported file, parser format, or header mode changes, preventing row-indexed edits from being applied to different records.

### JOIN views

After parsing your data, open **分析规则 → 视图设置 → ＋ 新建**. Join two tables from visible cards or use a saved project view as either source. Choose Inner, Left, Right, Full, Semi or Anti.

- **Choose keys.** Pick one or more equality conditions, match same-name fields, or apply a suggested pair after checking its shared-value and duplicate counts in the sample. Compound keys preserve value types, including `0` and `false`.
- **Choose the output.** Search, alias and reorder columns, or apply **左表全部＋右表补充**. With Right and Full joins this preset retains the right-side keys so you can identify unmatched right rows. Check the match counts and up to five actual output rows before saving.
- **Enable when ready.** The designer shows the output size. Activation checks the 1,000,000-row limit per JOIN and the 8,000,000-cell total for displayed source tables and enabled views. Clear **在当前工程启用** to save a definition for later.
- **Maintain a chain.** The designer checks for circular references before saving. Renaming a view updates its references across the project. Before deletion you can see which downstream views will be disabled and kept for repair. [Worked JOIN example](docs/guides/user-guide.md#85-find-customers-without-orders)

### Copy, export, and recovery

- **Copy formats**: TSV (default), CSV, Markdown, ASCII, JSON inline/expanded, and Lua inline/expanded. JSON and Lua copies use plain-text/code HTML payloads so they paste as code rather than a table.
- **Spreadsheet formula injection protection**: cells starting with `=`, `+`, `@`, or a non-numeric `-` are prefixed to prevent accidental execution when pasting into spreadsheet applications.
- Lua serialization does not apply spreadsheet formula prefixes and converts numbers, booleans, empty cells, hexadecimal values, and strings to Lua literals.
- **Excel export**:
  - **Raw Excel** — visible source tables from the current project's table pool, without filters or JOIN views.
  - **Full Excel** — select which tables and views to include, with display-column projection.
  - **Preview Excel** — all currently filtered results across pages.
- Paste and click **Full Excel** directly: exports prepare the latest source, reuse a matching completed or pending parse, and honor the chosen format/header options. Cancellation or a changed source prevents an outdated download; the original text stays intact.
- Safe numeric serialization keeps long identifiers, unsafe leading-zero values, high-precision numeric-looking strings, and non-finite values as Excel text.
- **Versioned workspace backup** (JSON): export the entire workspace and restore it later, choosing to **replace** the current workspace or **append** each tab as a new analysis.
- **Configuration export / import**: rules, JOIN views, and per-card UI settings, with no raw data. 5 MB file limit. Useful for sharing analysis setups without exposing underlying data.
- **Temporary data mode**: disable raw-text persistence so source data stays only in the current page session. Rules and preferences are still saved.
- **Visible storage status** in the footer, with an estimated workspace-size meter and clear reporting for local settings or IndexedDB snapshot failures. The estimate is not the browser's available quota.

## Quick start

1. Download or clone this repository.
2. Open `index.html` in a current desktop browser.
3. Paste data, drop a supported text file, or choose **Load sample**.
4. By default, parsing runs automatically after the input settles; select a format/header strategy if automatic detection needs correction.
5. For large sources or when auto-parse is disabled, choose **Parse now** to inspect the data, or click **Full Excel** directly to parse and export in one operation. The default export includes every row and column; explicit table/column export settings still apply.

No server is required. A local static server is useful only during development.

## Browser support

This is a desktop-browser application. The release target is the latest two versions of Chrome, Edge, and Firefox on Windows, macOS, and Linux, plus the latest Safari on macOS. Mobile layouts are a fallback; developing from a phone does not make Android browsers or touch interaction the primary acceptance target.

The application uses modern browser APIs including `localStorage`, IndexedDB, Web Workers, `FileReader`, `DOMParser`, `Blob`, `TextEncoder`, and the Clipboard event API.

## Privacy and local storage

All parsing, filtering, JOIN processing, copying, and Excel generation happen in the browser. The application contains no external resources or network API calls.

By default, small settings are stored under the historically named `ota_v21_workspace` key in browser `localStorage`; the current workspace schema is 22. Large original text is committed to IndexedDB before its snapshot reference is saved. Unchanged original text reuses its committed snapshot when settings or pages change. Schema 21, schema 20, and legacy workspaces migrate automatically after a successful save. Disable **Save raw data on this device** to keep source text only in the current page session. **Clear local data** removes the app's workspace settings and raw snapshots. The status-bar meter estimates saved workspace size; it does not measure available browser quota. If a settings write or raw-snapshot operation fails, the status bar reports the failure and the in-memory data remains available for backup.

Read [PRIVACY_POLICY.md](PRIVACY_POLICY.md) before using the tool with sensitive data.

## Recommended limits

- Source: file bytes and UTF-16 estimate each limited to 128 MiB; workspace file/raw aggregate: 256 MiB
- Parsed/query/export results: 8 million cells; each JOIN: 1 million rows; XLSX: 256 MiB output
- These are protection budgets, not guaranteed capacity on every computer; excess results produce a visible error and preserve original text.
- Default rendered page: 100 rows per table (switchable to 50, 250, or 500)
- Wait for the saved status before closing. Storage failures preserve current data for original-text/workspace backup. Private browser sessions do not retain data after closing; changing the HTML path/browser profile can change storage access.
- Automatic detection validates bounded, progressively enlarged samples; only the selected format parses the complete input. Unresolved large-input ambiguity offers manual format selection.
- Large table-data/text parsing, filtering, JOIN and XLSX work stays in a local Worker; Window receives table descriptors and current-page records. CSV/TSV records and CLI lines are consumed incrementally, while HTML/DOMParser parsing retains its Window path. See the [large-data architecture decision](docs/architecture/large-data.md) for the boundaries.
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

The browser runtime has no dependencies. Development dependencies provide Chromium E2E automation and XLSX readback.

```bash
npm ci
npm test              # rebuilds the release and runs all unit/integration tests
npm run test:coverage # runs Node tests and writes coverage/lcov.info
npm run test:e2e      # builds the release and runs the Chromium browser workflow
npm run build:release # rebuilds the single-file release from src/
npm run validate:release  # release readiness check
npm run validate:architecture # architecture and deterministic-build check
```

The test suite covers parser formats, copy serialization, state/storage behavior, JOIN correctness, syntax checks, UI contracts, accessibility markers, and offline release constraints.

On a supported desktop host, install Chromium with `node node_modules/playwright/cli.js install chromium --only-shell`, then run `npm run test:e2e`. Playwright's managed browser does not run in Termux/Android; CI runs this Chromium job on Ubuntu. For a real desktop Firefox check while developing in Termux, use the [Termux browser-validation guide](docs/testing/termux.md). On filesystems that do not allow symlinks, install dependencies with `npm ci --bin-links=false`.

## Documentation

- [User guide](docs/guides/user-guide.md)
- [Testing strategy](docs/testing/strategy.md)
- [Termux browser validation](docs/testing/termux.md)
- [Product requirements](docs/planning/requirements.md)
- [Roadmap](docs/planning/roadmap.md)
- [Architecture](docs/architecture/architecture.md)
- [Refactor requirements](docs/planning/refactor-requirements.md)
- [Release architecture](docs/architecture/refactor.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and keep the runtime offline, dependency-free, and distributable as one self-contained HTML file.

## License

[MIT](LICENSE)
