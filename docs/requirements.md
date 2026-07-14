# v20 Requirements and Scope

The workspace schema remains version `20`; the current application release is **20.2.0**.

## 1. Product definition

Offline Table Analyzer is a local-first workbench for turning copied or text-file tabular data into inspectable, filterable, joinable, and exportable tables. It is not intended to replace a spreadsheet, a database, or a cloud BI product.

The defining constraints are:

- no server and no network dependency;
- no installation required for end users;
- one self-contained release HTML file;
- sensitive source data stays in the browser;
- legacy `cli-table-data` inputs remain supported;
- parsing or migration ambiguity must be visible rather than silently destructive.

## 2. Complete inherited v18 requirements

### Import

- Paste plain text and capture HTML table clipboard content.
- Automatically detect or manually select CLI, CSV, TSV, semicolon, HTML, Markdown/pipe, ASCII, fixed-width, aligned fixed-width, or whitespace text.
- Support CSV quotes, escaped quotes, embedded delimiters, and embedded line breaks.
- Normalize BOM, CRLF, NBSP, literal/escaped `<br>`, blank lines, blank headers, and duplicate headers.
- Offer automatic header inference, forced first-row header, or generated headers.
- Keep CLI `validflag` header semantics independent of general header inference.
- Parse multiple CLI and HTML tables.
- Continue parsing mismatched rows and surface diagnostics.

### Source editing

- Resizable primary editor.
- Full-screen editor with synchronized format/header controls and statistics.
- Paste, clear, sample, and raw export actions.
- Persist source and UI state per analysis tab.

### Workspace

- Create, close, activate, rename, and reorder analysis tabs.
- Maintain unique IDs and titles and retain at least one tab.
- Preserve theme, global JOIN views, and copy preferences.
- Backup/restore tabs and import/export configuration.

### Analysis rules

- Select visible raw tables and enabled JOIN views.
- Select focus/visible columns per table.
- Global and table filters with exact, contains, not-equal, numeric comparisons, regex, AND, and OR.
- Per-column contains filters.
- Highlight and highlighted-only modes.
- Per-table collapse state and row/show/filter counters.

### JOIN

- Raw table or existing view as either source.
- Inner and Left equality joins with multiple conditions.
- Column search and selection, aliases, and output ordering.
- Automatic same-name relation matching.
- Match and unmatched row estimates.
- View management, duplication, deletion, and JSON import/export.
- Cycle protection and unsaved-change confirmation.

### Preview and movement of results

- Column-header and transposed row-header orientations per table.
- Visual rectangular selection in either orientation.
- Selection auto-scroll and table-wide Ctrl/Cmd+A.
- Cell editing.
- TSV/CSV/Markdown/ASCII text copy plus HTML clipboard content.
- Raw, full, and filtered-preview Excel export.
- Multiline preservation appropriate to each output format.

## 3. v20 release requirements

### R1 — trustworthy persistence

- Schema version `20`, application version `20.2.0`.
- Single key `ota_v20_workspace`; migrate legacy `v16_4_store` once and remove it only after a successful v20 write.
- Catch `QuotaExceededError` in `save()` and report the specific failure in the status bar; in-memory data remains usable.
- Show saved/failed state, estimated storage use (`json.length * 2` for UTF-16 approximation), and a usage meter in the status bar.
- Support temporary raw-data mode via the `persistRaw` flag: when false, raw source strings are serialized as empty to save space.
- The `loadFailed` flag prevents destructive overwrite of an unreadable workspace with an empty default.
- Clear local data removes `ota_v20_workspace`, all legacy keys, and `v16_4_inputHeight`.

### R2 — zero silent truncation

- Rows shorter than the max column width are padded with empty strings rather than truncated.
- Overflow cells (longer than headers) are preserved and flagged via a `ROW_WIDTH_MISMATCH` diagnostic.
- The CLI parser expands headers when rows contain extra columns (the `validflag` line determines the header set).
- Parser diagnostics and format candidates (with confidence scores) are returned through the public `ImportEngine.parse()` result.
- Diagnostics are visible via a "Details" button and include format candidates with one-click correction to switch parsers.

### R3 — safe imports and rendering

