# Choose the source module and release seam

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Given the fixed release contract of one offline `index.html` with no runtime dependencies, should the current OTA registry and deterministic inline build remain the source-module model, or should the authoring/loading model evolve while preserving that release artifact? Decide how much development-tooling complexity is justified by better dependency visibility, testability, and change locality. Use the friction audit and the agreed roadmap capability horizon; consider the current module loader, build manifest, `file://` use, and Node test setup.

## Answer

Keep the OTA registry and deterministic inline build. They directly support the fixed single-file, offline, zero-runtime-dependency release and direct `file://` use; the friction audit found concrete workflow ownership issues but no evidence that the loader or build model causes enough friction to justify native ESM or a larger bundler. Keep the manifest as the authoring-time order and strengthen development-only validation so every source module is included once, module dependencies exist and precede their consumers, and `index.html` remains reproducible. Use the same manifest order when tests load source modules. Reconsider a different authoring model only if a concrete capability or repeated change shows that these light tools are inadequate. This decision does not authorize new roadmap capabilities.
