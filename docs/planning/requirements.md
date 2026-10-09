# Requirements and Scope

The current workspace schema is `21`; application release **23.1.0**. Schema 20 and legacy backups remain supported through migration. Historical additions below describe their release at the time; current requirements take precedence. The [large-data ADR](../architecture/large-data.md) records the authorized extension.

## 1. Product definition

Offline Table Analyzer is a local-first workbench for turning copied or text-file tabular data into inspectable, filterable, joinable, and exportable tables. It is not intended to replace a spreadsheet, a database, or a cloud BI product.

The intended end-user environment is a desktop browser. A phone can host the development tools through Termux, but Android browser behavior and touch interaction are not the primary release target. The existing narrow-screen layout remains a fallback.

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
- Preserve theme, global JOIN views, and copy preferences. `copyFormat` remains the existing global field and accepts `default`, `csv`, `markdown`, `ascii`, `json-inline`, `json-expanded`, `lua-inline`, or `lua-expanded`; the older `json` value retains the expanded layout.
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
- TSV/CSV/Markdown/ASCII/JSON inline/JSON expanded/Lua inline/Lua expanded text copy plus format-appropriate HTML clipboard content.
- Copying remains driven exclusively by the selected visual rectangle. Lua uses selected headers as string keys, selected records as child tables, continuous `[1]`-based indexes, and equivalent semantics in column-header and transposed row-header views.
- Raw, full, and filtered-preview Excel export.
- Multiline preservation appropriate to each output format.

## 3. Current release requirements

### R1 — trustworthy persistence

- Schema version `21`, application version `23.1.0`.
- Released 21.x–22.1.0 correction keys migrate from literal table names to `$` + table name; `cellEditKeyEncoding: dollar-v1` makes the migration idempotent. Backups without this release metadata retain the canonical source contract.
- Settings key `ota_v21_workspace`; migrate `ota_v20_workspace` and `v16_4_store`, removing the legacy key only after a successful new write.
- Large raw snapshots commit in IndexedDB before the settings reference is published; unchanged raw reuses its snapshot. Recovery uses the latest settings and matching raw document IDs/revisions. Failed recovery blocks automatic overwrite.
- Raw snapshots retain exact UTF-16 strings, including BOM, CRLF and lone surrogates; released UTF-8 Blob snapshots remain readable without consuming their BOM. New snapshots contain only source identity/raw and commit metadata. Recovery ignores obsolete snapshot UI, so legitimate correction overlays exceeding 2000 edited rows cannot block original recovery. External import safety checks remain unchanged.
- A superseding save ends earlier saving/cleanup status even when rejected before I/O. Snapshot cleanup failures are visible and retried on the next save, without replacing the committed workspace or repeating successful cleanup for unchanged raw.
- Show saving/restoring/cleanup status. Background storage errors preserve memory and the previous committed workspace. Wait for a saved status before closing; pending save offers the browser close confirmation.
- Catch `QuotaExceededError` in `save()` and report the specific failure in the status bar; in-memory data remains usable.
- Show saved/failed state, estimated storage use (`json.length * 2` for UTF-16 approximation), and a usage meter in the status bar.
- Support temporary raw-data mode via the `persistRaw` flag: when false, raw source strings are serialized as empty to save space.
- The `loadFailed` flag prevents destructive overwrite of an unreadable workspace with an empty default.
- Clear local data removes current/legacy keys, `v16_4_inputHeight`, and IndexedDB raw snapshots. Temporary mode clears stored raw asynchronously while retaining the current in-memory text; cleanup failure is visible.

### R2 — zero silent truncation

