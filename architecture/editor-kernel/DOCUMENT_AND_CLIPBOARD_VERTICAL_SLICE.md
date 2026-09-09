# Document and clipboard vertical slice

Status: active; S11 clipboard and document-geometry sub-slices accepted on
2026-09-09.

## Contract

- Clipboard bytes and host probing are I/O, never canonical document state.
- New-document form state is one short-lived dialog session. React may own it;
  it must not publish history, renderer state or a persistent clipboard cache.
- A clipboard dimension probe may populate untouched width/height fields. It
  may never overwrite user edits and Create may not commit provisional defaults.
- Closing/unmounting the dialog invalidates the pending probe. A late result
  cannot reopen a dialog or mutate another invocation.
- Copy and Copy Merged read one committed selection lease. Paste binds async
  work to the initiating document and publishes one recoverable transaction.
- Image Size, Canvas Size, Crop and document Rotate publish the new document,
  exact selection and GPU exchange as one compound operation. No observer may
  see new dimensions with an old document-sized mask, or the reverse.
- Document-space raster masks on every layer-tree node are projected once;
  only root layer transforms receive the document mapping. Selection active
  state is semantic and survives coverage moving fully outside the canvas.
- A document-size change invalidates renderer-internal clipboard textures.
  OS clipboard payloads remain host-owned and Paste still enters through its
  normal command transaction.

## Implemented route

```text
Ctrl+N / File > New
  -> open NewDocumentDialog immediately
  -> LightTableImageClipboard.readDimensions()
  -> desktop preload IPC
  -> encoded PNG/WebP/GIF header, then Windows DIB header
  -> Electron nativeImage fallback only when no supported payload succeeds
  -> populate width/height if that field is still untouched
  -> one document.create command
```

Encoded formats are de-duplicated and ordered before DIB because Electron's
`readBuffer()` materializes the selected payload even though LightTable only
parses its header. Per-format provider failures are isolated. This avoids a
full image decode on the normal Windows path but deliberately retains a
compatibility fallback for clipboard providers exposing only a native bitmap.

Copy, Copy Merged and Paste remain on the already accepted selection-kernel
route documented in `SELECTION_VERTICAL_SLICE.md`. This sub-slice did not add a
second clipboard or history owner.

Document geometry now uses this route:

```text
UI or document.applyGeometry / document.setImageSize
  -> immutable geometry/resize plan and projected ImageDocument
  -> one renderer GPU exchange for layer pixels, every raster mask and all
     selection targets
  -> one DocumentSession publication containing document + editor selection
  -> one history entry retaining exact before/after snapshots and GPU owners
  -> undo/redo exchanges runtime, surface dimensions and canonical state
```

`DocumentSession.updateDocumentAndEditorIf` is the compound publication
boundary. Its compare-and-swap predicate binds both the exact originating
document object and selection revision. GPU work stays in the geometry/resize
services; React only invokes the route and mirrors its low-frequency result.

## Critic repairs

1. Added per-format isolation, encoded-before-DIB ordering, case-insensitive
   de-duplication and shared encoded signature/dimension parsing.
2. Removed the parent/dialog dual preflight and persistent dimension snapshot.
   The dialog is now the sole cancellable owner; submit itself rejects pending
   dimensions and manual width/height edits win over late results.
3. Exchanged all selection targets, including their semantic active flag, for
   active and inactive selections; projected nested masks and image-resize
   masks; and cleared document-sized internal clipboard textures on resize.
4. Kept fully off-canvas selection coverage active instead of inferring
   selection semantics from a zero-filled readback. GPU history accounting now
   counts only mask/result/shape textures, not the active boolean.

No P0 remains. The second critic's stale-launcher P1 and late-parent-popup P2
were eliminated by removing the parent preflight. A DIB-only provider can still
make Electron copy a large DIB before its header is parsed; the packaged
acceptance records the common encoded Windows path and this fallback must stay
in later performance/soak coverage.

## Evidence

- desktop/app TypeScript checks: pass;
- desktop dimension/encoded tests: 10 pass;
- selection clipboard and command tests: 108 pass;
- boundary verification: pass;
- instrumented packaged desktop: pass;
- packaged Copy/Copy Merged/Paste equivalence: pass;
- packaged Ctrl+N clipboard image dimensions and created canvas: pass, 59.7 ms
  on the current machine; report:
  `tmp/new-document-clipboard/report.json`.
- focused document/selection/renderer tests: 384 pass across 59 files;
- instrumented desktop package and telemetry boundary: pass;
- packaged Canvas Size, orthogonal/arbitrary Rotate, interactive/selection
  Crop, fixed layer transform and their undo/redo matrix: pass; report:
  `tmp/document-geometry-smoke/report.json`;
- packaged 1584x935 -> 792x468 Image Size through UI, Action-equivalent command
  and undo: pass; report: `tmp/image-size-smoke/1/image-size.json`.

The repository-wide source-structure audit remains red on its eight previously
tracked legacy hotspots. This slice adds no net lines to
`LightTableEditorOverlay.tsx`; compound canonical publication lives in
`DocumentSession`/`DocumentSelectionStateStore`, while renderer exchange policy
stays in the two bounded GPU services. The broader hotspot reductions remain
slice-driven migration work, not a claim completed here.

The generic visual browser driver was unavailable with `Transport closed`.
The packaged Playwright/Electron acceptance is real UI evidence, not a claimed
manual observation.

## Remaining S11 work

1. Open/Place and save/export format semantics.
2. Autosave/recovery, decode/export failure and unsaved close.
3. Generated/AI result insertion through the normal cancellable command route.
