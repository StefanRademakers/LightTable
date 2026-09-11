# Paint / recovery ownership fix — 11 September 2026

## Result and limits

A destructive recovery/paint interleaving is reproduced and repaired. This is
not a claim that every cause of the reported renderer shutdown is identified:
the original diagnostic toast was not captured. The original open session was
not restarted or modified by automation. Already destroyed pixels are not
reconstructed by this code change.

The two preserved recovery copies in `work/recovered/2026-09-11-paint-failure/`
open, but contain Background and Grade only, not the missing pasted layers.

## Proven cause

1. Paste creates a compact raster texture (700 × 600 in the reproduction).
2. A brush transaction prepares a document-sized surface (2560 × 1440). Its
   geometry is a transaction preview until pointer-up, not a canonical commit.
3. Automatic recovery exported the older canonical document and called
   `synchronizeDocumentForExport` on the shared interactive renderer.
4. `LayerRuntimeStore.sync` saw the old dimensions and destroyed the live
   prepared paint texture, replacing it with an empty compact texture.
5. Paint commit projected full dimensions again. The actual selected pixels
   were gone, even though history advanced and the canvas still rendered.

GPU texture destruction instrumentation confirmed this exact call chain.
The pre-fix packaged test read actual active-layer clipboard pixels:
**420,000 visible pixels → 0**. Initial tests checking history/canvas readiness
missed it; even a layer-preview artifact was insufficient here. The regression
now reads actual pixels, verifies painting changes them, and checks exact undo/redo.

## Ownership change

- Recovery defers while the existing document transaction or history admission
  owns an edit. A long gesture is normal scheduling, not a persistence failure.
- After font/host awaits, snapshot admission is checked again before any GPU
  capture. Background recovery does not synchronize/rewrite renderer projection.
- Native asset export captures every uncached raster/mask/derived-preview input
  synchronously. One encoder submits the complete copy batch before any await.
- PNG encoding reads immutable snapshots, sequentially, releasing each after
  use. Final cleanup releases all outstanding snapshots on failure.
- Encoded asset cache hits do not allocate snapshots. Codec dimensions come
  from the retained texture, not a subsequently changed live layer runtime.
- A later edit supersedes the old checkpoint normally. Both pre/post export
  checks classify this before the generic renderer-binding assertion.
- No lock is held through PNG encoding, hashing or disk I/O. No fallback route
  or swallowed GPU/codec error was added.

Renderer failure presentation was also corrected: failed lifecycle state is
not loading. A short toast points to persistent, selectable, escaped technical
details on the canvas. The original error remains in the lifecycle owner.

## Evidence

- `scripts/smoke-desktop-pasted-paint.mjs`: three cycles per ordering, real
  pointer paint, actual recovery publication, preserved/changed pixels and
  byte-exact undo/redo. Recovery-first deliberately holds mapped export work
  while a new stroke starts. No false recovery-unavailable warning remains.
- Before/after/order reports: `tmp/pasted-paint-smoke/`.
- `scripts/smoke-desktop-renderer-failure.mjs`: synthetic GPU failure enters
  the real lifecycle bridge; persistent escaped diagnostic replaces Loading.
  This proves error presentation, not the cause of the owner's original error.
- Focused scheduler, asset snapshot/cache, export, lifecycle and viewport tests,
  application typecheck, boundary checks and instrumented packaged build pass.
- Independent critic: two repair rounds; final targeted P1 check passed.
- Existing large-PSD recovery profile now uses the current Recovery Records
  gallery, replacing its obsolete restore-button locator.

## Performance — measured cost, not a universal promise

For the 2560 × 1440 case: synchronous snapshot capture planning/encoding into a
command buffer was approximately 0.07–0.17 ms on the CPU. Cold snapshot memory
peaked at 84.375 MiB and returned to zero. This is not a GPU completion latency
measurement. Whole-run animation-frame p95 was approximately 16.75 ms, with a
66 ms maximum; it is not a direct brush input-to-presented-frame metric.

Large case: EHS-396, 3000 × 4242, 43 layers after the test edit. Latest profile
`tmp/recovery-paint-large-20260911-v2/report.json`:

- checkpoint preparation 2808 ms and persistence 250 ms, asynchronous;
- queued zoom command-to-next-frame p95 55.6 ms; during recovery 71.9 ms;
  after checkpoint 76.0 ms; baseline cold p95 91.8 ms;
- 589,129,760 bytes (~562 MiB) temporary snapshot peak; zero retained afterward;
- measured post-queued/recovery window includes long tasks up to 84 ms;
- restored dimensions and 43-layer count match; normalized screenshot RMSE
  3.95 under the existing threshold of 8 (not a byte-exact visual claim).

The existing qualification passes because its budget is relative to the cold
baseline. That does **not** prove professional low-latency interaction. These
are single-run observations, not a controlled before/after implementation
benchmark. Large-document memory and latency remain explicit product risks.

## Open

- Owner confirmation of the original paste/transform/grade/paint flow.
- Exact original GPU shutdown diagnostic, if it recurs; no assumption that
  every black canvas had the same cause.
- Large-document latency/memory work: coherent snapshots are necessary, but
  temporary memory proportional to uncached content needs broader qualification.
- Direct input-to-presented-frame measurements for paint and sliders, beyond
  the current zoom/frame and CPU-capture observations.
- No commit or push made for this task; earlier dirty worktree changes preserved.
