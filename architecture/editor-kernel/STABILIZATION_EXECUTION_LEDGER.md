# LightTable stabilization execution ledger

Status: **active feature-freeze plan**. Updated 2026-09-08.

This is the single ordered, checkable execution ledger for stabilizing the
artist-visible editor. It does not replace the kernel contracts or the broader
[transaction and rendering audit](../EDITOR_TRANSACTION_AND_RENDERING_STABILIZATION_PLAN.md).
Those documents explain the architecture and evidence; this file controls work
order, gates and status.

The aim is not to make every old path pass more tests. The aim is to migrate one
complete user operation at a time to one predictable ownership route while the
rest of the application remains on an intact legacy route.

## Status vocabulary

Only these states may be used in the master ledger:

- `queued`: not started;
- `mapping`: current owners and failure modes are being proved;
- `implementation`: one end-to-end kernel route is being built;
- `critic`: an independent read-only review is active;
- `real-app`: automated checks pass and the packaged app is being exercised;
- `owner`: waiting for manual product acceptance;
- `complete`: every definition-of-done gate passed and fallback removal is safe;
- `blocked`: the stop rule fired and an explicit decision is required.

Passing unit tests alone never changes a slice to `real-app`, `owner` or
`complete`.

## Non-negotiable system shape

Every migrated operation follows this route:

```text
UI / shortcut / Action / MCP
             |
      semantic command + validated capabilities
             v
     editor-kernel transaction/session
       |                         |
canonical document/history   projection/resource ports
       |                         |
serializable committed state  renderer/WebGPU/UI projections
```

- React owns controls, input adaptation and low-frequency projections only.
- The document owns serializable committed meaning; GPU handles are never
  document truth.
- The kernel owns command coordination, transaction identity, revision order,
  commit/cancel and resource-lifetime rules. Domain algorithms remain in paint,
  vector, text, filter and renderer packages.
- Preview state is disposable, revision-bound and never a history baseline.
- One user gesture produces zero history entries when cancelled and exactly one
  history entry when committed.
- UI, shortcut, Action and MCP entry points must reach the same semantic handler.
- A user operation is completely legacy or completely kernel-owned. A mixed
  preview/commit/history/resource path is a release blocker.
- Every retained legacy fallback is quarantined compatibility code, not an
  extension point. Agents may not add behavior, entry points or consumers to
  it, nor use it as precedent for a new implementation. A fallback may change
  only to remove it after its owner gate or to fix an explicitly reproduced
  blocker while preserving complete route isolation; record either change in
  the owning slice.
- Failure, document switch, supersession and unmount all have explicit terminal
  behavior. Stale asynchronous work cannot publish into a newer generation.
- Pointer hot paths do not write React/document/history state, perform GPU
  readback, or allocate full-document resources per event.

## Fixed loop for every slice

Copy this checklist beneath a slice-specific work note. Do not skip a stage.

### A. Map and bound the work

- [ ] Write the exact artist-visible flows, layer types and unsupported cases.
- [ ] Record the baseline commit and reproduce each reported failure.
- [ ] Map the current owners of input, preview, canonical state, renderer
      projection, resources, history, cleanup, UI availability, Action and MCP.
- [ ] Define the canonical serializable value and all transient values.
- [ ] Define transaction states, revisions, resource leases and terminal paths.
- [ ] Define invariants and a numeric performance baseline in debug and packaged
      builds.
- [ ] Name the responsibility that will leave every legacy hotspot touched.
- [ ] Agree the smallest complete vertical slice. Do not begin adjacent cleanup.

### B. Build one complete route

- [ ] Add or amend the small kernel contract before adding orchestration.
- [ ] Keep algorithms behind typed ports; do not move them into the kernel.
- [ ] Connect every supported entry point to one semantic command.
- [ ] Implement preview, commit, cancel, undo, redo, failure rollback, document
      rebind and resource disposal as one lifecycle.
- [ ] Keep the legacy fallback isolated until acceptance; never interleave it.
- [ ] Verify the diff neither extends nor creates a caller of a quarantined
      fallback; name every fallback removed or deliberately retained.
- [ ] Add focused contract, lifecycle, generation/failure and projection tests.
- [ ] Add Action/MCP equivalence tests for any externally reachable command.

### C. Self-review and focused proof

