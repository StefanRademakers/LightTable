# Photoshop blend-mode color profile corpus

Status: reproducible visual regression corpus, updated 2026-08-06.

## Purpose

This corpus isolates blend equations from effect geometry. Every case uses the
same two 400 x 400 raster layers and changes only the top layer blend mode,
opacity or fill opacity. Photoshop and LightTable both open the same
Photoshop-canonical PSD.

The chart contains:

- a complete hue range blended toward white;
- the same hue range blended toward black;
- neutral and RGB channel ramps;
- a per-pixel alpha ramp;
- 128 deterministic RGB swatches spanning the color cube.

Every flat comparison is 800 x 400 with LightTable on the left and Photoshop
on the right. Amplified and unscaled Difference images plus numeric metrics
are retained per region. The runner records the maximum-error pixel and
accepts `--max-rmse`, `--max-delta` and `--max-significant-percent` gates.

## Reproduce

```text
npm run generate:psd-blend-corpus
"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe" -r D:\mediavibe\LightTable\scripts\photoshop-render-blend-mode-corpus.jsx
npm run audit:psd-blend-corpus
npm run report:side-by-side-gallery -- D:\Mediavibe\LightTableTests\BlendModes\compare D:\Mediavibe\LightTableTests\BlendModes\all-comparisons.png
```

Outputs live at `D:\Mediavibe\LightTableTests\BlendModes`. `report.json`
contains the region metrics; `ranking.json` is sorted by total RMSE.

The profile/precision extension lives at
`D:\Mediavibe\LightTableTests\BlendColorMatrix` and is generated with:

```text
npm run generate:psd-blend-color-matrix
"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe" -r D:\mediavibe\LightTable\scripts\photoshop-render-blend-color-matrix.jsx
npm run audit:psd-blend-corpus -- --root D:\Mediavibe\LightTableTests\BlendColorMatrix --max-rmse 3
```

That gate passes all 48 cases. Adobe RGB Hard Mix measures RMSE 0.13 at 8-bit
and 0.15 at 16-bit. A successful run without a numeric gate remains diagnostic
only.

## Coverage and semantic result

The test covers all 26 modes currently exposed by LightTable plus four 50%
layer-opacity cases and two 50% fill-opacity cases. Photoshop opened all 32
files and LightTable imported all expected blend modes and quantized opacity
values correctly. PSD stores opacity in an 8-bit field, so authored 50% returns
as either 128/255 or 127/255; this is valid semantic parity.

The Photoshop reference run records its color context alongside every render:

- document mode: RGB;
- bit depth: 8 bits/channel;
- assigned document profile: none (the generated PSDs are untagged);
- Photoshop Color Settings preset: `North America General Purpose 2`.

The 48-case follow-up independently covers untagged, tagged sRGB and Adobe RGB
at 8 and 16 bits/channel. It still does not cover 32-bit Photoshop behavior,
proofing, or a Photoshop configuration with different RGB blending
preferences.

## Findings

The opaque color result disproves a general profile or gamma mismatch:

- `Normal` is pixel exact for hue-to-white, hue-to-black, channel ramps and
  all 128 swatches;
- 21 of 26 modes have opaque-color RMSE at or below 1;
- 24 of 26 modes have opaque-color RMSE below 3;
- only Vivid Light and Hard Mix are structural outliers.

For Multiply and Screen, the implementation and the supplied reference agree
on the standard encoded-channel equations (`Cb * Cs` and
`1 - (1 - Cb) * (1 - Cs)`). The shared premultiplied source-over structure is
also algebraically consistent with the reference. The unresolved issue is not
those two blend equations themselves, but the color space in which the final
coverage/opacity terms are evaluated.

### Vivid Light and Hard Mix (historical diagnosis)

The initial run measured RMSE 54.39 for Vivid Light and 47.17 for Hard Mix.
Those values are retained here as the diagnosis baseline, not current output.
Endpoint handling and the declared-profile path now pass the production gates.

The evidence points to endpoint handling in Color Dodge/Color Burn. The GPU
implementation replaces zero denominators with epsilon. Photoshop uses
explicit endpoint branches. At a controlled red-base/cyan-blend sample,
LightTable produces approximately `[240, 0, 0]` while Photoshop produces
`[0, 255, 255]`. The individual Dodge/Burn cases only expose the error at a
small set of endpoints; Vivid Light and Hard Mix amplify it over the chart.

### Alpha, opacity and fill opacity

All modes show a larger error in the per-pixel alpha strip. Normal mode is
otherwise exact, but its alpha-strip RMSE is 22.47. At 50% layer opacity, a
red/cyan sample is approximately `[187, 188, 188]` in LightTable and
`[127, 128, 128]` in Photoshop.

The shared blend function already evaluates its blend equation in encoded
sRGB and converts the result back to linear. The compositor then performs the
coverage/opacity interpolation in linear texture space. Photoshop's 8-bit RGB
result in this corpus interpolates that coverage in document blend-color
space. This explains the systematic 50% opacity/fill differences and the
per-pixel alpha strip without invoking an ICC-profile mismatch.

This is deliberately scoped to the recorded untagged, 8-bit Photoshop run.
The corpus proves what Photoshop produced under that configuration; it does
not yet establish one universal Photoshop rule for every profile, bit depth,
or `Blend RGB Colors Using Gamma` preference. It also does not generalize the
two ordinary fill-opacity cases to Photoshop's special fill-opacity behavior
for the special blend-mode family.

## Relationship to Layer Styles

Layer Styles call the same central blend functions as ordinary layers.
Therefore the Vivid Light/Hard Mix endpoint problem applies directly to FX.
The alpha/opacity-space difference also affects partially covered highlights,
shadows, antialiased contours and blurred effect masks. It can explain part of
the softer LightTable bevel appearance, but it does not prove that the current
bevel height/normal mask is correct; mask fidelity remains an independent
test dimension.

## Implemented architecture

1. Explicit Photoshop-compatible zero/one branches cover Color Dodge, Color
   Burn, Vivid Light and Hard Mix.
2. One document blend-profile contract drives ordinary layers, adjustments and
   Layer Styles without changing canonical linear GPU storage.
3. Adobe RGB 8/16-bit samples remain encoded until the GPU decode boundary;
   16-bit data is never reduced to RGBA8.
4. Text, vector, gradient and Layer Style semantic colors normalize through
   the same document transform service.
5. Photoshop references flatten in the authored profile before conversion to
   the common sRGB comparison output.
