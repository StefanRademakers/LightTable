# Current state and roadmap

This file separates verified architecture from direction. Update it when a
milestone changes those boundaries; feature task details belong in
`work/todo/`.

## Current strengths

- Independent repository with shared web and Electron hosts.
- Explicit host capabilities and LightTable-owned assets/UI/CSS.
- Multi-document workspace with one active document, one persistent
  editor/canvas/Dockview runtime and inactive canonical sessions without
  recurring background rendering.
- Document-scoped history, source, viewport and revisions plus application-wide
  workspace layout and tool state; tab/preset switches do not mutate documents.
- Generation-pinned source publication, export and renderer callbacks reject
  late work after a document/renderer rebind. Prepared source/document/history
  publication is one externally observable session snapshot.
- Document-lifetime canonical command ports are independent from the one active
  presentation port. Admitted model-only UI/Actions/MCP commands can address an
  inactive session without switching tabs; renderer-dependent work remains an
  explicit capability instead of creating hidden editors.
- Multi-file desktop Open serializes initial hydration through the one renderer,
  so every selected file reaches a complete source/document/history snapshot.
- Canonical raster, group, adjustment and vector layers with masks, clipping,
  styles and scene transforms.
- Pure compositor planning before GPU encoding.
- Semantic dirty domains and animation-frame invalidation scheduling.
- Ordered processing instances and registered GPU effect executors.
- Twelve full-frame P0 filters share one canonical UI/Actions/MCP/save/
  rasterize route and reusable linear-RGBA16F WebGPU cores. One lazy
  document-owned scratch pool is shared across the family and packaged runtime
  evidence rejects stale pixels, shader errors and post-warm memory growth.
- Lazy optional effects/codecs and explicit GPU resource lifecycle.
- Reusable vector stack across `vector-core`, `vector-rendering`,
  `vector-svg-normalizer`, `vector-svg`, `paint-scene`,
  `paint-scene-adapters`, `vector-vello` and `vector-webgpu`.
- One default hybrid renderer: stable semantic render islands, retained
  cross-layer fragments/scenes, per-island Vello/native admission on a shared
  GPU device and bounded active/warm/cold/evicted resource ownership.
- Shared secure SVG Open/Place/import/paste/Actions/MCP routes with editable
  paths and primitives, linear/radial gradients, opacity groups, bounded local
  vector clips and symmetric SVG export for the admitted subset.
- Warm packaged `VORTEXT.SVG` first-useful-pixel evidence of 428--446 ms across
  five runs. The transient preview is renderer-only and the final editable
  canonical/Vello result is still required before the harness passes.
- Semantic point, paragraph, vertical and imported path text with lazy
  Rust/Wasm shaping, WebGPU realization and bounded inactive-layer caches.
- PSD export release candidate for the verified 8-bit RGB semantic subset,
  plus strict Photoshop Layer Style and 48-case color/blend comparison gates.
- Bounded first-page PDF open and fail-closed one-page flattened/hybrid export.
- A versioned semantic command service with stable document/resource IDs,
  optimistic revisions, atomic batches, bounded artifacts, async task events
  and document-space gestures.
- Durable named Action sets support bounded typed variables, explicit prior-
  result bindings, schema-gated defaults/overrides, bounded user-facing step
  rationales, dependency-aware stepwise replay and explicit fail-closed one-
  undo playback for atomic-batch-compatible workflows through that same
  semantic command service. Saved command contracts use explicit consecutive
  per-command migrations; missing, future or invalid migration chains fail
  before playback and successful upgrades rewrite the bounded library.
- Document observation includes bounded color semantics, and sRGB profile
  assignment is a metadata-only UI/Actions/MCP command with reversible history;
  Convert to Profile remains unimplemented.
- Embedded opt-in Agent Access plus outbound TLS/WSS pairing and a remote MCP
  adapter; transport, permissions and editor command semantics remain separate.
- The packaged Preferences UI can start a loopback-only MCP/OAuth server,
  register/authorize Codex without terminal command copy/paste and use the same
  exact-client read/one-time-edit/persistent-edit permission model as an online
  TLS/WSS server. The older isolated launcher remains a denial/escalation test
  harness.
- MCP construction/query support for editable text, vectors, gradients and
  Layer Styles, including revision-bound layer pages, active-layer content
  summaries, shared conservative layer bounds, whole-document/layer/mask/region
  GPU previews, unchanged-image transfer suppression, on-demand final-document
  and isolated-layer palettes, bounded typed inspection for every current
  adjustment presentation, artist workflow guides, complete layered-design
  transactions and native/bitmap export artifacts. The design guide favors one
  context read, compact layer reuse, atomic phases and 512-pixel WebP review.
- Configured Posterize, Threshold and Gradient Map nodes can be created in one
  history publication for standalone or attached placement. Ready, clean,
  unchanged single-raster documents can serve bounded source previews and full
  pixel copy while inactive without owning a hidden renderer.