- [ ] Run boundary verification, typecheck for touched packages and focused tests.
- [ ] Run source-structure audit and record hotspot line/responsibility deltas.
- [ ] Inspect the diff for duplicate truth, fallback leakage and silent catches.
- [ ] Measure the declared hot path; investigate a repeatable regression over
      10% rather than explaining it away as debug overhead.

### D. Independent critic, at most two repair loops

- [ ] Start a separate senior architecture critic agent after implementation.
- [ ] The critic is read-only and judges ownership, failure atomicity, lifecycle,
      performance shape, fit with the existing codebase and unnecessary scope.
- [ ] Triage every finding yourself: accept only feedback supported by code and
      the kernel contracts; record rejected feedback with a reason.
- [ ] Repair P0/P1 findings, rerun only affected checks, then request rereview.
- [ ] Repeat once more if needed. After two repair loops, unresolved P0/P1 means
      `blocked`; do not silently start a third loop or mark the slice complete.

Suggested critic prompt:

> Independently review this completed LightTable vertical slice. Do not modify
> code. Ignore routine green-build praise. Determine whether this is the best
> implementation for the existing architecture: one canonical owner, one
> transaction lifecycle, safe failure/undo/resource behavior, no legacy/kernel
> split, shared UI/Action/MCP semantics, bounded hot paths and reduced rather
> than displaced responsibility. Report only evidence-backed P0/P1/P2 findings,
> then state whether the slice may enter packaged-app acceptance.

### E. Real-app acceptance

- [ ] Build the exact packaged desktop artifact under test.
- [ ] Use the computer-use/browser skill to exercise the real Windows UI, not a
      synthetic DOM substitute. Read that skill's guidance before controlling it.
- [ ] Exercise normal, edge, cancel, undo/redo, repeated-use, document-switch and
      failure flows with visible evidence or telemetry.
- [ ] Compare UI, shortcut, Action and MCP results where supported.
- [ ] Repeat the performance scenario in debug for diagnosis and in packaged
      release for the acceptance result.
- [ ] Record artifact identity, scenario, result and screenshots/log locations.

### F. Product-owner gate and closure

- [ ] Owner manually confirms that the interaction feels correct.
- [ ] Remove the legacy fallback only after that confirmation and rerun focused
      plus direct-neighbour regressions.
- [ ] Update this ledger, `MIGRATION_STATUS.md` and the slice document.
- [ ] Make an atomic milestone commit; push only when requested.
- [ ] Confirm the worktree contains no accidental generated or unrelated files.

## Definition of done

A slice is `complete` only when all of these are true:

- no accepted P0/P1 critic finding remains;
- canonical state, pixels, layer presentation, history and resources agree after
  commit, cancel, undo, redo, failure and document switch;
- focused automated tests and direct-neighbour tests are green;
- packaged WebGPU real-app acceptance is recorded;
- the declared performance budget is met;
- UI/shortcut/Action/MCP parity is proved or an unsupported route is explicit;
- no new source-structure failure exists and touched hotspots lost a named owner;
- the owner accepted the user interaction.

## Ordered master ledger

The order is dependency-driven. Cross-cutting checks are performed in every
slice; they are not postponed to the final phase.

| ID | Vertical slice | State | Kernel | critic | packaged app | owner | fallback removed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S00A | Selection geometric/paint foundation | `owner` | yes | passed | passed | [ ] | [ ] |
| S00B-1 | Horizontal/vertical strip marquees | `owner` | yes | passed | passed | [ ] | retained with S00A |
| S00B-2 | Magic Wand | `owner` | yes | passed | passed | [ ] | retained |
| S00B-3 | Object Selection | `owner` | yes | passed | passed | [ ] | yes |
| S01 | Layer capabilities, rasterize, merge and flatten | `owner` | yes | passed | passed | [ ] | yes |
| S02 | Masks, Remove Background and layer-result insertion | `owner` | yes | passed | passed | [ ] | partial (paint -> S03) |
| S03 | Raster paint and pixel mutation sessions | `owner` | yes | passed | passed | [ ] | yes |
| S04 | Transform, selected-pixel transform, snapping and guides | `owner` | yes | repaired | passed | [ ] | partial |
| S05 | Vector paths and live shapes | `owner` | yes | passed | passed | [ ] | partial |
| S06 | Text, paragraph/vertical/path text and text conversion | `owner` | yes | passed | passed | [ ] | partial (warp -> S07) |
| S07 | Warp and experimental Face Warp | `owner` | yes | passed | passed | [ ] | partial (Text Warp authoring absent) |
| S08 | Adjustment-layer lifecycle | `owner` | yes | passed | passed | [ ] | partial |
| S09 | Layer styles/effects lifecycle | `owner` | yes | passed | passed | [ ] | yes |
| S10 | Filters P0, P1 and P2 by release tier | `owner` | yes | repaired | P0 baseline passed | [ ] | partial |
| S11 | Document geometry, clipboard, open/place/save/export/recovery | `owner` | complete | repaired | packaged passed | [x] | partial |
| S12 | View, zoom, panels, scopes and multi-document lifecycle | `active` | yes | passed | packaged foreground pass | [ ] | partial |
| S13 | Full undo/redo, Action/MCP, GPU-loss and soak matrix | `queued` | [ ] | [ ] | [ ] | [ ] | n/a |

