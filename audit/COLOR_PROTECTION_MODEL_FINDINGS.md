# Adaptive color protection - findings from Color and Vibrance

## Why this matters

Photoshop-style Vibrance is not merely a weaker Saturation slider. Its user
value is that muted colors can become clearer without making skin, already
saturated colors, and near-gamut colors fail first. Those protections may also
be valuable in LightTable's native Grade, but they must remain an explicit
native product decision rather than leaking in through Photoshop compatibility.

## What is proven

- Adobe documents Vibrance as affecting low-saturation colors more, reducing
  saturation clipping, and protecting skin tones.
- The captured Photoshop 27 Color and Vibrance lattice is hue-dependent and
  saturation-dependent. At one controlled medium-saturation slice,
  Vibrance +100 produced approximately 1.38-1.52x OKLab chroma in the
  red/orange region versus approximately 1.84x around blue.
- At hue 20 degrees, the measured chroma multiplier fell from about 2.14x at
  HSV saturation 0.1 to 1.12x at saturation 0.9. Around blue 220 degrees it
  fell from about 2.76x to 1.36x. Protection is therefore a family of response
  curves, not one global slider curve.
- The exact skin-protection boundary cannot be inferred from one hue slice.
  Skin appearance spans hue, chroma, luminance, profile, lighting, and camera
  rendering. Portrait corpora remain required.

## Reusable machinery LightTable already owns

| Existing machinery | Relevance |
| --- | --- |
| `linearRgbToOklab` / `oklabToLinearRgb` | perceptual lightness, chroma and hue representation |
| `pointColorSelectionWeight` | soft periodic hue x chroma x luminance selection with CPU and WGSL parity |
| Color Mixer hue interpolation | smooth periodic authored response over color ranges |
| Photoshop Hue/Saturation range weights | measured soft range boundaries and hue wrapping |
| classic `applyPhotoshopVibrance` | compact saturation falloff and explicit warm/skin arc protection |
| Selective Color | evidence that semantic color regions can be adjusted, although its max/min RGB and CMYK correction model is not the preferred skin mask |
| signed Color and Vibrance headroom | proof that protection must run before the final gamut clamp |

The likely reusable core is Point Color's three-axis selection, not Selective
Color's correction equation. A native protection model can combine a broad,
soft skin likelihood with saturation and gamut guards without duplicating a
second range-selection system.

## Candidate native contract

Conceptually, a future native Grade control could evaluate:

```text
requested chroma change
  x low/mid-saturation response curve
  x (1 - skin-likelihood x skin-protection amount)
  x available output-gamut/headroom weight
```

The skin likelihood should be a smooth function of OKLab/OKLCH hue, chroma and
lightness, using the same CPU/WGSL selection definition as Point Color. Gamut
protection should compress toward a valid boundary; it should not simply clamp
RGB after oversaturation.

## Required evidence before native Grade changes

1. A synthetic hue x chroma x luminance corpus, including hue wraparound and
   neutral instability.
2. Diverse real portraits across skin tones, exposure levels and lighting,
   evaluated at normal viewing size as well as through pixel metrics.
3. Highly saturated non-skin objects to prove that skin protection is not a
   generic red/orange suppression.
4. Negative and positive Vibrance, global Saturation combinations, and slider
   continuity around zero.
5. Neutral, grayscale, wide-gamut and headroom tests.
6. An explicit comparison between the current native Grade response and the
   protected candidate. Alpha 0.1 does not freeze the old response: the better
   model may become the new default when the visual evidence is convincing and
   the document/version consequence is deliberate.

## Current decision

Task 213 corrected an important overclaim from task 211. CAT16 Temperature/Tint
was compact and explainable, but visibly failed the actual Photoshop extremes.
Color and Vibrance now uses a bounded, lazy measured compatibility asset for
Temperature/Tint and for the combined four-slider pipeline. The isolated
Vibrance/Saturation path deliberately keeps the adaptive OKLab chroma, soft
OKLCH skin-like mask and continuous neutral-axis gamut projection that already
performed well.

The protection constants and CPU reference now live in
`gpu/colorVibranceModel.ts`; the WGSL evaluator consumes the same constants.
This keeps the protection model reusable for task 212, but does not make the
Photoshop compatibility data a native Grade design. The current evidence still
contains too few skin tones and too few highly saturated non-skin red/orange
objects to justify that broader default without another targeted corpus.
