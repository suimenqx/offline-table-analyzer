# Offline Table Analyzer

Offline Table Analyzer is a privacy-first table workbench that runs entirely in one HTML file. Paste or drop messy tabular data, inspect and filter it, build JOIN views, copy a selected range, and export clean Excel files—without uploading data or installing an application.

Version: **20.0.0**

## Why this project exists

Operational data rarely arrives as a perfect spreadsheet. It is often copied from a terminal, a browser, a Markdown document, an Excel sheet, or a diagnostic log. Offline Table Analyzer turns those inputs into a consistent table model and provides the practical tools needed to review and move the result elsewhere.

- Fully offline and dependency-free at runtime
- One portable `index.html`
- No accounts, telemetry, analytics, or network requests
- Designed for sensitive operational and troubleshooting data
- English documentation with a [Chinese guide](README.zh-CN.md)

## Features

### Import and normalization

- Legacy multi-table `cli-table-data`
- CSV, including quoted commas, escaped quotes, and multiline cells
- Excel/Google Sheets TSV paste
- Semicolon-delimited data
- HTML clipboard tables, including `colspan`, `rowspan`, and `<br>`
- Markdown/pipe tables, including escaped pipes
- ASCII/terminal tables
- Fixed-width and whitespace-delimited text fallbacks
- Automatic, forced-first-row, or generated headers
- Duplicate/blank header normalization and visible parse diagnostics
- Local CSV/TSV/TXT/HTML/Markdown file selection and drag-and-drop

### Analysis workbench

- Multiple named, reorderable analysis tabs
- Global, table-level, and per-column filtering
- Numeric comparisons, exact/contains/not-equal rules, regex, AND/OR, and quoted values
- Highlight rules and focus-only mode
- Per-table visible-column selection and collapse state
- Column-header and transposed row-header previews
- Paginated DOM rendering for large tables
- Persisted cell corrections with undo/redo

### JOIN views

- Inner, Left, Right, Full, Semi, and Anti joins
- Multiple equality conditions
- Source can be a raw table or another view
- Dependency-cycle and missing-field validation
- Output-column aliases and ordering
- Match/unmatched row estimates
- Collision-safe compound keys and correct preservation of `0`/`false`

### Copy, export, and recovery

- TSV, CSV, Markdown, and ASCII copy formats
- Simultaneous HTML clipboard payload
- Spreadsheet formula-injection protection for copied TSV/CSV
- Preview, full-workspace-table, and raw Excel export
- Versioned workspace backup and restore
- Rule/configuration import and export
- Optional temporary-data mode that does not persist raw source text
- Visible local-save and storage-failure status

## Quick start

1. Download or clone this repository.
2. Open `index.html` in a current desktop browser.
3. Paste data, drop a supported text file, or choose **Load sample**.
4. Select a format/header strategy if automatic detection needs correction.
5. Choose **Parse data**.

No server is required. A local static server is useful only during development.

## Browser support

The release target is the latest two versions of Chrome, Edge, and Firefox on Windows, macOS, and Linux, plus the latest Safari on macOS. Mobile layouts provide a usable fallback, but dense editing and JOIN design are best on a desktop-sized screen.

The application uses modern browser APIs including `localStorage`, `FileReader`, `DOMParser`, `Blob`, `TextEncoder`, and the Clipboard event API.

## Privacy and local storage

All parsing, filtering, JOIN processing, copying, and Excel generation happen in the browser. The application contains no external resources or network API calls.

By default, the current workspace is stored in browser `localStorage` so it can survive a refresh. Disable **Save raw data on this device** to keep source text only in the current page session. Browser storage is limited; when saving fails, the status bar reports the failure and the in-memory data remains available for backup.

Read [PRIVACY.md](PRIVACY.md) before using the tool with sensitive data.

## Recommended limits

- Maximum accepted source/workspace file: 25 MB
- Default rendered page: 100 rows per table
- For very large datasets, keep raw-data persistence disabled and export a workspace backup before closing the page
- XLSX files can be exported but are not imported
- JOIN conditions are equality-based; data types are compared as represented in the parsed table

## Development

Runtime dependencies are intentionally zero. Node.js is used only for validation.

```bash
npm test
npm run validate:release
```

The test suite covers parser formats, copy serialization, state/storage behavior, JOIN correctness, syntax, UI contracts, accessibility markers, and offline release constraints.

## Documentation

- [User guide](docs/user-guide.md)
- [Requirements and scope](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and keep the runtime offline, dependency-free, and distributable as one self-contained HTML file.

## License

[MIT](LICENSE)

