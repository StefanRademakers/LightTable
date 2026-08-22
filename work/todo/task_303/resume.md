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

## Worktree ownership

- `work/todo/task_303/` belongs to this active renderer program.
- `work/todo/task_304/` belongs to the owner and must remain untouched.

## Current focus

Commit the proven cache and fixed-surface zoom correction, then extend the
baseline across representative small/pathological SVG scenes and mutation.
Profile cold-open next; separately build the bounded Vello interoperability
spike and evaluate CPU/GPU/worker choices against this improved native path.

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
