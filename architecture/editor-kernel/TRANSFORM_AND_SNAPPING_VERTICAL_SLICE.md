# Transform and snapping vertical slice

Status: **automated acceptance passed; owner acceptance pending**. Baseline: `83a07c42`.

This note bounds S04. It covers Free Transform for raster, selected pixels,
text, vector/live shape, multiple layers and linked/unlinked masks; move, scale,
rotate, skew and projective interaction; snapping, smart guides, auto-pan,
commit/cancel, history and renderer lifetime. Warp remains S07. Vector-internal
point editing remains S05 and text editing remains S06.

## Artist-visible contract

- Pointer-down admits exactly one document, target set, renderer, immutable
  source geometry/pixels, selection generation and snap-target snapshot.
- Every drag within the same Transform session derives from that immutable
  source. Pointer-up checkpoints the gizmo only; it does not recursively bake
  raster pixels or open a second history transaction.
- Enter/tool exit commits once. Escape, document/renderer replacement and
  unmount cancel once. Undo/redo restores document geometry, pixels and the
  exact selection together or restores none of them.
- Raster whole-layer affine transforms remain document geometry. Selected-pixel
  and projective transforms use one immutable GPU source and rasterize only at
  terminal commit. Text/vector/live-shape transforms remain semantic.
- Snap candidates never contain the moving node, selected descendants or their
  ancestors. One match per axis is latched until its release threshold is
  crossed. Smart guides project only those accepted matches.
- Auto-pan continues the current transform from the stationary pointer, stops
  at the document boundary and creates no history entry of its own.

## Baseline ownership map

| Concern | Baseline owner | S04 target |
| --- | --- | --- |
| Tool activation and four session variants | 1,259-line `useTransformSessionController` | thin React adapter over one non-React session owner |
| Raster/semantic target and transform math | `TransformController` | pure admitted target plan plus terminal result |
| Raster source, preview and history textures | `TransformRasterizer` + `TransformSessionStore` | renderer-bound GPU projection/resource owner |
| Mask and multi-layer preview | hook refs calling the current renderer | opening-renderer-bound session variant |
| Document transaction/history | hook, `DocumentMutationTransaction`, bespoke selected-pixel history and `commitAppliedPixelMutation` | one terminal publication owner per result kind |
| Pointer math and hit testing | 403-line `TransformOverlay` | display adapter plus extracted gesture owner/pure math |
| Snap solve/hysteresis | `snapEngine` and `snapTransformTranslation` | immutable candidates, deterministic per-axis latch |
| Snap target construction | Overlay closure + `layerSnapGeometry` | document projection excluding the complete moving subtree |
| Smart guides | Overlay refs/effects + renderer frame setters | projection of accepted snap result only |
| Auto-pan | marquee-only code inside the 1,600-line viewport hook | shared bounded edge-pan primitive used by marquee and transform |

## Canonical and transient state

- Canonical document state: layer local-to-parent matrices, mask matrix/link,
  pixel revision/surface geometry, selection snapshot/provenance and history.
- Transient editor state: pointer owner, drag-start frame, pivot, snap latch,
  transform matrix/quad, renderer preview and edge-pan state.
- GPU-derived state: immutable pixel/selection source, preview targets, uniform
  buffers and reversible snapshots. These belong to the opening renderer.
- React projects the current gizmo and controls. React identity is not the
  transaction, renderer, selection or rollback authority.

## Required lifecycle

```text
validate capability and exact target set
  -> acquire document transaction and opening renderer
  -> snapshot selection/source geometry and build immutable snap candidates
  -> open one semantic or GPU preview
  -> derive every pointer frame from drag-start state
  -> checkpoint visual state without finalization
  -> terminal commit publishes one atomic history result
     or terminal cancel destroys only opening-renderer resources
```

No cleanup or undo callback may rediscover `getRenderer()` and silently address
a replacement renderer. A failed terminal publication retains enough state to
compensate or retry; it must not destroy the only recovery snapshot.

## Proven baseline risks

1. Mask/group update and cleanup rediscover the current renderer. A renderer
   replacement can leave preview state in the opening renderer or clear an
   unrelated new renderer.
2. `TransformController` is retained across renderer replacement in the same
   document. Its preview calls remain bound to the old renderer while selected
   pixel commit/history code may use the new renderer.
3. Selected-pixel publication implements bespoke async pixel + selection
   rollback. Several failure branches ignore failed GPU compensation and then
   destroy the edit, recreating the unrecoverable rollback class fixed in S03.
4. Mask, group, semantic, raster geometry and selected pixels are interleaved
   in one React hook with transaction and resource ownership. There are no
   direct lifecycle tests for this hook.
5. Transform has no edge auto-pan. The only implementation is marquee-specific
   and embedded in the viewport routing hook.
6. Smart-guide frame publication is split across React effects and immediate
   pointer callbacks using the current engine. Renderer replacement and a
   rejected preview update can display feedback not accepted by the session.
