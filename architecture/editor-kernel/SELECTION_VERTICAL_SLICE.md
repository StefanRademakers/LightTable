# Selection and marquee vertical slice

Status: **kernel route implemented; packaged proof and independent architecture review passed; owner visual acceptance pending**.
Updated: 2026-09-08.

Implementation baseline for the completion pass: `5152b53b`.

## Completion-pass owner and flow map

This map records the production owners at the start of the remaining-slice
work. It is intentionally narrower than the historical inventory above and is
the review baseline for removing mixed ownership.

| Flow | Intent/input owner | Commit owner at `5152b53b` | Projection/resource owner | Known boundary |
| --- | --- | --- | --- | --- |
| rectangle/ellipse/free/polygon | `SelectionGestureController` and `PolygonalSelectionGestureController` | `SelectionShapeCommandService` -> `SelectionMutationCoordinator` | `SelectionShapeProjectionService` with committed/spare `SelectionTextureStore` targets | kernel-owned after pointer-up; draft remains presentation-only legacy state |
| replace/add/subtract/intersect | semantic `selection.applyShape` command or the same UI gesture result | same shape command service | staged mask, measured bounds and exact snapshot activate together | UI, Actions and MCP already converge on `selection.applyShape` |
| pointer move of marquee | `useSelectionSessionController` translation gesture | `SelectionShapeCommandService.executeTranslation` | semantic direct-shape preview or mask-contour shader offset; staged final mask | final coverage derives from opening lineage plus cumulative displacement |
| keyboard nudge | keymap -> `nudgeSelectionMask` -> controller `translate` | same kernel translation command | staged exact translation | serialized through the same transaction/history admission as drag |
| selection paint | controller-owned stroke sampling | `SelectionShapeCommandService.executePaint` | renderer-bound preview lease restores the baseline, releases ownership, then final dabs stage on spare targets | store mutation primitives reject competing activation/history/rebind/geometry work while preview owns the mask; terminal rollback transfers exclusively to the kernel |
| paint through selection | `usePaintSessionController` | pixel-edit transaction | `RasterPaintService` reads the committed mask | stroke captures and revalidates the document selection revision |
| copy / Copy Merged | layer document command gateway | read-only clipboard task | `SelectionClipboardService` reads the mask | lease uses measured committed bounds and rejects stale completion |
| undo/redo of shape | document history | `SelectionShapeCommandService.restore` | staged exact-snapshot activation | kernel-owned for shape entries only |
| undo/redo of move/paint | document history | kernel selection history reservation | staged exact-snapshot activation | fresh monotonic revision; projection/state rollback together |
| document rebind/tab switch | document lifecycle in `LightTableEditorOverlay` | read-only `projectCurrent` | staged exact-snapshot activation | rejects stale completion without authoring history or revision |

The completion pass must remove commit authority for move/nudge, selection
paint and exact rebind from the controller/React lifecycle. Gesture sampling
may remain in the controller, but its terminal intent must enter one
document-addressed application command service. Pointer preview must be
replaceable and cancellable and may not publish a committed selection revision.

## User-visible acceptance chain

```text
open PNG
-> draw rectangle/ellipse marquee with replace/add/subtract/intersect
-> move and nudge it across every document edge and back
-> paint through it
-> copy active layer and Copy Merged
-> paste
-> undo/redo each committed step
-> switch document and return
-> save/close/reopen without selection state corrupting document content
```

At every point the visible contour, reported bounds, effective paint mask,
clipboard crop and undo state must refer to the same committed selection
revision. Temporary viewport clipping may not shrink that committed value.

## Baseline authority map at `5152b53b`

| Concern | Current owner/path | Current truth used |
| --- | --- | --- |
| document selection state | `DocumentSession.editor`, via `useDocumentEditorSession` | operation list plus `SelectionMaskSnapshot` |
| pointer gesture | `useViewportInteractionController` -> `useSelectionSessionController` | mutable gesture/controller fields |
| GPU coverage | `SelectionTextureStore.mask`, mutated by `SelectionRasterizer` | mutable document-sized `r16float` texture |
| exact restore | `SelectionMaskSnapshot` captured from GPU and stored in editor state/history closures | full mask bytes |
| committed outline | `useRendererPresentationSync` -> `WebGpuEngine` | direct semantic shape when possible, otherwise live GPU mask |
| copy bounds | `useLayerDocumentCommands.clipboardBounds` | `selectionOperationsSupportBounds(operations)` |
| copied pixels | `SelectionClipboardService` | live GPU mask texture |
| paint clipping | `RasterPaintService` | live GPU mask texture, read directly during dabs |
| selection history | `useSelectionSessionController.pushHistory` -> `DocumentCommandHistory` | closures over before/after operations and snapshots |
| Action/MCP | command service -> overlay command port -> selection controller | active presentation controller |

