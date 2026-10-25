# Extraction session acceptance baseline

Date: 2026-10-25. This implements the second accepted architecture recommendation after shared Excel derivation.

## Ownership and regression coverage

ExtractionSession owns the current source snapshot, routing, shared work, cancellation, result publication and receipt validity. App supplies editor reads and presentation. BackgroundService retains Worker lifetime, transport and resident dataset versions; ImportEngine retains parsing. Schema 22, corrections, source preservation and offline single-file delivery are unchanged.

| Scenario | Evidence |
| --- | --- |
| Window stays synchronous; matching success is reused; explicit reparse invalidates old receipts | `tests/unit/extraction-session.test.js` |
| Worker pending work is shared by export and diagnostics; render requests are combined | Session unit tests and `tests/integration/export-source.test.js` |
| Card/revision/text/HTML/format/header/temporary regions/config changes invalidate snapshots, including nested caller mutation | Session unit tests; integration tests change actual Store/editor inputs |
| Queued matching source notifications preserve the current extraction and temporary header confirmation | Session unit tests and queued-source/header-confirmation export regressions |
| Cancel immediately releases waiters and busy feedback; late success/rejection cannot publish or clean up newer work | Session unit tests and cancel/retry integration regressions |
| Editing after cancelling a completed extraction clears its retained old preview | `tests/integration/export-source.test.js` |
| Reported failures remain available to diagnostics and may be retried for export | Window/Worker session unit tests, existing visible-failure and hidden-card pool tests |
| Multi-card parsing stays in Worker; HTML DOMParser stays on Window; full Worker tables remain resident | Session routing tests, existing card metadata tests and real-browser descriptors |
| Shared extraction produces complete XLSX output; cancelled exports produce no download; retry succeeds | `e2e/extraction-session.e2e.js`, independent `read-excel-file` readback |

The cancellation regressions were run before implementation: one failed because waiting export/diagnostics depended on a late transport response; another failed because cancellation left the card in `parsing`. Both pass through the new shared interface.

Local checks: `npm test` passed 552 Node tests; `validate:release`, `validate:architecture` (47 modules) and `git diff --check` passed. The release was regenerated from source and inspected.

## Desktop Firefox on Termux

Followed [the local desktop-browser workflow](termux.md) with Firefox 158.0.1, geckodriver 0.37.1 and Xvfb, loading the generated `index.html` directly via `file://` at a 1440 × 1000 window.

- Held completion delivery from the real embedded Worker; parse, export and diagnostics shared one extraction. The actual downloaded workbook passed complete multi-sheet readback; Window retained only empty-row descriptors.
- Cancelled while both consumers waited. Diagnostics resolved false, busy feedback cleared immediately and no workbook downloaded before the held transport response.
- Started a retry, delivered the cancelled response, and verified the retry stayed busy. The newer response completed successfully; a subsequent export reused it and passed XLSX readback. Original text was unchanged and there were no page errors or unhandled rejections.

The temporary verification script and logs are outside the repository; its owned browser/driver/display processes were stopped. Local Playwright remains unavailable on Android (`Unsupported platform: android`); the retained Chromium E2E scenarios run in push CI, separately from this Firefox evidence.
