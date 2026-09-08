# Layer finalization vertical slice

Status: **kernel route implemented; packaged proof and independent architecture
review passed; owner interaction acceptance pending**.

Baseline: `f4099033` (`feat(selection): migrate object selection to kernel`).

## Owned route

```text
Layers UI / Ctrl+E / Action / MCP
  -> semantic capability and eligibility dispatcher
  -> document mutation transaction
  -> fresh full-canvas raster reservation
  -> one renderer composite/copy submission
  -> atomic document + history publication
  -> source/destination runtime retention for undo/redo
```

React selects and presents the command. `useLayerDocumentCommands` coordinates
the application transaction. Pure document commands define the replacement and
eligibility. `RasterDocumentOperations` owns GPU submission and pending versus
submitted cleanup. No entry point has a direct finalization fallback.

## Behavioral contract

- Rasterize uses a fresh raster ID for text, vector/live shape, gradient,
  processed/styled/masked/transformed raster, pixel-generating adjustment and
  supported group content. A plain raster is already final and produces no
  history entry.
- Overall visibility, opacity, blend and clipping remain outer stack
  relationships; intrinsic content, fill opacity, mask, processing and styles
  are baked once.
- Merge accepts at least two contiguous siblings and preserves document order.
  `Ctrl/Cmd+E` resolves the synchronously selected layer row, including when its
  read-only name field retains focus.
- Flatten Group bakes intrinsic group content while retaining its outer stack
  relationship. Flatten Image includes document processing in final order and
  resets the live global processing state only after successful publication.
- Every command either publishes one replacement plus one history entry or
  restores the exact opening document and releases the uncommitted destination.
  Undo retains recursive group runtimes, masks and derived previews.

## Explicit fail-closed cases

An isolated subtree cannot reproduce a result that reads an unselected lower
backdrop. Merge therefore rejects a selected adjustment, non-normal blend,
pass-through group or incomplete clipping chain when a lower backdrop is
reachable, including through pass-through ancestors. Flatten Group applies the
same ancestor rule. The shared eligibility result supplies the same explanatory
message to local UI, Actions and MCP.

Correction adjustment layers use Merge Down; only pixel-generating adjustment
layers rasterize independently. This is a deliberate correctness boundary, not
a missing silent fallback.

## Evidence

- Independent critic pass 1 found backdrop isolation, recursive runtime
  retention and byte-accounting defects.
- Repair pass 1 added fail-closed planning, recursive IDs and conservative
  resource accounting. Critic pass 2 found upper-layer/ancestor backdrop cases
  and inconsistent denial messages.
- Repair pass 2 closed those cases. Final critic verdict: no evidence-backed
  P0, P1 or P2 remains.
- Focused TypeScript and 249 keyboard/command/finalization tests passed; the
  finalization subset passed 166/166 after the second repair.
- `package:desktop:verify` passed for the instrumented packaged artifact.
- `scripts/smoke-desktop-layer-merge-matrix.mjs` exercises context-menu
  rasterize, Layer-menu Flatten Image, `Ctrl+E`, Merge Selected and undo on
  `shapes.psd` and `TextTest.psd`. Pixel RMSE is 0.00–0.03 against the opening
  presentation; report and screenshots are under `tmp/layer-merge-matrix/`.
  The final instrumented packaged run measured rasterize at 495–773 ms,
  flatten at 376–775 ms, Merge Down at 277–612 ms and three-layer merge at
  501–812 ms. Maximum pixel RMSE was 0.03.

The broader route-equivalence harness now reaches the next independent vector
creation failure before its final Action/MCP comparison. S01 command-service
tests prove record/replay and the common semantic dispatcher; the harness failure
is carried into S05 rather than misreported as a finalization failure.

## Structural effect and remaining gate

The same-ID text rasterizer and renderer/WebGPU façade methods were removed.
`useLayerDocumentCommands.ts` lost the duplicate text transaction but remains a
legacy hotspot at roughly 2,000 lines because masks, clipboard and document
operations still live there. Those responsibilities leave only with S02 and
S11; mechanical splitting is not accepted as migration.

The remaining S01 gate is owner interaction/performance acceptance. Do not add
a legacy fallback while waiting for that check.
