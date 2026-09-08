# Selection and marquee vertical slice

Status: **authority inventory complete; shape commit route implemented; real-app proof pending**.
Updated: 2026-09-08.

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

## Current authority map

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

## Proven divergence

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

Undo and redo prepare the recorded exact snapshot offscreen, activate it, then
publish a fresh monotonic selection revision. A failed prepare cannot change
canonical state or history. A failed shape commit also reprojects the canonical
snapshot because legacy pointer preview still temporarily uses the live mask.

Copy and Copy Merged acquire a `SelectionReadLease`, crop to the measured mask
support bounds and reject an async result if either the document or selection
revision changes. Paint captures the selection revision at stroke start and
rolls the pixel edit back if the mask changes mid-stroke. Remaining legacy
selection commits now publish measured bounds and advance the revision, so they
cannot silently poison these consumers while migration is incomplete.

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
2. **Renderer staging — implemented/unit proven:** shape and exact-snapshot
   results prepare on isolated reusable targets and return snapshot plus bounds.
   Real WebGPU/device-loss proof remains open.
3. **Document state — complete for this route:** `DocumentSession.editor` has a
   monotonic selection revision, measured bounds and a tested CAS adapter.
4. **History admission — complete for this route:** history is reserved before
   activation and appended in the same publication boundary as selection CAS.
5. **Command route — implemented:** UI pointer-up and `selection.applyShape`
   (including Action/MCP playback) use the same kernel handler.
6. **Projection — committed half complete:** committed mask and outline activate
   together. Pointer-rate draft rendering is still legacy-owned.
7. **Move/nudge:** derive every preview and final result from the opening coverage
   plus cumulative delta; never incrementally accept clipped previews.
8. **Consumers — shape route implemented:** copy and Copy Merged use measured
   lease bounds and reject stale async exports; paint captures/revalidates the
   revision and rolls back on change. Renderer-side revision assertions remain
   open for non-kernel selection sources.
9. **Undo/rebind — partial:** shape undo/redo restores the exact snapshot through
   staging with fresh revisions. Document rebind remains on the legacy restore
   path and needs a real tab-switch test.
10. **Removal gate:** delete the legacy shape/move/copy/paint selection route only
    after the complete real-WebGPU acceptance chain passes.

Steps 6, 7, the remaining part of 8, the rebind part of 9 and the real-WebGPU
removal gate remain open. Selection therefore remains mixed-owned; this is not
yet a claim that the complete marquee subsystem is stable.
