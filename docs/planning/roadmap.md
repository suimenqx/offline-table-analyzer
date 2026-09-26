# Roadmap

v21 delivered the first wave of architecture modularisation: domain logic extraction (`FilterEngine`, `TableBuilder`) and a stable public filtering API.

v22 completes the current reliability pass: a command/event protocol (`Store.transition` / `onChange` / `dispatch`), source-revision isolation, the pure `QueryService` preview pipeline, 41 deterministic source modules, accessible status/chips/dialog behavior, and architecture validation.

## 22.x — reliability and browser coverage (current)

- Chromium E2E automation for paste → parse → filter → JOIN → copy → XLSX download and readback.
- Cross-browser clipboard and download matrix, including Safari.
- Improved focus trapping and screen-reader announcements for complex dialogs.
- Deterministic malformed HTML/CSV boundary and parser mutation tests.

## Deferred architecture

Large-data capabilities such as IndexedDB, Web Workers, virtual scrolling, and streaming exports are explicitly outside the current product scope. The next work remains bounded to browser regression coverage, parser correctness, and maintainable offline UI behavior.

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