- Rows shorter than the max column width are padded with empty strings rather than truncated.
- Overflow cells (longer than headers) are preserved and flagged via a `ROW_WIDTH_MISMATCH` diagnostic.
- The CLI parser expands headers when rows contain extra columns (the `validflag` line determines the header set).
- Parser diagnostics and format candidates (with confidence scores) are returned through the public `ImportEngine.parse()` result.
- `ImportEngine.detect()` validates bounded record-aware samples before `parse()` calls the selected full-source adapter. Sampling expands through 16,384/65,536/262,144 UTF-16 code units and 64/256/512 records, with at most six fingerprint candidates per round (bounded adapter fallback if none is usable). Sample-cut rows never distort separator consistency. Unresolved ambiguity above the maximum sample size produces an `ambiguous` result with no guessed table; explicit/manual or compatible remembered choices resolve it.
- Complete diagnostics stay in Worker; Window displays at most 200 details and their full count. Source records and Excel rows are never capped by this diagnostic display limit.
- Diagnostics are visible via a "Details" button and include format candidates with one-click correction to switch parsers.

### R3 — safe imports and rendering

- Source file bytes and `raw.length * 2` UTF-16 estimate: 128 MiB (`MAX_IMPORT_BYTES`). Workspace file and total raw estimate: 256 MiB (`MAX_WORKSPACE_BYTES`), up to 100 documents. Limits apply before replacing the current workspace.
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
- Original text above 128 Ki characters uses at most 100 lines/10,000 characters of read-only preview; complete text remains the parse/save/export source. New paste replaces large text.
- Large table-data/text parsing, querying, JOIN and XLSX run in cancellable embedded Workers; large HTML retains its DOMParser Window path. Error/cancel/stale source results cannot discard original text or overwrite a newer source.
- Non-table clipboard HTML does not force text onto Window. ImportEngine owns the DOMParser routing decision; a manual text parser remains authoritative even with an HTML table in the clipboard.
- At most 8 million cells in parsed datasets, combined selected/query/export tables; 1 million rows per JOIN; 256 MiB XLSX output. Budget failures are explicit, without silent truncation. These are implementation protection budgets, not universal capacity guarantees.
- Pages reuse the same query and raw snapshot; only source/query/view/correction changes invalidate derived results. Worker full-query and Window page caches each have at most two entries. Complete parsed/filtered/JOIN tables stay in Worker; Window descriptors contain empty rows plus rowCount. Only current pages, at most the selected 50/100/250/500 rows per visible table, cross the boundary. Hidden large-mode tables send metadata only.
- All original raw text is retained, including CRLF for intercepted large paste/file input. XLSX exports full filtered results across pages.

### R6 — complete existing controls

- All Excel actions prepare the latest original source even when automatic parsing is disabled or skipped for large input. Reuse a matching completed parse (including corrections) or await the matching pending parse. Automatic format detection is the default; manual parser/header choices remain authoritative.
- Direct paste → Full Excel exports all rows/columns by default, subject to explicit table/column/JOIN export settings and existing resource budgets. Preview/page limits never truncate full export.
- The export lock covers parsing and serialization. Show each stage, preserve cancellation, and validate document/source/options again immediately before download. Failure, cancellation, changed source/options or tab switch cannot download an outdated result; keep original text recoverable.
- "Export displayed columns": when `exportCols === 'shown'`, `projectTableForExport` projects focus columns during full export.
- Window and Worker share TableUtils column projection: preserve requested order, ignore missing columns, fall back to all columns when none are valid, and leave the original table unchanged.
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
- Node's built-in test runner executes unit and integration files under `tests/`; `npm run test:e2e` runs the generated release in Chromium and reads exported XLSX files with a development-only reader. Release and architecture validation use their named npm scripts.
- CI runs Node tests on Node 20, 22, and 24, Chromium E2E on Node 22, LCOV coverage reporting on Node 24, and release plus architecture validation on Node 20.

## 4. v20 additions delivered

### Workbench and layout
- Redesigned workbench with a responsive layout, sidebar, and top navigation.
- Narrow-screen (<1100 px) and mobile (<760 px) breakpoints with a drawer sidebar and toggle button.
- Resizable source input editor with height persistence in `localStorage`.

