# Rendering performance audit - 4 August 2026

Status: completed implementation audit and measured follow-up register.

This audit covers the active rendering and presentation paths. It does not
replace `PERFORMANCE_CONTRACT.md`; that file remains normative. No item below
permits lower settled resolution, precision, text/vector fidelity or export
quality. Interactive preview quality is allowed only where the existing
contract already requires a final-quality settle.

## Scope reviewed

- renderer startup, source upload and document publication;
- dirty-state fan-out and animation-frame scheduling;
- document compositor planning and GPU encoding;
- source-geometry, effect, output and display stages;
- viewport presentation and editor overlays;
- histogram/scopes scheduling and readback;
- raster paint, pixel history, transform and selection resources;
- vector, text, Layer Style and derived-preview caches;
- layer-thumbnail generation and UI publication;
- export/readback boundaries;
- GPU ownership estimates, history retention and teardown;
- React publication paths driven by renderer diagnostics and thumbnails.

Primary implementation boundaries reviewed include `WebGpuEngine`,
`RenderDirtyState`, `RenderInvalidationScheduler`, `LayerDocumentRenderer`,
`LayerCompositor`, the renderer runtime/resource stores, effect runtime,
text/vector coordinators, scope/histogram runtimes, viewport presentation,
thumbnail controller and editor diagnostics.

## Verified strengths

1. Dirty domains distinguish document composite, correction stages, viewport
   and analysis. Viewport-only changes do not require document composition.
2. The frame scheduler coalesces invalidations, pauses inactive documents and
   skips command-buffer creation when no executable work remains.
3. Heavy interaction graphs can cap submission cadence while retaining the
   newest state and scheduling settled quality on release.
4. Compositor analysis is pure before GPU encoding, and a single trivial
   full-canvas raster can bypass composition.
5. Optional text, vector, styles, effects, depth and selection resources have
   explicit owners, estimates and destroy paths.
6. Histogram and scopes are observers of content revisions rather than pan or
   zoom, and asynchronous readback cannot blindly wake empty frames.
7. Text input, paint/warp dabs, resize and other high-frequency UI paths use
   frame-level coalescing rather than publishing every raw event to React.
8. Layer thumbnails are bounded GPU exports keyed by source revisions; they do
   not read full-resolution PNGs into the Layers panel.

The focused unit suite already covers dirty propagation, no-work skips,
paused scheduling, stage ordering, cache invalidation, texture ownership,
selection resources, text caches and viewport settle behavior.

## Defects found and resolved during the audit

### Detached raster history bypassed its byte budget

Structural create/delete mutations retained every raster ID from both document
snapshots and declared zero bytes. Unique temporary layers therefore remained
GPU-resident until the 100-entry limit even when the intended 512 MiB budget
had already been exceeded.

Resolution:

- retain only raster/mask identities that appear, disappear or change mask;
- report a conservative high-precision texture estimate to command history;
- let the existing history eviction trigger runtime pruning.

Physical result: a 60-cycle TextTest create/paint/delete run rises during valid
undo retention, reaches about 395 MiB by iteration 20, and remains exactly
flat through iteration 60. Post-GC JavaScript heap ends at 13.4 MiB; live DOM
and listener counts remain flat.

### Hidden diagnostics accumulated presentation DOM

Repeated informational render/comparison samples created new log rows inside
the mounted but inactive Debug panel. Visibility stress added 28 live elements
per roundtrip despite stable content memory.

Resolution:

- identical informational diagnostics are idempotent;
- errors and warnings remain repeatable;
- the panel renders only the newest 100 entries while Copy all retains the
  complete bounded log.

Physical result: 20 layer-visibility roundtrips keep 13 rendered debug rows,
1,210 live elements, 3,067 listeners and the 65 MiB GPU estimate flat after
warm-up.

### Large layer stacks withheld thumbnail feedback

