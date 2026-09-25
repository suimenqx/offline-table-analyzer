# Choose the source module and release seam

Type: grilling
Status: open
Blocked by: 01, 02

## Question

Given the fixed release contract of one offline `index.html` with no runtime dependencies, should the current OTA registry and deterministic inline build remain the source-module model, or should the authoring/loading model evolve while preserving that release artifact? Decide how much development-tooling complexity is justified by better dependency visibility, testability, and change locality. Use the friction audit and the agreed roadmap capability horizon; consider the current module loader, build manifest, `file://` use, and Node test setup.
