# Testing strategy

This guide tells agents how to choose a test boundary and prove a change. The package scripts and CI workflow are the source of truth for exact commands and runner versions: see [`package.json`](../../package.json) and [CI](../../.github/workflows/ci.yml).

## Use the red-green-refactor loop

1. Trace the user-visible behavior to its owning module and read nearby tests. Read the [architecture guide](../architecture/architecture.md) when a change crosses module ownership, state, or delivery boundaries.
2. State the behavior and edge case the change must preserve. Choose the narrowest public seam that can observe it.
3. Add a regression test and run it before changing production code. Confirm it fails for the expected reason.
4. Make the smallest implementation that makes the test pass. Keep existing behavior and error semantics covered.
5. Refactor with the relevant tests green. Keep the regression test as a permanent contract.
6. Run the checks for every boundary changed. Regenerate and inspect `index.html` when source or release inputs change. Report any check that could not run and why.

A change is ready when its regression test is retained, relevant checks pass, the generated release is current when applicable, and any environment-limited check is green in CI.

## Choose the test boundary

| Change | Test location | What to prove |
| --- | --- | --- |
| Pure parsing, filtering, JOIN, state transition, or serialization behavior | `tests/unit/` | Inputs produce the documented result, including boundary cases and diagnostics. |
| Several real modules collaborating, Store/dispatch behavior, or DOM integration with mocked browser boundaries | `tests/integration/` | The public flow crosses modules correctly; mocks stand in only for browser or storage APIs. |
| Clipboard, keyboard focus, responsive UI, browser downloads, or a workflow that depends on real browser behavior | `e2e/` | The generated release works through Chromium as a user would use it. |
| Module order, dependency direction, offline delivery, generated release integrity, or Store command boundary | `tools/validate-*.cjs` through the named npm scripts | The architecture and packaged artifact keep their invariants. |
| XLSX output | Unit/integration or browser test plus `read-excel-file` readback | A separate reader can open the downloaded workbook and see the expected sheets, values, and types. |

Prefer assertions on exported module behavior and user-observable results. Test private implementation details only when the invariant itself is architectural and has no stable public observation.

## Use the existing harness

- Node tests use the built-in `node:test` runner. Put them in `tests/unit/` or `tests/integration/`; browser tests belong in `e2e/`.
- Load source modules with [`loadModules`](../../tests/helpers/load-modules.mjs), then obtain the requested export from `OTA.require()`. The helper creates a fresh OTA registry per call and rejects misspelled requested module names. Use a fresh registry or restore state when a test mutates a module singleton.
- Use the existing DOM and storage mocks for browser boundaries. Keep real application modules in integration tests; avoid mocks that reimplement the behavior under test.
- Browser E2E rebuilds and serves the actual `index.html` locally. Keep external requests observable and use real clipboard/download behavior where it is part of the workflow.
- Parser malformed-input and generated cases must be deterministic and bounded so a failure can be reproduced from its fixture or seed.

## Let CI cover the host-specific path

CI runs on pushes and pull requests. It tests the Node suite on Node 20, 22, and 24; validates release and architecture constraints; uploads the LCOV baseline; and runs the Chromium workflow on Ubuntu. The LCOV file is retained as a CI artifact for 14 days. Treat coverage as a signal for missing behavior cases; add a threshold only after reviewing the baseline and agreeing on a module-specific gate.

Playwright's managed Chromium workflow requires a supported desktop Linux, macOS, or Windows host. On Android/Termux, run the Node tests and applicable validators locally, then rely on the Ubuntu browser job for E2E. Report that limitation accurately; a skipped local browser run is not an E2E pass.

GitHub Pages deployment is separate from CI: its workflow rebuilds and validates the release before publishing it. A green Pages deployment confirms publication, not test coverage; use the CI result for that.