The registered toolbar inventory is sourced from `toolRegistry.ts`; adjustment
and effect inventories come from `adjustmentLayerCatalog.ts`,
`layerStyleDefaults.ts` and the P0/P1/P2 filter catalogs. When a catalog changes,
this ledger must change in the same commit.

### S00A -- selection geometric/paint foundation

Already implemented and independently reviewed; the legacy fallback remains
until owner acceptance. The existing packaged smoke is proof, not permission to
skip the manual gate.

- [x] Rectangular selection shape/preview/commit.
- [x] Elliptical selection shape/preview/commit.
- [x] Free selection shape/preview/commit.
- [x] Polygonal selection shape/preview/commit.
- [x] Selection Brush preview/commit and resource ownership.
- [x] Move, nudge, edge excursion/return, paint clipping and exact copy bounds.
- [x] Combine modes, rollback, undo/redo and document rebind coverage.
- [x] Separate critic with two ownership repairs.
- [x] Packaged WebGPU smoke.
- [ ] Owner manual interaction/performance acceptance.
- [ ] Remove fallback and reduce selection controller responsibilities.

### S00B -- remaining selection catalog

- [x] Horizontal selection kernel-route and automated packaged acceptance.
- [x] Vertical selection kernel-route and automated packaged acceptance.
- [x] Exact configured thickness, full document span, one history entry,
      undo/redo and restored Copy Merged bounds for both strip tools.
- [x] Independent critic plus two focused evidence repairs; no P0/P1/P2 remains.
- [ ] Committed strip survives background/minimize and foreground restoration.
- [ ] Owner visual/interaction acceptance for both strip tools.
- [x] Magic Wand UI and semantic command commit through one isolated kernel
      projection with exact history, cancellation and stale-document guards.
- [x] Full staged rasterizer/workspace reuse prevents per-click full-canvas
      scratch allocation; terminal teardown destroys scratch and mask textures.
- [x] Independent critic completed two repair passes; stale recovery races,
      source cleanup and pooled-resource disposal are closed with no accepted
      P0/P1/P2 remaining.
- [x] Packaged 4K UI acceptance: six repeated replace/add/subtract/intersect
      operations completed at 66--102 ms GPU and 176--196 ms visible update.
- [x] Packaged Action recording, undo and playback preserve the sampled semantic
      recipe without serializing document revision or raster mask bytes.
- [ ] Owner visual/interaction acceptance for Magic Wand.
- [ ] Remove the legacy direct-renderer fallback with the other S00 fallbacks.
- [x] Object Selection inference remains tool-owned while its terminal raster
      mask uses the shared isolated kernel projection, CAS and exact history.
- [x] Queued results revalidate document, revision, renderer and cancellation;
      tool invalidation aborts admitted interactive commits.
- [x] Exact-renderer preview leases prevent an old completion from clearing a
      newer preview or leaving failed/canceled inference visible.
- [x] Select Subject task completion, Action recording/playback and external MCP
      execution agree after the terminal commit boundary.
- [x] Independent critic completed two repair passes; no accepted P0/P1/P2
      remains after task-state and tool-invalidation repairs.
- [x] Packaged SAM2 Object Finder, Select Subject, undo/Action playback and
      external MCP acceptance passed on a real raster document.
- [ ] Owner visual contour/interaction acceptance for Object Selection.
- [ ] Selection Brush catalogue/shortcut parity after S00A fallback removal.

