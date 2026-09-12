# Mask and background-removal vertical slice

Status: **owner acceptance**. Baseline: `f94192c2`.

This note bounds S02. It covers raster layer-mask creation, deletion, enable,
disable, link state, inversion, destructive application, loading a mask as a
selection, mask painting admission, and Remove Background result publication.
It does not redesign brush algorithms (S03), transform masks (S04), or the
background-removal model.

## Artist-visible flows

- Add a reveal-all mask or create one from the committed selection.
- Select the pixel or mask thumbnail, link/unlink, enable/disable, invert,
  delete, and destructively apply the mask.
- Ctrl/Cmd-click the mask thumbnail to load its coverage as the selection.
- Paint or paste into the active mask with the same cancellation and history
  guarantees as pixel painting.
- Run Remove Background in replace, intersect, or new-layer mode; cancel it;
  undo and redo the published result; switch documents while inference runs.
- Reach the same mutation through UI, Actions, and MCP semantic commands.

Unsupported in this slice: vector masks, applying a raster mask to text/vector/
group nodes, and applying a mask to a non-renderable document-FX node. Raster
Apply Mask deliberately preserves the stable layer identity and unrelated live
style/adjustment semantics. A non-raster Apply Mask requires S01's separate
fresh-destination finalization lifecycle; the menu is disabled and semantic
UI/Action/MCP execution fails closed before allocating GPU work until that route
is integrated without reintroducing two owners.

## Historical ownership map at S02 baseline

This table records the starting defects, not supported extension paths. The
kernel cut-over removed direct panel mutation fallbacks; current callers use
the registered mask route. Follow the cut-over ledger and Task416 for current
implementation evidence and remaining owner decomposition.

| Concern | Baseline owner(s) | S02 target |
| --- | --- | --- |
| UI input | `LayerPanel`, editor menus, `BackgroundRemovalDialog` | input adaptation only |
| semantic routing | `LightTableCommandService`, overlay command ports, plus direct panel fallbacks | one registered semantic route |
| document mask metadata | `documentCommands`, `useLayerPanelController`, `useLayerDocumentCommands`, inactive session ports | `documentCommands` algorithm behind one mask command service |
| mask GPU pixels | `LayerDocumentRenderer` / `SelectionRasterizer` | renderer projection port only |
| pixel undo | `pixelMutationTransaction` called ad hoc by layer commands | one mask transaction lifecycle |
| mask-as-selection | selection controller + renderer | selection kernel transaction consuming an exact mask source |
| mask painting | paint controller/raster paint runtime | shared raster-session lifecycle with a committed selection lease |
| background task | React controller, command task, document task registry and model each hold cancellation/generation state | one document-bound task generation; React presents only |
| result insertion | `executeBackgroundRemovalOperation` callback into `useLayerDocumentCommands` | same mask semantic command used by all callers |

## Proven failure risks at baseline

1. Panel mask changes still have direct mutation fallbacks, so UI and
   Action/MCP do not have one owner.
2. `layer.setMask` covers only add/remove/enabled/linked. Invert, apply, and
   load-as-selection are separate routes.
3. Remove Background uses the generic `automation` task kind with
   `replace: false`, while the React controller and model also supersede work.
   Multiple independently tracked task IDs and generations can disagree.
4. The React task-id ref is assigned asynchronously and cleared by any
   completion, so an older completion can erase the newer cancellation target.
5. Background result admission checks document revision before calling the
   mask mutation, but renderer identity and task-currentness are not part of
   one terminal publication boundary.
6. Mask metadata-only changes can be executed by inactive document ports while
   pixel-bearing add/remove histories depend on a mounted renderer. Capability
   and history behavior therefore vary by route.

## Canonical and transient values

- Canonical: layer mask metadata in the serializable document plus its exact
  document-owned mask texture revision.
- Canonical selection: the selection kernel's committed coverage snapshot.
- Transient: open pixel edit, generated inference mask, task progress,
  selection read lease, prepared raster destination, and renderer binding.
- No generated mask bytes, task ID, progress state, or GPU handle enters the
  document model.

