# Offline Table Analyzer — User Guide (v20.2.0)

## 1. Import data

### 1.1 Three import paths

| Method | How |
| --- | --- |
| **Paste** | Paste text directly into the left-panel source editor. The editor accepts CSV, TSV, HTML tables, Markdown/pipe tables, ASCII tables, fixed-width and aligned fixed-width tables, CLI `table-data` blocks, and plain whitespace-delimited text. |
| **Drag file** | Drag a supported text file onto the editor area. A visible drop zone highlight confirms detection. |
| **Select file** | Click **Select file** (or press `Ctrl/Cmd+O`) and choose a file. Accepted extensions: `.csv`, `.tsv`, `.txt`, `.log`, `.md`, `.markdown`, `.html`, `.htm`. |

Files larger than **25 MB** are rejected with a safety message.

### 1.2 File extension auto-detection

When a file is opened by drag or click, the extension is used to pre-populate the format selector:

| Extension | Preselected format |
| --- | --- |
| `.csv` | CSV |
| `.tsv` | Excel/TSV |
| `.html`, `.htm` | HTML table |
| `.md`, `.markdown` | Markdown/Pipe table |
| Anything else | Auto detect |

If the auto-detected format was already set to "Auto detect", the selector is updated for you.

### 1.3 Format selection

The **Format** dropdown includes eleven options:

1. **Auto detect** — runs all parsers and picks the highest-confidence match (recommended).
2. **CLI table-data** — multi-table blocks with `table-data <name>` headers and `validflag` rows.
3. **CSV** — comma-delimited, with quoted-field support.
4. **Excel/TSV** — tab-delimited data (e.g., copy-paste from spreadsheet apps).
5. **Semicolon CSV** — semicolon-delimited (common in some European locales).
6. **HTML table** — extracts `<table>` elements from HTML markup.
7. **Markdown/Pipe table** — GitHub-flavored pipe tables with optional alignment separators.
8. **ASCII table** — box-drawn tables using `+`, `-`, and `|` characters.
9. **Fixed width** — columns inferred from repeated spacing patterns.
10. **Aligned fixed width** — delimiter-free aligned output whose column positions are inferred from the header row.
11. **Whitespace text** — splits each line on whitespace; useful for simple columnar logs.

**When auto-detection is wrong:** Open the **Details** panel (beside the parse status indicator). It lists format candidates with confidence scores (e.g., "Excel/TSV — 87%"). Click any candidate to switch format and re-parse immediately.

CLI `table-data` mode additionally auto-detects each data block's internal format (TSV, CSV, pipe, or fixed-width) based on the content of the `validflag` header row.

### 1.4 Aligned fixed-width tables

The **Aligned fixed width** parser is intended for reports whose columns line up by character position but have no `|` borders. It recognizes `-` or `-`/`+` separator lines and supports:

- separators above and/or below a table;
- a separator between the header block and data block;
- multiple tables in one input;
- preserves cell text such as `--` instead of interpreting it as empty.

Columns must have at least two spaces between header words. A standalone line between tables can be used as the next table's name. Values are sliced by the header's character ranges, so a value wider than its header may be truncated at the next column boundary.

### 1.5 Header selection

Three header modes in the dropdown:

- **Auto header** (default) — compares the first row's cell types against the rest of the data. A row is promoted to headers when names look like identifiers, types differ substantially from data rows, or common header names (id, name, date, status, etc.) are detected.
- **First row header** — always treats the first row as column names.
- **No header** — keeps the first row as data and generates `Column1`, `Column2`, … headers.

When format is **CLI table-data**, headers come from the `validflag` line and the header mode control is disabled (greyed out).

Duplicate or empty header names receive numeric suffixes (e.g., `Name_2`).

### 1.6 Diagnostics

The parse status bar shows warnings for malformed quotes, rows with mismatched column counts, and other recoverable issues. These never block parsing; they are informational. Open **Details** to see the full list.

---

## 2. Source editor

### 2.1 Resizable input

