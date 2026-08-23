# Task 303 final report — scalable vector rendering and Vello bake-off

Recorded: 2026-08-22

> Historical decision snapshot. Task 305 and commit `9e07bd97` supersede the
> launch/routing decision below: LightTable now ships one hybrid renderer,
> retained islands are invariant, and eligible islands use Vello with native
> LightTable fallback on the shared device. The measurements and package
> boundaries remain evidence; the former selectable-backend/default
> recommendation is not current configuration.

Branch: `main`

Baseline: `c71254b1`
Final implementation: `da214c62`

## Verdict

Task 303 achieved its architecture and evidence goals. LightTable now has a
renderer-neutral, revision-keyed vector scene boundary; a substantially faster
current WebGPU path; a real zero-copy Vello backend on the app's shared WebGPU
device; secure reusable SVG normalization; editable SVG gradients, opacity
groups and vector clips; deterministic device-loss recovery; and packaged
correctness/performance/lifecycle evidence for both backends.

The production routing decision is deliberately conservative:

- **At this checkpoint, Current WebGPU remained the normal shipping default.** It had the broadest
  proven editor integration and wins the broad 17-surface recomposition case.
- **At this checkpoint, Vello was an explicitly build-selectable hybrid backend.** In Vello
  mode, supported PaintScene content uses Vello and explicit unsupported
  content can use the LightTable backend on the same Vello-owned browser
  device. This is the only current mode that admits both implementations.
- **The checkpoint did not auto-select per document.** Device ownership was locked before
  first WebGPU initialization. A browser-owned current device cannot later be
  replaced by Vello without rebuilding every dependent GPU resource.
- **Promotion criterion:** remove the reproducible first-close latency spike,
  expand exact clip/mask coverage, and pass a larger representative corpus.

This is not a rejection of Vello. On the pathological 26,492-element scene it
is already the materially better mutation backend and uses far less texture
memory. The evidence does not yet justify changing every user's startup device.

## Stable package ownership

The resulting split is intentionally reusable outside the full editor:

| Package | Sole authority / responsibility |
| --- | --- |
| `@lighttable/vector-core` | Canonical editable geometry and transforms |
| `@lighttable/paint-core` | Canonical paint instances and color semantics |
| `@lighttable/vector-svg-normalizer` | Secure, bounded `usvg` normalization; never document authority |
| `@lighttable/vector-svg` | SVG import/export semantics and editable scene projection |
| `@lighttable/paint-scene` | Immutable validated renderer-neutral scene contract |
| `@lighttable/paint-scene-adapters` | Canonical/source models to PaintScene; explicit capability issues |
| `@lighttable/vector-rendering` | Derived realization/tessellation utilities and caches |
| `@lighttable/vector-webgpu` | LightTable WebGPU rasterization and reusable mask compositing |
| `@lighttable/vector-vello` | Vello scene synchronization and shared-device rendering |
| `@lighttable/lighttable-app` | Document lifecycle, history, UI orchestration and final compositing |

Canonical document data never depends on either renderer. PaintScene and GPU
resources are derived, revision-keyed and disposable. Pan, zoom, workspace UI
changes and backend recovery do not mutate document authority.

The same boundary is suitable for future AI/EPS/PDF adapters: each importer
must own source parsing, security and fidelity reporting, then project into
canonical data or PaintScene. Vello's PostScript-like scene concepts are useful
implementation precedent, but Vello is not a second PDF/AI document model.

## Proven performance and correctness

### Pathological VORTEXT scene

- Original packaged open: about **65.6 s**.
- After bounded linear SVG traversal and import improvements: about **3.0 s**.
- Zoom before cache/invalidation repair: **145,829 ms** total, p95 frame
  **666.63 ms**, 11 document recomposites.
- Zoom after repair: **956 ms** total, p95 **16.74 ms**, **0** document
  recomposites, unchanged reference pixels.
- Current six-edit mutation retained heap was reduced from **142,820,324 B**
  to **1,441,392 B** by structural sharing; restored pixels are exact.
- Incremental Vello mutation uploads one changed fragment rather than all
  26,492 elements. Recorded edits complete in **90–133 ms**, versus roughly
  **1.0–1.3 s** on current in the matched heavy-scene bake-off.
- Vello estimated texture memory is about **57 MB**, current about **109 MB**
  on this scene. Browser-oracle RMSE is **1.38** for Vello versus **6.36** for
  current in the normalized four-file corpus evidence.

### Broad SVG vector fixture with clips

Fresh packaged runs of `svg_vector_render_test.svg` pass on both backends:

| Metric | Current | Vello |
| --- | ---: | ---: |
| First rendered document | 2,412 ms | 2,447 ms |
| Browser-oracle RMSE | 23.76 | 23.98 |
| Estimated GPU bytes | 266,436,384 | 186,356,384 |
| 24-step pan document composites | 0 | 0 |
| Zoom p95 frame | 16.75 ms | 16.73 ms |

The two LightTable previews compare at **RMSE 3.70 / MAE 0.60** per channel;
only **1.08%** of channel values differ by at least 16. That supports one
canonical scene with expected rasterizer/antialiasing differences.

