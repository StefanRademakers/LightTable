# Raster paint and pixel-mutation vertical slice

Status: **owner acceptance**. Baseline: `bd6a30e9`.

This note bounds S03. It covers Brush, Eraser, Clone Stamp, Healing Brush,
Dodge, Burn, Sponge, Paint Bucket/Clear, raster Gradient, pixel/mask targets,
selection clipping, tight/transformed raster preparation, history and renderer
lifetime. It does not change brush appearance algorithms, vector gradients,
selection-paint algorithms (S00), warp (S07), filters (S10), or selected-pixel
transform (S04).

## Artist-visible flows and entry points

- Draw one continuous Brush or Eraser stroke; cancel it or undo/redo it.
- Alt-click a Clone/Healing source and paint from one immutable source for the
  complete stroke.
- Draw Dodge/Burn/Sponge strokes with one snapshotted tone operator.
- Fill/Clear or draw a raster Gradient into explicit pixels or a layer mask.
- Clip all pixel mutations to the exact committed selection when active.
- Paint a compact/transformed pasted raster without a shifted result, wrong
  copy area or recursive quality loss.
- Switch/close documents, replace the renderer or unmount during a gesture
  without publishing or addressing another renderer's edit.
- Reach final Brush, Fill and raster Gradient semantics through UI/Actions/MCP
  without serializing pointer-time GPU or preview state.

Explicit limits in this slice: recorded brush gestures retain at most 4096
samples / 220 KiB; a larger user stroke still paints and histories correctly
but is not recorded as an Action. Blur Brush uses its existing immutable source
snapshot but is not a separate registered toolbar tool. Pixel painting on
non-raster layers remains unsupported and fails before opening an edit.

## Ownership map at baseline

| Concern | Baseline owner | S03 target |
| --- | --- | --- |
| Pointer sampling/tool intent | `useViewportInteractionController` | input adapter only |
| Stroke interpolation | `PaintGestureController`, `paintDabScheduler` | pure gesture/frame algorithm |
| Stroke transaction | `usePaintSessionController` plus direct gesture resets in Overlay | one renderer/document-bound session owner |
| Brush algorithms/GPU work | `RasterPaintService` and shaders | renderer projection port only |
| Clone/Healing source | `SampledBrushSourceController`, renderer scratch snapshot | immutable plan admitted into stroke session |
| Fill | `useFillCommandController` + `fillOperation` | one discrete pixel mutation route |
| Raster Gradient | `RasterGradientCommandController` + `gradientOperation` | one gesture/discrete pixel mutation route |
| Canonical revision | document commands via the three controllers | document transaction only |
| GPU undo and retained resources | `commitAppliedPixelMutation` / editor kernel coordinator | shared exact pixel-mutation owner |
| Selection clipping | renderer selection texture plus numeric revision guard | exact committed generation for session lifetime |
| UI/Action/MCP | viewport, observed gesture, command service | same final controllers |

## Canonical and transient state

- Canonical: raster/mask pixel revision, dirty bounds, raster surface geometry,
  history entry and semantic recorded command.
- Transient: pointer ownership, interpolator state, queued dabs, brush/operator
  snapshot, sampled source scratch, open renderer edit, prepared surface edit,
  renderer binding and selection revision.
- React may project active pointer/cursor state, but owns none of the above
  mutation or rollback decisions.

## Required lifecycle

```text
validate exact document/layer/channel/locks
  -> acquire document transaction + concrete renderer + selection generation
  -> optionally prepare compact raster surface
  -> open one renderer edit / immutable sampled source
  -> schedule bounded dabs without React/document/history writes
  -> finish exact edit and stage dirty document bounds
  -> atomically publish document + one history entry
  -> transfer edit/resource ownership to history
```

Cancel, pointer loss, selection change, supersession, document switch, renderer
replacement and unmount all roll back through the opening renderer exactly once.
No later renderer may finish, undo or destroy an edit opened by an earlier one.

## Baseline failure risks

1. The controller resolved the current renderer during dabs, finish and cleanup
   instead of retaining the opening renderer. A rebind could mutate or clean up
   the wrong resource repository.
2. Document open/rebind/reset paths called `PaintGestureController.reset()`
   directly, bypassing open GPU edit, sampled-source, prepared-surface and
   document-transaction cleanup.