Drag the horizontal handle below the source textarea to resize it. The height range is **120–600 px**. Your preferred height is saved automatically to `localStorage` and restored on subsequent visits.

### 2.2 Full-screen editor

Click **Fullscreen edit** (or the expand button beside the card heading) to open a dedicated editor in a modal or full-screen overlay. It provides:

- **Synchronized controls** — format and header-mode selects mirror the sidebar controls. Changes sync in both directions.
- **Live statistics** — character and line counts update in real time in the footer.
- **Convenient parsing** — `Ctrl/Cmd+Enter` parses without closing the editor.
- **Quick save** — `Ctrl/Cmd+S` saves the current source to the workspace.
- **Escape / Close / Done** — all three actions sync the edited text back to the main source area before closing.

---

## 3. Sidebar layout

The left sidebar has two tabs:

| Tab | Contains |
| --- | --- |
| **Data** (数据源) | Source textarea, format/header selects, file import button, parse/clear actions, parse status, privacy toggle, sample data loader, and quick-export utilities. |
| **Config** (分析规则) | View settings (raw tables, JOIN views), rule engine (highlight, row filter, global filter), column focus, and export options. |

### 3.1 Collapse the sidebar

Click the sidebar toggle (the OTA logo button) to collapse the sidebar into a narrow icon-only strip. Click again to expand.

**On mobile** (viewport narrower than 760 px), the sidebar starts collapsed and slides in as a drawer when toggled open.

### 3.2 Accordions in Config

The Config tab uses collapsible accordion sections for **View settings**, **Rule engine**, and **Export options**. Click a section heading to expand or collapse it.

---

## 4. Analysis tabs

Each analysis **tab** (page) is an independent workspace — it stores its own source text, parsed tables, filter rules, column focus, page size, preview orientation, cell corrections, and export preferences.

| Action | Method |
| --- | --- |
| **New tab** | Click **New tab** or press `Ctrl/Cmd+N` |
| **Rename tab** | Double-click the tab label, or select the tab and press `F2`. Press `Enter` to confirm, `Escape` to cancel. |
| **Reorder tabs** | Drag a tab left or right. A visual indicator shows the drop target. |
| **Close tab** | Select the tab and press `Delete`. At least one tab must remain. |
| **Switch tabs** | Click a tab, or use `←` / `→` arrow keys when a tab is focused. |
| **Activate tab** | Press `Enter` or `Space` on a focused tab. |

---

## 5. Filter and highlight syntax

Filters and highlight rules share the same expression language. Enter rules in the **Rule engine** accordion (Config tab).

### 5.1 Operators

| Operator | Meaning | Example |
| --- | --- | --- |
| `=` | Exact equals (case-insensitive) | `Status=Error` |
| `:` | Contains / substring (default operator) | `Message:timeout` |
| `!=` | Not equals | `Level!=INFO` |
| `>` | Greater than (numeric) | `CPU>90` |
| `>=` | Greater or equal (numeric) | `Memory>=1024` |
| `<` | Less than (numeric) | `Latency<5` |
| `<=` | Less or equal (numeric) | `Count<=0` |

If no operator is present, the token is treated as a **contains** test across the entire row (all columns joined).

### 5.2 Combining conditions

- **AND** — Separate tokens with **spaces**. All space-separated tokens must match for the row to pass.

  ```
  Status=Error Host:web-01
  ```
  Matches rows where `Status` equals `Error` AND the `Host` column contains `web-01`.

- **OR** — Separate values within a single token with `|` (pipe). The token matches if *any* alternative matches.

  ```
  error|warning|critical
  ```
  Matches rows containing "error", "warning", or "critical" anywhere.

- **NOT** — A bare `!` prefix negates a token.

  ```
  !debug
  ```
  Matches rows that do NOT contain "debug".

### 5.3 Regex

Wrap a complete regular expression in `/` (forward slashes) to match across the entire row (all columns joined with a space):

```
/timeout|refused/
```
Performs a case-insensitive regex search for "timeout" or "refused".

The complete `/.../` token is evaluated as one regular expression, so the `|` inside `/timeout|refused/` remains regex alternation rather than being split into plain-text OR terms.