Eight repeated hide/show cycles restored an identical screenshot every time,
with zero GPU growth and no page/console/runtime errors. Current used **34.87
ms** total document encode; Vello used **54.27 ms**. Vello saves about **80 MB**
but is 56% more expensive in this recomposition workload.

### Close/open and failure lifecycle

- Both packaged backends passed **16 complete close/reopen cycles**, producing
  16 distinct document session identities and an active ready renderer every
  time.
- Estimated GPU bytes remained exactly flat for every cycle.
- Forced-GC heap stabilized around **4.45–4.50 MiB** above the cold sample,
  with intermediate drops rather than linear per-document growth.
- No page errors, console errors or stopped runtimes occurred.
- Warm opens stabilized around **122–144 ms**.
- Current closes normally stabilized around **41–59 ms**.
- Vello closes normally stabilized around **43–51 ms**, but the first Vello
  close reproducibly took about **1.3–1.4 s**. This remains a promotion blocker.
- A packaged forced-device-loss run on VORTEXT reacquired a new Vello
  device/runtime while preserving canonical revision, complete layer
  projection and preview SHA-256.

The reusable commands are:

```powershell
$env:LIGHTTABLE_TEST_EXECUTABLE='D:\path\to\LightTable.exe'
npm run audit:desktop:render-engine -- --engine vector --file 'D:\path\scene.svg'
npm run audit:desktop:vector-lifecycle -- --file 'D:\path\scene.svg' --cycles 16
```

## SVG and scene semantics delivered

- secure preflight plus local-only, feature-minimal `usvg` WASM normalization;
- external filesystem/network resources and active content remain forbidden;
- unknown harmless SVG metadata/presentation attributes can be ignored or
  reported instead of crashing the whole import;
- basic shapes, paths, transforms, CSS-derived presentation, local `<use>`,
  units and markers normalize into editable geometry;
- linear/radial gradient semantics, including SVG 2 focal radius, survive
  import, native save/reopen, both renderers and SVG export;
- isolated group opacity survives canonical materialization and round-trip;
- local `clipPath` resources, including normalized object-bounds clips, survive
  as editable canonical vector clips and round-trip through native save/export;
- PaintScene schema 4 has validated revision-keyed clip resources and recursive
  composition; Vello synchronizes fragments and clips independently;
- current WebGPU uses a reusable premultiplied mask compositor rather than a
  CPU bitmap/readback route.

## Explicit remaining limitations

These cases fail explicitly or remain preserve-only; none should silently
render incorrect pixels:

1. A clip path containing multiple independent operands still needs an exact
   boolean union implementation. Source-over alpha accumulation is not a valid
   substitute at coincident antialiased edges.
2. Inverted vector clips are not implemented.
3. A group combining vector and raster masks needs exact mask multiplication.
4. A group combining a vector clip and layer styles needs an exact ordering and
   masking implementation.
5. SVG patterns, filters, embedded images, text and richer mask semantics are
   not complete editable features yet.
6. The current generic PaintScene WebGPU consumer rejects hierarchical clips;
   the editor's canonical current path handles the admitted single-operand
   vector clips through its dedicated mask compositor.
7. Cross-platform packaged evidence is still required; this task's runtime
   distributions are Windows/Electron/WebGPU evidence on the owner's machine.

## Rejected or bounded paths

- One-render-pass-per-vector-layer batching regressed the measured workload and
  was reverted.
- Viewport-dependent retessellation was removed because a document-sized
  retained surface must not rebuild geometry merely because the camera zooms.
- Direct `vello_svg` document authority was rejected. It is useful as an oracle
  and renderer-side parser, but it does not satisfy LightTable editability,
  security, round-trip and canonical-history requirements.
- CPU raster fallback/readback was rejected for the normal vector path.
- Silent approximations for unsupported clips/masks were rejected.
- Automatic Vello-default promotion was rejected for now by mixed small-scene
  latency, slower broad recomposition and first-close evidence.

## Key commits

- `dda94bba` — eliminate viewport-driven document recomposition.
- `a5db693e`, `ba8c5ea1` — secure reusable SVG normalizer and shared routes.
- `72fedbf7`, `0ba3777a` — validated PaintScene clip stacks/composition.
- `1f93bd63`, `12bd2a20` — incremental Vello synchronization and telemetry.
- `f57fd4e4`, `26c7b87e` — idempotent teardown and packaged device recovery.
- `560fe606` — canonical SVG opacity groups.
- `c27552a4` — editable vector clips through SVG, native persistence and both
  render backends.
- `da214c62` — packaged backend recomposition and document lifecycle audits.

## Manual validation still requested

Before treating the current hybrid renderer as release-qualified, manually
inspect on at least one second
GPU/vendor and one lower-tier qualified machine:

- gradient and clipped-edge appearance at 25%, 100%, 400% and high-DPI scale;
- first Vello document close responsiveness;
- mixed raster/vector documents with floating panels and workspace switching;
- save, reopen, undo and SVG re-export after editing admitted clip geometry;
- device loss/recovery while two vector documents are open.

Task 303 is complete as an evidence-led architecture and backend bake-off. Its
subsequent production integration is tracked by Task 305 and the canonical
architecture documents. The remaining items above are scoped product features
or release gates, not hidden correctness claims.