- Source/workspace imports: 25 MB limit (`MAX_IMPORT_BYTES = 25 * 1024 * 1024`).
- Configuration imports: 5 MB limit (hardcoded in the file input handler).
- Workspace import validates `kind` (`ota-workspace` or `table-tool-tabs`), schema forward-compatibility, and doc count (≤100).
- Recursive safety check via `isSafePayload`: depth ≤12 levels, ≤2000 keys per object, ≤10000 array items, blocks `__proto__`, `prototype`, `constructor`.
- Imported IDs are deduplicated and titles are enforced unique across the workspace.
- User-derived names and headers are escaped or rendered via DOM text APIs; dangerous object-key names are blocked for table and view names.

### R4 — data-correct JOINs

- Compound keys use `JSON.stringify` of typed tuples `[typeof value, value ?? null]` for collision safety.
- Missing relation fields (columns not present in either table) are rejected by `parsePairs`.
- Numeric `0` and boolean `false` are preserved correctly in composite keys.
- Duplicate output headers are normalized via `TableUtils.ensureUniqueHeaders`.
- Dependency cycles are detected via DFS graph traversal before save.
- All six JOIN types implemented: Inner, Left, Right, Full, Semi, Anti.

### R5 — large-table protection

- Per-table pagination limits rendered DOM rows; page sizes: 50, 100, 250, 500 (enforced in `normalizeDoc`).
- Full filtered result is exported regardless of the current page.
- Source size is checked before parse: `sourceText.length * 2 > MAX_IMPORT_BYTES`.
- For slow parses (>800 ms elapsed), a Toast notification shows the parse time.
- A single source above 25 MB is rejected at the input stage.

### R6 — complete existing controls

- "Export displayed columns": when `exportCols === 'shown'`, `projectTableForExport` projects focus columns during full export.
- Export options (`exportOnlyChecked`, `exportCols`) are stored per-tab in the doc UI state and restored on tab changes.
- HTML clipboard state is scoped to the current tab via `docId` tracking in `lastPaste`; it is cleared on tab switch or plain-text edit.
- Full-screen source editor Escape behavior synchronizes back to the main input via `syncSourceTextFromLarge()` before closing with `closeSourceEditor()`.
- Cell corrections are persisted as a non-destructive overlay in `ui.cellEdits`, applied during `applyStoredCellEdits()`, and support session undo/redo.

### R7 — accessible responsive workbench

- Primary workflow: sidebar data tab → parse button → config tab/preview → export buttons (Import → Parse → Analyze → Export).
- Visible parse states via `parseStatus` element with ready/warning/error CSS classes.
- Status bar shows storage status, usage meter fill, and saved timestamp.
- Keyboard: tab activation (Enter/Space), rename (F2), close (Delete), arrow key navigation.
- Shortcuts: Ctrl+Enter (parse), Ctrl+N (new tab), Ctrl+O (file import), Ctrl+S (save), Ctrl+Z/Ctrl+Y (undo/redo cell edits), Ctrl+A (select all), F2 (rename tab), ? (help).
- CSS rules for `prefers-reduced-motion: reduce` (animations/transitions set to 0.01 ms) and `forced-colors: active` (borders, selection outline).
- Mobile: below 760 px, the sidebar becomes a fixed drawer with a toggle button.

### R8 — open-source release quality

- Include README, license, privacy, security, contribution, conduct, changelog, architecture, user guide, roadmap, CI, and issue templates.
- One authoritative application file (`index.html`).
- Production test hooks and historical duplicate HTML files removed.
- Five test suites (`run-parser-tests`, `run-copy-tests`, `run-tab-tests`, `run-join-tests`, `run-ui-tests`) plus one release validator (`validate-release.js`).
- CI runs on ubuntu-latest, windows-latest, and macos-latest.

## 4. v20 additions delivered

### Workbench and layout
- Redesigned workbench with a responsive layout, sidebar, and top navigation.
- Narrow-screen (<1100 px) and mobile (<760 px) breakpoints with a drawer sidebar and toggle button.
- Resizable source input editor with height persistence in `localStorage`.

### Import and parsing
- File selection via button and drag/drop import with automatic format detection from file extension.
- Ten parsers: CLI table-data, HTML, ASCII, Markdown/pipe, Excel-paste (TSV), CSV, semicolon-CSV, fixed-width, aligned fixed-width, plain text.
- Format candidates returned with confidence scores; one-click format switching via the "Details" diagnostic dialog.
- Parse-time Toast notification when parsing exceeds 800 ms.
- `ROW_WIDTH_MISMATCH` diagnostics for mismatched rows (overflow preserved, short rows padded).
- CLI parser header expansion when rows have more columns than headers.
- Legacy `[PREFIX] table-data` markers supported.
- `rowspan` preservation in HTML tables and escaped Markdown pipe handling.

