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

Since the truthful processing-layer migration, the LightTable reference is a
normal Grade Layer placed at the top of the root layer stack. It is global by
position and never through a hidden Global Grade singleton.

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

## Extended corpus and review tooling

The versioned corpus manifest is `scripts/grade-camera-raw-corpus.json`. It
covers generated luminance ramps, near-black/near-white steps, smooth color
targets, skin patches, multiple spatial frequencies, deterministic luminance
and chroma noise, low/high-key photographs, colorful/backlit photographs and
a real 16-bit TIFF. Generated sources and the complete inventory—including
content hashes, dimensions, profiles and bit depth—remain outside the
repository under `D:\mediavibe\LightTableTests\GradeCameraRawCorpus`.

Run:

```text
npm run prepare:grade-camera-raw-corpus
npm run capture:grade-light-corpus
npm run capture:grade-light-corpus -- --source=tonal-steps
npm run contact-sheet:grade-parity -- --root=<one capture root>
```

The corpus runner is resumable by source; `--force` deliberately replaces
existing Adobe and LightTable captures. Each control contact sheet shows the
Camera Raw result, LightTable result, a four-times-amplified difference between
their neutral-relative effects and a split view. These sheets are review
evidence, not accepted visual baselines.

The first new end-to-end tonal-steps run reconfirmed Photoshop 27.9.1 and
Camera Raw 18.5. It measured 0.03% neutral RMSE. Previously accepted Contrast
and Blacks remained close (maximum delta RMSE 0.62% and 0.40% respectively),
while Highlights, Shadows and Whites remained open and structurally different.

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

Highlights, Shadows and positive Whites remain unchanged pending a grounded
adaptive model. Their ramp and photograph responses disagree too strongly for
a fixed scalar correction.

### Negative Whites transfer family

Negative Whites is now calibrated separately from positive Whites. The four
measured negative curves agree across the ramp and photograph and replace the
former weak exponential output adjustment. Positive Whites remains on the
existing protected output path because a fixed transfer curve overcorrects the
photograph and therefore is not yet a justified replacement.

Across the four negative settings, effect correlation is 0.9923–0.9974 on the
ramp and 0.9852–0.9908 on the photograph. Maximum delta RMSE is 0.43 percent on
the ramp and 0.80 percent on the photograph. The aggregate Whites metrics also
improve despite the untouched positive half:

| Corpus | Metric | Before | After |
| --- | --- | ---: | ---: |
| Grayscale ramp | Effect correlation | 0.6118 | 0.8096 |
| Grayscale ramp | LightTable / Camera Raw magnitude | 0.360 | 0.680 |
| Photograph | Effect correlation | 0.7230 | 0.8805 |
| Photograph | LightTable / Camera Raw magnitude | 0.474 | 0.800 |

### Positive Whites processing ownership

The truthful processing-layer migration exposed a separate correctness defect:
positive Whites still lived in the retired document-final output transform.
Consequently a normal topmost Grade Layer—and therefore every mid-stack,
grouped or masked Grade Layer—produced exactly zero positive Whites effect.
Negative Whites already evaluated inside the owning Grade tone pass.

The existing protected positive response now evaluates conditionally in that
same tone pass. Values above scene-linear 1.0 remain untouched, neutral remains
an exact bypass, and the hidden output-transform application has been removed.
This restores truthful layer order and a usable control; it is not presented as
finished Camera Raw parity.

Across the ten-source corpus the positive response moved from a zero magnitude
range to 0.01–0.67 of Camera Raw, with mean effect correlation 0.5117. The wide
range and remaining worst-case error confirm that Camera Raw positive Whites is
distribution-dependent and must not be “fixed” with a scalar gain. Negative
Whites retained mean magnitude 1.010 and its existing measured curve family.

## Color corpus baseline