### S01 -- layer capabilities, rasterize, merge and flatten

This is next because later tools need one trustworthy way to finalize content.

- [x] Derive icons/menu/shortcut availability from one capability projection.
- [x] Rasterize text, live shapes/vector, gradient/fill, raster with adjustments,
      raster with layer styles, pixel-generating adjustment layers and supported
      groups. Backdrop-reading correction layers deliberately use Merge Down.
- [x] Define whether rasterizing an already-raster layer applies its non-destructive
      stack, and preserve visual bounds/placement exactly.
- [x] Merge Down / selected layers (`Ctrl/Cmd+E`) with order, blend, masks,
      clipping, opacity, adjustments and styles preserved in the result.
- [x] Flatten Group and Flatten Image with global adjustment/Lens Fx ordering.
- [x] Atomic failure rollback: no half-replaced layer, leaked texture or history.
- [x] Layer-stack collapse/expand, selection and thumbnail state remain coherent.
- [x] UI, shortcut, Action and MCP all use the same commands.
- [x] Two critic repair loops closed backdrop admission, recursive runtime
      retention, byte accounting, error parity and submitted/pending cleanup.
- [x] Packaged WebGPU matrix preserves rasterize/merge/flatten pixels across
      vector and text PSDs; `Ctrl+E`, multi-select, undo and redo are exercised.
- [ ] Owner manually accepts layer affordances and repeated finalization feel.

### S02 -- masks and background removal

- [x] Add/delete/enable/disable/invert/apply mask and load mask as selection.
- [x] Mask painting uses the shared raster-session lifecycle and selection lease.
- [x] Remove Background has one cancellable generation-bound task and inserts its
      result through the same layer/mask command as UI, Action and MCP.
- [x] Undo/redo and failure restore layer pixels, mask, selection and resources.
- [x] Independent critic completed two repair loops; final gate found no P0/P1/P2.
- [x] Instrumented and debug packaged mask-kernel acceptance passed; Apply Mask
      visual RMSE 0.037 and no page errors.
- [ ] Owner manually accepts mask editing and a real Ben2 Remove Background run.
- [ ] S03 removes the retained legacy raster-paint session ownership and profiles
      the 741-767 ms cold Load Mask as Selection path.

### S03 -- raster paint and pixel mutations

- [x] Brush and Erase.
- [x] Healing Brush and Clone Stamp, including immutable source acquisition.
- [x] Dodge, Burn and Sponge.
- [x] Paint Bucket/Clear and raster Gradient.
- [x] Selection/mask clipping and transformed/tight raster coordinates share one
      document-space transform authority.
- [x] One continuous renderer/document/selection-bound stroke, bounded dirty
      regions and one history entry.
- [x] Cancel, document/renderer change, frame exception, unmount and double
      rollback failure have complete cleanup or durable quarantine/retry.
- [x] Independent critic completed two repair loops; no P0/P1/P2 remains.
- [x] Instrumented and debug packaged browser/Windows matrix passed without page
      errors, including one real toolbar/viewport Brush drag.
- [ ] Owner manually accepts paint feel and latency on a large real document.

### S04 -- transform and snapping

- [x] Transform for raster, text, vector, shape, group and supported masks.
- [x] Selected-pixel transform keeps an immutable source until terminal commit.
- [x] Move, scale, rotate, skew and supported projective modes.
- [x] Snap candidates exclude self; one latched target with hysteresis prevents
      corner fighting, guide flicker and return-to-previous-state jumps.
- [x] Repeated transforms in one tool session never recursively rasterize previews.
- [x] Auto-pan, document bounds, cancel, undo/redo and multi-document rebind.
- [x] Opening renderer generation and selection revision remain bound through
      async selection restore, terminal CAS, history and compensation.
- [x] Group/mask lifetime moved to a non-React owner; group pointer previews use
      scene terms captured once at admission.
- [x] Two read-only critic passes and debug/instrumented packaged acceptance.
- [ ] Owner manually accepts transform/snapping feel on a large real document.
- [ ] Extract the remaining overlay gesture state machine before adding behavior.

### S05 -- vector paths and live shapes

