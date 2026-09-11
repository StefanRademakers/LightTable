# O03b: document/selection publication — bounded acceptance

Date: 2026-09-11. Previous accepted baseline: `5e36a503` on main.
O03b is accepted after an explicitly authorized additional repair round. This
report accompanies the milestone commit; no push was requested. This is **not
whole-app acceptance or release approval**. Earlier failed gates are retained
below as evidence, followed by the final verification.

## Accepted work before this slice

| Commit | Responsibility extracted |
| --- | --- |
| 54ea1c40 | Lazy Escape precedence |
| 1948b54a | Persistent tool activation and successor admission |
| 127d0003 | History prerequisites and layer gesture ownership |
| a0afa343 | Single temporary override state and UI projection |
| 5e36a503 | Document/processing projection and contextual presentation cache |

Checkpoint preceding cleanup: `df000cc5`. These are bounded acceptances, not
whole-app certification. Overlay is still a large file: checkpoint 9,090,
accepted HEAD 8,952, current dirty 8,843 physical lines. WebGpuEngine is 3,979
physical lines in the dirty tree; its separate decomposition has not happened.

## New binding and discovered lifetime defect

`DocumentSelectionPublicationBinding` takes surface/transform publication policy
out of Overlay. It retains one originating session, not a second selection store.

Additional packaged proof found an existing surface-history dependency on
disposable renderer resources. Resize retained selection texture exchanges and
a renderer callback; tab retirement destroyed those presentation owners. Undo
failed before entering the new canonical publisher:

1. `Selection targets are unavailable.`
2. Compensation: `Load an image before resizing its document.`

The GPU raster/mask repository is document-owned and survives facade retirement;
the selection projection is not. Keeping an obsolete renderer alive or removing
expected-state checks would violate that distinction.

## Implemented repair, reviewed in two rounds

- Both ImageResizeGpuService and DocumentGeometryGpuService explicitly transition
  to durable history: retire detached selection targets after submitted work;
  retain authored raster/mask exchanges. Selection state survives as exact masks.
- DocumentSurfaceHistoryBinding resolves and revalidates one current renderer of
  the same session for every replay, including replay without a tab switch.
- GPU device mismatch rejects before queue admission. No reconstruction fallback.
- A named history-publication admission extends active undo/redo ownership;
  ordinary publication still rejects busy history. Foreign mutation/task work
  remains blocked during the queued interval.
- Existing selection staging machinery creates correctly sized projection
  textures. Pixel, surface, mask and canonical publication happen synchronously
  after queue admission. No per-pointer GPU work was introduced.
- Critic round 1 rejected the inverse ordering. Round 2 restores pixels first,
  then surface/selection, then canonical/editor state. Injected publication
  failure at unequal dimensions now compensates in that order.
- Packaged round 2 exposed source metadata retained at pre-resize dimensions on
  rebind. bindExistingDocument now uses canonical document dimensions; the resize
  shortcut requires both metadata and current document dimensions to match.
- Final source review: PASS **conditional on the remaining packaged proof**.

Limits: history byte estimates conservatively include retired selection targets;
replay admission verifies active history state, not a per-command unforgeable
capability. Device replacement fails closed. No overall latency claim is made.

## Evidence and remaining failure

Passed on the current implementation:

- App typecheck, architecture boundary, source-structure audit.
- 27 focused tests across publication binding, surface history compensation,
  selection projection and renderer boundary. A broader focused history/session
  invocation passed 179 tests. Those numbers are not UI acceptance.
- Fresh instrumented desktop package.
- Packaged resize -> tab away/back -> undo/redo with byte-identical document
  preview pixels, without an active selection.
- Full `smoke-desktop-transform-kernel.mjs`, including transform/Exposure.
- `smoke-desktop-document-capability-equivalence.mjs`: UI/Actions/MCP parity.

Failed repeatedly in the stricter packaged layer-history test:

