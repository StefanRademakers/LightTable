# Paint engine audit — 2026-08-08

## Outcome

The paint engine remains GPU-native, frame-batched and GPU-history-backed. The
audit found no reason to trade image quality, precision or undo fidelity for
speed. The retained changes remove avoidable CPU allocation, queue fences and
full-surface Blur Brush copies while preserving the existing shader result.

## Pipeline reviewed

1. Pointer routing and coordinate projection.
2. Distance-based smoothing and dab spacing.
3. One-frame lossless dab scheduling.
4. GPU upload, analytic tip rasterization and selection masking.
5. Blur source sampling.
6. Styled-layer invalidation and interactive quality.
7. GPU-only dirty-tile undo/redo.

## Retained improvements

- Consume ordered `getCoalescedEvents()` samples when available. Fast curves no
  longer lose device samples before smoothing; unsupported hosts retain the
  dispatched pointer event fallback.
- Append pending frame dabs in place. The former repeated array concatenation
  copied the complete pending stroke on every input update.
- Project undo bounds with exact affine half extents instead of four corners and
  several temporary arrays per dab.
- Use numeric history-tile keys instead of allocating `"x:y"` strings.
- Reuse a grow-on-demand GPU dab upload buffer. Steady-state painting no longer
  creates and queue-fences one storage buffer per rendered frame.
- Copy only the Blur Brush's conservative sample support into its immutable
  source texture. This retains the source/destination separation required by
  WebGPU without copying the complete raster layer for a local dab.
- Invalidate only the edited layer's styled presentation per batch and identify
  that layer as the interaction-quality target. Other layers and the full
  document remain clean.

## Measurements

These are deterministic hot-path microbenchmarks, intended to prove direction
rather than predict end-user FPS:

| Path | Before | After | Result |
| --- | ---: | ---: | ---: |
| 12,000 pending single-dab updates | 108.06 ms | 0.065 ms | 1,665× synthetic stress speedup |
| 10,000 affine undo bounds | 3.19 ms | 0.332 ms | 9.62× speedup |
| 4,096² Blur source copy, one 80 px dab | 128 MiB | 66.1 KiB | ~1,982× fewer copied bytes |
| Steady-state dab buffers/fences | one per frame | zero per frame | growth only |

The Blur bound includes the shader's maximum required sample radius, affine
projection, bilinear support padding and texture clipping. Unit tests compare
the optimized affine bounds with the former four-corner reference.

## Quality and architecture decisions

- Kept RGBA16F paint targets and GPU-only tile history.
- Kept analytic hardness, roundness, roughness, pressure and selection coverage.
- Kept every generated dab; the scheduler still drops no paint input.
- Kept final-quality rendering after pointer release.
- Did not lower Blur Brush samples, reduce precision, introduce CPU readback,
  add replay-based history, or create another caching subsystem.
- Did not use predicted pointer events. They can reduce apparent latency but can
  also paint pixels the user never committed and need a reversible preview
  contract before they are appropriate here.

Primary platform contracts checked during the audit:

- [W3C Pointer Events — coalesced events](https://www.w3.org/TR/pointerevents3/)
- [W3C WebGPU — queue and submitted-work ordering](https://www.w3.org/TR/webgpu/)
