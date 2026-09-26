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

Node.js 20 or newer is recommended. The browser runtime has no dependencies; development dependencies provide browser E2E and XLSX readback.

```bash
npm ci
npm test
npm run validate:release
npm run validate:architecture
```

Open `index.html` directly for manual testing. A static server may be used when a browser restricts local-file APIs.

Browser E2E and coverage are separate workflows. Install Chromium with `node node_modules/playwright/cli.js install chromium --only-shell`, then use `npm run test:e2e`. Playwright does not support Termux/Android; CI runs the browser workflow on Ubuntu. Use `npm run test:coverage` to produce the Node suite's LCOV report. On filesystems that do not allow symlinks, install with `npm ci --bin-links=false`.

For the red-green-refactor loop and guidance on choosing unit, integration, browser, and architecture checks, follow the [testing strategy](docs/testing/strategy.md).

## Before pushing

- Keep changes focused and explain the user-facing outcome.
- Add parser fixtures for format changes and edge cases.
- Add JOIN tests for matching semantics and null/empty behavior.
- Test light/dark themes, keyboard navigation, and at least one narrow viewport for UI changes.
- Run `npm test`, `npm run validate:release`, and `npm run validate:architecture` before pushing a change.
- Update `CHANGELOG.md` under an Unreleased section.
- Do not commit generated downloads, screenshots containing sensitive data, or duplicated release HTML files.

## Commit style

Short conventional prefixes are encouraged: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, and `chore:`.
