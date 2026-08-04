# GPU resource optimization experiments — 2026-08-04

## Contract

Effect settings are canonical document data. GPU textures are disposable
derived caches. An optimization is accepted only after an A/B run of the
production Electron build on the same fixture, with memory, cold/warm timing,
long-task, error and visual evidence.

Machine-readable reports and screenshots live under
`tmp/effect-lifecycle-audit/` and are intentionally not committed.

## Experiment 1 — lazy optional effect targets

Fixture:

`EHS-396.psd` from the Save-the-Date corpus (production Electron build).

Protocol:

- select an existing visible raster owner;
- toggle each effect six times;
- separate the first cold activation from five warm activations;
- wait for the renderer memory estimate to stabilize;
- capture enabled and disabled viewport images;
- require every enabled cycle to reproduce the same pixels;
- compare the eager and lazy builds on the same source file.

| Effect | Eager cold | Lazy cold | Eager warm median | Lazy warm median | Eager p95 | Lazy p95 | Resident while enabled |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lens Distortion | 467.0 ms | 453.1 ms | 401.4 ms | 394.5 ms | 766.5 ms | 528.2 ms | 105.7 MiB |
| Chromatic Aberration | 411.5 ms | 452.3 ms | 395.6 ms | 399.2 ms | 433.1 ms | 404.6 ms | 97.1 MiB |
| Halation | 393.0 ms | 448.0 ms | 396.4 ms | 392.8 ms | 405.5 ms | 404.5 ms | 109.2 MiB |
| Grain | 453.9 ms | 453.7 ms | 398.7 ms | 389.9 ms | 433.2 ms | 399.8 ms | 291.3 MiB |

Interpretation:

- Warm activation is neutral within run-to-run noise and does not regress.
- Cold results are mixed; no cold-speed claim is made.
- The enabled steady-state allocation is intentionally unchanged because the
  same full-quality render still needs the same targets.
- Before first visible encode, the lazy build retains zero image-target bytes;
  a regression test verifies this for Lens Distortion, Chromatic Aberration,
  Halation and Grain. Lens Blur likewise defers its derived render targets but
  retains its canonical `r16float` depth source.
- All comparable enabled screenshots match across eager and lazy builds.
- Halation and Grain visibly differ from bypass in this fixture and remain
  deterministic. The selected source made Distortion and Chromatic Aberration
  pixel-stable at viewport resolution, so their shader fidelity remains covered
  by existing focused tests rather than claimed by this screenshot.
- Both runs recorded 54 long tasks. Their aggregate duration changed from
  7,857 ms to 7,797 ms; this is neutral and shows that large-document composite
  work, not allocation timing alone, remains the larger problem.

Decision: retain the lazy first-encode lifecycle. It removes up to hundreds of
MiB from enabled but not-yet-rendered owners without adding a warm interaction,
fidelity or stability regression.

## Experiment 2 — dirty-tile GPU pixel history

Fixtures:

- `D:\shapes.psd` for a repeatable before/after run;
- `EHS-396 copy.jpg` (12.7 megapixels) for a large-raster validation run.

The previous history implementation copied the complete RGBA16 pixel surface,
or complete R8 mask, at pointer-down. The accepted implementation captures each
newly touched 256 x 256 tile once per gesture immediately before its first GPU
paint submission. Pointer moves only extend that pending snapshot; pointer-up
publishes one undo command and pointer-cancel restores and destroys it.

| Gesture | Full-surface baseline | Dirty tiles | Reduction | Before | After |
|---|---:|---:|---:|---:|---:|
| `shapes.psd` pixel brush | 4.57 MiB | 0.50 MiB | 89.1% | 584.7 ms | 582.9 ms |
| `shapes.psd` pixel eraser | 4.57 MiB | 0.50 MiB | 89.1% | 573.4 ms | 574.3 ms |
| `shapes.psd` mask brush | 0.57 MiB | 0.06 MiB | 89.1% | 372.7 ms | 383.8 ms |
| 12.7 MP pixel brush | 97.1 MiB | 2.50 MiB | 97.4% | n/a | 587.1 ms |
| 12.7 MP mask brush | 12.1 MiB | 0.19 MiB | 98.5% | n/a | 383.2 ms |

