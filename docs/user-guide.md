# User Guide

## 1. Import data

Use one of three paths:

- paste text into the left source editor;
- drag a supported text file onto the editor;
- choose **Select file**.

Supported file/text families are CSV, TSV, TXT/log, HTML, Markdown, CLI `table-data`, ASCII tables, and fixed-width tables. Files above 25 MB are rejected.

### Format selection

Keep **Auto detect** for most inputs. If the preview is wrong, open **Details** in the parse status and switch to another candidate, or choose the format directly.

### Header selection

- **Auto header** compares the first row with later value types.
- **First row header** forces the first row to be field names.
- **No header** retains the first row as data and creates `Column1`, `Column2`, and so on.
- CLI `table-data` always uses the `validflag` line.

Diagnostics report malformed quotes and row-width inconsistencies without blocking the full import.

## 2. Manage analysis tabs

- Choose **New tab** or press Ctrl/Cmd+N.
- Double-click a tab label or press F2 to rename it.
- Drag tabs to reorder them.
- Arrow keys move between focused tabs; Delete closes a focused tab when more than one exists.
- Each tab stores its source, rules, page size, preview orientation, cell corrections, and export options.

## 3. Filter and highlight

Open **Analysis rules** in the left panel.

Examples:

```text
Status=Error
Message:"connection timeout"
CPU>=90
Level!=INFO Host:web-01
error|warning
/timeout|refused/
```

Spaces combine tokens with AND. A pipe inside one token is OR. A quoted value may contain spaces. Regex patterns longer than 200 characters are ignored as a safety limit.

Click a column header to apply an additional case-insensitive contains filter for that column.

## 4. Choose columns and tables

- **Show raw tables** controls which imported tables appear.
- **Enable JOIN views** adds derived views.
- **Focus/display columns** changes the columns shown for the selected target table.
- Double-click a table heading or use its **Collapse** button to collapse it.

If **Export displayed columns** is enabled, full export applies the focus-column projection.

## 5. Build a JOIN view

Choose **Manage** next to JOIN views, then add a view.

1. Name the view and choose left/right sources.
2. Select a JOIN type:
   - Inner: matched pairs only;
   - Left: matched pairs plus unmatched left rows;
   - Right: matched pairs plus unmatched right rows;
   - Full: all matched and unmatched rows;
   - Semi: one output per left row that has a match;
   - Anti: left rows with no match.
3. Add one or more equality conditions.
4. Select output columns and optionally add aliases.
5. Reorder output fields and save.

The designer blocks missing fields, name conflicts, and dependency cycles. Duplicate output names receive suffixes such as `_2`.

## 6. Preview and correct cells

Each table can use:

- **Column header** for the conventional layout;
- **Row header** to transpose a very wide table.

Choose 50, 100, 250, or 500 rendered rows per page. Filtering and export operate on all matching rows, not only the current page.

Double-click a raw-table cell to correct it. Corrections are saved separately from the original source and survive rerendering. JOIN views are read-only. Use Ctrl/Cmd+Z and Ctrl/Cmd+Y or the toolbar buttons to undo/redo during the current session.

## 7. Copy data

Drag across preview cells. Selection automatically scrolls near table edges. Press Ctrl/Cmd+A while a preview table is active to select its full current page.

Choose TSV, CSV, Markdown, or ASCII from the copy selector. Copy writes both plain text and HTML. Multiline values are quoted or represented appropriately for the chosen format.

Formula-prefix protection is on by default. It adds a leading apostrophe to copied cells starting with potentially executable spreadsheet formula characters. Disable it in **Analysis rules → Export options** only when exact formula text is required and the destination is trusted.

## 8. Export and back up

- **Raw Excel**: normalized source tables.
- **Full Excel**: current tab's selected raw tables and enabled JOINs, without row filters.
- **Export preview**: filtered/highlighted/focused results for all matching rows.
- **Back up workspace**: versioned JSON containing tabs, raw sources, rules, corrections, views, and preferences.
- **Restore backup**: replace the current workspace or append imported tabs.

## 9. Privacy and recovery

Disable **Save raw data on this device** for temporary source handling. Rules and preferences remain persisted, but raw text does not survive a refresh.

The bottom status bar reports browser-save state. If storage is full, keep the page open and download a workspace backup. Use **Clear local data** to remove saved state, then refresh.

## 10. Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Parse | Ctrl/Cmd+Enter |
| New tab | Ctrl/Cmd+N |
| Choose source file | Ctrl/Cmd+O |
| Save current workspace | Ctrl/Cmd+S |
| Undo/redo cell correction | Ctrl/Cmd+Z / Ctrl/Cmd+Y |
| Rename active tab | F2 |
| Select current preview table | Ctrl/Cmd+A |
| Open help | `?` |