- [x] Pen.
- [x] Add anchor point.
- [x] Delete anchor point.
- [x] Convert anchor point.
- [x] Path selection.
- [x] Direct selection.
- [x] Rectangle live shape.
- [x] Ellipse live shape.
- [x] Triangle live shape.
- [x] Line live shape.
- [x] Vector Gradient, fill/stroke, masks/clipping and hybrid renderer parity.
- [x] Path create/edit/close/transform/undo and rasterize hand-off.
- [x] Two critic passes, focused proof, deterministic fixtures, debug and
      instrumented packaged browser acceptance.
- [ ] Owner manually accepts vector authoring/editing feel on a real document.

### S06 -- text

- [x] Type tool (point text) creation and editing.
- [x] Paragraph text creation and editing.
- [x] Vertical type tool creation and editing.
- [x] Text measurement is generation-bound and exact for transform before glyph
      realization; stale retained layouts cannot become current.
- [x] Path Text resolves the native contour under the click, records stable ids
      and replays through Actions after undo.
- [x] Style/run/paragraph edits use the existing grouped semantic transaction.
- [x] Text transform, convert-to-shape and rasterize hand-offs preserve semantic
      text until the explicit conversion/finalization boundary.
- [x] Font preparation, failure, document/renderer invalidation and undo/redo
      have focused automated coverage.
- [x] Two read-only critic passes plus the supplemental async-activation repair;
      final verdict has no P0/P1.
- [x] Debug packaged Type Tool and Path Text/Actions browser acceptance.
- [ ] Owner manually accepts text authoring and transform latency/feel.
- [ ] Text Warp is deliberately S07 and may not add a second preview owner.
- [ ] Extract the accepted P2 post-hit activation adapter from the 9k-line
      overlay before adding more text behavior.

### S07 -- warp

- [x] Raster Warp has one immutable source and stable module identity per session.
- [x] Preview cannot switch between old and new generations while dragging.
- [x] Commit/cancel/repeat/two-stroke undo-redo and resource cleanup are deterministic.
- [x] UI, Actions and MCP persist the same bounded semantic Warp command.
- [x] Incremental field updates require an exact renderer-owned preview lease;
      all document/history projections rebuild canonically.
- [x] Face Warp stays production-hidden and passed its debug-packaged native
      WebGPU detection/sculpt/semantic/undo/performance gate.
- [x] Imported Text Warp remains canonical and rendered; no nonexistent
      authoring surface was synthesized during feature freeze.
- [ ] Owner manually accepts raster Warp and experimental Face Warp feel.

### S08 -- adjustment layers

First prove the common lifecycle: create, select, edit preview, commit/cancel,
mask/clipping, reorder, duplicate, enable, delete, rasterize/merge, undo/redo,
save/open and renderer rebind. Then check every catalog entry:

- [x] Ownership map and single-route contract recorded in
      `ADJUSTMENT_LAYER_VERTICAL_SLICE.md`.
- [x] Adjustment Layer and attached creation no longer stores panel mirrors in
      history or uses a second multi-publication lifecycle.
- [x] Layer-local edits preserve independent document-wide processing.
- [x] Contextual panel state is re-derived from the canonical owner after
      generic document publication, including undo/redo owner changes.
- [x] Two bounded critic repair passes completed; ownership locking, disabled
      state, rebind, sidecar publication, presentation caching and Lens-Fx GPU
      retention are accepted.
- [x] Bounded follow-up cycle closed document-owner isolation,
      specialized-kind preservation, complete transport validation/schema and
      masked duplication; the fresh critic verdict contains no P0/P1.
- [x] Packaged lifecycle, Action, undo/redo, masked duplication and 4K
      interaction/resource evidence recorded.
- [ ] Owner manually accepts adjustment interaction and visual output.

- [x] Grade; Lens Fx.
- [x] Brightness / Contrast; Levels; Curves; Exposure.
- [x] Color and Vibrance; Hue / Saturation; Color Balance; Black & White.
- [x] Photo Filter; Channel Mixer; Color Lookup; Selective Color.
- [x] Invert; Posterize; Threshold; Gradient Map.
- [x] Clarity and Dehaze.
- [x] Grain remains a queryable Lens-Fx sub-owner and is deliberately not a
      standalone creation item.
- [x] Hidden legacy `Vibrance` identity remains readable without a duplicate UI.

### S09 -- layer styles/effects

Prove the shared live-preview/commit stack once, then every effect and stack
combination. Rasterize/merge must consume the same renderer projection.

