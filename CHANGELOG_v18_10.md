# v18.10

## Preview
- Added per-table preview orientation switch:
  - 列表头: classic column-header table.
  - 行表头: transposed preview with fields pinned on the left.
- Selection now uses visual coordinates so both preview orientations can be copied consistently.
- Selection auto-scrolls horizontally and vertically while dragging near table/preview edges, allowing copying data beyond the visible columns.

## Export
- Added top-right “导出全量 Excel” for current tab full data export.
- Excel/JSON export filenames now include the active tab name plus timestamp.

## Source editor
- Large source editor no longer writes the full source into localStorage on every keystroke.
- Stats and persistence are debounced to improve typing and selection responsiveness on large inputs.

## Tabs
- New Analysis tab naming now uses the next highest Analysis number instead of docs.length + 1.
- New tabs avoid reusing names like “Analysis 2” after deletions.
- Duplicate manual tab renames receive a suffix such as “Analysis 2 (2)”.

## Tests
- Parser regression tests: 14
- Tab interaction tests: 18
- UI interaction/static tests: 30