The generic interaction audit now derives all pointer coordinates from the
actual fitted document rectangle. Paint, erase, mask and gradient actions must
advance the history state; a gesture outside the canvas is a test failure rather
than a misleading successful timing. On the large fixture, pixel and mask
undo/redo completed in 30.7–32.3 ms.

Full-surface operations such as mask fill and invert deliberately retain their
full-surface history cost. There is no CPU readback or CPU-to-GPU image upload:
capture, undo and redo remain GPU-to-GPU copies. Existing brush, fill and
gradient Electron smokes passed, including transformed brush behavior.

Decision: retain dirty-tile history for localized gestures. It materially lowers
bounded undo residency while keeping the hot path and ownership model simple.
The mask-brush wall-time difference on the small fixture is 11.1 ms and remains
inside interaction-run noise; no speed-improvement claim is made.

## Experiment 3 — immediate hidden Layer Style cache eviction

The production Electron A/B audit toggled the cached raster style owner
`EHS-395 / swirl` six times. The candidate released one full-document RGBA16
cache (100,800,000 bytes, 96.1 MiB) whenever the layer was hidden, and every
restored canvas hash matched the reference.

The cost was reproducible: median show latency rose from 266.8 ms to 283.7 ms
and 286.2 ms in two candidate runs (+16.9 to +19.4 ms). Immediate eviction is
therefore rejected. The production ownership policy remains unchanged. The
repeatable audit stays available as `npm run audit:desktop:style-cache`; future
memory-pressure or long-idle policies must beat the same fidelity and latency
gate without adding general cache infrastructure prematurely.

## Experiment 4 — tight persistent Layer Style caches

Layer Style evaluation remains full-document RGBA16F and uses the existing
three full-size work targets. Only the persistent, derived result cache is
copied to conservative integer bounds around the styled source. Cache bounds
are computed from the transformed source plus the existing maximum outer
effect expansion, rounded outwards and clipped only at the document canvas.
The compositor receives the cached texture together with its document-space
bounds; document data, effect parameters and effect algorithms are unchanged.

Production Electron A/B results:

| Fixture | Full-document cache | Tight cache | Reduction | Baseline show median | Tight show median |
|---|---:|---:|---:|---:|---:|
| `EHS-395`, raster Color Overlay | 2812.2 MiB total | 2287.7 MiB total | 524.5 MiB | 260.8–263.1 ms | 259.7 ms |
| `EHS-404`, raster Gradient Overlay | 2089.8 MiB total | 1999.3 MiB total | 90.5 MiB | 225.9 ms | 229.5 ms |

Each lifecycle run used six hide/show cycles. Every restored image was stable
within its run and no page, console, runtime or WebGPU error occurred. The
complete Layer Style reference plan additionally exercised context, solo,
bypass, stacked effects, fill opacity and 400% zoom. Enabled solo Color,
Pattern, Gradient and Drop Shadow captures were pixel-exact against the
full-document-cache build. Existing dormant PSD Drop Shadow and Outer Glow
instances were also enabled on a raster fixture; their stacked captures
preserved the complete outer halo and matched the baseline styled pixels.

The 400% Gradient lifecycle capture was pixel-exact. The 400% Color lifecycle
capture differed on 176 of 1,051,350 pixels (0.016740%), always by at most one
8-bit channel step; the effect-only reference was pixel-exact and no shape,
edge, crop or halo difference occurred. Context captures showed the same
maximum-one-step background presentation noise in their bypass images. This
is below visible output precision and is not a Layer Style fidelity change.

Decision: retain tight persistent caches. They remove the largest measured
repeated Layer Style allocation without changing canonical data, effect
evaluation, settled visual output or warm interaction latency. The known
Photoshop-fidelity gaps in individual Layer Style algorithms remain a separate
quality task and must not be hidden by cache work.

## Experiment 5 — retire Layer Style work targets after every submit

A post-submit candidate detached the three full-document RGBA16F style work
targets and handed them to the existing submitted-resource retainer. GPU
destruction remained correctly delayed until `onSubmittedWorkDone()` and the
settled estimate fell by another 288.4 MiB on `EHS-395` and 299.3 MiB on
`EHS-404`. All restored images remained stable and no runtime or WebGPU error
occurred.

