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
- The selectable Vello backend is integrated in `@lighttable/vector-vello`,
  selected through the dedicated dev/package commands, surfaced in renderer
  telemetry, and falls back explicitly when PaintScene reports unsupported
  semantics. Its package output remains separate from the normal backend.
- Vello now writes LightTable's exact linear-premultiplied texture contract.
  A raw texture probe identified the previous display-sRGB encoding error;
  focused current/Vello centers are byte-equal or differ by one rounding unit.
- Backend-neutral gradient paint now covers linear, radial, angle and reflected
  geometry with bounded sampled ramps. SVG radial gradients preserve the full
  two-circle geometry (`fx`, `fy`, SVG 2 `fr`) through editable import, save,
  reopen, current WebGPU and Vello. Document-space SVG gradient export also
  removes the owning element transform to prevent double transformation on
  reopen.
- Packaged current and Vello runs of `svg_vector_render_test.svg` both pass.
  Current versus Vello preview RMSE is 3.24, MAE 0.45 byte/channel, with 1.85%
  of pixels differing by more than 16 (primarily antialiasing boundaries).
  Both pan/zoom traces perform zero document composites and zero scene rerenders.
- The SVG normalization/security decision is recorded in
  `SVG_NORMALIZATION_AND_SECURITY_ASSESSMENT.md`. `usvg` is a candidate
  normalizer/oracle only behind LightTable preflight and resolvers that forbid
  filesystem/network resources; `usvg::Tree` is never document authority.
- The decision is now implemented as the renderer-independent
  `@lighttable/vector-svg-normalizer` package backed by a pinned, feature-minimal
  `usvg` WASM crate. File Open and semantic SVG placement (including MCP) share
  this adapter before the existing editable codec. The command route reads
  document authority only after asynchronous normalization, so concurrent user
  edits cannot be replaced by a stale pre-normalization snapshot.
- The integrated packaged torture-SVG passes with 41 cached geometry entries,
  RMSE 31.95 / MAE 6.55 against the browser oracle, versus RMSE ~38 before
  normalization. Pan and zoom still execute zero document composites.
- PaintScene schema 3 now expresses fragment-local persistent clip stacks.
  Shared validation rejects missing paths and unbalanced/cross-fragment stacks;
  Vello maps them to native clip layers and validates again inside WASM. The
  current PaintScene backend fails explicitly because its per-draw stencil
  lifecycle cannot preserve clips; it never silently renders unclipped pixels.
- A packaged four-file corpus run passes on both backends after normalization.
  The 7.2 MB VORTEXT scene contains 26,492 geometry entries and reaches first
  rendered state in 3,089 ms on current versus 2,545 ms on Vello. Vello also
  reduces browser-oracle RMSE from 6.36 to 1.38 and estimated GPU texture bytes
  from ~109 MB to ~57 MB. Smaller files show mixed first-render latency (Vello
  can be roughly 0.3 s slower), so this supports complexity-aware/default-Vello
  evaluation but is not yet enough to freeze routing policy. Both backends keep
  pan/zoom near 60 fps with zero document recomposites.
- The packaged six-edit mutation bake-off is now recorded for the torture SVG
  and VORTEXT. Both backends restore the original image (no pixel above the
  comparison threshold), retain zero additional estimated GPU bytes and add
  only about 0.7-1.4 MB forced-GC JS heap in the bounded run. On VORTEXT the
  current renderer needs roughly 1.0-1.3 seconds per half-pixel transform,
  while the first full-scene Vello bridge needs 189-308 ms.
- `@lighttable/vector-vello` now synchronizes revision-keyed PaintScene
  fragments incrementally. After the first upload, one edited element sends
  one fragment instead of serializing all 26,492 elements; Rust retains only
  the current fragments for each bounded source and reassembles them in paint
  order. VORTEXT mutation falls again to 86-133 ms with oracle parity unchanged
  (`RMSE 1.38`) and ~57 MB estimated texture memory. Closing/removing a layer
  explicitly releases its native fragment state, rather than waiting for the
  bounded 64-source eviction policy. Backend source keys are namespaced per
  document renderer, so opening the same canonical layer IDs twice cannot
  alias native mutable cache state.
- Device-loss teardown now marks the shared Vello runtime released before its
  WASM bridge is disposed. Existing document renderers fail subsequent render
  attempts explicitly and source cleanup becomes idempotent instead of calling
  through a freed WASM object. Shared-device reacquisition tests and Vello
  teardown tests pass; a packaged forced-loss journey is still outstanding.

## Worktree ownership

- `work/todo/task_303/` belongs to this active renderer program.
- `work/todo/task_304/` belongs to the owner and must remain untouched.

## Current focus

The renderer-neutral package split, selectable Vello backend, zero-copy shared
texture route, linear-premultiplied color contract and secure reusable SVG
normalization boundary are proven. Normalization recovers `<use>`, CSS, units,
markers and basic shapes while the editable codec remains document authority.
The next semantic dependency is hierarchy: group and clip stacks must exist in
the canonical document model and PaintScene projection before patterns, group
opacity, masks or filters can be represented safely. Mutation and immediate
source-release evidence now pass; broader repeated open/close, device-loss and
memory distributions are still required before selecting production routing.

## Next safe steps

1. Add canonical group/clip-stack semantics without flattening or document
   mutation; compile them to explicit PaintScene push/pop operations.
2. Implement and compare clip layers in current WebGPU and Vello, including
   nested and object-bounds cases.
3. Harden SVG save/reopen and corpus round trips for every newly admitted
   semantic feature.
4. Run packaged current/Vello repeated open/close, crash, retained-memory and
   device-loss distributions; then record backend routing policy.

## External fixtures

User-owned vector fixtures are under the external LightTable test corpus. Do
not commit their bytes or expose private fixture contents in distribution
artifacts.