3. The React paint hook had no unmount cleanup.
4. Stroke publication, Fill and Gradient share the S02 pixel coordinator, but
   refusal-before-callback and partial rollback must be proved for every adapter.
5. Load Mask as Selection is correct but cold packaged measurements are
   741-767 ms; its boundary must be profiled before attributing that delay to
   painting or changing GPU ownership.
6. The 641-line `RasterPaintService` combined continuous brush/source work with
   discrete fill/gradient/invert commands. S03 extracted the latter into
   `RasterPixelCommandService`; the facade is now 487 lines and its public API
   did not change.

## Implemented ownership corrections

- Brush sessions retain their opening document transaction, renderer, target
  matrix, selection revision, brush and operator through terminal cleanup.
- Document rebind, open, reset and unmount call the complete paint-session
  rollback instead of resetting only pointer interpolation.
- Frame-delivered GPU exceptions and exceptions during edit close cannot escape
  with a live transaction; cleanup continues through interaction-quality and
  sampled-source release.
- Fill, Gradient and Brush share an unpublished-edit rollback owner. It tracks
  each edit's applied state, compensates partial failure, quarantines recovery
  snapshots after a double failure and retries that exact state machine before
  admitting more work.
- Raster Gradient retains its pointer-down renderer, layer, channel, settings,
  paint and selection revision. A changed selection or renderer rejects before
  GPU work.
- `paintTargetSourceToDocument` is the common coordinate authority: raster
  pixels use the complete scene transform including ancestors; masks use their
  own persisted transform. Pointer, semantic gesture, Fill and Gradient routes
  all consume it.
- Discrete pixel commands destroy pending resources immediately on encode or
  submit failure and retire submitted resources only after queue completion.

## Invariants and performance budget

- One completed continuous stroke creates exactly one document revision and
  one history entry; cancel/no-op creates none.
- Brush settings, target transform, operator/source, renderer binding and
  selection generation are immutable for the stroke.
- Pointer move performs no readback, history publication or full-document GPU
  allocation. Dab uploads are reused and submitted at most once per frame.
- Tight-raster preparation is one reversible edit and cannot become canonical
  if the stroke fails.
- Fill and Gradient are one renderer submission plus one exact reversible edit.
- Repeated packaged 4K strokes may allocate bounded lazy resources once; stable
  tail memory and latency may not grow per stroke. A repeatable >10% regression
  against the measured packaged baseline blocks acceptance.

## Fixed-loop checklist

### A. Map and bound

- [x] Scope, entry points, owners, state, lifecycle and risks recorded.
- [x] Baseline commit recorded.
- [x] Debug and instrumented packaged numeric evidence recorded.
- [x] Named hotspot extraction completed: discrete raster commands leave
      `RasterPaintService`; document lifecycle resets leave Overlay.

### B. One complete route

- [x] Renderer/document/selection-bound stroke lifecycle complete.
- [x] Brush/Erase/Clone/Healing/Dodge/Burn/Sponge matrix complete.
- [x] Fill/Clear and raster Gradient matrix complete.
- [x] Compact/transformed raster and pixel/mask selection clipping complete.
- [x] UI/Actions/MCP share the final controllers; failure routes are covered.

### C-F. Proof and acceptance

- [x] 61 focused controller/renderer tests and 3,523 app tests passed; boundary,
      typecheck, command-contract and architecture-doc checks passed.
- [x] Independent critic completed two repair loops; final verdict has no
      P0/P1/P2 finding.
- [x] Instrumented and debug packaged Windows acceptance passed with no page
      errors. The route includes a real toolbar/viewport Brush drag plus
      semantic Fill, Gradient, Brush, Erase, tone, sampled, cancel and mask work.
- [ ] Owner acceptance and milestone commit.

## Packaged evidence

Evidence is written to `tmp/raster-paint-kernel-smoke/report.json` by
`npm run smoke:desktop:raster-paint-kernel`. On the 256 x 192 matrix the
final instrumented operation times were 11.05 ms Fill, 11.26 ms Gradient and
8.26-11.53 ms per semantic stroke. Debug measured 14.11 ms Fill, 12.84 ms
Gradient and 8.79-14.15 ms per stroke. Exact selection clipping, cancel pixel
equality, one-entry history, undo/redo and mask painting passed in both builds.
The current source-structure audit still reports pre-existing global hotspots;
S03 reduces `RasterPaintService` by 154 lines and does not raise that baseline.