**Safety limit:** regex patterns longer than **200 characters** are silently ignored (the token returns `false`).

Invalid regex patterns that throw an error during construction also return `false`.

### 5.4 Quoted values

Values containing spaces must be wrapped in double or single quotes:

```
Message:"connection timeout"
```
```
Name:'John Doe'
```

Quotes are stripped before comparison. Use `""` (doubled) to include a literal quote inside a quoted value.

### 5.5 Numeric comparisons

Numeric operators (`>`, `>=`, `<`, `<=`) attempt to parse both the cell value and the filter value as numbers (`parseFloat`). If either side is `NaN`, the comparison returns `false`.

### 5.6 Column-unknown keys

If a filter key (left-hand side of an operator) does not match any column header, the token returns `false` — treating the row as non-matching.

### 5.7 Per-column contains filter

Click any column header in a preview table to open a small popover. Enter text to apply an additional **case-insensitive contains** filter on that specific column. Active column filters are indicated by a blue dot on the header. Click **Clear** in the popover to remove the filter. These per-column filters are AND-ed with the rule-engine filters.

### 5.8 Filter fields reference

| Field | Location | Scope |
| --- | --- | --- |
| **Highlight rule** | `hlInput` in Config | Matches are highlighted visually in preview rows. |
| **Row filter** | `filterInput` in Config | Rows that do NOT match are excluded from preview and export. |
| **Global filter** | `globalFilter` in Config | Applied across ALL target tables; rows not matching are excluded. |
| **Column filters** | Popover per column header | Additional contains filter on one column. |

---

## 6. Highlight mode

- **Enable highlight** — Toggle the checkbox to turn visual highlighting on/off. When off, rows are not styled even if the highlight rule matches.
- **Only show highlighted (Focus mode)** — When enabled, rows that do NOT match the highlight rule are hidden from the preview. This is a quick way to focus on interesting rows.

---

## 7. Selecting tables and columns

### 7.1 Show raw tables

Click the multi-select chip area under **Show raw tables** (Config tab) to open a checkbox list of all parsed source tables. By default, all tables are shown (`默认全显`). Uncheck tables to hide them from the preview.

### 7.2 Enable JOIN views

Click the multi-select chip area under **Enable JOIN views** (or **Manage** to create views first) to toggle which JOIN views appear in the preview.

### 7.3 Focus/display columns

Select a **target table** from the dropdown, then either type comma-separated column names or click **Select** for a searchable checkbox list. Only those columns are displayed for that table. Other columns are hidden from preview and export (when `Export displayed columns` is enabled).

### 7.4 Collapse tables

- **Double-click** a table heading in the preview area to collapse/expand it.
- Use the **Collapse / Expand** button in the table toolbar.

Collapsed tables show only the header bar; the data body is hidden. The collapse state is saved per table per tab.

---

## 8. Build a JOIN view

Click **Manage** next to **Enable JOIN views**, then add or edit a view. The JOIN designer opens as a full-screen modal.

### 8.1 Setup

1. **Name** the view (e.g., `StockReport`).
2. Choose a **left table** and **right table** from the parsed sources.
3. Select a **JOIN type**:
   - **Inner Join** — only rows where keys match on both sides.
   - **Left Join** — all left rows; unmatched right columns are empty.
   - **Right Join** — all right rows; unmatched left columns are empty.
   - **Full Join** — all matched and unmatched rows from both sides.
   - **Semi Join** — one output row per left row that has at least one right match (right columns are from the first match).
   - **Anti Join** — left rows that have no match on the right.
4. Add **equality conditions** (ON clauses): select a left column and a right column for each condition. Multiple conditions are AND-ed.
   - Use **Auto match** to automatically pair columns with the same name.

### 8.2 Column selection

Each side has:
- A **search** box to filter columns by name.
- A **Only selected** checkbox to show only the picked columns.
- **Select all** (✓) to toggle all currently visible columns.
- **Select filtered** to pick only the columns matching the current search.

### 8.3 Output column order