The buffers are nevertheless reused by cache-missing styled owners during
ordinary visibility cycles. Recreating them increased the `EHS-395` median
show latency from 259.7 ms to 270.8, 278.3 and 280.9 ms across three production
runs: a repeatable 11–21 ms regression.

Decision: reject per-submit work-target retirement and restore the production
ownership policy. A future change may reduce these targets only if it removes
their full-frame requirement or proves safe reuse/aliasing without allocation
churn; merely evicting them fails the interaction-speed gate.

## CPU-to-GPU transfer finding

The four toggled effects do not upload image-sized CPU data when enabled. They
write only small uniform payloads (32 bytes for Lens Distortion, Chromatic
Aberration and Halation; 64 bytes for Grain). Their large allocations are
GPU-local render targets. Lens Blur uploads a single-channel 16-bit depth map
when new depth analysis is published, not on every effect frame.

Therefore CPU-to-GPU bandwidth is important for document hydration, decoded
layers, depth publication and future cold-cache restoration, but it is not the
measured bottleneck in ordinary warm FX toggling. Compression work must target
those actual upload boundaries and must not insert encode/decode work into a
GPU-only effect path.

## Next experiments

1. Add resource lifetime telemetry before aliasing full-frame temporaries.
2. Test inactive-document eviction and restoration latency; immediate
   hidden-layer eviction has already failed the latency gate.
3. Only then test cold CPU tile compression and checkpointed stroke replay.

## Render-engine audit extension — 2026-08-05

`npm run audit:desktop:render-engine -- --engine <compositor|vector|text>
--file <fixture> --iterations <count>` now applies one production Electron
protocol to all three engines. It records hide/show wall latency, renderer GPU
estimates, GC-backed JS heap retention, long tasks and per-stage render encode
telemetry. Every restored canvas capture must reproduce the first SHA-256 hash;
page errors, console errors, a stopped document runtime, more than 5 MiB of
retained heap, or a changed canvas hash fail the run. Text editing retains the
additional `smoke:desktop:paragraph` gate for authored content, drag selection,
layout-cache reuse and input-to-submit/input-to-GPU latency.

The audit intentionally measures a real document interaction. Its two-frame
settle interval adds a fixed floor to wall timings, so A/B comparisons use the
same script, packaged builds, fixture, machine and iteration count. CPU encode
telemetry is interpreted separately from end-to-end interaction latency.

### Accepted: bounded vector realization cache

The native vector renderer previously flattened every canonical cubic path on
every document composite, even though the WebGPU vertex buffer already used a
geometry-revision/tolerance key. A 32 MiB weighted CPU LRU now uses that same
identity. Transform and paint revisions reuse flattened geometry; geometry
revision changes miss the cache. Live-shape paint and transforms are refreshed
on hits, and destroying the document renderer clears the cache.

On vector-heavy `EHS-395` (14 vector layers), twelve composites changed total
document-composite encode from 22.08 to 20.80 ms (-5.8%) and the maximum from
2.61 to 1.94 ms. Median end-to-end hide/show remained neutral (161.35/155.76
ms baseline; 159.15/157.01 ms candidate), renderer GPU bytes stayed exactly
2,398,855,792, and baseline/candidate viewport PNGs were byte-identical. The
small `shapes.psd` fixture remained within encode and wall-time noise, so no
larger claim is made.

### Accepted: keep text diagnostics off the input hot path

`beginTextInput` no longer publishes a React-facing telemetry snapshot per
keystroke. Latency bookkeeping is still published when its exact text source
is submitted and reaches GPU completion. Detailed scheduler guards and
housekeeping remain internal; font configuration, document synchronization,
shaping, source publication, retained-preview fallback and failures keep their
debug breadcrumbs.

Five isolated candidate paragraph runs and four completed baseline runs were
alternated on the same packaged builds. Median authored typing changed from
1298.1 to 1210.8 ms, input-to-submit p95 from 38.4 to 28.6 ms, and input-to-GPU
p95 from 66.9 to 44.9 ms. Individual runs remain noisy, so the latency gates
stay in the repeatable smoke rather than becoming a one-number product claim.
`TextTest.psd` visibility/composition stayed neutral, its renderer estimate
remained 184,721,784 bytes, and the baseline/candidate canvas hash was exactly
equal. Paragraph smoke user-data is now process-isolated so earlier editor
sessions cannot pollute later runs.

