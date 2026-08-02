# Chromatic Aberration

Chromatic Aberration is an optional source-geometry effect in `client/src/features/lighttable/effects/chromaticAberration`.

- It operates on encoded source RGB before the core sRGB decode.
- Red and blue sample in opposite radial directions; green remains anchored.
- Amount is normalized against source resolution. Edge falloff shapes the radial mask and Balance biases the red/blue displacement.
- Sampling is aspect-correct and fades to the unchanged source at the outer sampling boundary to avoid smeared edge pixels.
- When disabled or Amount is zero, `encode()` returns its input texture and creates no command pass.

The serialized settings live at `settings.effects.chromaticAberration`. The flattened output remains the only image consumed by the host app.
