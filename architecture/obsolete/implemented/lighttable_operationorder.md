# LightTable operation order

This is the current processing order in the WebGPU implementation. The order of panels in the UI does not determine processing order.

The planned boundary between the stable correction core and optional effect passes is documented in `lighttable_core_and_effects_architecture.md`.

## Image pipeline

1. **Decode and source upload**
   - The browser decodes JPEG/PNG/WebP with `colorSpaceConversion: none`.
   - Encoded source pixels are stored unchanged in an `rgba8unorm` texture.

2. **Source geometry effects — encoded float working texture**
   - Optional Lens Distortion performs an aspect-correct radial remap with bounded curvature, adjustable midpoint and explicit zoom. Positive distortion is automatically scaled to avoid sampling beyond the source.
   - Optional Chromatic Aberration separates red and blue samples radially around the optical centre.
   - Amount is resolution-normalized, Edge falloff controls how strongly the separation is confined to the frame edge, and Balance distributes the split between red and blue.
   - The pass runs before sRGB decoding so all later analysis and corrections see the same remapped image.
   - Disabled Chromatic Aberration returns the source texture directly and encodes no render pass.

3. **Basic correction pass — linear `rgba16float`**
   - Decode sRGB transfer curve to linear RGB.
   - Temperature and Tint: CAT16 chromatic adaptation.
   - Exposure: linear RGB multiplication by `2 ^ exposureEV`.
   - Tonal controls in log luminance:
     1. Blacks
     2. Shadows
     3. Highlights
     4. Contrast
   - Blacks, Shadows, and Highlights contribute together through overlapping tonal masks before Contrast is applied around its log-luminance pivot.
   - Whites is deliberately not applied here; it is a display white-point control later in the pipeline.
   - These controls preserve exact zero by design. They shape or scale tones; they are not a black pedestal.

4. **Local luminance support pass — only for Clarity or Dehaze**
   - Downsample corrected linear luminance to quarter resolution.
   - Horizontal Gaussian blur.
   - Vertical Gaussian blur.
   - This pass is skipped when both Clarity and Dehaze are zero.

5. **Final color pass**
   - Texture: edge-aware fine/medium luminance detail from the full-resolution corrected texture.
   - Clarity: broader local-contrast correction using the blurred luminance texture.
   - Dehaze: bounded, dark-channel-inspired creative reconstruction using the post-tone LDR signal and blurred luminance.
   - Color Mixer: Hue, Saturation, and Luminance together in OKLab/OKLCH, using one shared bounded periodic interpolation that reaches every slider value at its range centre.
   - Saturation and Vibrance: perceptual global chroma adjustment in OKLab after Color Mixer classification.
   - Color Grading: Global plus normalized Shadows/Midtones/Highlights tint in OKLab, followed by separate endpoint-protected luminance grading.
     - Masks are calculated once from immutable pre-grade perceptual luminance.
     - Blending controls tonal overlap and Balance shifts emphasis toward Shadows or Highlights.
     - Soft endpoint guards keep absolute black, display white, and overrange highlights neutral.
   - Lift: an affine RGB pedestal, `lift + rgb * (1 - lift)`, after the colour transforms. It can recover absolute black or signed low-end excursions while keeping normalized white fixed.
   - Custom Curves: per-channel R/G/B curves followed by Master RGB, backed by one 1024-sample GPU LUT.
     - The UI and LUT use a signed sRGB-shaped domain, then convert back to linear RGB.
     - PCHIP interpolation avoids overshoot between points. Values outside the LUT domain use endpoint-slope extrapolation so working headroom is not silently clipped.
   - Optional Lens Blur: guided depth refinement, half-resolution foreground/background aperture gathers and full-resolution premultiplied compositing in scene-linear RGB.
     - Depth is analyzed once from the unchanged decoded source and remapped with the same Lens Distortion geometry before filtering.
     - Near foreground and far background use separate acceptance/coverage paths to reduce silhouette bleeding.
  - Interaction uses a 24-sample gather; the saved quality preset selects a 48-, 64- or 128-sample final gather after interaction ends.
     - Visualize Depth bypasses the creative image, Halation, Vignette, output shoulder/Whites and Grain while retaining only the required linear-to-sRGB display encode.
   - Optional Halation: highlight extraction, quarter-resolution diffusion and warm film-base spill in scene-linear RGB.
   - Vignette: spatial edge exposure in linear RGB, after Halation so the lens edge treatment also shapes the spill.
   - Scene-to-display transform:
     1. conditional luminance shoulder/highlight roll-off whose knee scales continuously with controls that can create highlight headroom;
     2. Whites adjustment in the upper luminance range;
     3. hue-preserving chroma fit into display RGB.
   - Encode linear RGB to sRGB.
   - Clamp and store the display-encoded pre-grain result in full-resolution `rgba16float` so gradients are not quantized before Grain.

