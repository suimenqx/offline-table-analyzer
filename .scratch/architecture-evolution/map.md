# Offline Table Analyzer — Architecture Evolution

## Destination

A decision-backed architecture evolution blueprint that reduces coupling and regression risk while preserving the single-file, fully offline release and zero-runtime-dependency contract. The map tracks future architecture decisions and user-authorized implementation slices, with evidence needed to validate each change.

## Notes

- Keep single-file `index.html` delivery, full offline operation, privacy, and zero runtime dependencies as fixed product constraints.
- Optimize first for lower coupling, safer changes, and better testability. Use likely future capabilities only to check that the target architecture does not close off a clearly valuable path.
- Read `docs/architecture/architecture.md`, `docs/architecture/refactor.md`, `docs/planning/refactor-requirements.md`, and `docs/planning/roadmap.md` before resolving architecture decisions. The repo has no `CONTEXT.md` or ADRs yet; use established terms from those architecture documents and update the domain glossary only when a domain term is actually settled.
- Follow the repository's main-branch workflow: stage only this effort's files, then commit and push directly to `origin/main`.
- On 2026-09-25 the user authorized implementation of all three concrete seams from the friction audit: source snapshot/parse preference ownership, paired clipboard serialization, and direct App-to-QueryService preview access. This implementation does not add roadmap capabilities or change the release loader contract.

## Decisions so far

<!-- One line per resolved child ticket. The decision detail belongs in that ticket. -->

- [Audit architecture friction across core flows](issues/01-architecture-friction-audit.md): strongest evidence clusters at source-to-parse, paired clipboard output, and preview-query caller seams; preserve the deep core modules.
- [Choose the first workflow seam for the architecture blueprint](issues/04-first-workflow-seam.md): implement all three audited seams, starting with source-to-parse, then clipboard serialization, then preview-query access.
- [Choose which future capabilities should shape the architecture](issues/02-roadmap-capability-horizon.md): none are active architecture constraints; keep the near-term horizon on browser regression, parser correctness, and maintainable offline UI, and revisit later candidates when prioritized.
- [Choose the source module and release seam](issues/03-source-module-and-release-seam.md): keep the OTA registry and deterministic inline build; strengthen lightweight development checks for module inventory, dependency order, and release reproducibility.

## Out of scope

- Shipping new user-facing capabilities from the roadmap. Their architectural implications may inform decisions, but implementation is a separate effort.
- Changing the single-file, offline, privacy, or zero-runtime-dependency product constraints.
- Accounts, cloud synchronization, telemetry, and server-side data processing, which conflict with the product's offline/private model.
