# Raster resource projection boundary — 11 September 2026

## Scope

Follow-up to the repaired paint/recovery race: ordinary document projection
must not destroy authored raster pixels because metadata dimensions differ.
This is one resource invariant, not another kernel migration or a claim of
whole-editor stability. Existing dirty work from Tasks 414/415 is preserved.

## Implementation

- Removed metadata-driven color texture destruction/reallocation from
  `LayerRuntimeStore.sync`.
- Validate all existing rasters before any sync allocation or mask change.
  The recursive scan does not build flattened paths/ancestor arrays and does
  no GPU work. New raster IDs still allocate normally.
- `ensureRaster` cannot reuse a retained same-ID raster as an incompatible
  destination.
- Engine document projection, surface resize and export synchronization reject
  incompatible surfaces before changing their document or derived resources.
  Direct renderer sync/initialization also preflight. Named-session lookup does
  not rebind or inspect a different active session by accident.
- Explicit transform/paint promotion uses the existing pixel exchange owner;
  Image Size uses the existing complete-runtime exchange owner. Their retained
  surfaces and undo/redo remain the only way to change existing raster sizes.
  No replacement copy/resample, fallback, silent mismatch tolerance or GPU
  readback/wait was added.

## Inventory

| Flow | Existing transfer retained |
| --- | --- |
| Transform; compact/transformed raster paint preparation | `TransformRasterizer`, `exchangeRasterPixels`, inverse surfaces retained for history |
| Image Size | `ImageResizeGpuService`, atomic complete-runtime exchange |
| Crop / canvas / document rotate | document-space mask/selection exchange; raster source dimensions do not change |
| Paste / import / raster finalization | allocate genuinely new raster IDs; hydrate/prepare via existing operation |
| Undo/redo and document rebind | retained resources; matching metadata follows explicit inverse/forward exchange |

## Evidence

- Two new regressions failed before implementation: metadata-only resize and
  a delayed pre-edit projection replacing an explicitly promoted surface.
- Focused store/exchange/publication/paint/transform/geometry tests pass,
  including nested late mismatch preserving earlier masks, no partial new
  allocation, named-session checks and engine rejection before publication.
- Application typecheck, boundary audit, source-structure audit and fresh
  instrumented desktop package pass.
- Independent read-only architecture critic accepted the implementation after
  the scan-allocation improvement and nested/ensureRaster coverage. No blocking
  finding remains in this scope.
- Packaged paint-first: three real pointer strokes on pasted 700×600 content,
  while recovery is due; 420,000 visible pixels retained in every cycle, actual
  paint changes verified, exact undo/redo and successful recovery publication.
  No loading state. Evidence:
  `tmp/pasted-paint-smoke/resource-boundary-paint-first-report.json`.
  Whole-run rAF p95 16.74 ms, max 33.41 ms; live export snapshots return to zero.
  These are frame intervals, not a direct pointer-to-pixel latency benchmark.

## Packaged acceptance

- [x] Recovery-first packaged overlap: three cycles, actual paint changes,
      preserved pixels, exact undo/redo, committed checkpoints, snapshots freed.
      `tmp/pasted-paint-smoke/resource-boundary-recovery-first-report.json`.
- [x] Free-selection rotation directly into Exposure, normal and deliberately
      delayed readback: actual pixels and exact selection-copy undo/redo pass.
      `tmp/transform-kernel-smoke/resource-boundary-free-rotate-normal.json`
      and `resource-boundary-free-rotate-slow.json`.
- [x] Image Size and history through the packaged UI/semantic route, including
      immediate keyboard undo. `tmp/image-size-smoke/2k_00002_checkpoint_141344/image-size.json`.
- [x] Existing packaged raster-paint matrix: brush, erase, tone/sample operators,
      fill, gradient, selection clipping, mask paint and history.
      `tmp/raster-paint-kernel-smoke/report.json`.

The first transform attempt correctly failed its **pre-transform** nonempty
paste assertion: the layered recovery fixture opened with a sparse Grade raster
active. The harness now supports an explicit source-layer name; selecting the
actual Background layer fixes the fixture setup without weakening assertions.
Both passing transform variants used that layer. The recovered fixture's other
content was left intact; this test does not validate that old content's appearance.

## Deliberately not claimed

The invariant checks surface dimensions, not every same-size content revision
or preview identity. Mask/derived-preview lifetime and general interaction
handoff consolidation are not redesigned here. A truly invalid projection now
reports the missing transfer without erasing pixels; callers must still obey
the transaction contract. Broad product acceptance and large-document
performance remain separate. No commit or push requested for this follow-up.