- A real fresh Codex client has completed the first MCP-only cold-discovery
  artist construction: a separate 1200x1200 document with twelve editable
  raster/vector/text layers and a checked revision-bound preview. This is not
  yet the full save/export and independent-verification acceptance.
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
- Universal layer rasterization is available through one semantic command and
  shared capability projection for Layer-panel UI, Actions and MCP. Packaged
  route evidence covers generated-ID binding, replay, undo/redo and exact pixel
  equivalence.
- Hidden scope sections remain idle and explicitly wake on visibility/workspace
  activation; packaged evidence covers Hue Distribution, RGB Parade and
  Vectorscope without document revision, history or pixel mutation.

## Partial or incomplete

- `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain large integration
  facades. Viewport measurement, sampling-quality settling and timer cleanup now
  have a typed application owner; continue extracting similarly cohesive
  controllers and GPU resource owners.
- Some renderer and tool paths still need to consume the resolved
  scene-transform graph consistently, especially advanced nested masks,
  boolean clip geometry and selection/tool bounds.
- Edited, processed and layered inactive documents still require the active
  presentation renderer for pixel previews. A future on-demand canonical
  preview path must preserve the one-editor boundary and must not substitute
  original source pixels for current document state.
- Processing is semantically node-based, but not every grade/spatial operation
  has a completely independent generic executor.
- Smart Objects, Smart Filters, advanced text recovery/editing and full PSD
  style/adjustment parity remain incomplete.
- P0 filter product wiring is complete, but production calibration still needs
  reference-image alpha/HDR/edge oracles, large-document latency/soak and the
  supported NVIDIA/AMD/Intel/Apple packaged hardware matrix.
- Local Grade and Lens Fx ownership must remain visible and consistent across
  UI, save, merge, clipboard and PSD import.
- Warp has a working persistent displacement direction, but smoothing,
  reconstruction, freeze/thaw, higher-quality resampling and production edge
  behavior remain.
- Hybrid vector output still needs broader GPU/vendor evidence and exact parity
  gates for compound/inverted clips, raster+vector mask multiplication, clip
  ordering with layer effects and richer blend/isolation cases. Native
  LightTable remains the explicit island fallback; silent reduction is invalid.
- SVG patterns, filters, embedded images, native text-layout import, richer
  masks, external resources and complete CSS semantics remain unsupported or
  explicitly skipped. Multi-operand clip union and path boolean authoring need
  exact geometry rather than antialiased alpha approximations.
- Cold WebGPU startup and final edit-readiness for very large SVGs remain slower
  than first useful pixels. Large initial scene deserialization is material;
  warm JSON/Wasm transport is not the present bottleneck.
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
- The local MCP flow is packaged and owner-usable, but Task 264 still requires
  fresh-client save/export, independent pixel/layer verification and explicit
  invalid/stale/reconnect/cleanup proof. Online multi-user deployment still
  needs production authorization, tenant isolation, operations and security
  review. Mutation coverage also remains narrower than inspection coverage for
  several non-basic adjustment families.

## Next architecture milestones

The product-wide UI/UX capability inventory and decision filters are maintained
in `PRODUCT_UX_INSPIRATION_AND_GAPS.md`; Photoshop-specific evidence remains in
`PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md`.

The long-term agent/Actions/MCP destination and its acceptance ladder are
canonical in
[`goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md`](goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md).
That target does not promote its headless, branching, teach-mode or autonomous
reconstruction concepts to current capabilities.

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
6. Complete the hybrid vector parity matrix, exact clip/mask semantics and
   second-vendor/lower-tier packaged evidence; continue consolidating selection,
   transform, path and brush overlays on native vector GPU primitives.
7. Evolve warp and shared field-processing infrastructure with preview/final
   quality and dirty-region support.
8. Finish the remaining command/schema/admission gaps under Tasks 214/220/221,
   especially richer Grade/Lens Fx, vector structure, font/text measurement,
   asset/project flows and explicitly reviewed paid/provider authority.
9. Complete Task 264's real Codex save/export, independent pixel/layer
   verification, invalid/stale/reconnect/cleanup proof and measure the guided
   batch-first workflow against the 76-call cold-discovery baseline.
10. Define the pre-1.0 LightTable file-format contract, precision/export policy
   and migration policy only when the model is solid enough to freeze.
11. Reduce cold GPU/device startup and large-scene canonical/edit-ready latency
    without weakening the renderer-only preview boundary or duplicating
    canonical state.

## Not a goal

- Loading every old alpha LightTable file.
- Duplicating the editor in Electron or StoryBuilder.
- Keeping historical APIs alive without a current consumer.
- Faking PSD parity with the embedded composite while editable semantics are
  absent.
- Optimizing by flattening away editability without an explicit user command.