1. Create a solid document and a feathered ellipse (radius 6).
2. Capture selection.copyPixels (bounds and RGBA bytes).
3. Image Size, switch to another document, return, undo.
4. Image pixels restore, but clipboard bounds differ:
   before `(74,54,292,202)`; after undo `(67,47,306,216)`.

Source cause confirmed by critic: publishSurface derives support bounds from
`selectionOperationsSupportBounds` (a provenance/feather heuristic). Kernel
selection publication uses exact mask coverage. Provenance is not coverage
authority. The snapshot already caches exact bounds.

At the blocked gate, `tmp/layer-history-gesture/report.json` recorded status
failed and `failure.png` captured it. Geometry assertions were not reached in
that run. These generated artifacts are overwritten by later runs; final
passing reports now cover the geometry assertions too. The harness records
running/failed/passed explicitly instead of retaining stale passing reports.

## Additional round explicitly authorized by the owner

- [x] Replace surface provenance-derived support with
  `coverage.measureSupportBounds()`, already used in transform publication.
  This is cached O(1); no CPU mask scan or GPU readback is needed.
- [x] Preserve active=true/supportBounds=null for entirely clipped selections.
- [x] Test the actual canonical mask/clipboard contract, not just the rectangle
  provenance or new binding's own computed expectation.
- [x] Run feathered and painted selection -> resize/geometry -> tab away/back ->
  undo/redo. Compare document pixels, clipboard bounds AND clipboard content.
- [x] Re-run independent critic; source PASS. Packaged proof below.
- [x] Update checklist/size ceiling; this report accompanies the milestone commit.

Two rounds initially blocked acceptance. The owner then explicitly requested
another round ("doe dan nog maar een ronde en maak het af"). The exact-bounds
correction was made under that authorization, not a silent third loop.

Final targeted evidence:

- Feathered ellipse: complete resize AND clockwise rotation -> document switch
  -> undo/redo; document preview bytes and selection clipboard bounds/bytes equal.
  `tmp/layer-history-gesture/report.json`.
- Painted extension of the feathered mask: the same full chain passed three
  fresh-profile runs. `tmp/layer-history-gesture-painted/report.json`.
- 205 tests / 32 files in the final focused history/session/publication/renderer
  invocation; this includes sharded history/session tests, not a full suite.
- Critic approved cached exact support, canonical/editor agreement and active
  clipped selections; no GPU readback or per-sample work added.
- Fresh final package also passed selection-kernel, transform/Exposure and
  UI/Actions/MCP document capability equivalence. Final painted screenshot was
  inspected: rotated document, ellipse and painted extension remain visible.
  App typecheck, boundary and ratcheted source-structure audit passed.

**Unresolved separate observation:** the first painted-run attempt failed before
selection setup, on preview acquisition after three Opacity drags. The original
assertion reported only a missing artifact; there were no page errors. Subsequent
three runs passed. Diagnostic assertions now retain the full preview request /
artifact response and there is no retry inside the harness. Root cause is not
established; retain as an O08 preview-read/repeated-flow risk, not a fixed issue.

## Remaining overall cleanup

- [x] Finish O03b acceptance above.
- [ ] O03c document open/rebind/retire/disposal orchestration.
- [ ] O02c host/target transitions and save/export prerequisites.
- [ ] O01 broader baseline/ref relocation acceptance.
- [ ] O04 geometry command extraction, processing gestures and asset lifetimes.
- [ ] O05 tool-domain glue: text, vector/path/shape, transform/snapping, warp,
  selection/paint/gradient/masks/background removal.
- [ ] O06 layer/clipboard/command/automation composition.
- [ ] O07 bounded UI/host composition.
- [ ] O08 cross-domain user-flow proof, final documentation and structure audit.
- [ ] O09 separately scoped WebGpuEngine decomposition.

User-owned `work/recovered/` remains untouched and outside Git.