### Rejected: automatic vector cover scissors

A candidate derived conservative transformed fill bounds and exact stroke-mesh
bounds, then scissored otherwise full-target stencil/cover passes. Output was
byte-identical, including the large-stroke `shapes.psd` fixture. It did not
reduce CPU encode or end-to-end latency: `shapes.psd` average composite encode
rose from 0.560 to 0.624 ms, while `EHS-395` show latency rose from 155.76 to
186.33 ms. Full-attachment stencil clears likely remain dominant. The change
was removed; a future tiled vector surface must profile clear cost explicitly.

### Rejected: one composite uniform arena per frame

A candidate replaced per-layer 32/80-byte uniform buffers with one
256-byte-aligned frame arena and one queue upload. `EHS-395` remained
byte-identical and retained the same renderer memory estimate, but average CPU
encode remained 1.67–1.80 ms versus 1.72 ms baseline and median show latency
repeatedly rose to 170–187 ms versus 158 ms. The arena and its complexity were
removed. Fewer CPU-to-GPU API calls are not automatically faster on the current
Windows WebGPU backend; production interaction latency remains the gate.

## Whole-app endurance validation — 2026-08-05

The generic desktop stress runner now treats every tested interaction as a
roundtrip. Layer selection, visibility, zoom, pan and panel navigation restore
their reference state before the post-GC sample. This matters because selecting
a text layer schedules the Text panel on a later animation frame, while
Dockview deliberately retains a bounded alternate React panel tree. Comparing
two different active layer/panel states produced false detached-DOM growth of
400–1,796 nodes even though live DOM and heap were stable. The runner now waits
for that scheduled product action, restores the original layer and Grade panel,
and can optionally include Chromium's detached-DOM root summary with
`--diagnose-dom true`.

Ten interaction iterations passed on `TextTest.psd`, `shapes.psd`,
`FormulierPersoneel.pdf` and vector/style-heavy `EHS-395.psd`. Tail post-GC heap
variation was 0.15–0.35 MiB; no page error, stopped document runtime, listener
growth or suspicious retained DOM remained. A second desktop pass opened all
ten Save-the-Date PSD templates and exercised layer selection/visibility, zoom,
pan and panel navigation. All ten passed. The three initially state-mismatched
fixtures (`EHS-402`, `EHS-406`, `EHS-409`) passed six-iteration rechecks with
0.04–0.08 MiB tail heap variation and stable live DOM.

The read-only PSD inventory covers 10 documents and 284 layers. The PDF corpus
contains 974 files. pdf.js retains enough process-wide data that one monolithic
Node run can reach the 4 GiB heap limit, and the intentional
`operator_list_cycle.pdf` stress fixture can exhaust a worker by itself. The
corpus runner therefore uses bounded subprocess batches and recursively
isolates a failed batch down to one file instead of losing the remainder of the
run. Final results were 954 valid PDFs passed, 12 password-protected, seven
known malformed/fuzz PDFs rejected, and the cyclic operator-list fixture safely
reported as a worker failure. This batching belongs to test infrastructure; it
does not change LightTable's PDF runtime or claim that malformed inputs render.

The complete workspace verification remained green before this endurance pass:
304 application test files / 1,616 application tests plus every workspace test,
all typechecks, Web and desktop production builds, and the complete desktop tool
smoke set. Engine A/B screenshots for compositor (`EHS-395`), vector
(`shapes.psd`) and text (`TextTest.psd`) retained exact SHA-256 canvas hashes.

Decision: retain the two measured engine optimizations (tight style caches,
bounded vector realization cache) and the text input diagnostic reduction.
Retain the generic render-engine and endurance audits. Do not add vector
scissors, a composite uniform arena, immediate cache eviction, CPU compression
on warm GPU paths or an unproven renderer replacement. Realtime interaction
latency and settled visual equivalence remain hard gates; memory reduction is
accepted only after those gates pass.
