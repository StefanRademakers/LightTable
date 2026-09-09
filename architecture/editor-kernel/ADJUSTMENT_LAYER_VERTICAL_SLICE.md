# Adjustment-layer vertical slice

Status: **kernel, critic and automated packaged acceptance passed; owner feel
acceptance remains open**.

Baseline: `7e556f7b` (`stabilize warp and face-warp kernel lifecycle`).

## Owned route

```text
Layers menu / Image menu / Action / MCP
  -> semantic adjustment.create command
  -> one document mutation lease
  -> canonical AdjustmentLayer or RasterLayer attached owner
  -> document projection controller
  -> renderer document/processing projection
  -> one document-scoped history command

Properties interaction
  -> target locked at gesture begin
  -> pointer-rate renderer preview
  -> one canonical owner-stack commit or cancel
  -> one semantic adjustment snapshot in Action recording
```

## Authority contract

- `ImageDocument.layers` owns Adjustment Layers, local processing and attached
  adjustment stacks. Their identity, order, mask, clipping, visibility and
  settings are canonical document data.
- `DocumentSession.processing.adjustments` owns only document-wide processing.
  Editing a layer owner must never clear, copy or replace this independent
  document owner.
- `AdjustmentPresentationStore` and `adjustmentsRef` are presentation caches.
  They are derived from the current canonical owner and are never history
  payloads or rollback authorities.
- The renderer owns evaluated pipelines, textures and pointer-rate previews.
  It does not create authored module identities and cannot commit document
  state.
- `DocumentCommandHistory` stores commands against canonical document or
  document-processing owners. It never restores a React panel snapshot.

## Defects proven in the opening route

1. Correction Adjustment Layer creation manually published three mutable
   surfaces: document processing, the document tree and panel adjustments.
   Its history entry replayed all three. Filter layers used the normal single
   document transaction, so two creation lifecycles existed for the same
   layer model.
2. `projectAdjustmentSnapshot` replaced document-wide processing with neutral
   settings whenever a raster, attached or Adjustment Layer owner was edited.
   Independent owners therefore destroyed one another.
3. Attached-adjustment creation also captured and restored panel values in its
   command transaction, making a contextual UI cache part of undo/redo.

## Implemented correction

- All Adjustment Layer and attached-adjustment creation now uses the same
  canonical document transaction and generic document history path.
- Generic document snapshot publication resolves the current Properties owner
  again and materializes its controls from canonical state. Undo/redo therefore
  follows the restored active owner instead of replaying stale panel data.
- Layer and attached projections preserve document-wide adjustments unchanged.
- Hidden legacy `vibrance` remains a readable catalog identity but is not
  offered as a duplicate creation item.

Additional accepted repairs:

- Gesture ownership includes the exact contextual sub-owner, so switching
  between two inspectors on one layer cancels instead of miscommitting.
- Disabled and bypassed module settings remain materialized for editing and
  replay.
- Layer commits no longer republish unchanged document-wide processing, and
  unrelated document mutations reuse a stable lightweight presentation source.
- Grade and Lens-Fx Adjustment Layer GPU runtimes remain retained by the
  canonical owner inventory.

## Critic repairs and final verdict

The bounded follow-up closed document-owner isolation, specialized-kind
preservation, strict complete snapshot validation, schema/runtime parity and
filter-owner exclusion. The final independent critic accepted the route with
no P0/P1. Adjustment Layer duplication was then added through a separate
application service: it deep-clones semantic state and transfers mask pixels
to the shared reversible GPU-history owner. A final read-only rereview accepted
that route for packaged S08.

One P2 remains for the final system failure-soak: if history publication and
GPU compensation both fail, the kernel deliberately retains recovery textures
instead of destroying the only recoverable state. S13 must prove the durable
quarantine/retry policy under that injected double failure.

## Acceptance evidence

- The focused S08 matrix passes 17 files / 448 tests; the command contract
  passes 33/33.
- The instrumented packaged adjustment smoke exercises live Levels, Curves,
  Gradient Map and Color Grading previews, one semantic Action snapshot,
  exact undo/redo and masked Grade duplication undo/redo.
- All 19 visible standalone adjustment identities create, query and undo via
  the semantic packaged route. Hidden legacy `vibrance` and non-standalone
  Lens-Fx Grain remain queryable catalog identities.
- The packaged layer-subtarget smoke passes. Save/open round-trip and renderer
  rebind are covered by focused canonical persistence/projection tests.
- The 4K packaged interaction audit records 23--24 Hz under automation, no long
  tasks or page errors, and stable processing-suffix reuse. GPU high-water
  accounting remains an explicit S12/S13 resource-soak item.

Owner interaction/visual acceptance remains open. The generic multi-document
smoke currently fails before adjustment work because its expected `image.png`
tab is absent; that workspace/tab blocker belongs to S12 and is not counted as
S08 proof.

## Forbidden compatibility path

The removed multi-publication creation flow is not a fallback or extension
point. New adjustment kinds must enter through the catalog, semantic command,
canonical document transaction and shared projection route above.