## Proven baseline divergence

The current system does not have one committed selection value:

1. Operations drive direct outlines and clipboard bounds.
2. The live GPU mask drives paint and copied alpha.
3. A separate immutable snapshot drives document rebind and undo/redo.

`commitMutation` first changes the live renderer, then reads it back, then
records history, then publishes operations/snapshot through a React adapter.
Those steps have separate failure and observation points. History recording and
session publication are not one atomic commit.

Selection translation makes the mismatch observable. Pointer previews mutate
the fixed-size GPU mask incrementally and can clip it at an edge. The controller
also publishes an unclipped semantic transform. Although pointer-up now restores
the opening mask before applying the final delta, copy still calculates its crop
from operations while paint and clipboard alpha read the renderer texture. Any
stale/failed publication therefore yields a large contour/bounds paired with a
smaller effective mask—the exact reported defect.

Additional risks:

- currentness checks compare image ID and renderer identity, not a selection
  revision;
- overlay synchronization waits for a React effect and visibility depends on
  a non-empty operation list even when a mask exists;
- direct-shape outline and mask-contour rendering are two selection presentation
  paths with different inputs;
- paint captures no selection revision at stroke start and reads the mutable mask
  for every GPU submission;
- undo restores the GPU projection before publishing document editor state; a
  publication failure can leave history and projection disagreeing;
- `useSelectionSessionController` is 1,583 lines and owns input gestures,
  snapping, renderer mutation, serialization, history and Action observation.

## Target committed value

The kernel introduces one `CommittedSelectionState` containing:

- document session ID and monotonic selection revision;
- canvas dimensions;
- exact coverage artifact;
- measured effective in-canvas support bounds from that coverage;
- optional semantic provenance, which is never coverage authority.

Overlay, crop, copy, paint and history consume this value or a read lease for
its exact revision. No consumer receives only operations or reaches directly
for a mutable renderer texture.

## Implemented kernel route

Rectangle, ellipse, free and polygon shape commits now share this route for UI
pointer-up and `selection.applyShape` from Actions/MCP:

```text
semantic shape intent
-> kernel reads DocumentSession selection revision
-> renderer prepares mask + exact snapshot + measured bounds on spare targets
-> history admission becomes exclusive
-> renderer atomically activates mask and committed outline
-> DocumentSession CAS and history append publish inside one notification boundary
-> activation is accepted, or renderer/state/history roll back together
```

The renderer retains one dimension-matched spare target set. After the first
commit, later shape commits exchange the committed/spare sets rather than
allocating three document-sized textures per gesture. A dimension change
destroys the incompatible spare. This preserves the required double buffer
without adding pointer-rate allocation churn.

Move and nudge commits use the same route. Hit-testing samples the exact mask
without decoding a document-sized copy, snapping starts from its measured
support bounds, and the committed contour always reads the mask rather than
semantic provenance. A translated snapshot retains its
opening coverage and cumulative displacement, so moving outside the fixed-size
canvas mask and back cannot accept clipped texels as the new source. Pointer
movement does not mutate canonical state or allocate full-size targets: preview
shapes may move semantically and compound masks move by an inverse sampling
offset in the contour shader.

Selection paint may mutate the live mask only as a reversible pointer preview.
While that preview owns the texture, clipboard, raster paint/fill/invert and
selection-based transform consumers fail closed instead of observing temporary
coverage under the unchanged committed revision.
The preview lock is a token-owned lease bound to the concrete
`LayerDocumentRenderer` and its `SelectionTextureStore`; release never resolves
through the engine's current renderer. A late release from a switched document
therefore cannot unlock a newer preview. Preview capture, measurement, paint and
baseline restore run through that lease, while normal renderer façade selection
reads and writers cross the committed-access admission guard.
Pointer-up restores the exact baseline and stages the complete dab list through
the kernel route. Undo and redo preserve translation lineage while preparing
the recorded exact snapshot offscreen, activate it, then publish a fresh
monotonic selection revision. A failed prepare cannot change canonical state or
history. Terminal activation acceptance is a non-throwing cleanup contract, so
cleanup cannot retroactively split already-published state and history.

