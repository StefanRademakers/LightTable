# Document and clipboard vertical slice

Status: active; S11 clipboard, document-geometry, Open/Place/Save/Export and
recovery/close sub-slices accepted on 2026-09-09.

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
- Open serializes imports through the application document route. Place uses
  one transient input artifact and one completed semantic command/history unit.
- Save and Export pin their document/renderer/revision input and require an
  exact host `committed`, `canceled` or `failed` terminal result. Cancellation
  is normal; resolved failure is never success.
- Recovery observes the canonical `DocumentSession` revision, retries bounded
  persistence failure and exposes a real flush barrier. Document switch, open,
  close and application exit cannot overtake that barrier.
- Close admission is held simultaneously by commands, document/history
  mutations and document-task creation. Confirmation and revision-bounded
  recovery deletion happen while that admission remains owned.

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

Open, Place, Save and Export use this terminal route:

```text
host/open picker -> serialized document import -> bound document session
host/place picker -> transient artifact -> layer.placeArtifact command
                  -> one completed mutation/history unit -> artifact release
save/export       -> pinned document + renderer/revision -> encode
                  -> exact host committed | canceled | failed result
```

Browser download fallback is explicitly `unreported`, because no host
durability acknowledgment exists. UI Place surfaces structured command
rejections and is excluded from Actions recording: its released transient
artifact cannot be replayed until a durable artifact-reference contract exists.

Recovery and close use this route:

```text
semantic document revision -> newest-only recovery scheduler -> durable journal
switch/open/close           -> recovery transition barrier -> flush active owner
tab/application close       -> command + session + history + task admission
                            -> pin revision/dirty -> confirm -> bounded cleanup
                            -> revalidate canonical workspace -> terminal close
```

React refs and renderer previews are adapters, not close authorities. The
document session must accept a publication before a local ref is advanced, and
new Save/Export/analysis work is refused while close admission is retained.

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
5. Centralized host export delivery. Cancel reaches task, PDF and quick-export
   callers as `AbortError`; failure remains failure instead of false completion.
6. Extracted UI Place from the standalone host shell. It is non-recordable,
   surfaces rejection, and retains the artifact if a future implementation
   unexpectedly returns asynchronous `accepted` instead of `completed`.
7. Made recovery subscribe to canonical session revisions, added bounded retry
   and flush, and serialized all document activation/open paths through one
   transition gate.
8. Added revision-bounded save/discard cleanup and exact recovered-record
   removal; cleanup failure keeps the document open and reports the cause.
9. Added retained command/session/history/task admission for tab and application
   close. Session publication now precedes local React-ref advancement.

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
- file-I/O and command regressions: 127 pass across 9 files; focused terminal
  delivery tests: 12 pass; app typecheck and boundary verification: pass;
- packaged File > Open > Place: new raster layer, one `Place Embedded` history
  entry, non-empty preview and exact undo/redo restoration: pass;
- packaged source save/reopen: PNG, JPEG, WebP and TIFF at 8-bit plus PNG/TIFF
  at 16-bit: pass; measured save completion 289-354 ms;
- packaged native bitmap export, layered source-save fallback, cold/warm OS
  open and two-page PDF open/one-page PDF export: pass.
- recovery/close regressions: 188 focused tests pass plus focused extracted-close
  coverage; full app run: 3,661 tests across 577 files pass; complete workspace
  `verify`, typecheck, web build, desktop package and boundary checks pass;
- packaged crash/restart recovery, recovered Save cleanup and identical reopen:
  pass; report under `tmp/recovery-smoke/2026-09-09T17-41-32-924Z`;
- packaged close during a 2999x2249 Save waits for the Save and closes only
  afterward: pass;
- independent architecture critic: PASS after the task-admission and
  session-first React-ref repair; no remaining concrete P0/P1/P2 in this slice.

The repository-wide source-structure audit remains red on its previously
tracked legacy hotspots. Recovery transition, tab-close and application-close
coordination live in bounded services rather than adding those authorities to
the host shell. The shell still contains route wiring and remains an explicit
S11/S12 decomposition target; the broader hotspot reductions are slice-driven
migration work, not a claim completed here.

The generic visual browser driver was unavailable with `Transport closed`.
The packaged Playwright/Electron acceptance is real UI evidence, not a claimed
manual observation.

## Remaining S11 work

1. Generated/AI result insertion through the normal cancellable command route.
