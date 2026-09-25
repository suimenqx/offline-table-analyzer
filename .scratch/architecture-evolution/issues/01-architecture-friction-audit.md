# Audit architecture friction across core flows

Type: research
Status: resolved
Blocked by: none

## Question

Across the current application, where does a normal change require maintainers to understand multiple source modules, and which of those seams are causing concrete regression or testability costs? Audit the dependency and call paths for input/import/parsing, workspace and tab state, query/preview, JOIN, copy/export, UI orchestration, and the source-to-single-file build. Give extra weight to recent changes, including HTML clipboard retention, multiline cell handling, and copy header behavior.

Use the deletion test to distinguish shallow modules from deep modules that already earn their interface. Cite repository paths and line locations, connect claims to existing tests or recent commits, and identify evidence gaps. Do not run tests or modify application code. Save the findings as one Markdown asset under this effort's `research/` directory; this ticket will link the asset in its answer.

## Answer

The strongest concrete friction is at workflow seams: source-to-parse lifecycle spans `SourceController`, `App`, `Store`, `ImportEngine`, and the compatibility facade; clipboard copy makes one header decision and separately serializes two MIME forms; preview rendering reaches the deep `QueryService` through an export-controller private helper. Preserve already-deep modules such as `FormatSniffer`, `FilterEngine`, `QueryService`, and `Store`; their size is not a reason to split them. See the [architecture friction audit](../research/architecture-friction-audit.md) for path-level evidence, existing test references, and deletion-test results. This audit does not select the target architecture; the open roadmap-scope decision still shapes the next tickets.
