# Changelog

All notable changes are documented here. The project follows semantic versioning from v20 onward.

## 20.0.0 — 2026-07-12

### New workbench

- Redesigned the application around the Import → Parse → Analyze → Export workflow.
- Added a responsive drawer fallback, persistent status bar, visible parse/save state, help panel, keyboard shortcuts, reduced-motion support, and improved ARIA semantics.
- Unified every visible version marker as 20.0.0.

### Import and data integrity

- Added local file selection and drag/drop for CSV, TSV, TXT/log, HTML, and Markdown.
- Exposed format candidates, detection scores, parser diagnostics, and one-click format correction.
- Preserved overflow cells instead of truncating them and expanded CLI headers when needed.
- Added malformed CSV quote diagnostics, Markdown escaped pipes, HTML `rowspan`, and quoted filter values.
- Added 25 MB source/workspace and 5 MB configuration safety limits.

### Persistence, privacy, and recovery

- Introduced workspace schema 20 and `ota_v20_workspace` with guarded legacy migration.
- Added visible quota/security failure reporting and blocked destructive overwrite after a corrupted-state read.
- Added temporary raw-data mode, storage-use estimation, clear-local-data action, and versioned workspace backup/restore.
- Added size/depth/schema/prototype-key validation and normalization for imported workspaces/configuration.

### Preview and editing

- Added per-table pagination with 50/100/250/500-row page sizes.
- Changed cell edits into persisted, non-destructive corrections that survive rerenders.
- Added session undo/redo and made JOIN results explicitly read-only.
- Restored “export displayed columns” semantics and tab-state restoration for export controls.

### JOIN correctness and expansion

- Added Right, Full, Semi, and Anti joins.
- Replaced delimiter-concatenated compound keys with typed JSON tuple keys.
- Preserved `0` and `false`, rejected missing relation fields, normalized duplicate output headers, and added dependency-cycle validation.

### Copy safety

- Added spreadsheet formula-prefix protection for TSV/CSV/HTML clipboard payloads.
- Preserved the v18 TSV, CSV, Markdown, ASCII, HTML, and multiline behavior.

### Open-source release

- Added README files, MIT license, privacy/security policies, contribution and conduct guides, user/requirements/architecture/roadmap documentation, GitHub templates, CI, and release validation.
- Moved to one authoritative `index.html` and externalized production self-tests.

## 18.10–18.12 — 2026-05

- Added row-header/column-header preview switching and visual-coordinate copy.
- Added full Excel export and tab/timestamp filenames.
- Debounced large source editing.
- Added Ctrl/Cmd+A table selection and TSV/CSV/Markdown/ASCII copy formats.
- Preserved literal/escaped `<br>` as multiline cells through import, preview, copy, and HTML clipboard output.

## 18.5–18.9 — 2026-05

- Added tab rename and drag ordering.
- Added full-screen source editing.
- Repaired sidebar binding and new-tab regressions.
- Hardened tab IDs, naming, deletion, activation, and duplicate-title behavior.

## 18.0–18.4 — 2026-05

- Replaced the single legacy parser with `TableUtils`, `HeaderResolver`, delimiter utilities, parser adapters, and `ImportEngine`.
- Added CSV, TSV, semicolon, Markdown, ASCII, HTML, fixed-width, and plain-text imports.
- Added automatic/generated headers, manual header modes, duplicate/blank header normalization, and legacy CLI compatibility.
- Improved CJK/table typography and import metadata presentation.