The center panel shows the output column order. Features:
- **Drag** chips to reorder output columns.
- **Arrow buttons** (↑ ↓) move a column one position.
- **×** removes a column from the output.
- Add **aliases**: type an alias in the text field after a column name. Use `:` or `AS` syntax in select expressions (e.g., `left.col AS alias`).
- **Show/hide left** and **Show/hide right** toggles to filter the order view.
- **Rebuild** repopulates the order from current selections.
- **Clear** empties the order list.
- **Keep only left** / **Keep only right** to trim to one side.

### 8.4 Validation

- **Unchanged detection** — warns before closing if no changes were made (for new views).
- **Dependency cycle detection** — blocks saving a view that would create a circular dependency.
- **Missing fields** and **name conflicts** are flagged.

### 8.5 Keyboard shortcuts in the JOIN designer

| Key | Action |
| --- | --- |
| `/` | Focus the left-side column search (when no input is focused) |
| `Enter` | Save the view |
| `Escape` | Close the designer |

---

## 9. Preview and pagination

### 9.1 View modes

Each table offers two display orientations via toggle buttons in its toolbar:

- **Column header** (default) — conventional layout with headers at the top, columns across.
- **Row header** — transposed layout where the first column contains header names. Useful for very wide tables with few rows.

### 9.2 Pagination

Choose **50, 100, 250, or 500** rows per page from the sub-bar selector. Pagination shows current page / total pages with **Previous** and **Next** buttons.

**Important:** Filtering, highlighting, and export always operate on **ALL matching rows** across all pages, not just the visible page. The page control affects only what is rendered on screen.

---

## 10. Cell corrections

Double-click any cell in a **raw table** (source tables, not JOIN views) to edit its value inline. Corrections are stored as a **non-destructive overlay** — the original parsed data remains unchanged underneath. Corrections persist when the same source is re-parsed. Changing the source text, imported file, parser format, or header mode clears existing corrections with a visible notice so row-indexed edits cannot be applied to different records.

**JOIN views are read-only** — cells in derived tables cannot be edited.

Corrections are scoped per analysis tab and are saved with the workspace.

---

## 11. Undo / Redo

Cell corrections support undo and redo during the current session:

| Action | Shortcut | Toolbar |
| --- | --- | --- |
| Undo | `Ctrl/Cmd+Z` | ↶ button |
| Redo | `Ctrl/Cmd+Y` (or `Ctrl/Cmd+Shift+Z`) | ↷ button |

The undo/redo history is cleared when you switch tabs or re-parse.

---

## 12. Copy data

### 12.1 Selecting cells

- **Drag** across cells in a preview table to select a rectangular range. Selection auto-scrolls when the pointer is near the table or viewport edge.
- **`Ctrl/Cmd+A`** selects all cells on the current visible page of the active table.
- Selection is per-table — only one table's cells can be selected at a time.

### 12.2 Copy format

Choose the clipboard text format from the dropdown in the top toolbar:

| Format | Clipboard text |
| --- | --- |
| **TSV** (default) | Tab-delimited, with RFC 4180-style quoting for cells containing tabs, newlines, or quotes. |
| **CSV** | Comma-delimited. |
| **Markdown** | GitHub-flavored pipe table with alignment separator. Column widths are auto-calculated. |
| **ASCII** | Box-drawn table with `+`, `-`, and `|`. |
| **Lua inline** | A Lua table with one record per line. Field expressions are aligned by column when values have different widths. |
| **Lua expanded** | A Lua table with one record per child table and one field per line, using four-space indentation. |

Lua adds no separate configuration panel or export dialog. The current selection alone determines which fields and records are copied, and the selected copy format is saved as the existing global copy preference.

### 12.3 Clipboard behavior

Copy writes **both** plain text and HTML to the clipboard:

- **Plain text** uses the selected format (TSV/CSV/Markdown/ASCII/Lua).
- **HTML** remains a complete `<table>` element for TSV/CSV/Markdown/ASCII. Lua uses `<pre><code>` with HTML-escaped Lua text so rich-text editors preserve code indentation instead of rendering a data table.