- [x] Ownership map, strict route and packaged interaction baseline recorded in
      `LAYER_STYLE_VERTICAL_SLICE.md`.
- [x] Baseline: 120 input events, 22 submitted frames / 17.0 Hz, no long tasks
      or renderer errors, one bounded Action and exact undo/playback.
- [x] Bind the interaction to one document, layer, presentation target and
      exact renderer; total cleanup on every terminal path.
- [x] Record one strict complete snapshot for one local stack checkpoint while
      retaining granular external commands behind the same codec.
- [x] Locked owners fail closed; cancel/supersede/rebind/failure remount clean
      document/layer/generation-keyed UI drafts.
- [x] PSD import is normalized to the same finite scalar and 2..64/64
      collection domain, then asserted through the canonical stack parser.
- [x] Two critic repair loops closed renderer generation, target/draft reset,
      fallback leakage, granular no-op history and PSD-domain mismatches; final
      verdict ACCEPT with no P0/P1.
- [x] Full app 3,615 tests, 34 command-contract tests, typecheck and boundary;
      instrumented package, Layer Style interaction, layer-subtarget and PSD
      roundtrip gates pass.
- [ ] Owner manually accepts Layer Style interaction and visual output.

- [x] Drop Shadow; Inner Shadow; Outer Glow; Inner Glow.
- [x] Bevel & Emboss; Color Overlay; Gradient Overlay; Pattern Overlay.
- [x] Satin; Stroke; global-light and multi-effect ordering.

### S10 -- filters

Each tier is its own sub-slice and cannot inherit acceptance from another tier.

- [x] Common owner/resource/command inventory and P0 packaged baseline recorded
      in `FILTER_VERTICAL_SLICE.md` at `8bf4357d`.
- [x] Strict complete `filter.setSnapshot` route shared by Properties,
      Actions/MCP and the Layers attached-filter eye.
- [x] Pointer previews use disposable GPU generations; commit rebuilds one
      canonical revision from the immutable interaction origin. The cache
      regression covers two previews, commit, undo and redo.
- [x] Displace references are same-document rasters for edit and creation and
      are cleared atomically when a destructive layer operation removes them.
- [x] Two critic repair loops completed; no P0/P1 remains in the common route.
- [x] Full app 3,629 tests, 34 command-contract tests, typecheck and boundary;
      instrumented package plus 56-filter 1280x720 render/delete/cleanup smoke
      passed with exact per-filter export replay and no page/console errors.
- [ ] Locked filters remain visible in a disabled/read-only Properties view (P2).

- [x] P0: Gaussian Blur, Motion Blur, Surface Blur, Displace, Median, Reduce
      Noise, Smart Sharpen, Unsharp Mask, High Pass, Maximum, Minimum, Offset.
- [x] P1: Box Blur, Radial Blur, Field Blur, Iris Blur, Tilt-Shift, Wave, Ripple,
      Twirl, Spherize, Polar Coordinates, Dust & Scratches, Despeckle, Mosaic,
      Color Halftone, Clouds, Lens Flare, Find Edges, Emboss.
- [x] P2: Shape Blur, Smart Blur, Path Blur, Spin Blur, Pinch, Shear, Glass,
      Crystallize, Mezzotint, Pointillize, Difference Clouds, Fibers, Oil Paint,
      Glowing Edges, Diffuse, Solarize, Custom, Cutout, Plastic Wrap,
      Poster Edges, Watercolor, Photocopy, Halftone Pattern, Stamp, Torn Edges,
      Texturizer.
- [x] Common filter preview/commit/cancel, masks, stacking, reorder, rasterize,
      merge, save/open, undo/redo and GPU resource reuse.

### S11 -- document and file lifecycle

- [x] New document and instant clipboard-dimension probe; Paste/Copy/Copy Merged.
      See `DOCUMENT_AND_CLIPBOARD_VERTICAL_SLICE.md`: the packaged Ctrl+N route
      populated and created the exact clipboard canvas in 59.7 ms; packaged
      Copy/Copy Merged/Paste equivalence also passes.
- [x] Resize image, canvas size, crop and rotate with layers/masks/selection.
      Canonical document and exact selection publish atomically; all nested
      document-sized masks and selection GPU targets exchange with one retained
      history owner. Instrumented UI/command/undo smokes pass.
