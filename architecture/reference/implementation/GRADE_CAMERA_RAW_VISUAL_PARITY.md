# Grade / Camera Raw visual parity

## Purpose

LightTable Grade is a protected, fast creative workflow. It is not a Photoshop
adjustment node and must not be changed merely because a similarly named Camera
Raw control exists. Camera Raw is used here as a black-box visual reference to
find useful differences in response, range, clipping protection and processing
order. A measured difference is a finding, not an automatic implementation
requirement.

The first oracle covers the `Light` section. Later sections should use the same
isolation and evidence rules in this order: Color, Texture / Clarity / Dehaze,
Detail, Color Mixer, Point Color, Color Grading and Custom Curves.

## Protocol

The reference host is Photoshop 2026 version 27.9.1 with Camera Raw 18.5. Every
case starts from neutral and authors one control. Exposure covers -5, -4, -2,
-1, +1, +2, +4 and +5 EV. Contrast, Highlights, Shadows, Whites and Blacks
cover -100, -80, -50, -25, +25, +50, +80 and +100. Lift is intentionally not
compared because Camera Raw has no direct equivalent to LightTable's black
pedestal.

The corpus currently contains:

- `D:\people.jpg`, a real photograph;
- `D:\mediavibe\LightTableTests\ToneBrush\source\grayscale-ramp.png`, a
  diagnostic tonal ramp.

Metrics compare each product's adjusted output against its own neutral output.
This prevents a small neutral decode/profile difference from being attributed
to the control. The report records effect-vector correlation, relative effect
magnitude, luminance movement, clipping and normalized RGB RMSE. External
captures and reports live in:

- `D:\mediavibe\LightTableTests\GradeLightParity`;
- `D:\mediavibe\LightTableTests\GradeLightParityRamp`.

Run:

```text
npm run capture:camera-raw-grade-light-oracle
npm run capture:lighttable-grade-light-oracle
npm run analyze:grade-light-parity
```

All six Camera Raw descriptors must produce a non-zero effect. The Camera Raw
Filter Action Manager IDs are `Ex12`, `Cr12`, `Hi12`, `Sh12`, `Wh12` and
`Bk12`. XMP property names such as `Highlights2012` are not interchangeable
with these filter descriptor IDs; Camera Raw silently ignored those names.

## Initial Light findings

These are characterization results, not accepted parity gates.

### Real photograph

| Control | Effect correlation | LightTable / Camera Raw magnitude | Worst delta RMSE |
| --- | ---: | ---: | ---: |
| Exposure | 0.9746 | 0.935 | 10.99% |
| Contrast | 0.7778 | 1.412 | 8.06% |
| Highlights | 0.9177 | 1.706 | 5.52% |
| Shadows | 0.9070 | 0.588 | 5.81% |
| Whites | 0.7230 | 0.474 | 7.79% |
| Blacks | 0.6535 | 0.223 | 12.62% |

Neutral render RMSE is 0.45 percent.

### Diagnostic grayscale ramp

| Control | Effect correlation | LightTable / Camera Raw magnitude | Worst delta RMSE |
| --- | ---: | ---: | ---: |
| Exposure | 0.9766 | 0.939 | 9.33% |
| Contrast | 0.8577 | 1.449 | 6.98% |
| Highlights | 0.8823 | 0.778 | 6.25% |
| Shadows | 0.9207 | 0.431 | 10.75% |
| Whites | 0.6118 | 0.360 | 13.86% |
| Blacks | 0.6475 | 0.212 | 12.35% |

Neutral render RMSE is 0.02 percent.

### Interpretation

- Exposure already follows Camera Raw closely in direction and average
  strength. Most residual appears near large positive values and clipping.
- Contrast is too strong in the negative direction and uses a different pivot
  or tonal distribution. Its positive endpoint is close in total magnitude,
  but magnitude alone hides the curve-shape difference.
- Highlights cannot be corrected with one gain. LightTable is substantially
  stronger on the portrait but weaker on the uniform ramp. This is direct
  evidence of Camera Raw's image-adaptive tonal response.
- Shadows is consistently too weak, retaining only about 35–65 percent of the
  Camera Raw effect across these sources.
- Whites is consistently too weak and its tonal selection correlates only
  moderately with Camera Raw, especially at positive extremes.
- Blacks is the largest structural gap. LightTable produces only about 10–28
  percent of Camera Raw's response and does not yet behave like a protected,
  image-adaptive black-point control.

Do not tune these controls with isolated scalar multipliers. The next research
step is to recover the response curves and adaptation statistics from several
diagnostic luminance distributions, then test a grounded adaptive model on both
the ramp and photographs. Any accepted change must rerun the existing native
Grade visual regression so good Grade behavior is not traded away for a single
Camera Raw match.

## Accepted improvements

### Contrast transfer curve

The first accepted renderer change replaces the old scene-log pivot formula
with an endpoint-preserving perceptual transfer curve measured from Camera Raw
18.5. Intermediate control values interpolate toward the measured positive or
negative endpoint. The measured Camera Raw response scales almost linearly:
across the six intermediate settings, residual curve-shape error on the ramp is
less than one 8-bit code value.

Contrast no longer activates the generic display shoulder. That shoulder made
positive Contrast incorrectly lower white from 255 to roughly 246 even though
the contrast curve itself already protects both endpoints.

| Corpus | Metric | Before | After |
| --- | --- | ---: | ---: |
| Grayscale ramp | Effect correlation | 0.8577 | 0.9959 |
| Grayscale ramp | LightTable / Camera Raw magnitude | 1.449 | 0.994 |
| Grayscale ramp | Maximum delta RMSE | 6.98% | 0.41% |
| Photograph | Effect correlation | 0.7778 | 0.8964 |
| Photograph | LightTable / Camera Raw magnitude | 1.412 | 0.959 |
| Photograph | Maximum delta RMSE | 8.06% | 3.70% |

Exposure and the remaining Light controls were intentionally unchanged. The
native Grade baseline was refreshed after this measured improvement; neutral,
color, effects and combined pipeline cases then reproduced at 100 percent.

### Blacks transfer family

Blacks now uses a measured perceptual transfer family instead of a small
scene-log shadow mask. Camera Raw's positive response scales linearly toward a
single endpoint curve. Its negative response changes shape substantially, so
the implementation interpolates between measured -25, -50, -80 and -100
curves. This preserves the progressive black-point crush instead of inventing
an unverified gain or exponent.

The curves run conditionally in the existing basic pass. Values above 1.0 stay
scene-linear and untouched, preserving 16-bit/HDR headroom.

| Corpus | Metric | Before | After |
| --- | --- | ---: | ---: |
| Grayscale ramp | Effect correlation | 0.6475 | 0.9928 |
| Grayscale ramp | LightTable / Camera Raw magnitude | 0.212 | 0.990 |
| Grayscale ramp | Maximum delta RMSE | 12.35% | 0.35% |
| Photograph | Effect correlation | 0.6535 | 0.9585 |
| Photograph | LightTable / Camera Raw magnitude | 0.223 | 0.981 |
| Photograph | Maximum delta RMSE | 12.62% | 4.18% |

Highlights, Shadows and Whites remain unchanged pending a grounded adaptive
model. Their ramp and photograph responses disagree too strongly for a fixed
scalar correction.
