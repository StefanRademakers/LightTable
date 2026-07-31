# LightTable refactor handoff

Updated: 2026-07-31  
Repository: `D:\mediavibe\LightTable`  
Branch: `main`  
Architecture checkpoint: `5a9fa02 Centralize document adjustment state`
Current milestone: interaction-aware publication and render invalidation

This is the short operational handoff. The architectural source of truth remains
`LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md`.

## Working state

The architecture milestone is complete and committed. The commits after it are
an intentional UI/theme polish interlude, not a change of architecture
direction.

The default workspace-layout edits are committed at `d766cca`: Scopes and Grade
start visible beside each other and Layers starts as a compact floating panel.
That commit also contains the first documentation classification pass. It is
the baseline for resuming the refactor.

Verification at the architecture checkpoint:

- app TypeScript check passed;
- 171 test files and 749 tests passed;
- repository boundary verification passed;
- standalone web production build passed;
- Electron/desktop TypeScript check passed.

Latest renderer-performance verification:

- repository boundary verification passed;
- 180 test files and 810 tests passed;
- standalone web production build passed;
- packaged Electron verification passed.

The renderer now exposes on-demand counters and CPU command-encoding timings in
the Debug panel. Capturing or resetting telemetry is explicit: diagnostics do
not poll and therefore cannot wake an idle document renderer.

`DocumentCoreGpuResources` now owns the document-level sampler, uniform buffers,
curve LUT and retained GPU payload writers. `WebGpuEngine` no longer manages
those resources as unrelated nullable fields, giving the renderer one
idempotent lifecycle boundary for document-core GPU state.

The next interaction-performance target is the selection overlay. The legacy
overlay rasterizes a viewport-sized mask, performs a full `getImageData()`
readback and scans every pixel whenever pan or zoom changes. This is noticeable
on desktop GPUs and severe on macOS. Simple selections must use a vector overlay;
composite/feathered rasterization must be cached by selection revision and never
rebuilt for viewport-only changes.

Canvas panning now follows the same interaction rule as GPU rendering: raw
pointer events are accepted at device frequency, but only the newest pan value
is published to document/React state once per display frame. Pointer-up flushes
the final value synchronously and document switches cancel queued input. This
keeps high-rate trackpads and pens from repeatedly rendering the complete editor
shell, without reducing visible pan cadence or losing per-document viewport
state.

High-frequency Grade and Lens Fx presentation no longer lives in the editor
root's React state. Each document owns an adjustment presentation store. During
a slider gesture, immutable snapshots update the relevant panels and WebGPU
preview directly; the canonical document/session tree is published once at
gesture completion, together with the single undo entry. Immediate commands,
undo and redo still commit atomically. This prevents a slider from repeatedly
re-rendering Dockview, the canvas shell and unrelated panels.

Known non-blocking build warnings:

- `wasm-vips` contains direct `eval`;
- the main web bundle still exceeds Vite's default chunk-size warning.

These are existing dependency/bundling concerns, not failures introduced by the
last milestone.

## What has been completed

The production refactor has moved authority out of the original composition
hotspots without changing the intended image-processing math.

Current approximate hotspot sizes:

- `LightTableStandaloneApp.tsx`: 156 lines;
- `LightTableEditorOverlay.tsx`: 1,631 lines, down from roughly 4,900;
- `WebGpuEngine.ts`: 1,341 lines, down from roughly 1,900;
- `LayerDocumentRenderer.ts`: 332 lines, down from roughly 2,200.

Important completed boundaries include:

- a multi-document workspace with exactly one active document;
- document-scoped runtime, history, tasks, tools, viewport and diagnostics;
- deterministic React Strict Mode-safe application/runtime disposal;
- document-level error containment so one failed tab does not brick siblings;
- host-neutral web/Electron document opening and file-drop routing;
- source probing and lazy codec selection for fast ordinary-image startup;
- application-owned open, hydrate, publish, save and export transactions;
- declarative, replaceable keymap resolution and document-scoped execution;
- feature-owned Grade, Lens Fx, Layers, Scopes and Debug panel bindings;
- typed Dockview panel registration instead of hard-coded panel branches;
- isolated selection, transform, paint, fill, warp and auto-align transactions;
- explicit GPU resource owners for image, layer, mask, style, tool, history,
  scope, histogram and transient submit-lifetime resources;