6. **Grain — optional display-referred effect**
   - Generate deterministic full-resolution RGB procedural grain.
   - Apply horizontal and vertical grain softness passes.
   - Mix monochrome/RGB grain, apply shadow response and blend mode, then composite over the display-encoded image.
   - Grain owns its own settings/uniforms and only enters the render path when its persisted `enabled` switch is on and Amount is non-zero.
   - When disabled or Amount is zero, all Grain passes are skipped and a neutral resolve pass converts the float grade to the final `rgba8unorm` texture.

7. **Output consumers**
   - The viewport blits either the untouched source texture or the final processed texture.
   - The histogram reads the same selected texture as the viewport, in display-encoded RGB.
   - PNG export reads the final full-resolution texture; Canvas 2D is used only for PNG encoding.

## Compact order

```text
sRGB source
  -> Lens Distortion (optional source geometry)
  -> Chromatic Aberration (optional source geometry)
  -> sRGB decode
  -> Temperature / Tint
  -> Exposure
  -> Blacks + Shadows + Highlights
  -> Contrast
  -> Texture
  -> Clarity
  -> Dehaze
  -> Color Mixer (H + S + L)
  -> Saturation / Vibrance
  -> Color Grading (Global + Shadows / Midtones / Highlights)
  -> Lift
  -> Custom Curves (R/G/B, then Master RGB)
  -> Lens Blur (optional, depth-aware linear spatial effect)
  -> Halation (optional, linear spatial effect)
  -> Vignette
  -> highlight shoulder
  -> Whites
  -> display gamut/chroma fit
  -> sRGB encode
  -> Grain
  -> viewport / histogram / PNG
```

## Important consequences

- Color Mixer sees the result of Light and Effects, not the original pixels.
- Global Saturation/Vibrance runs after Color Mixer so it cannot change the hue classification used by selective adjustments.
- Color Grading runs after corrective/selective color and before Vignette/output rendering. Its three local masks always sum to one, so identical local wheels produce one uniform tint independent of Blending or Balance.
- Color Grading tint changes only OKLab opponent-color components. Its separate luminance controls use bounded linear-light EV scaling, and both paths share soft black/white endpoint protection.
- Exposure, Blacks, Shadows and grading luminance all preserve exact zero. Lift is intentionally the distinct operation that can change the black floor.
- Lift runs after colour transforms so negative low-end channel excursions have not already been destroyed. Dehaze also preserves signed channels internally.
- Curves run after Lift. Raising a curve's lower endpoint can therefore provide an additional deliberate black lift; lowering its upper endpoint caps white.
- Grain is intentionally last and display-referred; later tonal or color controls do not reshape it.
- Lens Blur runs before Halation, so blurred highlights can feed the film-base spill. Its AI depth analysis is source-side cached state, not part of the adjustment render loop.
- Whites operates after the other linear corrections and controls the display white region rather than acting as a second Exposure slider.
- Imported LDR images already contain a rendering transform. Hue/Saturation-only edits therefore use gamut safety without engaging a second highlight shoulder. Tonal controls introduce that shoulder continuously rather than through an on/off switch.
- Dehaze is currently a compact creative post-tone effect. A physically earlier Dehaze would require its own pre-tone analysis texture plus a second post-tone local-luminance analysis, so it must not be reordered as a simple function move.
- Every render starts from the unchanged source texture. Slider edits are not destructively accumulated.
- Neutral groups are true shader no-ops where implemented; Lens Distortion, Chromatic Aberration and Grain additionally skip their render passes entirely when disabled or neutral.

## Code locations

- Orchestration and pass skipping: `client/src/features/lighttable/gpu/WebGpuEngine.ts`
- Operation formulas and exact shader order: `client/src/features/lighttable/gpu/shaders.ts`
- Adjustment layout and defaults: `client/src/features/lighttable/types.ts`
- Curve interpolation and LUT generation: `client/src/features/lighttable/curves.ts`

Update this document whenever the order in `BASIC_CORRECTION_WGSL`, `CREATIVE_GRADE_WGSL`, `OUTPUT_TRANSFORM_WGSL`, or `WebGpuEngine.renderNow()` changes.