The same version-pinned oracle now covers Temperature, Tint, Vibrance and
Saturation at signed 25, 50, 80 and 100 settings across all ten corpus
sources. Photoshop 27.9.1 / Camera Raw 18.5 produced an active response on
seven color-bearing sources. Camera Raw produced no measurable response for
the three generated achromatic sources; those inactive source/control pairs
are reported but excluded from correlation and magnitude aggregates.

| Control | Active sources | Minimum source correlation | Mean magnitude ratio | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Temperature | 7/10 | 0.4544 | 0.542 | 33.97% |
| Tint | 7/10 | 0.3916 | 0.598 | 17.81% |
| Vibrance | 7/10 | 0.7371 | 1.302 | 13.56% |
| Saturation | 7/10 | 0.9281 | 0.973 | 8.32% |

Saturation is already the strongest Color match and should not be replaced by
a speculative curve. Vibrance has similar average strength but remains
content-adaptive: the positive magnitude ratio spans 0.60–3.82 across active
sources. Temperature and Tint are structural gaps rather than range errors;
their low correlations show that a scalar increase would amplify the wrong
chromatic response. These controls remain characterization findings pending a
grounded chromatic-adaptation model and visual review of the generated contact
sheets.

## Spatial-detail corpus baseline

The corpus oracle also covers Clarity (`Cl12`) and Dehaze (`Dhze`) at signed
25, 50, 80 and 100 values. Both descriptors were proven active on every
source. Texture descriptors `Txtr`, lowercase `texture`, and canonical
`Texture` with both integer and double values were separately proven inert in
Camera Raw Filter 18.5. Texture therefore
remains an explicitly unresolved automation control instead of being reported
under a guessed descriptor.

| Control | Active sources | Minimum source correlation | Mean magnitude ratio | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Clarity | 10/10 | 0.2697 | 0.378 | 12.25% |
| Dehaze | 10/10 | 0.0404 | 0.336 | 38.92% |

The broad per-source magnitude ranges and low correlations show that the
current compact local-contrast and dark-channel-inspired implementations are
useful creative controls, but not Camera Raw parity implementations. Scaling
their existing output would not recover Camera Raw's radius, tonal masks or
scene adaptation and is therefore rejected as an ungrounded change.

The standalone Luminance Noise Reduction oracle was migrated from the removed
Global Grade pseudo-row to a normal topmost Grade Layer and now decodes its
source only once. Its earlier result reproduced: at Amount 100, Camera Raw and
LightTable retain nearly identical high-frequency energy (0.7357 versus
0.7365), while LightTable's total effect magnitude is 1.595 times Camera Raw
with correlation 0.6505. This is evidence that the remaining gap is in
multi-scale threshold/reconstruction distribution rather than one overall
strength value; no scalar retuning was accepted.

## Internal processing and readiness audit

The August 2026 audit separated visual-parity evidence from implementation
readiness. A normal Grade Layer and attached Grade share the same renderer and
fixed photographic order. Independent layer nodes remain ordered by the layer
stack; the module inventory inside one fused Grade node is not presented as an
arbitrarily reorderable graph.

```text
Temperature / Tint
-> Exposure + Highlights / Shadows / Whites / Blacks / Contrast
-> conditional wavelet luminance and color noise reduction
-> Sharpening
-> Texture -> Clarity -> Dehaze
-> Color Mixer -> Point Color
-> Saturation / Vibrance
-> Color Grading
-> Lift -> Curves
```

Gradient Map and Photoshop adjustment payloads use the same final creative
shader only when their focused node owns those settings. They are not exposed
as hidden Grade sections.