- a renderer-facade import boundary enforced by `verify:boundary`;
- lazy optional pipelines so disabled authoring/effect features do not block a
  plain image from opening;
- an ordered processing-node runtime for Lens Fx and persistent Warp nodes;
- canonical document adjustment state that keeps the editable stack and its
  materialized shader input atomic and document-local.

Recent GPU/refactor commits, newest first:

- `5a9fa02` canonical document adjustment state;
- `af39214` Vite-compatible inline icon glob options;
- `e472d02` document image GPU resource ownership;
- `35a352d` document histogram runtime;
- `e469c66` document scope runtime;
- `1d0bb93` document source GPU loader;
- `7d7e8e0` document GPU memory policy;
- `1985510` reference difference measurement;
- `dc0a5bf` transient editor overlays;
- `aff15f4` document workspace surface.

Recent UI-only commits after the architecture checkpoint include CSS hot
reload, consolidated theme tokens, tool-option alignment, slider/segmented
control consistency and compact styling. These changes must keep using the
extracted workspace/panel contracts; they are not justification for moving
state back into the editor root.

## Last architecture issue fixed

Vite requires the second argument of `import.meta.glob` to be an inline object
literal. Reusing an `iconImportOptions` identifier broke development startup.
Both PNG and SVG icon globs now use inline options, and the standalone web build
proves the fix.

## Next architectural milestone

Continue reducing `WebGpuEngine` as a facade, one contract-tested seam at a
time. Do not combine this with new rendering behavior.

After the next coherent decomposition milestone, resume the active Warp track
from `../LIGHTTABLE_GPU_WARP_TOOL_SPEC.md`. Push is a working architecture
proof; the remaining Warp modes, masking, quality and resilience work are not
complete yet.

A macOS test also exposed noticeably slower tool switching and painting. Treat
this as a cross-platform production gate, not cosmetic polish. Instrument the
main thread, React/layout, render scheduler, GPU queue and scope refresh paths
before optimizing; the measurable budgets live in the modularization plan.

The first interaction pass is now in place: viewport pointer routing performs
one bounds read per event, paint owns an explicit preview/final-quality
lifecycle, and visible scope analysis plus histogram GPU readback are capped at
10 Hz during paint and adjustment gestures while the document preview remains
frame-coalesced. Gesture completion or cancellation resets that budget and
requests one final-quality effects/analysis render. This is a safe baseline,
not a substitute for profiling full-document compositing on representative
Macs.

Viewport presentation state is also compared at the actual WebGPU boundary:
canvas pixel dimensions and the eight `f32` view-uniform values. Repeated
ResizeObserver/layout emissions that resolve to identical GPU state no longer
upload the view buffer, invalidate the viewport or request another frame.
Scope option and interaction setters now follow the same semantic rule:
replaying an identical options object or interaction flag is a no-op instead
of scheduling analysis/render work.

Document-grade replacements, Lens Blur interaction flags, depth-view flags
and identical depth-result objects now follow that rule too. They are rejected
before GPU buffer uploads, effect invalidation, scope work or frame scheduling.
The effect runtime owns transient Lens Blur state and replays it when a node is
recreated, so this optimization preserves correctness across stack changes.

Scope canvas backing sizes are now synchronized at the resize boundary.
Repeated ResizeObserver notifications that resolve to identical WebGPU pixel
dimensions no longer request display frames, and ordinary scope renders no
longer read DOM layout. Scope analysis is deliberately unaffected by a
display-only resize.

Document publication now has a semantic GPU boundary. The engine retains the
latest immutable document snapshot for UI/editor queries, then compares only
render-bearing state before crossing into retained GPU synchronization.
Names, locks, timestamps, active-layer state and import diagnostics no longer
rebuild the compositor, Grade/Lens Fx or scopes. Structural order, pixels,
masks, transforms, styles, local stacks and document assets remain conservative
render dependencies. This replaces the earlier coarse `document.revision`
gate, whose revision also changed for nonvisual editor commands.

