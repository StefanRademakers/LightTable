# Halation

LightTable implements Halation as an optional linear-spatial GPU effect, not as a red overlay or display-space glow.

```text
linear creative grade
  -> soft highlight-energy extraction
  -> quarter-resolution horizontal/vertical diffusion (two cycles)
  -> warm red/orange film-base tint
  -> additive linear composite
  -> Vignette and shared display transform
```

The effect owns `Amount`, `Radius`, `Threshold`, `Warmth`, its uniform buffer and all temporary textures under `client/src/features/lighttable/effects/halation/`. It encodes no passes unless its persisted `enabled` switch is on and Amount is non-zero.

Darktable's Bloom module was inspected only as conceptual confirmation of the threshold -> separable blur -> composite structure. LightTable uses independent WGSL math, scene-linear RGB, a soft threshold knee, reduced-resolution diffusion and a film-halation colour model.
