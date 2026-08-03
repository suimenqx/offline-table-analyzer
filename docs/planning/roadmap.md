# Roadmap

v21 delivered the first wave of architecture modularisation: domain logic extraction (`FilterEngine`, `TableBuilder`), a stable public filtering API, and build-manifest growth to 30 modules.

v22 completes the controller extraction: a command/event protocol (`Store.transition` / `onChange` / `dispatch`) and 7 independently-testable UI controllers (`SourceController`, `CellEditController`, `FilterController`, `ModalController`, `TabController`, `ExportController`, plus the `dispatch` command bus). App.js shrank from 1,721 to 918 lines.

## 22.x — reliability and browser coverage (current)

- Real browser E2E automation for paste → parse → filter → JOIN → copy → export.
- Cross-browser clipboard and download matrix, including Safari.
- XLSX round-trip validation with a real reader in development tests.
- Improved focus trapping and screen-reader announcements for complex dialogs.
- Additional malformed HTML/CSV fixtures and fuzz tests.

## 23+ — large-data architecture

- IndexedDB document/source storage with transactional migrations.
- Web Worker parsing and rule execution with cancellation and progress.
- Virtual scrolling after pagination benchmarks identify a clear benefit.
- Streaming or chunked large exports.
- Saved filter/JOIN presets and correction audit history.

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