Frame submission now has an explicit no-work boundary as well. Renderer dirty
state reports only stages that can emit commands, and visible scopes expose
their own pending analysis/display state. A late histogram readback retry or a
presentation-only publication can therefore stop before creating and
submitting an empty WebGPU command buffer. This is intentionally a frame-graph
contract rather than a React heuristic; future processing nodes should expose
dirty work through the same boundary.

Scope analysis now follows actual canvas visibility, not only configured panel
flags. Collapsed sections, inactive dock tabs and hidden accessory panels do
not dispatch their analysis or redraw their retained results. The standalone
Hue Distribution and compact Color Mixer remain independent display consumers
of the same retained hue bins. Reopening either consumer marks only scope
analysis/display dirty; panel resize redraws retained bins without rebuilding
the document correction graph. Interactive analysis remains capped at 10 Hz
and gesture completion requests the final full-quality observation.

Document compositing and global correction now have separate invalidation
domains. The renderer retains the last valid document-only composite texture;
global Grade and Lens Fx edits reuse it and run only their downstream passes.
Layer, pixel, mask, transform, local processing and style mutations still mark
the document composite dirty and rebuild it before correction. The retained
handle does not allocate another texture and is cleared with the document GPU
generation. Keep this dependency boundary explicit when adding processing
nodes: a node attached to a layer invalidates the composite, while a document
post-process does not.

The correction graph now retains its existing stage outputs by handle (without
allocating duplicate textures) and tracks the earliest dirty stage. A
source-geometry edit rebuilds every downstream stage; a linear-spatial edit
reuses geometry; an output-transform edit reuses geometry and spatial work;
and a display-post edit such as Grain reuses all earlier work. Missing handles
invalidate their downstream dependency chain, and exports/reference metrics no
longer force a complete effect pass when the committed full-quality frame is
already current.

The Debug panel can now capture and reset correction render telemetry without
polling the renderer. A capture reports render calls, submitted frames,
no-work skips, correction frames and execution/reuse counts for document
composite, source geometry, linear spatial, output, display post and display
resolve. Timings deliberately measure CPU command encoding and resource
preparation; they are not asynchronous GPU execution timings. Use a capture
before and after one isolated interaction on representative macOS hardware to
decide the next optimization instead of adding speculative bypasses.

Adjustment presentation is now split into explicit `grade` and `lens-fx`
domains. The full immutable snapshot remains shared, but an interactive Lens
Fx publication no longer wakes the large Grade panel tree, and a Grade slider
no longer wakes Lens Fx. Whole-grade replacement commands such as reset and
paste deliberately publish to both domains. This is a React/main-thread
optimization, not a GPU bypass: renderer invalidation continues to follow the
processing-node dependency graph and the existing dirty-stage caches.

Interactive render cadence is now a renderer policy rather than a UI debounce.
Effect executors may report a preferred frame interval while their graph is
interaction-dirty. Active Lens Blur and Halation currently cap GPU submissions
at roughly 33 fps; lightweight grade-only stacks retain normal display-frame
cadence. Pointer/React updates are never delayed, skipped frames keep the newest
dirty state, and gesture completion removes the cap before the final-quality
render. Keep future expensive multipass nodes on this explicit cost-hint path
instead of adding component-specific timers.

Adjustment payload publication is also retained at the GPU boundary. The
document grade and every per-layer/Adjustment Layer grade compare the next
uniform payload and curve control points against their last published state.
Only changed uniform bytes or a changed 1024-sample curve LUT cross the GPU
queue. This means an effect-only edit performs no grade upload, a regular
slider edit does not rebuild the curve texture, and an active curve shape edit
does not rewrite an unchanged uniform. Keep this rule in the GPU payload owner;
do not duplicate dirty comparisons in React components or command handlers.

