# Architecture

## 1. Delivery architecture

The release application is `index.html`, generated from `src/index.template.html`, `src/styles.css`, and the ordered source modules under `src/modules/` by `tools/build-release.js`. CSS, markup, parser adapters, state management, transformations, clipboard serialization, XLSX generation, and UI behavior remain self-contained in the generated file. Runtime dependencies and network resources are intentionally absent.

The generated file is intentionally kept as the only end-user artifact, while source modules are the only hand-edited application source. Node scripts under `tools/` build and validate the artifact and are development-only.

## 2. Logical modules

| Module | Responsibility |
| --- | --- |
| `Tooltip`, `Toast` | Lightweight interaction feedback |
| `Exporter` | Browser downloads and dependency-free XLSX ZIP/XML generation |
| `Store` | Versioned workspace, migration, normalization, privacy preferences, safe local persistence |
| `TableUtils` | Text/cell normalization, row width handling, unique names and headers |
| `HeaderResolver` | Header inference and forced header modes |
| `Delimited` | Quote-aware delimiter parsing and diagnostics |
| Parser adapters | 10 adapters: `CliTableDataParser`, `HtmlTableParser`, `AsciiTableParser`, `PipeTableParser`, `ExcelPasteParser`, `CsvParser`, `SemicolonCsvParser`, `FixedWidthParser`, `AlignedTableParser`, `PlainTextTableParser` |
| `ImportEngine` | Manual/automatic adapter selection, candidates, normalized result and diagnostics |
| `Joiner` | Equality JOIN execution, statistics, dependency safety, projection |
| `JoinEditor` | View design UI: column picker with search & "only selected" filter, select all/filtered, alias support (inline or `AS`), drag-reorder output columns, show/hide left/right, help panel |
| `ClipboardFormatter` | TSV/CSV/Markdown/ASCII/HTML serialization and formula-prefix protection |
| `Select` | Visual-coordinate range selection, auto-scroll, row/column header selection modes, clipboard matrix construction |
| `App` | UI orchestration, parsing, pagination, filtering, corrections, file/workspace/config flows, fullscreen source editor, drag-and-drop import, edit undo/redo, sample data loading |

The refactor decision, module manifest, dependency rules, migration phases, and branch/worktree policy are recorded in [Refactor architecture](refactor-architecture.md); the complete acceptance checklist is in [Refactor requirements](refactor-requirements.md).

## 3. Core data model

### Workspace state

```text
schemaVersion: 20
docs[]
activeId
theme
globalViews[]
nextAnalysisSeq
copyFormat
spreadsheetSafe
persistRaw
lastSavedAt
```

### Analysis document

```text
id
title
raw
ui:
  displayTables
  enabledViews
  targetTable
  rules
  columnFilters
  collapsedTables
  previewModes
  tablePages
  pageSize (100)
  cellEdits
  sidebarTab ("data")
  importFormat ("auto")
  importHeaderMode ("auto")
  exportOnlyChecked (false)
  exportCols ("all")
```

Cell corrections are stored as a nested overlay in `cellEdits`, keyed by `$${tableName}` → row index → column index → new value:

```text
{ "$table1": { 0: { 2: "corrected" }, 5: { 1: "fixed" } } }
```

Parsing starts from the unchanged source text and reapplies the overlay. This preserves the original input while keeping corrections stable across filtering, pagination, orientation changes, and reloads. An edit history stack (max 100) and redo stack support undo/redo.

When the source text, imported file, parser format, or header mode changes, the overlay and session edit history are invalidated. This prevents row-indexed corrections from being applied to a different parsed record.

### Normalized table

```text
name
headers[]
rows[][]
sourceType
meta
diagnostics[]
```

All downstream operations consume this shape regardless of the original source format.

## 4. Data flow

```text
paste / drop / file / fullscreen editor
  → source text + optional clipboard HTML
  → ImportEngine format scoring or manual adapter
  → adapter parse
  → HeaderResolver and TableUtils normalization
  → diagnostics + normalized tables
  → persisted correction overlay + edit undo/redo
  → filters/highlights/focus columns
  → optional JOIN views (dependency cycle check → execution)
  → paginated DOM preview
  → clipboard / preview XLSX / full XLSX / workspace JSON / config JSON
```

Drag-and-drop of local files onto the source area is supported. A fullscreen source editor is available for working with large inputs. Config import/export (`table-tool-config` kind, 5 MB limit) transfers rules, filters, views, and UI settings across documents.

The full processed result remains in memory for export, while only the selected page is materialized as table DOM.

## 5. Persistence and migration

`ota_v20_workspace` is the authoritative browser key. On startup, the Store first tries this key, then the legacy `v16_4_store`. A legacy key is removed only after the v20 payload is written successfully. `clearLocalData()` also removes the legacy `v16_4_inputHeight` key.

Writes are guarded. Quota or security failures update visible status and do not discard the in-memory workspace. If a saved JSON payload cannot be read, automatic writes are blocked so the unreadable value is not silently replaced; users may restore a backup or explicitly clear local data.

Temporary mode serializes an empty `raw` value for every document while retaining raw text in the current in-memory state.

## 6. Security boundaries

- Preview values use `textContent`.
- Dynamic names used in templates pass through a single escaping helper; select options use DOM `Option` objects.
- Workspace import: `kind` must be `'ota-workspace'` or `'table-tool-tabs'`, depth limit 12 levels, max 100 docs, max 2000 keys per object, prototype poison keys (`__proto__`, `prototype`, `constructor`) rejected. Config import: `kind` must be `'table-tool-config'`, file size capped at 5 MB.
- Table/view names that map to JavaScript prototype keys are rejected or replaced.
- JOIN compound keys use typed JSON tuples.
- Clipboard delimiters prefix common spreadsheet-formula starters by default.
- Release validation rejects external scripts/styles and network API references.

## 7. Performance model

Parsing, filtering, JOINs, and XLSX generation currently run on the main thread. v20 reduces the most visible DOM cost through pagination and source-save debouncing. Input size is capped at 25 MB.

Web Workers, IndexedDB document storage, streaming export, and virtual scrolling remain architectural follow-ups when real benchmarks justify their complexity.

## 8. Testing architecture

All test scripts reside under `tools/`:

- `run-parser-tests.js`: parser formats (all 10 adapters), malformed input, diagnostics, normalization, and aligned-table separator variants.
- `run-build-tests.js`: source manifest completeness, deterministic release output, single-script packaging, and generated syntax.
- `run-startup-tests.js`: browser-like DOM/storage smoke test for the module graph and application bootstrap.
- `run-copy-tests.js`: copy formats (CSV/TSV/Markdown/ASCII/HTML/text), multiline cells, HTML escaping, formula protection.
- `run-tab-tests.js`: tab rules, Store migration shape, temporary mode, quota failures, workspace imports, config import/export.
- `run-join-tests.js`: all JOIN types, compound-key collisions, missing fields, duplicate headers, dependency cycle detection.
- `run-ui-tests.js`: full-script syntax and static interaction/accessibility contracts.
- `validate-release.js`: version consistency, single inline script, offline assets/APIs, required community files.

The static UI contract suite is intentionally not described as full E2E coverage. Browser interaction remains part of release QA and is a roadmap target for automated CI.
