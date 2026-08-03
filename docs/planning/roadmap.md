# Roadmap

v20 deliberately prioritizes trustworthiness and open-source release quality over an unlimited feature list.

## 20.x — reliability follow-ups

- Real browser E2E automation for paste → parse → filter → JOIN → copy → export.
- Cross-browser clipboard and download matrix, including Safari.
- XLSX round-trip validation with a real reader in development tests.
- Performance fixtures for 1 MB, 5 MB, 20 MB, and 100,000-row sources.
- Improved focus trapping and screen-reader announcements for complex dialogs.
- Additional malformed HTML/CSV fixtures and fuzz tests.

## 21 — large-data architecture

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

