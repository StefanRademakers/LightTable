# Lens Distortion

Lens Distortion is an optional source-geometry effect in `client/src/features/lighttable/effects/lensDistortion`.

- It uses an aspect-correct bounded radial remap before Chromatic Aberration and the core sRGB decode.
- Distortion controls signed barrel/pincushion curvature. Midpoint controls how quickly curvature leaves the optical centre. Zoom adds an explicit crop.
- Positive edge expansion is normalized by its corner factor so the pass does not silently create black or smeared borders.
- The output stays encoded RGB in `rgba16float`; color conversion remains owned by the correction core.
- When disabled, or when Distortion and Zoom are both neutral, `encode()` returns the input texture without a render pass.

Settings are serialized at `settings.effects.lensDistortion` and therefore participate in recipes, grade copy/paste and local undo/redo.
