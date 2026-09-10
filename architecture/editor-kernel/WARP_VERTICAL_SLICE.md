# Warp Vertical Slice

Status: C08 exclusive kernel route independently approved; owner feel acceptance open.

## Artist contract

- A continuous Warp drag uses one immutable opening source and one stable
  adjustment-stack/module identity. Pointer previews replace the in-progress
  stroke; they never recursively deform the previous preview.
- The visible result advances monotonically. Pipeline preparation, a renderer
  replacement or a delayed animation frame may not reveal an older or
  unwarped generation between newer drag frames.
- Pointer-up creates exactly one semantic document/history operation. Cancel,
  tool switch, document switch, renderer replacement and unmount restore the
  exact opening document and retire the opening renderer's interaction state.
- Brush Warp edits raster layers non-destructively through `lt.warp`. Imported
  Text Warp remains a resolution-independent text envelope in the canonical
  document/renderer, but LightTable currently has no user-facing Text Warp
  authoring control; S07 does not invent one during feature freeze. Native vector/live-shape
  content is not silently rasterized; brush Warp requires explicit Rasterize.
- Actions and MCP retain the final bounded stroke recipe, never pointer/UI,
  renderer or GPU-resource state.
- Face Warp remains experimental. Detection/review is transient until Accept;
  sculpt/refinement is one reversible document transaction bound to the
  accepted source revision and renderer generation.

## Ownership map

| Concern | Canonical owner | Session/projection owner |
| --- | --- | --- |
| Raster Warp strokes and settings | raster layer `AdjustmentStack` / `lt.warp` | none |
| Pointer samples and smoothing | none | `WarpGestureController` |
| Gesture recipe and transaction | none | `WarpSessionController` |
| GPU displacement field/output | none | per-layer `WarpEffect` in `LayerEffectRenderer` |
| Imported text envelope | text layer `TextWarp` | text renderer; no authoring session exists |
| Face landmarks/displacements after acceptance | raster `lt.face-warp` node | none |
| Face detection/review | none | `FaceWarpDetectionReviewController` |
| Face sculpt/refinement | none until commit | face-warp interaction session |

## Baseline defect proved in S07

The original raster session derived every preview from `transaction.before`.
That correctly avoided recursive pixels, but the first Warp on a layer also
allocated a fresh stack and module id for every preview. The per-layer effect
runtime therefore destroyed and recreated `WarpEffect` during the drag. While
the replacement pipelines/resources became ready, the renderer could return
the unwarped input, producing the reported old/new rebound.

S07 freezes one recipe base after the opening sample. Every later preview
replaces that stroke on the same stack/module identity. The session also owns a
lease on the opening renderer generation; cleanup never targets whichever
renderer happens to be current later.

## State flow

```text
pointer down
  -> admit document/layer + document transaction + renderer lease
  -> freeze source-space transform and stable recipe base
  -> publish opening preview on one module identity
pointer/hold samples
  -> gesture controller appends canonical source-space samples
  -> frame scheduler keeps only latest projection task
  -> replace same stroke on same recipe base
pointer up
  -> publish exact final stroke under the stable module identity and a new revision
  -> bind that exact revision to a canonical full-field GPU rebuild
  -> one canonical document/history commit
  -> record one semantic command
  -> release opening renderer lease
cancel/invalidation
  -> cancel frame/hold work
  -> restore opening document
  -> release opening renderer lease
```

## Structural limits

- `WarpSessionController` owns gesture admission, recipe identity and terminal
  publication. React only supplies current ports and pointer events.
- `WarpEffect` owns displacement textures and buffers. Canonical documents and
  history never retain GPU objects.
- A future Text Warp authoring feature must begin behind a bounded application
  controller; it may not first add gesture policy to `LightTableEditorOverlay.tsx`.
- Face Warp detection and review are owned by a bounded application controller;
  detector/deformer algorithms remain in their domain modules. React presents
  its external-store snapshot and cannot publish accepted settings directly.
- The source-structure threshold may not be raised to hide these extractions.

## Acceptance matrix

- Push, clockwise/counter-clockwise twirl, pinch and bloat sampling. Smooth,
  reconstruct, freeze and thaw remain reserved document values and are
  explicitly rejected by UI/Actions/MCP until they have a GPU executor.
- Hold-driven modes continue while stationary and stop exactly once.
- Stable effect identity and monotonic preview throughout a drag.
- Commit and redo rebuild the same terminal recipe and must be pixel-exact;
  incremental half-float preview accumulation is never a history baseline.
- Transformed raster source coordinates, cancel, reset, undo/redo and repeat.
- Tool/document/renderer switch and unmount release the opening lease.
- Liquify brush shortcut route and Warp tool route produce the same semantic
  stroke/history behavior.
- Imported Text Warp round-trips and renders semantically. Interactive Text
  Warp authoring is explicitly out of scope because no such product surface exists.
- Face detection reject/cancel/accept, sculpt/refine/cancel, undo/redo and
  document/renderer invalidation.
- Action recording/playback and MCP use the same final raster Warp command.
- Debug/instrumented packaged browser run has no page errors, visible old/new
  rebound or unbounded GPU growth.

## Verification loop

1. Focused Warp, document transaction, effect-runtime and Face Warp tests.
2. Independent read-only architecture critic.
3. At most two evidence-backed repair passes.
4. Packaged raster Warp/Liquify, Text Warp and Face Warp acceptance.
5. Relevant boundary/typecheck suite; full verification at the checkpoint.

## Independent review record

- Pass 1 rejected five P1 gaps: fictional modes, stale Face Warp source,
  terminal renderer leases, Text Warp presentation ownership and an unbounded
  UI-to-Action stroke hand-off. All were accepted and repaired.
- Pass 2 caught an invalid delta-preserving strategy and a smoke that would
  override the live renderer with the canonical document while measuring it.
  The final repair uses one 768-sample interactive polyline, recomputes
  accumulated deltas whenever it decimates, and never performs a second
  terminal-only reduction. Live drag proof reads canvas pixels only; canonical
  export is reserved for commit, undo and redo.
- Packaged acceptance then exposed a terminal half-float mismatch. Replacing
  persistent module ids was rejected: ids are document contracts shared by UI,
  Actions and MCP. The repaired route keeps ids stable, advances module and
  stack revisions monotonically, and asks the opening renderer for one exact
  revision-bound canonical projection.
- The final critic found that a second-stroke history redo could still take the
  append optimization without an active gesture. Incremental accumulation is
  now allowed only under an explicit renderer-owned layer/module preview lease;
  every other document/history projection rebuilds from the complete recipe.
  Packaged two-stroke commit/undo/redo is pixel-exact for both strokes.
- C08 removed the remaining semantic command's private apply/history ports,
  made the interactive renderer binding mandatory and extracted detector/review
  state from `LightTableEditorOverlay.tsx`. Late detection results require the
  exact opening document, renderer and generation.
- C08 critic pass 1 found two terminal lifecycle defects: rejected Warp history
  could retain a renderer canonicalization marker, and RAF-delayed Face Warp
  refinement could be cancelled after pointer-up by a tool/document switch.
  Canonical projection is now an identity-scoped retire lease; Face Warp
  refines and commits synchronously at pointer-up. Pass 2 accepted with no
  P0/P1, and direct stale-retire test coverage was added.
- Debug-packaged native WebGPU Face Warp acceptance passed detection review,
  cancellation, mesh acceptance, sculpt/refinement, eight repeated transaction
  boundaries, semantic adjustment undo, idle stability and GPU/heap checks.