7. `TransformOverlay` owns UI markup, pointer capture, modifier semantics,
   transform derivation and snap latching. This prevents lifecycle testing
   without React and encourages another oversized interaction file.
8. The existing packaged snapping smoke depends on a missing developer-local
   `D:\\shapes.psd` fixture and proves only one multi-layer translation.

## Acceptance matrix

- Raster whole-layer affine: move/scale/rotate/skew, repeated checkpoints,
  cancel, commit, undo/redo, nested transform and no pixel resampling.
- Selected pixels: move/duplicate/scale/rotate/projective, exact source clear,
  transformed selection, cancel, atomic undo/redo and document-edge movement.
- Text/vector/live shape: semantic preview and commit with editable content
  retained; no rasterization.
- Multi-layer and mask: one document-space delta, linked-mask parity, unlinked
  mask isolation, transformed ancestors and exact stale-session rejection.
- Snapping: self/subtree exclusion, deterministic tie-break, per-axis latch and
  release, zoom independence, no centre rebound and guide visibility parity.
- Lifecycle: tool/layer/document/renderer changes, pointer cancel, Escape,
  unmount, failed publication and failed compensation.
- Performance: pointer move has no readback/history/document writes; one preview
  submission per presented frame; no per-frame unbounded allocation; packaged
  debug and instrumented interaction timings show no repeatable >10% regression.

## Fixed-loop checklist

### A. Map and bound

- [x] Scope, artist contract, owners, state, lifecycle and baseline risks recorded.
- [x] Baseline focused tests: 19 files / 88 tests passed.
- [x] Replace the missing-local-file smoke with a generated deterministic fixture.
- [x] Record debug and instrumented packaged numeric baseline.

### B. One complete route

- [x] Extract opening-renderer/session ownership from React for publication,
      group and mask variants; retain the single-target renderer controller.
- [x] Centralize terminal publication and durable failure compensation.
- [x] Keep repeated pointer gestures on one immutable source/session.
- [x] Extract the shared bounded edge-pan primitive. Further overlay gesture
      decomposition is recorded as structural follow-up, not hidden here.
- [x] Make accepted snap matches the sole smart-guide source.

### C-F. Proof and acceptance

- [x] Current cut-over proof passes: 234 focused files / 958 tests.
- [x] Independent read-only critic completed two repair rounds plus a final
      acceptance pass. The repairs closed selection-generation, async binding,
      post-CAS self-rejection and quarantine-lifetime P1s.
- [x] Type and boundary gates pass; milestone full verify is recorded at commit.
- [x] Instrumented and debug packaged Windows matrix passes without page errors.
- [ ] Owner manually accepts transform feel and latency on a large real document.
- [x] Atomic milestone commit.

## Implemented ownership and evidence

- `TransformPublicationOwner` owns terminal semantic/raster/selected-pixel
  publication. Selected pixels carry the admitted selection revision and exact
  renderer generation through restore, CAS, history and compensation.
- `BoundSelectionPublication` restores a mask and publishes canonical state
  under one binding, revalidating after its async renderer await. It never
  publishes against a replacement generation.
- `AuxiliaryTransformSessionOwner` owns group/mask admission, preview, terminal
  plan and cleanup. Group preview scene terms are captured once; pointer frames
  perform matrix projection only, not document reconstruction.
- `AsyncPixelStateTransitionOwner` and `AsyncPixelStateRollbackOwner` retain
  recovery state until both GPU and canonical sides agree.
- Snap ties are deterministic, retained per axis, exclude the moving dependency
  chain, and solve the immutable grid analytically at any drag distance.
- `smoke-desktop-transform-kernel.mjs` generates its own document and proves
  layer geometry with edge-pan, exact geometry undo/redo, selected-pixel commit
  and exact pixel undo/redo, canonical revision advance, and one-delta
  multi-layer transform. The final packaged run measured 465 ms including a
  deliberate 280 ms edge hold, 390 ms selected-pixel drag/commit, and 212 ms
  multi-layer drag/commit; these are end-to-end scripted gesture durations,
  not per-frame renderer timings.

## Explicit structural follow-up

`useTransformSessionController.ts` fell from 1,164 to 979 lines by
removing real publication and auxiliary GPU ownership. `TransformOverlay.tsx`
is still about 516 lines and owns pointer capture, handle derivation and the
drag-local snap latch. Before S04 gains new behavior, extract that gesture state
machine as a non-React owner; do not mechanically split JSX or move methods to
an unowned utility file.

The milestone source-structure audit therefore remains red by design: it still
requires an ownership review for the 979-line transform adapter and reports
pre-existing growth in the layer-command, selection, WebGPU, editor-overlay,
layer-style and standalone-app hotspots. S04 reduced named responsibilities but
does not claim that broader structural gate is green.