The selected rectangle determines both the copied rows and columns. In **Column header** mode, the selected column headers become Lua field names and each selected data row becomes one child table. Existing text formats include the synthetic "字段" (Field) header column in **Row header** mode; Lua instead restores the selected transposed rectangle to the same field-header-plus-record-row structure as Column header mode, without exporting that synthetic column.

Lua does not treat `validflag` specially: it is copied whenever it is inside the selected rectangle and omitted when it is outside it. Record indexes always start at `[1]` and increase in selected row order; original source row numbers are not used.

### 12.4 Lua table rules

Both Lua layouts use explicit string keys, such as `["fieldName"] = value`, so Chinese names, spaces, punctuation, and Lua keywords are safe. Values are converted as follows:

- `0x...` and `0X...` hexadecimal integers remain hexadecimal, except all-zero values become `0`.
- Decimal integers and standard decimal floats remain numeric literals. Multi-digit leading-zero integers such as `00123` remain strings.
- Only lowercase `true` and `false` become booleans; `nil` remains the string `"nil"`.
- Empty cells become `""`; other strings retain their cell text and escape backslashes, quotes, newlines, carriage returns, and tabs.

With headers `fieldA`, `fieldB` and two rows, Lua inline produces:

```lua
{
    [1] = { ["fieldA"] = 0, ["fieldB"] = 0x1 },
    [2] = { ["fieldA"] = 1, ["fieldB"] = 0x2 },
}
```

Lua expanded produces the same data structure with one field per line:

```lua
{
    [1] = {
        ["fieldA"] = 0,
        ["fieldB"] = 0x1,
    },
    [2] = {
        ["fieldA"] = 1,
        ["fieldB"] = 0x2,
    },
}
```

If the selected rectangle contains only the header row, both layouts copy `{}`.

### 12.5 Formula protection

When enabled (default), cells that start with potentially executable spreadsheet formula characters receive a leading apostrophe (`'`) in the clipboard output:

| Cell starts with | Protected? |
| --- | --- |
| `=` | Yes |
| `+` | Yes |
| `@` | Yes |
| `-` followed by non-numeric | Yes |
| `-` followed by a number (e.g., `-42`) | No — treated as a negative number |

This prevents pasted data from being interpreted as formulas in Excel, Google Sheets, and similar tools. Disable formula protection in **Config → Export options** when you need exact formula text and trust the destination. Lua formats never apply this spreadsheet prefix: a cell such as `=value` becomes the Lua string `"=value"` regardless of the toggle.

---

## 13. Export and back up

### 13.1 Export types

| Export | Button location | Contents |
| --- | --- | --- |
| **Raw Excel** | Sidebar Data tab → "原始 Excel" | All parsed source tables (no filters, no JOIN views). One sheet per table. |
| **Full Excel** | Top toolbar → "全量 Excel" | Selected raw tables **plus** enabled JOIN views. Respects "Export displayed columns" if enabled. No row filtering applied. |
| **Export preview** | Top toolbar → "导出预览" | Filtered and highlighted results for **ALL matching rows** across all pages in the current tab. Uses the active focus columns. |
| **Back up workspace** | Sidebar Data tab → "备份工作区" | Complete workspace as versioned JSON: all tabs, raw sources, rules, cell corrections, JOIN views, and preferences. |
| **Restore backup** | Sidebar Data tab → "恢复备份" | Import a workspace JSON. Choose to **replace** the current workspace or **append** backup tabs as new tabs. |
| **Export configuration** | Config tab → "导出配置" | Rules, JOIN views, and UI settings only. **No raw source data.** |
| **Import configuration** | Config tab → "导入配置" | Apply exported configuration to the current workspace. Matches docs by **title first**, then by ID. Offers to create new docs for unmatched configs. |

### 13.2 Excel format

Excel files are `.xlsx` (Office Open XML) generated entirely in the browser. The ZIP archive is built with CRC-32 checksums using the Deflate store method. Each table becomes a separate worksheet. Sheet names are sanitized to ≤ 31 characters with unique suffixes when conflicts arise. Safe numeric values are typed as numbers; numeric-looking strings with more than 15 significant digits, unsafe leading zeros, or non-finite values are emitted as inline text to preserve identifiers and precision. Other text cells use inline strings with XML-escaped values.