## Required lifecycle

```text
validate semantic command and capability
  -> acquire exact document/renderer/selection admission
  -> begin document transaction
  -> prepare metadata/resource target
  -> begin + finish reversible GPU edit
  -> atomically publish document + history
  -> transfer edit/resource ownership to history
```

Cancel, failure, supersession, document close/switch, and unmount terminate the
task or transaction exactly once. A stale generated result cannot call the
publication port. Undo/redo must restore metadata before addressing a recreated
mask target and must compensate partial GPU failure.

## Invariants and performance budget

- One supported user command creates exactly one history entry; no-op/cancel
  creates none.
- No UI fallback mutates mask state after registered-command admission.
- Mask pixels, metadata revision, thumbnail, renderer composite, paint target,
  and history describe the same generation after every terminal path.
- At most one Remove Background task for a document is current; other
  automation work is not canceled.
- Inference may be slow, but terminal mask upload/publication performs one
  full-mask upload and one reversible capture, with no readback.
- Add/toggle/link/delete should publish in one frame. Mask load-as-selection
  and inversion must stay within the existing selection/pixel GPU budgets.
- A repeatable packaged regression above 10% relative to this slice's measured
  baseline blocks acceptance.

## Responsibility extraction

`useLayerDocumentCommands.ts` loses mask creation, mask pixel mutation and
background-result insertion. `useLayerPanelController.ts` loses canonical mask
mutation. `useBackgroundRemovalController.ts` becomes dialog/input state only;
document task generation owns execution and cancellation.

## Fixed-loop checklist

### A. Map and bound

- [x] Flows, unsupported cases, baseline, owners and failure risks recorded.
- [x] Canonical/transient values and terminal invariants defined.
- [x] Debug and packaged numeric baseline recorded.

### B. One complete route

- [x] Kernel task/mutation contract amended.
- [x] All supported entry points use one semantic handler.
- [x] Commit/cancel/undo/redo/failure/rebind/resource lifecycle implemented.
- [x] Focused lifecycle, generation, failure and equivalence tests added.

### C-F. Proof and acceptance

- [x] Focused checks and source audit.
- [x] Independent critic and two repair loops; final gate has no P0/P1/P2.
- [x] Packaged Windows acceptance and performance evidence.
- [x] Documentation, onboarding and migration ledger updated.
- [ ] Owner acceptance and remaining S03 paint fallback removal.

## S02 acceptance evidence

- Full `@lighttable/app`: 550 files / 3511 tests passed; editor kernel: 3
  files / 12 tests passed. App/workspace typechecks, command-contract checks,
  boundary verification, architecture-doc audit and web build passed.
- The source-structure audit still reports the recorded legacy hotspots. S02
  reduced its two touched hotspots relative to `f94192c2`:
  `LightTableEditorOverlay.tsx` 9153 -> 9147 lines and
  `useLayerDocumentCommands.ts` 1970 -> 1804 lines. Semantic mask dispatch now
  belongs to `executeSemanticMaskCommand`; task correlation belongs to
  `useBackgroundRemovalTaskBridge`; concrete mask mutations belong to the four
  focused layer command modules.
- Instrumented packaged timings at 256x192: add 14.8 ms, toggle 7.9 ms, invert
  13.1 ms, delete 13.2 ms, Apply 9.8 ms. Debug: 31.9, 9.0, 12.9, 11.1 and
  10.0 ms respectively. Apply's before/after preview RMSE was 0.037 in both.
- Cold Load Mask as Selection measured 766.6 ms instrumented and 740.7 ms
  debug. It is correct but materially slower than the metadata/pixel commands;
  S03 must determine whether this is cold pipeline/readback setup or retained
  selection-resource work before changing its implementation.
- Packaged automation covered add/enable/link/invert/load/delete, mask paint,
  Apply Mask, visual parity and undo/redo with no renderer page errors. Actual
  Ben2 model inference remains environment/model-dependent owner acceptance;
  cancellation, stale document/renderer admission and terminal publication are
  covered by focused failure tests.