### v20.1.0 data correctness additions
- Added the aligned fixed-width parser for delimiter-free reports with pure `-` separator lines, multiple tables, separated header/data blocks, and `--` empty cells.
- Clear persisted cell-correction overlays and session history when source text, imported file, parser format, or header mode changes.
- Preserve HTML `rowspan` values across expanded rows, including combined `rowspan`/`colspan` cells.
- Emit long or unsafe numeric-looking strings as Excel text to preserve identifiers and precision.
- Treat a complete `/.../` filter token as one regular expression before processing pipe-based OR alternatives.

### Persistence and data safety
- Schema version 20 with single key `ota_v20_workspace` and legacy `v16_4_store` migration.
- `QuotaExceededError` detection with actionable error message in the status bar.
- `loadFailed` flag prevents destructive overwrite of corrupted workspaces.
- Temporary raw-data mode (`persistRaw`: false serializes empty raw strings, true persists full source).
- Storage bytes estimated as `json.length * 2` with a visual usage meter in the status bar.
- Clear local data removes all v20 and v16 legacy keys.
- Workspace import validates kind, schema forward-compatibility, doc count (≤100), and structural safety.
- Config import with title-based matching, automatic ID deduplication, and a prompt to create new docs for unmatched configs.
- Versioned workspace/configuration export in JSON format.

### JOIN engine
- All six JOIN types: Inner, Left, Right, Full, Semi, Anti.
- Compound keys via `JSON.stringify` of typed tuples; preserves `0` and `false`.
- Missing relation fields rejected; dependency cycle detection via DFS.
- Duplicate output headers normalized.
- JOIN editor enhancements: column search, "only selected" filter, drag-reorder output columns, auto-match relations, help panel.
- Match/unmatched row estimates and dependency chain visualization.
- View management with batch delete and batch JSON export.

### Table display and interaction
- Per-table pagination (50/100/250/500 rows per page) with page size persisted per tab.
- Column-header and row-header (transposed) preview orientation per table.
- Visual rectangular cell selection with auto-scroll, Ctrl+A for select-all.
- Cell inline editing with non-destructive overlay (`ui.cellEdits`), 100-step session undo/redo.
- Per-column contains filters with popover UI.
- Global, per-table, and highlight/only-highlighted filter modes with quoted filter values and regex support.
- Collapsible table cards with row/show/filter counters.

### Export and copy
- Raw, full, and filtered-preview export to Excel (.xlsx) with sanitized sheet names.
- "Export displayed columns" semantics: `exportCols === 'shown'` projects focus columns.
- Per-tab export options: `exportOnlyChecked` (visible tables only) and `exportCols`.
- Copy: four text formats (default/TSV, CSV, Markdown, ASCII) plus HTML clipboard content.
- Spreadsheet formula-prefix protection (`spreadsheetSafe` toggle).
- Workspace and configuration JSON export.

### Accessibility and UX
- Keyboard shortcuts: Ctrl+Enter (parse), Ctrl+N (new tab), Ctrl+O (file import), Ctrl+S (save), Ctrl+Z/Ctrl+Y (undo/redo), Ctrl+A (select all), F2 (rename tab), ? (help).
- Tab activation (Enter/Space), rename (F2), close (Delete), arrow key navigation, drag-reorder.
- `prefers-reduced-motion: reduce` and `forced-colors: active` CSS media query support.
- Toast notifications for parse time, save status, copy count, and errors.
- Status bar with storage status, usage meter, and saved timestamp.
- Parse status indicator with ready/warning/error visual states.

### Repository and testing
- Five test suites: parser, copy, Store/tab, JOIN, UI syntax.
- One release validator checking version, script count, network-free, accessibility, and file presence.
- CI on ubuntu-latest, windows-latest, and macos-latest via GitHub Actions.
- Repository metadata: README, LICENSE, changelog, architecture, user guide, roadmap, security, privacy, contribution, conduct, issue templates, pull request template.

### Sample data
- Three built-in CLI sample tables: Inventory (products/stock), Orders (customer orders), SystemLogs (log entries).

## 5. Explicit non-goals for 20.0.0

- XLSX import.
- Remote URLs, database connectors, accounts, sharing, or synchronization.
- Full spreadsheet formulas or cell formatting.
- SQL, pivot tables, charts, or dashboards.
- Guaranteed durable storage beyond browser storage behavior.
- Native-app packaging.

These are evaluated in the roadmap only after the v20 reliability baseline remains stable.