- [x] Open/Place and save/export for the formats in `formatCapabilities.ts`, with
      explicit semantic versus flattened behavior. Exact host terminal results
      prevent cancel/failure from publishing success; UI Place is one
      non-recorded transient-artifact command with one history entry. Packaged
      Place/undo/redo, native save/export, source fallback, OS-open and PDF
      open/export smokes pass; independent critic accepted after two repairs.
- [x] Autosave/recovery, failed decode/export and unsaved-document close.
      Canonical recovery flush, bounded retry, transition serialization,
      revision-bounded cleanup and retained command/session/history/task close
      admission pass focused, packaged crash-recovery and close-during-save
      evidence. Independent critic accepted after two additional P1 repairs.
- [x] Generated/AI results use the normal cancellable result-insertion command.
      Submission persists project/document/revision/behavior provenance;
      automatic delivery fails closed across project/document switches before
      loading bytes, image edits use `layer.placeArtifact`, and create/explicit
      Open waits for terminal document decode. Focused delivery/GenAI/command
      regressions pass, the packaged project-asset boundary passes, and the
      independent critic reports no remaining P0/P1.

### S12 -- view and multi-document presentation

- [x] Move canvas, including middle-button/modifier conflicts. One retained
      document-bound owner covers View/Space/middle pan; pointer-up is exact,
      history-free, and a Ctrl+Tab mid-gesture cannot affect either document.
- [x] Zoom, including wheel/middle-button/modifier conflicts and
      stable 100% document zoom.
      Wheel, exact/fit/stepped/rectangle and temporary in/out routes pass the
      packaged two-document smoke. Alt+Space owns its full chord over the
      selected tool's Alt behavior. See `VIEW_AND_MULTI_DOCUMENT_VERTICAL_SLICE.md`.
- [x] Side panels, floating layer panel, tool options, scopes and rulers do not
      alter document coordinates or edge zones. Pointer projection and 32 px
      edge zones use the measured `.lighttable-viewport`; a packaged smoke
      copies the same exact 80x60 document selection in Photo Edit, Grading and
      ruler-visible layouts. Screen-mode/floating-resize gates and critic pass.
- [x] Tab switch, close/reopen and renderer rebind show the correct first frame.
      A layout-effect gate hides retained pixels and projections until the exact
      document/epoch/renderer/generation presents. Five A/B cycles, rapid
      A -> B -> A and close/reopen pass packaged with pixel/layer retention;
      delayed thumbnails share the same owner guards. Final critic: PASS.
- [x] Background/minimize/restore preserves committed state and the first correct
      foreground frame; stale previews do not replay in a burst. Native host
      state suspends the renderer, resume re-blits the retained final texture,
      and presentation/first-frame generations reject pre-suspend completions.
- [x] Losing foreground during an active gesture has one documented terminal
      policy: cancel before renderer suspension, with no partial commit or stuck
      pointer owner. Packaged marquee interruption/recovery and history pass.
- [ ] Hidden documents release transient work without losing committed resources.

### S13 -- final system matrix

This is a cross-domain proof, not the first time these properties are tested.

- [ ] Long mixed-operation undo/redo chains across all completed slices.
- [ ] Equivalent UI, shortcut, Actions and MCP command results and errors.
- [ ] GPU device loss/recovery, allocation failure and document-close cleanup.
- [ ] Multi-document memory and repeated-operation soak.
- [ ] Full boundary, source audit, typecheck, tests, web build and packaged desktop.

## Large-file reduction ledger

Do not create a separate cleanup campaign that mechanically moves code. When a
slice touches a hotspot, remove one named authority and record before/after
lines plus responsibilities here.

