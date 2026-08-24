# Performance contract

Performance is a system property. A fast shader cannot compensate for React
state churn, redundant composites, unbounded textures or a scope readback on
every pointer event.

## Dirty-only rule

Every semantic mutation declares what became dirty. Current dirty domains
separate document composite, correction/effects, blur input, viewport and
histogram/scope work. Viewport pan/zoom must not rebuild the document
composite. A disabled node changing settings must not wake the render path.

No dirty work means no GPU submission. Dependency-only flags must not produce
empty command buffers.

## Interaction rule

- Raw pointer events stay out of canonical React/document state.
- Publish only the latest value per animation frame and synchronously flush
  the final pointer-up value.
- One continuous gesture becomes one undo command.
- Expensive graphs may lower preview cadence or quality while the browser input
  loop remains responsive; pointer-up schedules final-quality evaluation.
- Brush/warp dab schedulers own spacing and coalescing.
- Selection outlines and other overlays must not force image recomposition.
- Animated overlay audits reset and query document-scoped render telemetry;
  selection-ant phase changes must report zero heavy-stage executions and zero
  correction frames.

## Caching and revisions

Caches key off the smallest relevant revisions: source pixels, geometry,
mask, processing stack, styles, composite content and presentation. A viewport
revision is not a content revision. Cache ownership must include byte estimates,
explicit invalidation, disposal and device-loss behavior.

Vector caching is island- and fragment-aware. An unchanged island must be
rejected by dependency identity before PaintScene construction or WASM. A
normal edit projects/uploads changed fragments only. Visibility skips
compositing but retains the island; warm textures may become cold under the
per-document budget while JS/Rust scene state remains independently retained.
Pan/zoom must produce zero document composites and zero island scene rebuilds.

Scopes depend on visible composite content, not pan/zoom. Reuse their analysis
until that content revision changes. Hidden or collapsed scopes do no work;
interactive scope refresh may run at a lower cadence than the viewport.

Layer thumbnails are fitted inside a bounded box and cached by pixel/mask/
processing revision. They must not read back a full-resolution PNG for every
layer list render.

## Resource and precision policy

- Compile optional pipelines lazily.
- Allocate heavyweight depth, blur, style, warp and vector resources only when
  a node/tool needs them.
- Keep inactive document renderers paused; keep resident resources only within
  an explicit memory policy.
- Avoid CPU readback on paint, pan, zoom and slider hot paths.
- Use workers/Wasm for expensive CPU codecs or analysis; do not penalize the
  normal PNG/JPEG/8-bit path.
- Preserve high precision internally, but do not allocate maximum precision or
  every optional buffer pre-emptively.

## Build profiles and measurement

The user-facing `release` profile is minified and contains no render telemetry
collector in its hot path. `instrumented` is the minified qualification profile:
it preserves production scheduling and optimization while compiling in render
telemetry for external automation. `debug` additionally enables source maps,
UI development tools and detailed vector profiling. Qualification scripts use
`package:desktop:verify` (instrumented); `run_release`, `build.bat` and
`build.sh` produce the clean release profile. Bundle-boundary verification must
fail when the collector is present in a clean package or absent from an
instrumented/debug package.

## Responsiveness targets

These are engineering goals, not claims that every device meets them today:

- UI and tool switching remain responsive on integrated Mac GPUs.
- Lightweight grade previews can update at display cadence.
- Heavy effects degrade preview work rather than input responsiveness.
- Opening a normal image reaches first useful frame without initializing every
  optional subsystem.
- A warm application targets first useful document pixels within 500 ms. This
  is distinct from final editable readiness and cold process/device startup.
- Background documents and unchanged scopes consume no recurring GPU work.

Instrument first frame phases, GPU-owned texture estimates, stage cache hits,
scope refreshes and interaction frame intervals. Optimize measured ownership,
not isolated microbenchmarks.

`DocumentStartupTimeline` is the current monotonic document-scoped trace. For
SVG it can record file selection/bytes, parse and usvg normalization,
canonical construction/publication, adapter/device/Vello readiness, first
island/GPU/compositor submissions, animation-frame presentation and first
visible pixel. `FIRST PIXEL VISIBLE` requires queue completion plus a browser
paint opportunity; a screenshot is useful evidence only when the harness also
waits for and verifies the final editable canonical island.

Current packaged Windows/discrete-GPU evidence for the 26,492-path
`VORTEXT.SVG` is five warm first-pixel samples of 428--446 ms. The conservative
early SVG preview is renderer-only; final editable readiness remains roughly
1.0--1.25 s in those runs. Cold measurements have shown about 1.5 s in shared
WebGPU/device initialization on the measured system, so a warm target is not a
cold-launch claim.

Warm-edit profiling also constrains priorities: PaintScene object construction
and LightTable orchestration have been material, while JSON plus JS/WASM
transport is small for one-fragment deltas. Large initial scenes do spend
material time in Rust JSON deserialization, so binary bootstrap remains a
measured future option, not a blanket warm-path rewrite. Chromium currently
does not expose reliable exclusive Vello GPU timestamps in the packaged path;
queue-completion wall time must not be relabelled as GPU execution time.

The production hardware/soak gate, provisional Windows targets and physical
device claim boundary are defined in `SUPPORTED_HARDWARE_AND_SOAK_GATE.md`.
The 6 August development-system run passed lifecycle and idle-work gates, but
measured Type Tool input-to-GPU latency of 67.7-117.6 ms remains above the
direct-manipulation target. A green soak is not a claim of Photoshop parity.

The completed 4 August 2026 implementation audit, measured packaged stress
evidence and ranked follow-ups are recorded in
`reference/implementation/RENDERING_PERFORMANCE_AUDIT_2026-08-04.md`.
