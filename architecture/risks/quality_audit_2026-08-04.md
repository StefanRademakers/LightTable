# LightTable quality and performance audit — 2026-08-04

## Scope

This audit exercises the production Electron build, the shared web/desktop
editor code, every current toolbar family, document lifecycle, GPU validation,
history transactions, repeated canvas interaction, and the ten PSD templates
below `Save the Date Invitation PSD 6`.

The audit follows the guardrails in `current_risks.md`:

- `ImageDocument` remains canonical; tests drive public commands and real UI.
- Pointer-frequency work stays in controllers/GPU paths rather than new React state.
- Overlay-only animation only invalidates viewport presentation.
- GPU resources remain renderer-owned and are included in explicit byte estimates.
- One gesture is checked against one history mutation where applicable.
- PSD remains an import adapter; unsupported fidelity is reported, not hidden.

## Automated coverage

The desktop smokes cover brush, fill, gradient, line, shape geometry, pen tools,
tool flyouts/context menus, all six selection tools, type/paragraph text, system
fonts, merge/rasterization, zoom, pan, erase, warp, transform, layer masks and
the typed command driver. The canvas audit additionally repeats warm interactions
under forced garbage collection and records page errors, console errors, runtime
stops, Chromium long tasks, heap, DOM nodes and listener counts.

Reproduce the canvas audit with:

```powershell
npm run audit:desktop:canvas:build -- D:\shapes.psd
```

The final canvas run completed without page errors, console errors, runtime
stops, WebGPU validation errors or long tasks. Across the stable part of five
repeated interaction rounds, live DOM and event-listener growth were zero and
heap growth was approximately 0.2 MiB.

## Fixes produced by the audit

1. Idle full-frame compositor targets are released, including the zero-copy
   and hidden-only paths.
2. Opening the persistent Effects inspector no longer starts a history
   transaction; a transaction begins only on the first real style edit.
3. Restored Dockview accessory panels use `onlyWhenVisible`, reducing the live
   DOM of EHS-406 from roughly 1,594 nodes to roughly 810 and preventing hidden
   panel work.
4. The stress driver parses KB, MB and GB GPU estimates correctly.
5. Layer masks, mask editing intermediates and mask undo snapshots use
   `r8unorm` instead of `rgba16float`. Mask brush, erase, fill, gradient,
   invert, decode, save/readback and undo paths use matching pipelines.
6. A repeatable canvas interaction and retention audit is now part of the
   workspace scripts.

## Save-the-Date PSD corpus

All ten PSDs open and survive repeated layer selection, panel switching, pan
and zoom. A two-round sweep initially flagged EHS-402 and EHS-406 because it
sampled one-time lazy panel mounts. A six-round follow-up passed both files:
the stable tails retained zero listeners, zero GPU bytes, 31–32 non-live DOM
nodes and 0–43 KiB heap. Live DOM remained stable at 1,129 and 824 nodes.

| Document | Estimated GPU before | Estimated GPU after mask optimization | Saved |
|---|---:|---:|---:|
| EHS-395 | 2.83 GiB | 2.75 GiB | 82 MiB |
| EHS-396 | 1.79 GiB | 1.79 GiB | 0 MiB |
| EHS-401 | 1.61 GiB | 1.61 GiB | 0 MiB |
| EHS-402 | 2.14 GiB | 1.82 GiB | 328 MiB |
| EHS-404 | 2.05 GiB | 2.05 GiB | 0 MiB |
| EHS-405 | 1.18 GiB | 1.18 GiB | 0 MiB |
| EHS-406 | 2.01 GiB | 2.01 GiB | 0 MiB |
| EHS-407 | 1.13 GiB | 1.13 GiB | 0 MiB |
| EHS-409 | 1.01 GiB | 1.01 GiB | 0 MiB |
| EHS-442 | 0.69 GiB | 0.69 GiB | 0 MiB |

The zero-saving documents do not realize a document-sized raster mask in the
native runtime. Vector masks and native vector geometry are not counted as
raster-mask allocations.

## Remaining performance risks

### P0 — bounded but excessive GPU residency

The corpus shows stable rather than continuously growing GPU memory, but
0.69–2.75 GiB for one document is not acceptable for integrated GPUs or several
open documents. The remaining cost is dominated by layer-local `rgba16float`
surfaces plus document-sized source, processing, adjustment, style and
compositor targets. This needs owner/format/dimension telemetry followed by
budgeted lazy realization, target aliasing and/or tiled eviction. Lowering the
reported estimate without changing ownership is not a fix.

### P1 — text interaction latency

The paragraph smoke remains functionally correct but reports approximately
28.8 ms input-to-submit p95 and 38.6 ms input-to-GPU p95 in the current fixture.
This is visibly behind a 60 Hz direct-manipulation budget. Profiling should
separate shaping/layout, cache publication, React publication and GPU submit;
caret/selection overlay updates must not rebuild settled text layers.

### P1 — PSD first-open latency

The audited corpus averages roughly 1.56 seconds to first ready frame, with a
worst observed file around 2.46 seconds on the test machine. PSD decode and
eager GPU hydration are the main candidates. Future work should publish the
retained composite quickly, then hydrate editable layer realizations under a
bounded scheduler without changing canonical document semantics.

### P1 — architecture guardrails still incomplete

The audit did not solve the transform-authority and shared-compositor-plan
items in `current_risks.md`. Paint, warp and parts of `WebGpuEngine` still have
direct transform/evaluation knowledge. Those migrations require cross-output
golden fixtures; they should not be folded into unrelated performance patches.

## Release interpretation

No unbounded heap, listener, live-DOM or per-interaction GPU growth was found in
the tested workflows. The recent crashes were addressed where reproduced, and
the current production build survives the broad tool and corpus suite. This is
not yet a low-memory release: large PSD GPU residency and text input latency
remain measurable product risks and should stay visible until budgeted fixes
land.
