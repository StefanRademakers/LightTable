# Document and clipboard vertical slice

Status: active; S11 first sub-slice accepted on 2026-09-09.

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

## Critic repairs

1. Added per-format isolation, encoded-before-DIB ordering, case-insensitive
   de-duplication and shared encoded signature/dimension parsing.
2. Removed the parent/dialog dual preflight and persistent dimension snapshot.
   The dialog is now the sole cancellable owner; submit itself rejects pending
   dimensions and manual width/height edits win over late results.

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

The generic visual browser driver was unavailable with `Transport closed`.
The packaged Playwright/Electron acceptance is real UI evidence, not a claimed
manual observation.

## Remaining S11 work

1. Image resize, canvas size, crop and rotate across layers, masks, selection,
   history and renderer resources.
2. Open/Place and save/export format semantics.
3. Autosave/recovery, decode/export failure and unsaved close.
4. Generated/AI result insertion through the normal cancellable command route.
