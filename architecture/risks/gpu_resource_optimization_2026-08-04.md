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

1. Instrument and compare Layer Style full-document caches against tight-bounds
   caches and replay cost.
2. Add resource lifetime telemetry before aliasing full-frame temporaries.
3. Compare dirty-tile GPU history with current full-surface snapshots.
4. Test inactive-document/hidden-layer eviction and restoration latency.
5. Only then test cold CPU tile compression and checkpointed stroke replay.

