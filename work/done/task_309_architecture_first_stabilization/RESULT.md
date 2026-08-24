# Task 309 result - architecture-first stabilization

Completed: 24 August 2026.

## Human summary

This pass did not rewrite LightTable. It tightened the boundaries already
intended by the architecture:

- document/source/history publication is atomic and late async work is pinned
  to the document and renderer generation that started it;
- pointer-hot group and vector movement stays in retained renderer preview
  state until one mouse-up commit instead of publishing React/canonical state
  on every pointer sample;
- settled document composites are reused during layer movement and canvas
  commands cannot leak through floating controls;
- hidden scopes wake when visible and GPU loss fails safely when raster pixels
  cannot be reconstructed;
- universal layer rasterization now uses one command/capability meaning through
  Layer-panel UI, Actions and MCP;
- ordinary bitmap bytes begin loading before renderer startup, while the clean
  release compiles out detailed renderer telemetry.

The result is a materially safer and narrower runtime, not a claim that every
feature is commercially ready or that manual interaction quality has been
accepted on every supported machine.

## Proven vertical changes

The implementation was split into descriptive commits from `554fa261` through
`3c5d6bf9`. The important boundaries are:

1. clean, instrumented and debug build profiles with a bundle-presence audit;
2. retained group/vector drag previews and cached settled composites;
3. atomic prepared-document publication and generation-guarded source/export
   callbacks;
4. shared command admission plus universal layer rasterization;
5. isolated contextual-adjustment transactions and explicit scope wake-up;
6. automatic vector recovery versus checkpoint-required raster recovery;
7. packaged route gates for tool switching, scopes and UI/Actions/MCP
   rasterization equivalence.

## Automated evidence

- Full repository `npm test`: passed.
- `@lighttable/app`: 520 files, 3027 tests passed.
- `@lighttable/app` typecheck: passed.
- Command-contract generation/coverage and 32 contract tests: passed.
- MCP server: 24 tests passed, including auth, reconnect soak, security and
  bounded latency diagnostics.
- Clean release package: passed distribution boundary; telemetry collector
  absent.
- Instrumented qualification package: passed distribution boundary; telemetry
  collector present.
- Packaged UI/Actions/MCP route equivalence: exact canonical state and pixels,
  including `layer.rasterize`, undo/redo and rejection behavior.
- Packaged document pixel retention, active-layer stability, tab thumbnails,
  screen/workspace modes, layer selection/subtargets, gradient tool, adjustment
  menu, Color/Vibrance pixels, source save, OS-open and release smoke: passed.
- Packaged Hue Distribution, RGB Parade and Vectorscope visibility/workspace
  wake: real non-uniform signal present; document revision/history/pixels
  unchanged.
- Packaged device loss: reconstructable SVG recovered pixel-identically;
  raster source remained failed with canonical layers intact and requested a
  recovery checkpoint instead of displaying fake empty pixels.

## Deliberately not claimed

- No owner/manual feel verdict was automated.
- No macOS or integrated-GPU physical-device qualification was run here.
- No multi-hour release soak or public/commercial release gate was claimed.
- Remaining product gaps in `architecture/CURRENT_STATE_AND_ROADMAP.md` remain
  real; a manual defect becomes a small new todo rather than reopening this
  completed technical pass.