### Import and parsing
- File selection via button and drag/drop import with automatic format detection from file extension.
- Thirteen parsers: CLI table-data, Data-Block, HTML, JSON, CLI multi-block, ASCII, Markdown/pipe, Excel-paste (TSV), CSV, semicolon-CSV, fixed-width, aligned fixed-width, plain text.
- Format candidates returned with confidence scores; one-click format switching via the "Details" diagnostic dialog.
- Parse-time Toast notification when parsing exceeds 800 ms.
- `ROW_WIDTH_MISMATCH` diagnostics for mismatched rows (overflow preserved, short rows padded).
- CLI parser header expansion when rows have more columns than headers.
- Legacy `[PREFIX] table-data` markers supported.
- `rowspan` preservation in HTML tables and escaped Markdown pipe handling.

### v20.1.0 data correctness additions
- Added the aligned fixed-width parser for delimiter-free reports with `-` or `-`/`+` separator lines, multiple tables, separated header/data blocks, preserving `--` as cell text.
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
- Copy: eight selectable text formats (default/TSV, CSV, Markdown, ASCII, `json-inline`, `json-expanded`, `lua-inline`, `lua-expanded`) plus HTML clipboard content; legacy `json` is equivalent to `json-expanded`, and JSON/Lua HTML is a code block rather than a table.
- Spreadsheet formula-prefix protection (`spreadsheetSafe` toggle) applies to spreadsheet-oriented copy formats and not to Lua.
- Workspace and configuration JSON export.

### Accessibility and UX
- Keyboard shortcuts: Ctrl+Enter (parse), Ctrl+N (new tab), Ctrl+O (file import), Ctrl+S (save), Ctrl+Z/Ctrl+Y (undo/redo), Ctrl+A (select all), F2 (rename tab), ? (help).
- Tab activation (Enter/Space), rename (F2), close (Delete), arrow key navigation, drag-reorder.
- `prefers-reduced-motion: reduce` and `forced-colors: active` CSS media query support.
- Toast notifications for parse time, save status, copy count, and errors.
- Status bar with storage status, usage meter, and saved timestamp.
- Parse status indicator with ready/warning/error visual states.

### Repository and testing
- Unit and integration tests cover parser, copy/export, Store/dispatch/source/tab lifecycle, JOIN, QueryService, UI controllers, build determinism, bootstrap, and accessibility contracts.
- `validate-release.cjs` checks version, script count, network-free output, accessibility markers, and required files; `validate-architecture.cjs` checks the Store command boundary, offline/large-data boundaries, schema/version consistency, manifest completeness, and deterministic output.
- GitHub Actions runs tests on `ubuntu-latest` with Node 20, 22, and 24, plus a Node 20 release-validation job.
- Repository metadata: README, LICENSE, changelog, architecture, user guide, roadmap, security, privacy, contribution, conduct, issue templates, pull request template.

### Sample data
- Three built-in CLI sample tables: Inventory (products/stock), Orders (customer orders), SystemLogs (log entries).

### v22.0.0 architecture improvements
- Extracted `FilterEngine` (pure filtering/highlighting/column-projection) and `TableBuilder` (preview table DOM construction) as independent modules.
- `App.proc()` reduced from ~100 lines to 7-line delegation to `FilterEngine`.
- Added `Store.transition` revision/source lifecycle metadata, explicit schema migrations, and UI command-boundary validation.
- Added the pure `QueryService` pipeline so preview and preview export share JOIN/filter/focus results and bounded cache keys.
- Added status/chip visibility, format-candidate explanations, dialog focus trapping, and deterministic version injection.
- Build manifest contains 42 source modules; all tests, architecture validation, and release validation pass without regression.

## 5. Explicit non-goals

- XLSX import.
- Remote URLs, database connectors, accounts, sharing, or synchronization.
- Full spreadsheet formulas or cell formatting.
- SQL, pivot tables, charts, or dashboards.
- Guaranteed durable storage beyond browser storage behavior.
- Native-app packaging.
- Virtual scrolling, Arrow/SQL engines, external-memory queries, and streaming XLSX; the product remains a bounded single-file offline workbench. Local Workers and IndexedDB are included by the 22.1 ADR.

These remain deferred in the roadmap while schema 20 migration and existing reliability contracts are maintained.
