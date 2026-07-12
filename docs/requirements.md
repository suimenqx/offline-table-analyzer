# v20 Requirements and Scope

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
- Automatically detect or manually select CLI, CSV, TSV, semicolon, HTML, Markdown/pipe, ASCII, fixed-width, or whitespace text.
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

- Use a single `20` workspace schema and `20.0.0` application version.
- Migrate the legacy `v16_4_store` once and remove it only after a successful v20 write.
- Catch quota/security failures and keep in-memory data usable.
- Show saved/failed state and estimated storage use.
- Support temporary raw-data mode.
- Never overwrite an unreadable saved workspace with an empty default workspace.

### R2 — zero silent truncation

- Preserve overflow cells rather than truncating them.
- Expand legacy CLI headers when rows contain additional cells.
- Return parser diagnostics through the public import result.
- Explain format candidates and permit a one-click manual correction.

### R3 — safe imports and rendering

- Limit source/workspace imports to 25 MB and configuration imports to 5 MB.
- Validate workspace kind, schema, document count, nesting depth, and dangerous object keys.
- Normalize imported IDs, names, UI defaults, and active tab.
- Escape or use DOM text APIs for user-derived names and headers.
- Block dangerous object-key names for tables and views.

### R4 — data-correct JOINs

- Use collision-safe compound keys.
- Reject missing relation fields.
- Preserve numeric zero and boolean false.
- Normalize duplicate output headers.
- Detect dependency cycles before save.
- Add Right, Full, Semi, and Anti joins.

### R5 — large-table protection

- Limit rendered DOM rows through per-table pagination.
- Permit 50, 100, 250, or 500 visible rows per page.
- Continue exporting the full filtered result, not only the current page.
- Show input size, table count, row count, and slow-parse feedback.
- Reject a single source above the documented safety limit.

### R6 — complete existing controls

- “Export displayed columns” must project focus columns during full export.
- Export options must restore on tab changes.
- HTML clipboard state must not leak across tabs or later plain-text edits.
- Full-screen Escape behavior must be documented and synchronize before closing.
- Cell corrections must persist as a non-destructive overlay and support undo/redo.

### R7 — accessible responsive workbench

- Present the primary journey as Import → Parse → Analyze → Export.
- Use visible parse and save states.
- Provide real button/tab/dialog semantics and keyboard tab activation/rename/close.
- Offer shortcuts for parse, file import, save, new tab, help, and edit undo/redo.
- Keep focus visible, respect reduced motion, and provide forced-color fallbacks.
- Use a narrow-screen drawer fallback.

### R8 — open-source release quality

- Include README, license, privacy, security, contribution, conduct, changelog, architecture, user guide, roadmap, CI, and issue templates.
- Keep one authoritative application file.
- Remove production test hooks and historical duplicate HTML files.
- Run parser, copy, Store, JOIN, UI, syntax, and offline-release validation in CI.

## 4. v20 additions delivered

- Redesigned workbench and responsive layout.
- File selection and drag/drop import.
- Format candidates, parse diagnostics, and correction controls.
- Safe Store writes, temporary-data mode, status bar, and workspace schema migration.
- Versioned workspace import/export validation.
- Pagination and per-tab page-size state.
- Persisted cell corrections and 100-step session undo/redo.
- Right/Full/Semi/Anti JOINs and JOIN correctness fixes.
- `rowspan`, escaped Markdown pipe, malformed CSV diagnostics, and quoted filter values.
- Spreadsheet formula-prefix protection.
- Restored displayed-column export semantics.
- Open-source repository metadata and cross-platform Node CI.

## 5. Explicit non-goals for 20.0.0

- XLSX import.
- Remote URLs, database connectors, accounts, sharing, or synchronization.
- Full spreadsheet formulas or cell formatting.
- SQL, pivot tables, charts, or dashboards.
- Guaranteed durable storage beyond browser storage behavior.
- Native-app packaging.

These are evaluated in the roadmap only after the v20 reliability baseline remains stable.

