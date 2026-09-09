# Vector paths and live shapes vertical slice

Status: **implemented; packaged acceptance passed; owner acceptance pending**.
Baseline: `23e7c299`.

This note bounds S05. It covers Pen, Add/Delete/Convert Anchor Point, Path
Selection, Direct Selection, live Rectangle/Ellipse/Triangle/Line authoring,
vector fill/stroke/gradient projection, path topology, semantic transform,
history, rasterize hand-off and renderer lifetime. Text layout and path-text
authoring remain S06; Warp remains S07.

## Artist-visible contract

- One pointer gesture admits one document snapshot, renderer generation,
  vector target set and immutable opening geometry.
- Pointer frames derive from that opening geometry. They may update a retained
  renderer preview, but never publish canonical document history per frame.
- Pointer-up or explicit path completion publishes one document transaction and
  one history entry. Escape, pointer cancel, layer/document switch, renderer
  replacement and unmount cancel the complete gesture.
- Pen paths remain editable through open/close/resume/connect. Anchor edits and
  direct-selection moves retain stable path, subpath and anchor identities.
- Live shapes remain parametric until explicit Convert to Path or Rasterize.
- Hybrid rendering, save/reopen, undo/redo, Actions and MCP observe the same
  canonical vector result; renderer caches and React selection are projections.

## Current ownership map

| Concern | Current owner | S05 decision |
| --- | --- | --- |
| Tool routing and pointer capture | `VectorToolSessionController` | retain as non-React interaction router |
| React composition | `useVectorToolSessionController` plus `LightTableEditorOverlay` ports | keep thin; add no geometry or transaction policy |
| Canonical vector transaction | `VectorDocumentController` over `DocumentMutationController` | retain; harden admitted-state checks where proof requires it |
| Pen topology | `PenToolController` plus `vector-core` mutations | retain pure topology and one open path transaction |
| Direct/element selection | dedicated controllers | retain, but bind renderer-hot previews to one admitted generation |
| Live shape geometry | `LiveShapeToolController` plus `vector-core` realization | retain parametric authority |
| Renderer-only element preview | `VectorContentPreviewStore` and `VectorLayerRenderer` | projection only; no document/history authority |
| GPU preview facade | callbacks that rediscover `engineRef.current` | replace with one captured renderer-preview binding per gesture |
| Vector editor selection | document-tab `EditorSession.vectorSelection` | transient projection; validate references against admitted/current document |
| External commands | `semanticVectorCommandExecutor` through the shared command service | final bounded commands only; never pointer streams |

## Canonical and transient state

- Canonical: vector layers, element/path topology, live-shape parameters,
  transforms, styles, revisions, layer relationships and history.
- Transient: active tool mode, pointer capture, opening selection, drag frame,
  provisional Pen endpoint and direct-selection marquee.
- GPU-derived: tessellation, cached meshes, editing overlays and content/transform
  previews. These belong to one concrete renderer generation.
- React: tool options and projection of the per-document vector selection. It
  does not own topology, gesture settlement, renderer lifetime or rollback.

## Required lifecycle

```text
validate document, capabilities and exact vector addresses
  -> acquire one document transaction
  -> capture immutable geometry and (when needed) one renderer generation
  -> derive all pointer frames from the admitted snapshot
  -> terminal commit publishes one canonical result and history entry
     or terminal cancel clears only the admitted preview and transaction
```

No pointer callback may rediscover a replacement renderer and continue an old
gesture on it. A rejected final pointer frame may not silently commit the last
successful intermediate frame.

## Proven baseline risks

1. Element/layer transform previews call the current `engineRef` on every
   frame and again during cleanup. A renderer replacement can therefore move
   an admitted gesture onto a different GPU generation or clear unrelated
   replacement state.
2. `VectorElementSelectionToolController.pointerUp` can commit after its final
   `pointerMove` was rejected, leaving the last accepted intermediate preview
   as an unintended canonical result.
3. Action-observation callbacks rediscover the current React document directly
   after commit. Publication is synchronous today, but that implicit timing
   contract is not represented in the result returned by the transaction owner.
