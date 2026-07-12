# Architecture

## 1. Delivery architecture

The release application is `index.html`. CSS, markup, parser adapters, state management, transformations, clipboard serialization, XLSX generation, and UI behavior are self-contained. Runtime dependencies and network resources are intentionally absent.

Node scripts under `tools/` extract logical sections from the HTML for regression tests. They are development-only and are not needed by end users.

## 2. Logical modules

| Module | Responsibility |
| --- | --- |
| `Tooltip`, `Toast` | Lightweight interaction feedback |
| `Exporter` | Browser downloads and dependency-free XLSX ZIP/XML generation |
| `Store` | Versioned workspace, migration, normalization, privacy preferences, safe local persistence |
| `TableUtils` | Text/cell normalization, row width handling, unique names and headers |
| `HeaderResolver` | Header inference and forced header modes |
| `Delimited` | Quote-aware delimiter parsing and diagnostics |
| Parser adapters | CLI, CSV, TSV, HTML, Markdown, ASCII, fixed-width, and plain text |
| `ImportEngine` | Manual/automatic adapter selection, candidates, normalized result and diagnostics |
| `Joiner` | Equality JOIN execution, statistics, dependency safety, projection |
| `JoinEditor` | View design and management UI |
| `ClipboardFormatter` | TSV/CSV/Markdown/ASCII/HTML serialization and formula-prefix protection |
| `Select` | Visual-coordinate range selection, auto-scroll, copy matrix construction |
| `App` | UI orchestration, parsing, pagination, filtering, corrections, file/workspace flows |

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
  rules
  columnFilters
  collapsedTables
  previewModes
  tablePages
  pageSize
  cellEdits
  importFormat
  importHeaderMode
  exportOnlyChecked
  exportCols
```

Cell corrections are stored as an overlay keyed by table, source row, and source column. Parsing starts from the unchanged source text and reapplies the overlay. This preserves the original input while keeping corrections stable across filtering, pagination, orientation changes, and reloads.

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
paste / drop / file
  → source text + optional clipboard HTML
  → ImportEngine format scoring or manual adapter
  → adapter parse
  → HeaderResolver and TableUtils normalization
  → diagnostics + normalized tables
  → persisted correction overlay
  → filters/highlights/focus columns
  → optional JOIN views
  → paginated DOM preview
  → clipboard / preview XLSX / full XLSX / workspace JSON
```

The full processed result remains in memory for export, while only the selected page is materialized as table DOM.

## 5. Persistence and migration

`ota_v20_workspace` is the authoritative browser key. On startup, the Store first tries this key, then the legacy `v16_4_store`. A legacy key is removed only after the v20 payload is written successfully.

Writes are guarded. Quota or security failures update visible status and do not discard the in-memory workspace. If a saved JSON payload cannot be read, automatic writes are blocked so the unreadable value is not silently replaced; users may restore a backup or explicitly clear local data.

Temporary mode serializes an empty `raw` value for every document while retaining raw text in the current in-memory state.

## 6. Security boundaries

- Preview values use `textContent`.
- Dynamic names used in templates pass through a single escaping helper; select options use DOM `Option` objects.
- Imported JSON has size, kind, schema, depth, count, and dangerous-key checks.
- Table/view names that map to JavaScript prototype keys are rejected or replaced.
- JOIN compound keys use typed JSON tuples.
- Clipboard delimiters prefix common spreadsheet-formula starters by default.
- Release validation rejects external scripts/styles and network API references.

## 7. Performance model

Parsing, filtering, JOINs, and XLSX generation currently run on the main thread. v20 reduces the most visible DOM cost through pagination and source-save debouncing. Input size is capped at 25 MB.

Web Workers, IndexedDB document storage, streaming export, and virtual scrolling remain architectural follow-ups when real benchmarks justify their complexity.

## 8. Testing architecture

- `run-parser-tests.js`: parser formats, malformed input, diagnostics, normalization.
- `run-copy-tests.js`: copy formats, multiline cells, HTML, formula protection.
- `run-tab-tests.js`: tab rules, Store migration shape, temporary mode, quota failures, workspace imports.
- `run-join-tests.js`: all JOIN types, compound-key collisions, missing fields, duplicate headers, cycles.
- `run-ui-tests.js`: full-script syntax and static interaction/accessibility contracts.
- `validate-release.js`: version consistency, single inline script, offline assets/APIs, required community files.

The static UI contract suite is intentionally not described as full E2E coverage. Browser interaction remains part of release QA and is a roadmap target for automated CI.

