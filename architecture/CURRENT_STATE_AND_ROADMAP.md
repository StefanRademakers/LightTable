# Current state and roadmap

This file separates verified architecture from direction. Update it when a
milestone changes those boundaries; feature task details belong in
`work/todo/`.

## Current strengths

- Independent repository with shared web and Electron hosts.
- Explicit host capabilities and LightTable-owned assets/UI/CSS.
- Multi-document workspace with one active document and paused background
  renderers.
- Document-scoped history, tasks, tools, viewport and renderer lifecycle.
- Canonical raster, group, adjustment and vector layers with masks, clipping,
  styles and scene transforms.
- Pure compositor planning before GPU encoding.
- Semantic dirty domains and animation-frame invalidation scheduling.
- Ordered processing instances and registered GPU effect executors.
- Lazy optional effects/codecs and explicit GPU resource lifecycle.
- Three-package vector architecture with editable paths and WebGPU fill/overlay
  backends.
- Application-owned open/save/export and structured PSD import reporting.
- Declarative cross-platform keymap and gesture-level undo boundaries.

## Partial or incomplete

- `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain large integration
  facades. Viewport measurement, sampling-quality settling and timer cleanup now
  have a typed application owner; continue extracting similarly cohesive
  controllers and GPU resource owners.
- Some renderer paths still need to consume the resolved scene-transform graph
  consistently, especially nested groups, masks, bounds and selection tools.
- Processing is semantically node-based, but not every grade/spatial operation
  has a completely independent generic executor.
- Smart Objects, Smart Filters, text and full PSD style/adjustment parity are
  incomplete.
- Local Grade and Lens Fx ownership must remain visible and consistent across
  UI, save, merge, clipboard and PSD import.
- Warp has a working persistent displacement direction, but smoothing,
  reconstruction, freeze/thaw, higher-quality resampling and production edge
  behavior remain.
- Vector strokes, anti-aliasing/device fixtures and overlay consolidation need
  more production validation.
- Sixteen-bit/profile-aware import exists for supported cases; explicit
  precision-preserving export and broader formats remain.
- Panel/docking state and shared design tokens need continued stabilization.
- Integrated-GPU/Mac responsiveness remains a release criterion, especially
  active selections, scopes, paint and panel resizing.

## Next architecture milestones

The product-wide UI/UX capability inventory and decision filters are maintained
in `PRODUCT_UX_INSPIRATION_AND_GAPS.md`; Photoshop-specific evidence remains in
`PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md`.

1. Finish scene-transform authority adoption and tight bounds throughout paint,
   masks, transform, clipboard, merge and nested groups.
2. Continue breaking the editor/GPU facades into typed, testable owners without
   moving behavior back into React roots.
3. Complete the ordered processing executor model for local stacks,
   adjustment layers, groups and future Smart Filters.
4. Make Grade/Lens Fx ownership, toggles, masks, rasterization and merge fully
   symmetric.
5. Harden PSD semantic fixtures and comparison tooling, then add Smart Object,
   text, adjustment and style mappings incrementally.
6. Consolidate selection, transform, path and brush overlays on the vector GPU
   primitives and complete stroke quality.
7. Evolve warp and shared field-processing infrastructure with preview/final
   quality and dirty-region support.
8. Define the pre-1.0 LightTable file-format contract, precision/export policy
   and migration policy only when the model is solid enough to freeze.

## Not a goal

- Loading every old alpha LightTable file.
- Duplicating the editor in Electron or StoryBuilder.
- Keeping historical APIs alive without a current consumer.
- Faking PSD parity with the embedded composite while editable semantics are
  absent.
- Optimizing by flattening away editability without an explicit user command.