The thumbnail controller exported all stale channels serially and published
the map only after the final channel. A large PSD could therefore show blank
or stale rows for the duration of hundreds of bounded GPU readbacks and PNG
encodes even though early thumbnails were already ready.

Resolution:

- preserve current thumbnails while newer revisions are prepared;
- publish completed thumbnails in batches of eight;
- yield one animation frame between batches so input and painting can run;
- keep the existing 80 x 80 maximum, aspect ratio, semantic transform,
  revision key, cancellation and object-URL disposal behavior.

This changes presentation latency, not image quality or semantic authority.

## Measured packaged gate

`npm run stress:desktop -- --iterations 10` exercises selection, visibility,
zoom, pan, panels, temporary raster creation, paint and deletion without save.
The final packaged run passes:

| Document | Result | Page/runtime errors | Layer drift | Settled leak signal |
| --- | --- | ---: | ---: | --- |
| `D:\TextTest.psd` | Pass | 0 | 0 | None |
| `D:\shapes.psd` | Pass | 0 | 0 | None |
| `D:\FormulierPersoneel.pdf` | Pass | 0 | 0 | None; undo GPU cache plateaus at about 686 MiB in the ten-cycle scenario. |

The gate stores raw post-GC heap, live/detached DOM, listener, GPU estimate,
status, layer and screenshot evidence. It distinguishes initial allocation and
bounded undo growth from continued growth in the final third of samples.

## Remaining ranked opportunities

### P0 - responsiveness and trust

1. Instrument the unresolved large-document native save stall by phase:
   final text settle, semantic asset enumeration, GPU readback, PNG encoding,
   archive construction and host write. Do not optimize before the stalled
   phase is identified.
2. Add startup phase timings for PSD parse, composite decode, semantic
   realization, source upload, first frame and accessory/thumbnail readiness.
   Current first-frame telemetry is good but does not explain the reported
   10-20x Photoshop gap by itself.
3. Run the stress gate on an integrated GPU and web browser in addition to the
   current high-end Windows desktop. The web physical browser gate is blocked
   when no controlled browser is available.

### P1 - eliminate broad work

1. Add document-composite cache accounting by layer/subtree revision so a
   local edit can reuse unaffected render islands. This is also the required
   fallback architecture for unsupported adjustment scopes.
2. Separate active overlay/caret/selection updates completely from text source
   cache publication; profile input-to-submit and input-to-GPU p95 on long
   paragraphs and many text layers.
3. Virtualize or visibility-prioritize thumbnails for hundreds/thousands of
   rows after the progressive batch path has field data. Do not remove or
   downsample the authoritative layer pixels.
4. Cache stable bind groups and effect-owner sets only where resource identity
   and revision tests prove reuse. Avoid micro-optimizing allocation without
   telemetry.
5. Add dirty-region/tiled evaluation for large paint, mask and local-effect
   edits only after exact halo, blend, mask and export behavior is specified.

### P2 - throughput and portability

1. Move PNG/archive encoding for large native saves behind a cancellable
   worker/Wasm boundary while retaining identical bytes and error reporting.
2. Add renderer telemetry budgets to CI fixtures: submissions, correction
   frames, composite passes, scope passes, cache hit/miss, peak owned bytes and
   settled latency.
3. Define inactive-document residency/eviction policy using measured GPU
   ownership rather than document count alone.

## Quality gates for future optimizations

Every rendering optimization must preserve:

- identical semantic document state and undo/redo behavior;
- high-zoom vector/text/stroke quality and exact settled transforms;
- linear high-precision intermediates and explicit output conversion;
- masks, clipping, fill opacity, blend and effect ordering;
- native save/reopen and explicit flatten/export decisions;
- a final-quality frame after any interactive approximation;
- clean WebGPU validation and deterministic resource disposal.

Performance changes require a before/after telemetry capture plus the closest
pixel, compositor-plan, cache-lifetime and packaged interaction gates. A lower
frame time with a different result is a rendering bug, not an optimization.