4. Vector selection is transient and structurally scoped, but has no explicit
   document/revision lease during gestures. Tests cover document-id switches;
   stale same-document selection replacement needs a defined policy.
5. The 1,324-line `VectorLayerRenderer` combines cache/resource lifetime,
   backend routing, draw preparation and editing projection. S05 must remove a
   named responsibility if it changes this file; line-count-only splitting is
   not success.
6. Existing packaged vector, Pen and shape smokes default to developer-local
   `D:\\shapes.psd`. On a clean checkout all three abort before opening the app,
   so they cannot serve as regression evidence.

## Acceptance matrix

- Pen: create open/closed paths, drag handles, undo provisional anchor,
  resume/connect, cancel and one terminal history command.
- Point tools: add/delete/convert anchors without identity drift; exact undo/redo.
- Selection: element/path/direct selection, marquee, multi-element move/scale/
  rotate, document/layer/renderer switch and stale-final-frame rejection.
- Live shapes: Rectangle/Ellipse/Triangle/Line in shape and pixel modes, geometry
  options, parametric editability, Convert to Path and Rasterize.
- Rendering: fill/stroke/gradient, anti-aliasing, clipping/masks, hybrid backend,
  cache invalidation and native/PSD round-trip parity.
- External routes: UI, Actions and MCP publish equivalent final semantics and
  bounded results; pointer previews remain private.
- Performance: no document clone, history write, readback or tessellation-owner
  churn per pointer frame; packaged debug and instrumented flows have no page
  errors or repeatable regression.

## Fixed-loop checklist

### A. Map and bound

- [x] Scope, artist contract, owners, state, lifecycle and baseline risks recorded.
- [x] Focused baseline: 43 files / 325 tests passed.
- [x] Existing packaged-smoke fixture failure recorded.
- [x] Replace local-file dependence with a generated deterministic fixture.

### B. One complete route

- [x] Bind renderer-hot vector preview and cleanup to one generation.
- [x] Reject/cancel a gesture when its final preview frame is stale or fails.
- [x] Prove document/selection/renderer invalidation and exact undo/redo.
- [x] Keep live shapes semantic and make rasterize hand-off atomic.

### C-F. Proof and acceptance

- [x] Independent read-only critic pass one.
- [x] Repair loop one and focused proof.
- [x] Independent read-only critic pass two: ACCEPT, no P0/P1 findings.
- [x] Repair loop two was not required after the accepting final review.
- [x] Debug and instrumented packaged acceptance.
- [x] Browser-driven artist-flow acceptance with captures/report.
- [ ] Owner manual acceptance.
- [x] Onboarding/status update and atomic milestone commit.

## Delivered proof

- Vector transforms keep canonical document identity stable throughout pointer
  movement and stage exactly once at pointer-up; renderer/device replacement,
  including an idle multi-click Pen path, cancels the admitted session.
- Preview set and cleanup are two-leg, exception-contained operations addressed
  only to their captured renderer generation. Pixels-mode rasterization carries
  that generation into the final layer command and rejects a stale hand-off.
- `VectorGradientHandleDragController` removes a complete gesture owner from the
  element-selection controller. The remaining >500-line session router has a
  recorded no-growth decision and named Pen-session extraction boundary.
- Focused application proof: 18 files / 259 tests. Cross-package vector proof:
  43 files / 325 tests. Boundary and app typecheck passed.
- Packaged debug and instrumented runs passed vector authoring/transform/native
  and PSD round-trip, Pen authoring, fixed geometry, Ellipse Pixels undo, and
  six repeated hybrid-vector open/close cycles with no page errors or GPU-byte
  growth. First committed shape frame was visible in 18.4 ms in the recorded
  instrumented run; native round-trip completed in 283.4 ms.
- Full workspace verification passed. The separate source-structure audit still
  reports the previously tracked legacy hotspots; S05 reduced element-selection
  ownership below 500 lines and records a no-growth/extraction decision for its
  remaining vector session router rather than weakening that audit.