Copy and Copy Merged acquire a `SelectionReadLease`, crop to the measured mask
support bounds and reject an async result if either the document or selection
revision changes. Paint captures the selection revision at stroke start and
rolls the pixel edit back if the mask changes mid-stroke. Remaining legacy
selection modifiers outside this first acceptance slice still publish measured
bounds and advance the revision, so they cannot silently poison these consumers
while migration is incomplete.

## Required renderer adapter

The first kernel route cannot safely wrap the current in-place mutation API.
The renderer must be able to prepare a result on transaction-owned selection
targets, measure its bounds and capture its snapshot without replacing the
committed targets. Activation swaps the prepared target set into presentation
and returns a rollback handle. Only after canonical state and history accept the
same result is that activation retained.

This is implemented through `SelectionTextureStore.exchangeState`, below the
semantic transaction boundary; React and the tool controller never call that
primitive directly.

## Migration sequence

1. **Contracts — complete:** committed selection value, read lease, prepared
   projection and reversible activation exist in `@lighttable/editor-kernel`.
2. **Renderer staging — implemented/unit and packaged proven:** shape,
   translation, selection-paint and exact-snapshot results prepare on isolated
   reusable targets and return snapshot plus bounds. Store allocation, swaps,
   exchange, detach and attach enforce preview ownership at the resource
   boundary; transform commit/history uses the same admission. Device-loss
   injection for a selection transaction remains outside this slice.
3. **Document state — complete for this route:** `DocumentSession.editor` has a
   monotonic selection revision, measured bounds and a tested CAS adapter.
4. **History admission — complete for this route:** history is reserved before
   activation and appended in the same publication boundary as selection CAS.
5. **Command route — implemented:** UI pointer-up and `selection.applyShape`
   (including Action/MCP playback) use the same kernel handler.
6. **Projection — complete for the slice:** committed mask and outline activate
   together; draft and translation previews are renderer-only and replaceable.
7. **Move/nudge — complete for the slice:** previews and final results derive
   from opening coverage plus cumulative delta and never accept clipped previews.
8. **Consumers — complete for the slice:** copy and Copy Merged use measured
   lease bounds and reject stale async exports; paint captures/revalidates the
   revision and rolls back on change.
9. **Undo/rebind — complete for the slice:** shape/move/paint undo and redo use
   staged exact snapshots. Rebind uses read-only `projectCurrent` and rejects a
   stale renderer; the packaged smoke switches away and back before exact copy.
10. **Removal gate:** delete the legacy shape/move/copy/paint selection route only
    after owner visual/interaction acceptance, not merely automated acceptance.

## Packaged acceptance evidence

- `smoke:desktop:selection-dimensions`: rectangle, ellipse, free and polygon UI
  paths, including committed geometric coverage and current controls. It also
  exercises the registered horizontal and vertical strip tools through the
  real toolbar, proves configured thickness and full document span from exact
  copied mask bounds, and verifies one history entry plus undo/redo restoring
  the same committed bounds.
- `smoke:desktop:selection-zoom-drag`: zoomed pointer translation without a
  runtime/GPU error.
- `smoke:desktop:selection-kernel`: all four edge excursions and return with
  byte-identical copied pixels, clipped-translation undo/redo/return, nudge,
  raster paint spanning every selected column (3,840 changed pixels, none
  outside), drag from paint-only coverage, selection paint, exact Copy bounds
  and two-document rebind.
- `smoke:desktop:pixel-clipboard`: exact UI/Actions/MCP Copy, Copy Merged and
  Paste render equivalence after undo.

Resource-boundary admission now prevents Action/MCP shape commits, undo/redo,
rebind, geometry/resize activation and transform-history swaps from replacing
the store during selection-paint preview. After exact baseline restore the
controller releases the lease and transfers rollback ownership to the kernel;
a losing paint CAS cannot republish its stale gesture baseline. Independent
review found no remaining P0/P1 in this slice. The remaining gate is a manual
owner run for contour quality and pointer feel.
Legacy fallbacks for embedded/no-session hosts and out-of-slice modifiers remain
present. Passing this slice is evidence that the architecture can work; it is
not a stability claim for transform, text, effects or other editor domains.

## Deferred non-blocking follow-ups

- `SelectionMaskSnapshot.contains()` is exact but RLE lookup is currently
  linear in row runs; profile large fragmented masks before choosing an index.
- Best-effort non-throwing activation cleanup should gain diagnostic telemetry
  without reopening the atomic commit boundary.
- History byte estimates can count shared translation-lineage storage more than
  once; make accounting graph-aware when history memory budgeting is enforced.
