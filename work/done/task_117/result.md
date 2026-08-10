# Task 117 result — boundary-aware GPU Healing Brush

## Outcome

The Healing Brush now uses a derivative-aware boundary reconstruction instead of the former colour-only harmonic correction. One full-opacity dab can replace a blemish; it no longer inherits the ordinary paint brush's 35% flow default.

Clone Stamp and Healing Brush still share source selection, aligned offsets, sampling modes, brush geometry, GPU snapshots, selection masking and one undo transaction. Only Healing's destination-aware fragment stage differs.

## Algorithm

- The immutable source/destination snapshot is sampled at the circular dab boundary.
- A discrete Poisson-kernel interpolation supplies the fast harmonic first approximation described by Georgiev.
- A second concentric ring estimates the normal derivative of destination-minus-source.
- A bounded derivative continuation corrects the seam near the brush edge, while the interior remains harmonic. This follows Georgiev's practical strategy: spend biharmonic work where derivative discontinuities are visible rather than iterating the entire patch to convergence.
- `Diffusion` is a discrete 1–7 control. It changes the derivative baseline and the depth over which boundary adaptation propagates; it is not implemented as blur.
- Interior pixels skip the second-ring reads when the selected diffusion does not need them. The operation remains one GPU render pass with no readback or CPU image processing.

This analytic circular-patch solve was selected over a general ping-pong ROI solver for the current brush mask. It preserves interactive latency and avoids a second healing architecture. A future arbitrary-mask healing operation may need a true iterative ROI solver, but that is not necessary for this task's dab/short-stroke tool.

## UX

- Healing Brush exposes `Diffusion` beside the existing shared sample and aligned controls.
- The default is 5; accepted values are clamped and rounded to 1–7.
- Healing keeps its own defaults of 0% Hardness and 100% Opacity, independent of the ordinary Brush and Clone Stamp settings.
- Flow is hidden and ignored for Healing because Healing replaces a coherent patch. Opacity remains available for deliberate partial healing. Ordinary Brush and Clone Stamp retain Flow unchanged.

## Repeatable comparison

`scripts/capture-desktop-screenshot.mjs` accepts `--paint-tool healing-brush` and the new `--healing-diffusion 1..7`. It records source/destination coordinates, brush size and diffusion in the JSON report and now fails a paint run on WebGPU binding/command validation errors.

Primary fixture used:

```powershell
node scripts/capture-desktop-screenshot.mjs `
  --file D:\pukkels-lighttable.png `
  --paint-stroke true --paint-tool healing-brush `
  --sample-layer Background --sample-x 0.45 --sample-y 0.17 `
  --paint-x 0.52 --paint-y 0.17 --brush-size 18 `
  --paint-stroke-length 0 --healing-diffusion 5 `
  --output tmp\screenshots\task117-healing-visible.png
```

The production Electron/WebGPU run completed with a changed destination thumbnail, a retained source layer, and zero page, console or WebGPU errors.

## Verification

- `@lighttable/app` typecheck: passed.
- Focused sampled-brush, paint-session, toolbar and shader suites: 131 tests passed.
- WGSL reflection parse: passed.
- Production desktop package and distribution boundary: passed.
- Real Electron/WebGPU healing fixture: passed.

## Technical references

- Todor Georgiev, *Photoshop Healing Brush: a Tool for Seamless Cloning* (Adobe Systems, 2004).
- Adobe Photoshop Healing Brush and Diffusion documentation.
- GIMP Healing algorithm notes, used as a secondary implementation reference.
