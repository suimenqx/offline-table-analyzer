# Roadmap

v21 delivered the first wave of architecture modularisation: domain logic extraction (`FilterEngine`, `TableBuilder`) and a stable public filtering API.

v22 completed the reliability pass: a command/event protocol (`Store.transition` / `onChange` / `dispatch`), source-revision isolation, the pure `QueryService` preview pipeline, 42 deterministic source modules, accessible status/chips/dialog behavior, and architecture validation.

v23 releases the validated large-data workflow with background text parsing and Excel export, exact original recovery, visible storage failures, and shared export column projection. Existing schema 21 workspaces remain compatible. Release 23.1 adds budgeted adaptive format detection, incremental CSV/TSV and CLI consumption, and Worker-owned tables with page-only transport.

## 23.x — reliability and browser coverage (current)

- Chromium E2E automation for paste → parse → filter → JOIN → copy → XLSX download and readback is implemented and configured in CI.
- Cross-browser clipboard and download matrix, including Safari.
- Improved focus trapping and screen-reader announcements for complex dialogs.
- Deterministic malformed HTML/CSV boundary and parser mutation tests.

## Deferred architecture

Release 22.1 adds the authorized [bounded large-data path](../architecture/large-data.md): finite original preview, embedded cancellable Workers, asynchronous raw recovery, result/snapshot reuse and explicit resource budgets. Desktop Chromium CI measures 100,000 × 32 synthetic table-data workflows; phone development does not require a desktop machine.

Virtual scrolling, Arrow/SQL, external-memory query execution and streaming XLSX remain proposals outside this delivery. HTML DOMParser background processing and the broader desktop Safari/Firefox acceptance matrix are also outstanding.

## Later candidates

- XLSX import as an optional offline module.
- Data-cleaning transforms: type conversion, null normalization, deduplication, replace, split, and merge.
- Sorting, column profiles, unique-value distributions, and grouped aggregates.
- Diff mode between two tables or workspace snapshots.
- Pivot tables and lightweight charts.
- Right-to-left/localized UI and an internationalization layer.
- Optional PWA/File System Access enhancements with a normal single-file fallback.
- A documented parser/transform plugin interface.

## Out of scope

Accounts, remote synchronization, telemetry, server databases, and cloud connectors conflict with the default offline/private product model and are not planned for the core release.
