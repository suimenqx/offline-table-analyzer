# v18.12

## Changed

- Treat literal `<br>`, `<br/>`, `<br />` and escaped `&lt;br&gt;` markers as line breaks inside cells during import.
- Preserve `<br>` line breaks when parsing HTML table clipboard content.
- Render multiline cell text in the preview as actual line breaks instead of showing raw tags.
- Keep default TSV/CSV copy safe by quoting multiline cells.
- Keep Markdown copy readable by converting cell newlines back to `<br>`.
- Preserve visual line breaks in the HTML clipboard payload.

## Validation

- Parser regression tests: 16 passed.
- Copy formatter tests: 10 passed.
- Tab interaction tests: 20 passed.
- UI interaction tests: 38 passed.
- Script syntax validation passed.
