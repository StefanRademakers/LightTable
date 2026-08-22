# Task 303 renderer program checkpoint

Recorded: 2026-08-22
Branch: `main`
Baseline: `c71254b1`

## Current proven state

- The heavy `VORTEXT.SVG` packaged open path improved from approximately
  65.6 seconds to approximately 3.0 seconds after replacing a quadratic XML
  descendant traversal with a bounded iterative walk in `c71254b1`.
- The same heavy document pans with zero document composites after
  `dda94bba`; the recorded 24-step automation gesture settles in about 410 ms.
- A naive one-render-pass-per-vector-layer experiment regressed the measured
  workload and was fully reverted. Fewer passes alone is not accepted as an
  optimization.
- `.referenceCode/vello` is an ignored research checkout. It is not a product
  dependency.
- Production-packaged zoom profiling exposed two independent faults:
  `RevisionedResourceCache.trim()` performed a full cache scan per eviction,
  and viewport scale buckets invalidated a fixed document-sized vector surface.
- The O(n) eviction scan is replaced by exact insertion-ordered O(1) LRU
  eviction. Vector tessellation now depends on authored document transforms,
  not viewport zoom, because the retained target remains document-sized.
- On the same VORTEXT 24-step zoom evidence, total zoom time fell from
  145,829 ms to 956 ms, settle time from 145,258 ms to 667 ms, p95 frame
  interval from 666.63 ms to 16.74 ms, and document composites from 11 to 0.
  Pixel counts and reference RMSE remained identical.
- The full four-file external SVG corpus passes packaged open, preview, pan and
  zoom evidence. Every pan and zoom gesture submits presentation frames with
  zero document composites; representative zoom p95 intervals are ~16.7 ms.
- SVG import now uses one UUID namespace per import plus monotonic element,
  subpath and anchor counters. VORTEXT open profiles removed 137.4 ms of
  `randomUUID` self-time. Three packaged A/B runs changed median first render
  from 2,949 ms to 2,795 ms and median total evidence time from 8,457 ms to
  8,261 ms, with identical pixel evidence.
- The isolated Vello/wgpu 30 probe passes in Electron 39. JavaScript creates a
  texture on the Rust/wgpu-owned browser device, Rust wraps it, Vello renders a
  background and circle, and JavaScript reads both expected pixels byte-exact.
  This proves a zero-copy Vello resource boundary is technically available.
- Heavy vector mutation no longer reparses and deep-clones every element in the
  layer. Unchanged canonical elements are structurally shared while the changed
  or untrusted element still crosses strict parsing. Across six packaged
  VORTEXT transform mutations, forced-GC retained JS heap growth fell from
  142,820,324 bytes to 1,441,392 bytes; GPU bytes remained unchanged. Restoring
  the original transform produced an exact final preview (`RMSE 0`).
- Vector history now reports approximate retained canonical bytes rather than
  incorrectly reporting zero. The same six mutations report 10,872 retained
  bytes across six undo entries.
- Heavy VORTEXT mutation is still expensive: representative composites encode
  in roughly 0.27-0.78 seconds. CPU evidence is led by many render-pass starts,
  buffer writes, bind groups and geometry encoding. The Vello scene bake-off
  must attack this remaining full-layer/backend submission cost.
- A minimal renderer-neutral `@lighttable/paint-scene` contract now represents
  exact move/line/cubic/close paths, affine transforms, solid fills and centered
  solid strokes. `@lighttable/paint-scene-adapters` compiles both native vector
  elements and PDF page scenes without making either source core depend on a
  backend package. Stable fragment/revision keys are canonical-data revisions,
  never viewport revisions.
- The adapter result is capability-gated: gradients, inside/outside strokes,
  PDF clips, non-normal blends, masks, transparency groups, CMYK/resource paint,
  text/images/forms and preserved operators produce explicit fallback issues.
  A lossy result can never be reported as `ready`.
- Paint paths are separate revision-keyed fragment resources referenced by
  `pathId`; a fill plus stroke neither serializes geometry twice nor invalidates
  geometry merely because paint/transform state changed.
- The Electron 39 Vello probe now decodes the serialized schema-1 paint scene,
  resolves its path resources and renders into the JavaScript-owned shared
  texture. Transparent and filled sample pixels both pass byte-exact. Vello is
  therefore proven against the intended backend contract, not only a hardcoded
  Rust scene.
- `@lighttable/vector-webgpu` now has a current-backend consumer for that exact
  scene. It reconstructs exact cubic authority once per path revision, caches
  path plus realization, and retains the existing LT stencil/fill/stroke engine.
- Five fresh Electron-process bake-offs compare 256 cubic paths and 512
  fill/stroke commands on the same device and target dimensions. Final p50
  totals: current cold 55.1 ms / warm 18.9 ms; Vello cold 43.0 ms / warm 4.8 ms.
  Vello's 1.96 MB WASM payload compresses to 531,698 bytes.
- Vello 0.10 writes straight-alpha output, while LT requires premultiplied
  intermediate textures. The reproducible reference patch changes the final
  storage write without an extra pass. With it, opaque fill RMSE is 1.03,
  alpha-fill RMSE 0.51, and fill+stroke RMSE 2.11 on the focused parity cases.
  The dense scene RMSE is 8.06; remaining differences are AA/stroke-edge
  coverage and require product acceptance thresholds rather than exact pixels.
- Lazy backend memory evidence: current rendering adds p50 ~28,488 KiB to the
  GPU process and ~22,932 KiB to the tab process; initializing/rendering Vello
  adds ~10,164 KiB GPU and ~5,080 KiB tab after that. These are process working
  set deltas, not exact GPU allocation accounting.

## Worktree ownership

- `work/todo/task_303/` belongs to this active renderer program.
- `work/todo/task_304/` belongs to the owner and must remain untouched.

## Current focus

The PostScript-style API assessment is recorded in
`POSTSCRIPT_SCENE_API_ASSESSMENT.md`. The bounded wgpu/Electron zero-copy
prerequisite and actual Vello render pass. Mutation and retained-memory evidence
now identify full-layer backend submission as the dominant remaining vector edit
cost. The minimum immutable scene slice shared by native vector and PDF path
fixtures now exists and passes its focused suites. Both the current backend and
Vello consume it, and the first bounded bake-off passes its correctness gate.
Next, make Vello selectable only in dev/product diagnostics, exercise real
imported scenes and mutation/lifecycle behavior, and extend supported paint
features only where parity evidence passes.

## Next safe steps

1. Commit the verified baseline harness and first renderer improvement.
2. Run the representative SVG corpus and capture cold-open/mutation profiles.
3. Rank CPU realization, GPU upload, pass/bind-group and memory costs.
4. Implement only the next highest measured current-renderer win.
5. Build the isolated Vello WebGPU interoperability spike before choosing a
   product integration architecture.

## External fixtures

User-owned vector fixtures are under the external LightTable test corpus. Do
not commit their bytes or expose private fixture contents in distribution
artifacts.