### 13.3 Export file naming

Exported files are named with a safe sanitized prefix derived from the current tab title (or a fallback), followed by a UTC timestamp:
```
<Title>_<YYYYMMDD_HHMMSS>.xlsx
```

### 13.4 Export column control

In **Config → Export options**:
- **Export only checked tables** — limits Full Excel to tables explicitly selected in "Show raw tables".
- **Column mode** — choose between "Export all columns" (full width) and "Export displayed columns" (respects the focus-column projection for each table).

---

## 14. Privacy and data persistence

### 14.1 Save raw data on this device

Toggle in the sidebar Data tab. When **enabled** (default), all source text is persisted to `localStorage` and survives browser refresh. When **disabled**, rules, preferences, and column filters are still saved, but the raw source text is not persisted across page loads (it remains during the current session).

### 14.2 Spreadsheet formula protection

Toggle in Config → Export options. Controls whether a leading apostrophe is added to dangerous formula-starting cells when copying spreadsheet-oriented text formats (see §12.5). It does not affect Lua formats or the Excel export.

### 14.3 Clear local data

The **Clear local data** button in the status bar removes ALL `localStorage` data for the app. Use this when storage is corrupted or you want a fresh start. The page does not auto-refresh, so you can still back up before clearing.

### 14.4 Storage status

The status bar reports save state in real time:
- **"已保存 · X KB"** — data saved successfully, with estimated size.
- **"临时数据模式 · 规则已保存"** — raw data persistence is off.
- **"保存失败"** (in red) — `localStorage` write failed (e.g., quota exceeded). A visual storage meter with a colored bar shows usage proportion.

If storage is full, **do not close the page** — download a workspace backup first, then clear local data.

### 14.5 Data stays local

All processing (parsing, filtering, JOIN execution, Excel generation) runs in the browser. No data is sent to any network server.

---

## 15. Keyboard shortcuts

### 15.1 Global

| Action | Shortcut |
| --- | --- |
| Parse current data source | `Ctrl/Cmd+Enter` |
| New analysis tab | `Ctrl/Cmd+N` |
| Open file | `Ctrl/Cmd+O` |
| Save workspace | `Ctrl/Cmd+S` |
| Undo cell correction | `Ctrl/Cmd+Z` |
| Redo cell correction | `Ctrl/Cmd+Y` (or `Ctrl/Cmd+Shift+Z`) |
| Select all in active preview table | `Ctrl/Cmd+A` |
| Rename active tab | `F2` |
| Show help | `?` |

### 15.2 Source editor (full-screen)

| Action | Shortcut |
| --- | --- |
| Parse without closing | `Ctrl/Cmd+Enter` |
| Save source to workspace | `Ctrl/Cmd+S` |
| Close (syncs text) | `Escape` or click **Close** / **Done** |

### 15.3 JOIN designer

| Action | Shortcut |
| --- | --- |
| Focus left column search | `/` (when no input is focused) |
| Save view | `Enter` |
| Close designer | `Escape` |

### 15.4 Cell editing

| Action | Key |
| --- | --- |
| Commit edit | `Enter` or `Tab` |
| Cancel edit | `Escape` |

### 15.5 Tab management (when a tab is focused via click or keyboard)

| Action | Key |
| --- | --- |
| Activate focused tab | `Enter` or `Space` |
| Rename focused tab | `F2` |
| Close focused tab | `Delete` (must leave ≥ 1 tab) |
| Move to previous/next tab | `←` / `→` |

---

## 16. Status bar

The bottom status bar provides:

- **100% 本地离线** indicator — confirms no network activity.
- **Save status** — current workspace state (saved / temporary / error).
- **Storage meter** — visual gauge of `localStorage` usage.
- **Keyboard hint** — quick reminder of the two most common shortcuts.
- **Clear local data** — removes all stored state.