| Hotspot | Intended remaining role | Responsibility to extract with slice | Done |
| --- | --- | --- | --- |
| `useSelectionSessionController.ts` | React/input adapter | terminal command, mask/resource and history coordination -> S00 kernel/adapters | [ ] |
| `SmartSelectionToolController.ts` | model-neutral inference and gesture session | preview renderer lifetime -> `SmartSelectionPreviewLease`; terminal document mutation/history -> S00 kernel adapter | S00B-3 |
| `useLayerDocumentCommands.ts` | thin command adapter/composition | finalization -> S01; masks/tasks -> S02; adjustment duplication -> S08; clipboard/document geometry -> S11 | S08: 1812 -> 1710; adjustment mask duplication/history coordination extracted to `duplicateAdjustmentLayerCommand` |
| `useTransformSessionController.ts` | pointer/key sampling | snap session, transform transaction and commit/history -> S04 | [ ] |
| `LayerStyleEditor.tsx` | presentational editor composition | transaction/history authority extracted to S09 session/snapshot route; 1,027-line UI decomposition debt remains | S09 authority extracted; no-growth |
| `WebGpuEngine.ts` | stable renderer facade | domain projection/resource coordinators -> relevant slice adapters | [ ] |
| `LightTableEditorOverlay.tsx` | composition/wiring only | feature orchestration -> per-domain hooks/adapters | S02: 9153 -> 9147; mask dispatch/task bridge extracted |
| `LightTableStandaloneApp.tsx` | host shell/composition | command registration, document lifecycle and persistence -> S11/S12 | S11 file I/O: Place artifact/terminal policy extracted, 1346 -> 1340 |
| `useViewportInteractionController.ts` | DOM pointer sampling and coordinate adapter | retained pan gesture and coalesced document-bound frame publication -> S12 application-input owners | S12 pan/zoom authority extracted; explicit generation/capture adapter remains oversized and is no-growth |
| `LightTableEditorOverlay.tsx` | editor composition root | retained-canvas first-frame and thumbnail publication -> S12 document-presentation owner | `useWorkspaceDocumentPresentation.ts` extracted; 9583 -> 9518 lines |

Rules:

- New production modules target one responsibility and normally stay below 350
  lines. At 500 lines a recorded decomposition decision is mandatory. The
  existing hard kernel ceiling of 800 handwritten lines remains absolute.
- A touched hotspot may not grow unless the slice note identifies a temporary
  adapter seam and the same slice removes more authority than it adds.
- Splitting a file without changing ownership does not satisfy this ledger.
- Generated catalogs/shaders are judged by generation and ownership, not by the
  same handwritten line target.

S00B-3 decomposition decision: `SmartSelectionToolController.ts` remains above
500 lines temporarily because source preparation, prompt inference and interactive
gesture admission form one cancelable tool session. The slice removed terminal
document mutation/history ownership and extracted exact-renderer preview lifetime
to `SmartSelectionPreviewLease`. Before this controller grows again, preparation
and prompt scheduling must move together behind a model-session port; mechanical
method splitting is not accepted.

S05 decomposition decision: `VectorToolSessionController.ts` remains above 500
lines temporarily because it is the single non-React router that serializes tool
mode, pointer ownership, document identity and renderer-generation admission for
all vector gestures. S05 moved gradient-handle gesture ownership into
`VectorGradientHandleDragController` and kept renderer preview ownership in
`VectorTransformPreviewBinding`; the router retains no geometry or GPU resource
authority. It may not grow again. The next extraction boundary is a dedicated
Pen session coordinator containing multi-click resume/connect/finish lifecycle;
the router will retain only mode dispatch and runtime invalidation.

## Performance ledger

Every slice records, before and after:

- pointer/preview frame time and dropped frames for interactive work;
- terminal commit and first-correct-frame latency;
- GPU allocations, readbacks and retained bytes/resources;
- history snapshot bytes and undo/redo latency;
- document-switch/rebind latency where relevant.

Debug is used to diagnose ownership and duplicate work. Packaged release is the
performance acceptance environment. A repeatable regression above 10% blocks
the slice until explained and explicitly accepted; a faster path still fails if
it weakens correctness or cleanup.

## Stop rules

Set the slice to `blocked` and request a decision when:

- two critic-repair loops leave an accepted P0/P1;
- real-app behavior contradicts tests;
- canonical ownership cannot be named without widening the slice substantially;
- a mixed legacy/kernel mutation is required;
- performance or GPU-memory behavior exceeds its declared budget;
- the implementation creates a new god object or merely moves one;
- required owner interaction acceptance is unavailable.

## Required progress report after each slice

Report exactly:

1. **Done:** user flows and architectural owners now proved.
2. **Changed:** files/responsibilities moved, including hotspot deltas.
3. **Proof:** focused checks, critic rounds, packaged scenarios and performance.
4. **Still open:** unchecked items and retained fallback, without optimistic
   wording.
5. **Decision:** proceed, repair, block or ask for owner acceptance.
6. **Next slice:** one named slice only.
