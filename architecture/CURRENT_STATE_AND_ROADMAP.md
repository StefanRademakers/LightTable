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
- Semantic point, paragraph, vertical and imported path text with lazy
  Rust/Wasm shaping, WebGPU realization and bounded inactive-layer caches.
- PSD export release candidate for the verified 8-bit RGB semantic subset,
  plus strict Photoshop Layer Style and 48-case color/blend comparison gates.
- Bounded first-page PDF open and fail-closed one-page flattened/hybrid export.
- A versioned semantic command service with stable document/resource IDs,
  optimistic revisions, atomic batches, bounded artifacts, async task events
  and document-space gestures.
- Embedded opt-in Agent Access plus outbound TLS/WSS pairing and a remote MCP
  adapter; transport, permissions and editor command semantics remain separate.
- MCP construction/query support for editable text, vectors, gradients and
  Layer Styles, including complete layered-design transactions and real GPU
  preview/export artifacts.
- Provider-neutral GenAI packages, OpenArt integration, a managed local-AI
  protocol/provider process and project-backed job/asset/history persistence.
- Local editor inference for depth, smart selection, matte refinement,
  background removal and Face Warp with explicit lazy/bundled model ownership.
- Project workspaces with indexed assets and durable AI history while normal
  document editing, recovery, selection intelligence and Agent Access remain
  available standalone.
- Application-owned open/save/export and structured PSD import reporting.
- Declarative cross-platform keymap and gesture-level undo boundaries.
- One contextual Properties shell tracks explicit layer, mask, local processing
  and Layer Style targets, and routes Grade, Lens Fx, Text and Effects to
  independently owned editors.

## Partial or incomplete

- `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain large integration
  facades. Viewport measurement, sampling-quality settling and timer cleanup now
  have a typed application owner; continue extracting similarly cohesive
  controllers and GPU resource owners.
- Some renderer paths still need to consume the resolved scene-transform graph
  consistently, especially nested groups, masks, bounds and selection tools.
- Processing is semantically node-based, but not every grade/spatial operation
  has a completely independent generic executor.
- Smart Objects, Smart Filters, advanced text recovery/editing and full PSD
  style/adjustment parity remain incomplete.
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
- GenAI generation and Remove Object are currently harder project-gated than
  their semantics require; the product must either state that requirement
  clearly or introduce a standalone generation workspace/output sink.
- Product licensing has policy and fail-closed rehearsal boundaries but no
  checkout, signed activation receipt verification, device lifecycle or
  entitlement UI/service yet.

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
5. Keep the established PSD/color/effects gates strict while adding Smart
   Object, missing-font, adjustment, pattern and 16-bit export mappings.
6. Consolidate selection, transform, path and brush overlays on the vector GPU
   primitives and complete stroke quality.
7. Evolve warp and shared field-processing infrastructure with preview/final
   quality and dirty-region support.
8. Extend the established semantic command surface into transforms, masks,
   selections, adjustments and remaining tool semantics so UI, plugins and MCP
   remain consumers of one undoable application boundary.
9. Define the pre-1.0 LightTable file-format contract, precision/export policy
   and migration policy only when the model is solid enough to freeze.

## Not a goal

- Loading every old alpha LightTable file.
- Duplicating the editor in Electron or StoryBuilder.
- Keeping historical APIs alive without a current consumer.
- Faking PSD parity with the embedded composite while editable semantics are
  absent.
- Optimizing by flattening away editability without an explicit user command.
