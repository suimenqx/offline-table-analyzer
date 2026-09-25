# Offline Table Analyzer — Architecture Evolution

## Destination

A decision-backed architecture evolution blueprint that reduces coupling and regression risk while preserving the single-file, fully offline release and zero-runtime-dependency contract. The map is complete when target module responsibilities and seams, the migration order, and the evidence needed to validate and roll back each phase are clear enough to plan implementation. This map plans the work; it does not implement it.

## Notes

- Keep single-file `index.html` delivery, full offline operation, privacy, and zero runtime dependencies as fixed product constraints.
- Optimize first for lower coupling, safer changes, and better testability. Use likely future capabilities only to check that the target architecture does not close off a clearly valuable path.
- Read `docs/architecture/architecture.md`, `docs/architecture/refactor.md`, `docs/planning/refactor-requirements.md`, and `docs/planning/roadmap.md` before resolving architecture decisions. The repo has no `CONTEXT.md` or ADRs yet; use established terms from those architecture documents and update the domain glossary only when a domain term is actually settled.
- Follow the repository's main-branch workflow: stage only this effort's files, then commit and push directly to `origin/main`. Existing tests and validators are evidence for planning; do not run tests unless explicitly requested.

## Decisions so far

<!-- One line per resolved child ticket. The decision detail belongs in that ticket. -->

- [Audit architecture friction across core flows](issues/01-architecture-friction-audit.md): strongest evidence clusters at source-to-parse, paired clipboard output, and preview-query caller seams; preserve the deep core modules.

## Not yet specified

- Which state and result lifecycles (workspace, source snapshot, parse result, derived preview) need a clearer owner after the friction audit.
- Which migration stages and validation evidence give enough confidence without turning the blueprint into a feature plan.

## Out of scope

- Shipping new user-facing capabilities from the roadmap. Their architectural implications may inform decisions, but implementation is a separate effort.
- Changing the single-file, offline, privacy, or zero-runtime-dependency product constraints.
- Accounts, cloud synchronization, telemetry, and server-side data processing, which conflict with the product's offline/private model.
