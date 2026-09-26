# Agent Guide

## Product and architecture invariants

- Keep the product private, offline, and usable as one self-contained `index.html` with zero runtime dependencies. Runtime code makes no network requests and loads no external assets.
- Treat `src/` as the application source of truth. `index.html` is generated from the template, stylesheet, and ordered module manifest in `tools/build-release.cjs`; edit those sources and regenerate the artifact instead of hand-editing the generated file.
- Keep source modules in the OTA registry model. Declare module dependencies in `OTA.define`, keep dependencies earlier in the build manifest, and use the existing architecture validator to protect the manifest and release boundary.
- Give each behavior one clear owner and a small, stable interface. Extend an existing deep module when it owns the behavior; avoid duplicate logic, pass-through modules, and calls into another controller's private methods or state.
- Keep `App` as the UI composition layer. Put parsing, filtering/querying, JOIN, serialization, persistence, and DOM table construction behind their existing module interfaces.
- `Store` owns persisted workspace state. UI reads through Store accessors and sends writes through `dispatch` to `Store.transition`; the UI does not write `Store.state` or call `Store.save()` directly.
- Preserve the normalized table contract and original input. Cell corrections remain an overlay; source or parse-option changes must invalidate corrections that no longer address the same records.
- Keep imported content inert: render user data as text, escape diagnostic previews, and never execute or directly render pasted HTML. Report parse, export, storage, and import failures visibly without discarding recoverable in-memory data.
- Preserve keyboard operation, semantic controls, focus behavior, and screen-reader feedback when changing UI flows.
- Treat later roadmap candidates as proposals. Add a capability or extension point only when it is in the agreed scope. Changes to runtime dependencies, offline delivery, persistence contracts, or module-loading strategy require an explicit architecture decision recorded in the architecture docs.

## Change workflow

1. Trace the existing user flow, module owner, state transition, and relevant tests before editing. Keep new behavior at the narrowest correct boundary.
2. Preserve existing public behavior and error semantics. Add regression coverage for changed behavior; use unit coverage for pure logic and integration/UI coverage for cross-module flows. Do not weaken a test or validator to make a change pass.
3. If persisted data shape or compatibility changes, update the migration path, old-version fixtures, and requirements documentation. If module ownership, dependency direction, or delivery architecture changes, update the architecture decision and its rationale.
4. Regenerate `index.html` through the project build. For source or release changes, run the relevant test, architecture, and release scripts declared in `package.json`; inspect the generated artifact and `git diff --check` before finishing.
5. Work directly on `main` and push completed commits to `origin/main`. If the checkout is on another branch, inspect its state and get user direction before changing branch state. Never create, switch to, or use `feature/*`, `fix/*`, agent, or other topic branches or worktrees; do not open pull requests. Stage only files belonging to the requested change and preserve unrelated user edits.

## Read on demand

- Before changing data flow, module ownership, state transitions, security boundaries, or query/render contracts, read `docs/architecture/architecture.md`.
- Before adding/reordering source modules or changing the build, loader, or single-file release model, read `docs/architecture/refactor.md` and inspect `tools/build-release.cjs` plus `tools/validate-architecture.cjs`.
- Before adding a capability or expanding product scope, read `docs/planning/roadmap.md` and `docs/planning/refactor-requirements.md`.
- Before changing persisted fields, migrations, import/export compatibility, or workspace limits, read `docs/planning/requirements.md` and the related Store and migration tests.

## Test workflow

- Run `npm ci` after checkout or lockfile changes. Use `npm test` for the release build plus all Node unit and integration tests. Place these tests under `tests/` and assert public module behavior.
- Use `npm run test:e2e` for changes that cross the browser UI. It rebuilds `index.html` and exercises paste, parse, filter, JOIN, copy, and XLSX export/readback in Chromium.
- Use `npm run validate:release` and `npm run validate:architecture` when changing release boundaries, build inputs, module dependencies, or Store command flow.
- Use `npm run test:coverage` to inspect the Node suite's LCOV report. CI stores the report as a baseline artifact; add module-specific gates only after reviewing baseline coverage.
- Keep Playwright and the XLSX reader in development dependencies. The generated HTML must remain self-contained and have no runtime dependencies.
