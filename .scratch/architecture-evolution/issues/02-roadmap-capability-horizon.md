# Decide which future capabilities should shape the architecture

Type: grilling
Status: resolved
Blocked by: none

## Question

Which capabilities already listed in `docs/planning/roadmap.md`, if any, should the target architecture explicitly make easier to add? Consider optional XLSX import, data-cleaning transforms, sorting/profiles/aggregates, diff mode, pivots/charts, a parser/transform plugin interface, and PWA or File System Access enhancements. Decide which are credible inputs to the architecture blueprint and which remain future possibilities that should not add complexity now. This ticket does not authorize implementing those capabilities.

## Answer

Do not make any of the listed future capabilities an active constraint on the target architecture. Keep the near-term architecture horizon bounded to browser regression coverage, parser correctness, and maintainable offline UI, as described in `docs/planning/roadmap.md`. Treat optional XLSX import, data-cleaning transforms, sorting/profiles/aggregates, diff mode, pivots/charts, plugin interfaces, and PWA or File System Access enhancements as future possibilities; revisit their architectural implications when one is prioritized. Do not add extension points, large-data infrastructure, or implement these capabilities now. This keeps the blueprint aligned with the current product scope and avoids complexity without a committed use case.
