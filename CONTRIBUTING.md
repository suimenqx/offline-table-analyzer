# Contributing

Thank you for improving Offline Table Analyzer.

## Project principles

1. Runtime behavior stays fully offline.
2. The release remains a self-contained `index.html`.
3. Existing `cli-table-data` behavior is backward compatible.
4. Data must not be silently dropped or changed.
5. User-derived content is never inserted into HTML without escaping.
6. Keyboard access, reduced motion, and narrow-screen fallback are release requirements.
7. New behavior includes regression tests and documentation.

## Development setup

Node.js 20 or newer is recommended. There are no runtime or package dependencies.

```bash
npm test
npm run validate:release
```

Open `index.html` directly for manual testing. A static server may be used when a browser restricts local-file APIs.

## Pull requests

- Keep changes focused and explain the user-facing outcome.
- Add parser fixtures for format changes and edge cases.
- Add JOIN tests for matching semantics and null/empty behavior.
- Test light/dark themes, keyboard navigation, and at least one narrow viewport for UI changes.
- Update `CHANGELOG.md` under an Unreleased section.
- Do not commit generated downloads, screenshots containing sensitive data, or duplicated release HTML files.

## Commit style

Short conventional prefixes are encouraged: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, and `chore:`.