| Area | Implementation state | Camera Raw evidence state |
| --- | --- | --- |
| Light | Shared, fixed-order, exact neutral bypass | Contrast/Blacks/negative Whites accepted; remaining adaptive controls characterized |
| Color | CAT16 white balance and shared perceptual color path | Full signed corpus characterized; no speculative scalar accepted |
| Curves | Shared native LUT/editor/shader | Master and RGB point curves characterized; Refine Saturation remains open |
| Texture / Clarity / Dehaze | Shared creative shader; spatial analysis only for Clarity/Dehaze | Clarity/Dehaze characterized; Texture descriptor unresolved |
| Detail | Conditional four-scale wavelet NR before fused Sharpening | Luminance NR characterized; remaining controls and combinations open |
| Color Mixer | Shared periodic eight-range implementation with red wraparound tests | Camera Raw Action Manager descriptors not yet proven |
| Point Color | Up to eight independent samples; neutral and overlap behavior tested | Camera Raw automation and Visualize Range oracle open |
| Color Grading | Normalized 3-way masks, Blend/Balance and endpoint guards tested | Camera Raw wheel descriptor/oracle open |
| B&W Mix | Separate Photoshop six-channel adjustment exists | True eight-range Grade B&W Mix is not implemented |
| Look / Profile | Document LUT infrastructure exists through Color Lookup | Grade Profile/Look selection and Strength are not implemented |

Performance invariants are covered by executable tests: neutral Noise
Reduction performs zero allocations and zero wavelet submissions; active
Noise Reduction performs four horizontal and four reconstruction passes into
three retained `rgba16float` textures; neutral Clarity/Dehaze avoids their
downsample/blur input. The complete fused creative order is also locked by a
shader contract test.

This matrix is intentionally not a 95% parity claim. B&W Mix, Profile/Look,
several Adobe descriptors, cross-section captures and owner visual review are
still required by Task 141 before that claim can be made honestly.

### Point Curves corpus

Camera Raw 18.5's point-curve descriptor is a flat `ActionList` of integer
input/output pairs. The active four-character keys are `Crv `, `CrvR`, `CrvG`
and `CrvB` for Master, Red, Green and Blue. String forms and the XMP property
name `ToneCurvePV2012` are accepted by the Filter boundary but pixel-inert.
The oracle therefore validates output pixels rather than treating a successful
Action Manager call as proof.

The ten-source suite covers endpoint lifts, endpoint reductions, strong
midpoint moves, an S-curve, a near-flat curve, isolated R/G/B curves and a
Master-plus-Red stack. It authors LightTable through the real shared
`CurvesEditor`, then compares both products against their own neutral render.

| Curve family | Active sources | Mean source correlation | Minimum source correlation | Mean magnitude LT / ACR | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Master | 10/10 | 0.9824 | 0.9075 | 1.012 | 25.72% |
| Red | 10/10 | 0.8379 | 0.3254 | 0.544 | 11.40% |
| Green | 10/10 | 0.8339 | 0.6552 | 0.688 | 7.49% |
| Blue | 10/10 | 0.9431 | 0.8250 | 0.819 | 3.94% |
| Master then Red | 10/10 | 0.8947 | 0.6744 | 0.858 | 20.15% |

Master is already close in direction and aggregate effect magnitude. Its high
worst-case error belongs to the deliberately saturated color target, not a
general range deficit. The individual Camera Raw channels are stronger and
behave differently on saturated colors. A research-only model comparison used
Camera Raw's own neutral outputs to test the same monotone S-curve in direct
encoded sRGB and in ProPhoto primaries with either an sRGB or 1.8-gamma shaper:

| Candidate channel space | Aggregate correlation | Magnitude candidate / ACR | RMSE |
| --- | ---: | ---: | ---: |
| Encoded sRGB | 0.8477 | 0.603 | 5.00% |
| ProPhoto + sRGB shaper | 0.7335 | 1.887 | 11.46% |
| ProPhoto + gamma 1.8 | 0.6768 | 2.234 | 14.75% |