The render invalidation boundary also follows the visible payload. Editing the
stored settings of a disabled processing node now updates document state but
does not schedule correction, histogram or scope work. Uniform, curve, output
and enabled-effect changes resolve to their earliest affected correction stage;
only that stage and its dependants are rerun.

Histogram readback completion no longer schedules an unconditional follow-up
frame. The runtime records whether a dirty image arrived while its readback was
pending and requests a retry only in that case. This preserves fresh scopes
without producing one empty animation frame after every ordinary histogram
sample.

Recommended order:

1. Inventory the remaining mutable GPU/static-resource fields in
   `WebGpuEngine` and identify the smallest coherent lifecycle owner.
2. Extract static baseline pipeline/buffer/texture ownership or frame
   coordination, whichever can be moved without exposing concrete GPU services
   outside the renderer facade.
3. Add focused lifecycle tests before changing call sites.
4. Run the complete verification gate and make one local commit.
5. Only then continue toward replacing the combined grade shader bridge with
   registered processing-node executors.

The remaining Phase 6 architectural debt is intentional:

- Lens Fx already executes through registered nodes;
- Warp proves persistent geometry-node authoring and roundtrip;
- document and Adjustment Layer grades use the shared evaluator;
- the combined grade shader is still the compatibility bridge;
- arbitrary per-module grade GPU executors and fully free processing order are
  not complete yet.

Do not remove the combined grade path until neutral bypass, operation order,
curve LUT behavior, color-domain transitions and PSD mapping have equivalent
tests in the replacement runtime.

## Other open plan items

The main plan still tracks:

- replacing mounted-overlay retention with explicit cross-document resource
  eviction policy;
- finishing typed command migration and gesture transaction centralization;
- defining the final source-handle port and future RAW capability slot;
- adding explicit startup performance budgets;
- completing the generic grade/effect processing-node evaluator.

These are not regressions and should not be “fixed” by adding compatibility
branches. LightTable is still alpha: prefer one clean current model over legacy
format handling.

## Required verification gate

Run from `D:\mediavibe\LightTable` before every milestone commit:

```powershell
npm run typecheck -w @lighttable/app
npm test -w @lighttable/app
npm run verify:boundary
npm run build -w @lighttable/web
npm run typecheck -w @lighttable/desktop
git diff --check
```

For runtime-sensitive changes, additionally test:

- `run_dev.bat`: desktop development host and live updates;
- web development host;
- ordinary PNG/JPEG fast open;
- PSD drag/open;
- two open documents, active-tab switching and close;
- Grade/Lens Fx edits remain isolated per document;
- inactive document renderer suspension and surviving-tab resume;
- save/reopen of a layered LightTable document.

## Adjustment interaction performance

Adjustment gestures publish immutable preview snapshots to the owning Grade or
Lens Fx presentation domain. Pointer movement no longer serializes the complete
adjustment tree for equality on every event. One exact comparison remains when
the gesture ends, so returning a slider to its starting value creates neither a
document commit nor an undo entry. Immediate non-gesture commands retain their
single equality check.

Layer thumbnails now subscribe to a pixel-bearing revision key instead of the
complete immutable `ImageDocument` object. Active-layer, selection, opacity,
blend, naming and other non-pixel publications therefore neither restart the
asynchronous thumbnail controller nor publish an equivalent React map. Raster
and mask pixel revisions remain independent cache boundaries.

GPU document synchronization now follows the same principle. A cheap,
reference-aware recursive comparison runs only when the immutable document
revision changes. Rename and lock commands still publish canonical state and
remain undoable, but do not invalidate retained layer resources or downstream
analysis. Tests protect both no-op cases and visual opacity, visibility and
pixel-revision changes.

## Guardrails for resuming

- Keep both web and Electron green.
- Persistent mutations go through document commands and one transaction.
- React is presentation, never canonical document state.
- GPU resources belong to one document generation or an explicit shared owner.
- Async callbacks must be rejected when their document generation is stale.
- Optional feature failure must not block base image display.
- Do not introduce StoryBuilder dependencies into LightTable.
- Do not add legacy LightTable document compatibility during alpha.
- Make local milestone commits; do not push unless explicitly requested.
