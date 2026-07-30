# LightTable implementation roadmap

This is the canonical eight-step implementation order. Detailed design
documents remain the source of truth for each feature.

1. **Define one shared render contract** — implemented; browser GPU smoke test pending
   - Texture.
   - Dimensions and bounds.
   - Linear, premultiplied alpha.
   - Revision.
   - Transform.
2. **Build the Transform tool** — implemented; browser interaction smoke test pending
   - Complete active layer or active selection.
   - Non-destructive preview, commit and cancel.
   - One completed transform is one undo step.
   - Persist transforms in layered documents.
   - See `transform_tool.md`.
3. **Build similarity Auto Align** — GPU prototype implemented; browser smoke test pending
   - Reuse the shared transform contract from steps 1 and 2.
   - Uses source-linear layer textures in one document-space analysis pass.
   - Gradient-domain translation, uniform-scale and bounded-rotation search,
     overlap and confidence checks run on WebGPU.
   - Layer-menu preview/apply/cancel flow; apply creates one geometry undo step.
   - The locked reference is never modified.
   - See `LIGHTTABLE_WEBGPU_AUTO_ALIGN_LAYERS.md`.
4. **Split the existing grade into reusable adjustment modules** — implemented
   - Add a small evaluator without duplicating the current grading engine.
5. **Add per-layer adjustment stacks** — stack contract implemented; recursive evaluator planned
   - See `LIGHTTABLE_PER_LAYER_ADJUSTMENTS_AND_FUTURE_NODE_GRAPH.md`.
6. **Add adjustment layers, then clipping and groups** — in progress
   - Build these on the same evaluator and layer contract.
   - One top-level Document Grade Adjustment Layer is editable and persisted.
   - Arbitrary placement, multiple adjustments, below-layer evaluation,
     clipping, masks and isolated groups remain.
7. **Run the Three.js/WebGPU interoperability spike, then add 3D layers** — planned
   - See `lighttable_3d_layer_research_implementation_plan.md`.
8. **Run wasm-vips as an isolated worker spike** — production hardening in progress
   - This work may happen earlier and must not block the editor architecture.
   - Ordinary 8-bit images remain on the native fast path.
   - Explicit u8/u16 precision-preserving import is implemented; performance,
     production smoke testing and broader professional formats remain.
   - See `lighttable_wasm_vips_implementation_checklist.md`.

## Current work

Steps 1 and 2 now share an authoritative raster contract with source and
geometry revisions, linear premultiplied pixels and a persisted
source-to-document transform. Whole-layer transforms update geometry without
resampling; selection transforms remain atomic pixel edits.

Step 8 continues to be hardened in parallel because it is isolated from the
editor architecture. Step 3 now has its first end-to-end similarity prototype
on the shared transform contract. Browser testing with real layer pairs is
required before affine alignment is considered.

## PSD/PSB convergence

PSD parity is not a ninth independent editor architecture. It depends on and
validates steps 4 through 6: reusable adjustments, typed layer kinds, nested
groups, clipping, masks and the shared compositor. The PSD codec must wrap the
same canonical LightTable document graph and asset registry used by native
LightTable documents.

Use `AG_PSD_FEATURE_PARITY_REFERENCE.md` for library/format facts and
`PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md` for the capability matrix,
required editing UI, phased implementation and release gates.