Adobe [documents that Lightroom's Develop preview uses ProPhoto RGB](https://helpx.adobe.com/uk/lightroom-classic/help/color-management.html), but that
does not establish the internal position or transfer domain of Camera Raw's
channel curves. The measured ProPhoto candidates are materially worse and are
rejected. LightTable's existing overshoot-safe monotone Grade curve and
encoded-sRGB channel boundary remain unchanged. Camera Raw Refine Saturation
and the internal channel working stage remain separate open investigations.

### Complete Detail descriptor and baseline oracle

Camera Raw 18.5's complete Detail family was recovered and pixel-validated
through the Filter Action Manager interface. The active four-character IDs
are `Shrp`, `ShpR`, `ShpD`, `ShpM`, `LNR `, `LNRD`, `LNRC`, `CNR `, `CNRD`
and `CNRS`. The equivalent long XMP property names are accepted by Photoshop
but inert in this Filter boundary and are therefore not used.

The oracle supports prerequisite baselines. Radius, Sharpening Detail and
Masking are compared against Amount 100 in both products. Luminance Detail and
Contrast are compared against Luminance 100; Color Detail and Smoothness are
compared against Color 100. This prevents a dependent control from being
misreported as inactive or from being compared against the wrong neutral.

The initial multiscale-noise target proves all ten descriptors active. It
shows that Sharpening is structurally different and substantially weaker in
LightTable, while primary Luminance NR is already close in direction but too
strong. These single-target figures are characterization only:

| Control | Correlation | Magnitude LT / ACR | Worst delta RMSE |
| --- | ---: | ---: | ---: |
| Sharpening Amount | 0.5495 | 0.189 | 8.70% |
| Radius | 0.2711 | 0.232 | 4.92% |
| Sharpening Detail | 0.3388 | 0.171 | 6.28% |
| Masking | 0.5590 | 0.085 | 7.40% |
| Luminance NR | 0.9057 | 1.384 | 1.73% |
| Luminance Detail | 0.5710 | 0.722 | 2.39% |
| Luminance Contrast | 0.1678 | 0.948 | 0.26% |
| Color NR | 0.8225 | 0.601 | 2.49% |
| Color Detail | 0.2804 | 1.971 | 2.20% |
| Color Smoothness | -0.0086 | 2.407 | 0.40% |

No renderer constant was changed from this one source. The complete ten-source
corpus subsequently produced the following aggregate characterization. A
control is counted active only where Camera Raw changed the source, so the
three achromatic targets do not contaminate the color-noise figures.

| Control | Active sources | Minimum source correlation | Mean magnitude LT / ACR | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Sharpening / Amount | 10/10 | 0.0945 | 0.109 | 12.35% |
| Sharpening / Radius | 10/10 | 0.0880 | 0.205 | 8.90% |
| Sharpening / Detail | 10/10 | 0.0619 | 0.113 | 6.38% |
| Sharpening / Masking | 10/10 | 0.2123 | 0.139 | 10.49% |
| Noise Reduction / Luminance | 10/10 | -0.0056 | 1.736 | 6.57% |
| Noise Reduction / Luminance Detail | 10/10 | 0.1540 | 0.844 | 9.37% |
| Noise Reduction / Luminance Contrast | 10/10 | 0.0691 | 0.735 | 0.40% |
| Color Noise Reduction / Color | 7/10 | 0.1545 | 0.805 | 26.46% |
| Color Noise Reduction / Detail | 7/10 | 0.1694 | 1.250 | 17.10% |
| Color Noise Reduction / Smoothness | 7/10 | -0.0419 | 0.820 | 0.90% |

This rules out a responsible scalar-only fix. LightTable Sharpening is much
weaker on average, but its per-source magnitude spans 0.02–0.49 of Camera Raw
and its minimum correlations are low. Increasing Amount would amplify a
different spatial response and worsen halos on sources that already respond
more strongly. Luminance and color noise reduction are closer in aggregate
strength, but their remaining low correlations and broad source-dependent
ranges locate the gap in scale thresholds, edge/chroma discrimination and
reconstruction. The next accepted Detail renderer change therefore requires a
kernel/model comparison and new before/after corpus evidence; none of the
current constants is retuned from these measurements alone.
