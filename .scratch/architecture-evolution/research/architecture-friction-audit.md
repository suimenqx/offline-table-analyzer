# Architecture friction audit

Scope: current core flows, recent changes, and the fixed single-file/offline release model. This is evidence for later decisions, not a target design. Existing tests and history were inspected; tests were not run.

## Findings

### 1. Source-to-parse behavior crosses several owners

One paste can depend on clipboard capture and snapshot matching in `SourceController` (`src/ui/source-controller.js:88-156`), format/header lookup in `App.getParseOptions()` (`src/ui/app.js:461-470`), source revision and parse-option transitions in `Store.transition()` (`src/state/store.js:541-577`, `728-755`), and format selection/diagnostics in `ImportEngine.parse()` (`src/parsing/import-engine.js:26-149`). The compatibility `Parser` facade adds another error path (`src/parsing/legacy-facade.js:4-21`), while `App.run()` catches failures and clears parse state (`src/ui/app.js:848-889`).

This path has recent regression evidence: `4a1c149` fixed import-option transitions that dropped HTML paste data; `fcc421c` and `eb0074a` fixed multiline cell/newline behavior. Existing tests cover CRLF normalization and retaining HTML across format/header changes (`tests/unit/source-controller.test.js:164-180`, `201-244`). `ImportEngine` also reads `Store.lastSuccessfulFormat` as an undeclared global (`src/parsing/import-engine.js:48-64`), with `App.run()` writing it separately (`src/ui/app.js:855-858`).

**Deletion test:** deleting the snapshot-lifetime rules would redistribute text/tab matching and retention behavior among source events, Store transitions, and parsing call sites. That complexity is already visible as cross-module knowledge. This is the clearest candidate for a stronger seam around source-to-parse lifecycle. The exact owner should remain undecided until the roadmap-scope ticket is answered.

### 2. A clipboard copy makes one semantic decision, then serializes twice

`Select.copy()` chooses the format and header policy, builds a matrix, then independently calls `ClipboardFormatter.toHtml()` and `toText()` (`src/ui/selection.js:187-204`). Both methods must agree on which matrix row is a header; their row handling is separate (`src/export/clipboard.js:127-151`). Commit `d55851c` fixed HTML output that repeated header values in `<tbody>` when headers were disabled. Existing unit and UI-smoke tests now cover the paired result (`tests/unit/clipboard.test.js:173-201`, `tests/integration/ui-smoke.test.js:143-180`).

**Deletion test:** deleting the formatter would spread CSV quoting, formula protection, Lua literals, multiline handling, and HTML escaping into selection/copy callers. The formatter is a deep module worth keeping. A smaller seam around the complete copy operation may improve locality because the two MIME outputs share one user choice.

### 3. The preview query is deep, but its entry path runs through the export module

`QueryService` owns JOIN resolution, filtering, cloning, revision-aware cache keys, and bounded caching behind `getPreview()` (`src/core/query-service.js:56-110`). Its tests cover preview paging, cache invalidation, and JOIN filtering (`tests/unit/query-service.test.js:10-43`). However, `App.renderPreview()` asks `App.getPreviewProcessedTables()` (`src/ui/app.js:509`, `972`), which delegates to `ExportController._getPreviewProcessedTables()`; that private helper gathers Store, TableRegistry, and revision state before calling QueryService (`src/ui/export-controller.js:212-224`). Preview rendering therefore knows an export-controller helper name even though the query module already owns the derived result.

**Deletion test:** deleting QueryService would spread JOIN/filter/cache behavior across rendering and export, so it should remain a deep core module. The friction lies in how callers obtain the shared result, not in the query implementation itself.

### 4. Large modules need workflow evidence before they are split

`App` is 1,127 lines and combines event wiring, parsing lifecycle, diagnostics, state-to-preview coordination, and DOM rendering. The architecture document already says App remains large and recommends extracting by user flow after behavior is protected (`docs/architecture/refactor.md:173-175`). The roadmap still calls for real browser paste-to-export coverage (`docs/planning/roadmap.md:7-17`).

`Store` is 879 lines and combines workspace normalization, schema migration, persistence, and command transitions (`src/state/store.js:1-52`, `240-265`, `465-599`). It owns important invariants: source revision changes clear row-indexed edits, parse results with stale revisions are rejected, and workspace schema migration remains explicit. The architecture contract names Store as the single owner of persisted workspace state (`docs/architecture/architecture.md`, “Command, revision, and rendering contract”).

**Deletion test:** removing App or Store would force substantial coordination, state ownership, and browser/storage behavior into callers. Their size alone is not evidence to split them. Later tickets should name a repeated cross-module change or concrete invariant before choosing a new module seam.

### 5. Several core modules already have useful depth

- `FormatSniffer` centers on `sniff(text)` and owns substantial fingerprint/scoring logic (`src/parsing/format-sniffer.js:31-60`, `206-510`, `516-634`). Format-specific parsers also keep syntax knowledge local. The deletion test argues against splitting them only because they are large.
- `FilterEngine` is documented as pure and has a focused test surface; `QueryService` composes it with JOIN and cache behavior. These modules already provide leverage to callers (`docs/architecture/architecture.md`, “Core” and “Testing architecture”; `tests/unit/filter-engine.test.js`, `tests/unit/query-service.test.js`).
- `TableRegistry` offers useful table/view metadata access and breaks an App ↔ JoinEditor cycle (`src/core/table-registry.js:1-10`), but returns its mutable raw table array (`:46-52`) and retains a deprecated `setRaw()` path (`:98-103`). The seam may need clearer ownership if the audit later selects parse-result lifecycle; deletion alone would move metadata and cycle-breaking knowledge back to callers.

### 6. The current module loader is an intentional release trade-off

The build manifest orders 41 source modules and inlines their source into `index.html` (`tools/build-release.cjs:11-74`, `80-108`). The OTA loader is a small registry and factory resolver (`src/core/module-loader.js:1-22`). Architecture documents explain this choice as a way to keep direct `file://` use, a single artifact, and no runtime dependencies (`docs/architecture/refactor.md:2-4`, `27-44`).

**Deletion test:** removing the loader or deterministic build would move dependency/order knowledge into source and tests, or change the release workflow. The existing approach has real leverage under current constraints. Replacing it should require evidence that the authoring/test friction is greater than the tooling and compatibility cost; the release seam ticket is the place to resolve that trade-off.

## Decision implications

The evidence points first to workflow seams and ownership leaks: source-to-parse lifecycle, paired clipboard serialization, and the preview query's caller path. It does not support a blanket rewrite or splitting deep parsers, filtering, JOIN, Store, or the module loader by size. The next decision should use this map together with the user's answer about documented future capabilities; concrete module ownership and migration stages can then be written as new tickets instead of guessed in advance.
