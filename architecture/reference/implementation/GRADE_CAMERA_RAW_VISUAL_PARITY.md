# Grade / Camera Raw visual parity

## Purpose

LightTable Grade is a protected, fast creative workflow. It is not a Photoshop
adjustment node and must not be changed merely because a similarly named Camera
Raw control exists. Camera Raw is used here as a black-box visual reference to
find useful differences in response, range, clipping protection and processing
order. A measured difference is a finding, not an automatic implementation
requirement.

The cross-feature rules learned from this work are normative in
[`architecture/VISUAL_PARITY_ENGINEERING.md`](../../VISUAL_PARITY_ENGINEERING.md).

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

### Production-render capture invariant

The LightTable side of every Grade section corpus must run the current packaged
desktop executable. Packaging followed by a development-Electron launch is not
valid product evidence. Before each non-neutral export, automation resets render
telemetry, authors the controls, and waits until the active document has
submitted a new `document-composite` frame whose presented revision is not
behind canonical state. Reports record the launch mode, presented revision,
output dimensions and output SHA-256 per case.

Bounded section batches checkpoint a sidecar beside every PNG. A later process
may reuse a partial only when its case ID, source SHA-256, case-manifest SHA-256
and packaged launch mode all match. An unproven PNG is recaptured instead of
being silently relabelled as current evidence.

The August 2026 production-route proof recaptured all eleven Curves cases for
`grayscale-ramp` through `production-packaged`. Every case produced a distinct
rendered revision and a non-empty 1024 x 256 PNG with a recorded hash. This
proves the strengthened capture boundary; it does not convert the existing
Curves characterization into a new Camera Raw parity claim.

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
Saturation at signed 25, 50, 80 and 100 settings across all eleven corpus
sources. Photoshop 27.9.1 / Camera Raw 18.5 produced an active response on
eight color-bearing sources. Camera Raw produced no measurable response for
the three generated achromatic sources; those inactive source/control pairs
are reported but excluded from correlation and magnitude aggregates.

| Control | Active sources | Minimum source correlation | Mean magnitude ratio | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Temperature | 8/11 | 0.3885 | 0.553 | 33.97% |
| Tint | 8/11 | 0.3916 | 0.603 | 17.81% |
| Vibrance | 8/11 | 0.7371 | 1.353 | 15.54% |
| Saturation | 8/11 | 0.9281 | 0.980 | 8.32% |

Saturation is already the strongest Color match and should not be replaced by
a speculative curve. Vibrance has similar average strength but remains
content-adaptive: the positive magnitude ratio spans 0.60–3.82 across active
sources. Temperature and Tint are structural gaps rather than range errors;
their low correlations show that a scalar increase would amplify the wrong
chromatic response. These controls remain characterization findings pending a
grounded chromatic-adaptation model and visual review of the generated contact
sheets.

The 18 August recapture binds every Camera Raw and LightTable report to the
exact source SHA-256 and current case-manifest SHA-256. The independent
readiness audit accepts all eleven source pairs as case-compatible for both
Light and Color. This replaces the earlier ten-source characterization; no
stale report participates in the aggregate.

## Spatial-detail corpus baseline

The corpus oracle covers Clarity (`Cl12`) and Dehaze (`Dhze`) at signed 25, 50,
80 and 100 values. Both descriptors were proven active on every source.
Texture is now identified as the four-character descriptor `CrTx`. An isolated
Photoshop 26.11.6 probe changed 80.64% of channel codes at +100 and 78.77% at
-100 on the frequency-detail target; `Txtr`, string `texture`, string
`Texture`, and string `CrTx` were exact no-ops. Adobe's current
[Camera Raw masking reference](https://helpx.adobe.com/uk/camera-raw/using/masking.html)
independently defines Texture as detail smoothing/accentuation which should not
change color or tonality.

This descriptor recovery is exploratory evidence, not a substituted oracle
version. The current packaged LightTable route is complete for all eleven
sources and all eight signed Texture settings. Every report records the same
case-manifest hash plus its exact source and ICC hashes. Camera Raw 27.9/18.5
must still recapture `CrTx` before Texture correlation or magnitude is accepted.
The earlier same-ID report made with inert candidates is rejected by manifest
hash and cannot enter analysis.

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
-> explicit user-selected Grade Look
-> Black & White Mix
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
| Texture / Clarity / Dehaze | Shared creative shader; spatial analysis only for Clarity/Dehaze | Clarity/Dehaze characterized; `CrTx` pixel-active and full LightTable corpus captured, current Camera Raw recapture pending |
| Detail | Conditional four-scale wavelet NR before fused Sharpening | Luminance NR characterized; remaining controls and combinations open |
| Color Mixer | Shared periodic eight-range implementation with red wraparound tests | All 24 Camera Raw HSL descriptors proven; full corpus characterized |
| Point Color | Up to eight independent samples; neutral and overlap behavior tested | Camera Raw automation and Visualize Range oracle open |
| Color Grading | Normalized 3-way masks, Blend/Balance and endpoint guards tested | All 14 Camera Raw controls proven and ten-source sRGB/16-bit corpus characterized; Display-P3 extension open |
| B&W Mix | Native fused eight-range photographic mix; Photoshop six-channel adjustment remains separate | Packaged LightTable side complete on 11 sources / 627 cases; Camera Raw response corpus remains open |
| Look / Profile | Native Grade Look with embedded `.cube` asset, live Strength and exact zero bypass | Creative user-selected Look is implemented; Camera Raw profile matching remains open |

Performance invariants are covered by executable tests: neutral Noise
Reduction performs zero allocations and zero wavelet submissions; active
Noise Reduction performs four horizontal and four reconstruction passes into
three retained `rgba16float` textures; neutral Clarity/Dehaze avoids their
downsample/blur input. The complete fused creative order is also locked by a
shader contract test.

This matrix is intentionally not a 95% parity claim. B&W Mix, Camera Raw profiles,
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

### Color Mixer descriptor oracle

Camera Raw 18.5 exposes all 24 HSL mixer controls through active four-character
Action Manager descriptors. Hue uses `HA_R`, `HA_O`, `HA_Y`, `HA_G`, `HA_A`,
`HA_B`, `HA_P`, and `HA_M`; Saturation and Luminance use the same suffixes with
the `SA_` and `LA_` prefixes. Every descriptor was pixel-validated at signed
50, 80, and 100 endpoints. LightTable is driven through its real range selector
and shared slider controls, not by mutating document state in the test.

The complete ten-source corpus uses a 0.2% Camera Raw RMS signal floor per
case. That keeps hue ranges which are genuinely absent from a source out of
correlation and ratio aggregates; quantization noise around `1e-5` must not be
reported as a 1000x strength mismatch. The three achromatic diagnostic sources
remain deliberately inactive. Depending on the range, four to six sources
carry reliable signal.

| Family | Mean correlation across ranges | Mean magnitude LT / ACR | Range of per-control mean magnitude | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Hue | 0.593 | 1.327 | 0.275-5.687 | 13.81% |
| Saturation | 0.660 | 1.191 | 0.430-3.085 | 13.77% |
| Luminance | 0.721 | 2.005 | 0.950-4.871 | 20.02% |

Orange Saturation is the closest isolated control (mean correlation 0.836,
magnitude 1.05). Blue Hue and Saturation are materially too weak, while
Magenta is much too strong and Luminance is generally stronger than Camera
Raw. The remaining low correlations prove that these are not scalar-only
range errors: Adobe and LightTable use different hue segmentation, overlap,
working-space and luminance-preservation behavior. The current periodic OKLCH
mixer remains unchanged until a grounded range-model comparison improves the
complete corpus rather than one chart or photograph.

### Color Grading descriptor and mask characterization

Camera Raw 18.5's four color wheels and transition controls are pixel-active
through `CgGH`/`CgGS` (Global), `STSH`/`STSS` (Shadows),
`CgMH`/`CgMS` (Midtones), `STHH`/`STHS` (Highlights), the four matching
luminance keys, `CgBl` (Blending) and `STB ` (Balance). Hue was sampled around
the wheel, saturation at 25/50/80/100, and signed luminance and Balance at
50/80/100 endpoints. Dependent controls use explicit active baselines.

The complete ten-source corpus produced:

| Control | Minimum source correlation | Mean magnitude LT / ACR | Per-source magnitude range | Worst delta RMSE |
| --- | ---: | ---: | ---: | ---: |
| Global Hue | 0.7571 | 1.126 | 0.65-2.55 | 11.02% |
| Global Saturation | 0.4992 | 0.889 | 0.40-1.19 | 23.32% |
| Shadows Hue | 0.4674 | 0.447 | 0.21-0.92 | 10.29% |
| Shadows Saturation | 0.2557 | 0.739 | 0.15-1.41 | 8.21% |
| Midtones Hue | 0.6885 | 1.055 | 0.56-5.42 | 10.43% |
| Midtones Saturation | 0.3898 | 0.841 | 0.56-1.59 | 18.92% |
| Highlights Hue | 0.5235 | 0.783 | 0.26-1.92 | 9.21% |
| Highlights Saturation | 0.6360 | 1.368 | 0.84-1.92 | 10.39% |
| Global Luminance | 0.6125 | 2.597 | 1.10-3.48 | 17.46% |
| Shadows Luminance | 0.2544 | 0.444 | 0.13-0.67 | 7.78% |
| Midtones Luminance | 0.4740 | 2.091 | 0.83-2.86 | 13.91% |
| Highlights Luminance | 0.4071 | 1.739 | 0.73-2.40 | 10.31% |
| Blending | -0.2362 | 1.613 | 0.37-3.81 | 3.84% |
| Balance | 0.0621 | 0.905 | 0.46-4.72 | 12.99% |

The contact sheets make the model mismatch visible: Camera Raw and LightTable
divide and overlap shadows, midtones and highlights differently, and Balance
redistributes those masks rather than applying one uniform strength. The broad
source-dependent ratios and low correlations reject scalar retuning. No
renderer constant and no LUT was changed from these results. A future accepted
change requires a grounded tonal-mask/overlap model that improves the complete
corpus, followed by recapture of earlier Color and Mixer sections.

The canonical source manifest also contains an explicitly tagged Display-P3
color target and records ICC hashes. The packaged LightTable side of that
extension is complete: all 85 isolated Color Grading outputs were captured from
the P3 source through the production UI, GPU compositor and PNG export route.
Its capture report embeds the exact source SHA-256 and ICC SHA-256, so it cannot
be mixed with a regenerated or differently tagged source. The Camera Raw side
is still required before P3 parity metrics can be accepted and is not silently
counted in the ten-source table above.

The corpus runners support `--lighttable-only` and `--camera-raw-only`. This is
an evidence-preserving resume mechanism, not permission to analyze one-sided
captures: analysis and contact sheets run only after both capture reports are
present. It allows the packaged product route to finish while the version-pinned
Adobe automation preflight is unavailable, without replacing or weakening the
missing oracle.

### Native Black & White Mix readiness

Grade now owns a distinct photographic Black & White Mix over Red, Orange,
Yellow, Green, Aqua, Blue, Purple and Magenta. Adobe likewise presents B&W as
a grayscale conversion whose individual source-color ranges determine their
resulting gray tones; Camera Raw shows the B&W Mixer instead of the Color Mixer
when B&W treatment is selected. See Adobe's current
[Camera Raw color and tonal adjustment reference](https://helpx.adobe.com/ca/camera-raw/using/make-color-tonal-adjustments-camera.html).

The LightTable implementation deliberately does not reuse or relabel the
Photoshop six-channel Black & White adjustment. It reuses the native Color
Mixer's periodic perceptual eight-range selection, converts to monochrome in
the fused creative pass after Color Mixer, Point Color and global color, then
leaves Color Grading available for subsequent toning. Disabled treatment is an
exact shader bypass and adds no render pass.

State, recipe persistence, copy/paste, module ownership, section bypass,
uniform packing and processing order are covered by the app suite. A packaged
desktop pixel smoke verifies that the neutral color fixture changes from mean
RGB `200.09, 159.25, 160.61` to exact monochrome mean
`172.93, 172.93, 172.93`. This proves the complete product route, not Camera
Raw magnitude parity. Descriptor recovery and the signed multi-source B&W
corpus remain required before changing the current response scale.

The versioned B&W manifest covers all eight ranges at signed 50%, 80% and
100% values. Its packaged LightTable route now contains all 57 isolated cases
for every one of the eleven canonical sources: 627 current-product outputs.
Every source report carries the same case-manifest SHA-256 plus exact source,
ICC, dimensions, depth and channel evidence. The color-target set was rebuilt
from an empty staging root in four bounded batches before replacing its older
pre-manifest evidence; no old output was relabelled as a fresh capture.

The candidate Camera Raw keys are deliberately marked unverified: Photoshop
2026 was visible and responsive but did not publish its automation object,
including after a bounded 90-second `/Automation` launch. No comparison metric
or parity claim is accepted until task 203 proves that external route and the
descriptors are pixel-active.

### Native Grade Look and Strength

Grade now owns a first-class Look section backed by an embedded document
`.cube` asset and a 0-100% Strength control. This is deliberately separate
from the Photoshop Color Lookup adjustment: both reuse the parser, asset
storage and 3D texture upload, but each owns an independent shader binding and
processing module. A Look is therefore always an explicit creative choice by
the user. It is never authored or selected automatically to hide a parity
difference elsewhere in Grade.

The Look is evaluated after Color Mixer, Point Color and the global perceptual
color controls, and before B&W Mix and Color Grading. Zero Strength is an exact
shader bypass. Grade copy/paste carries the LUT bytes in the session clipboard
so the Look can move across open documents; the persisted text-only clipboard
intentionally omits binary data and drops a missing Look rather than retaining
an invalid asset reference.

The packaged desktop smoke covers the real file chooser, embedded LUT load,
GPU resource path and PNG export. On the color fixture it measured mean RGB
`200.09, 159.25, 160.61` at neutral, `205.33, 168.93, 167.35` at full Strength,
`202.83, 164.22, 165.32` at 50%, and exact neutral again at 0%. The midpoint
therefore interpolates visually between bypass and full effect, while the
zero endpoint proves that this module cannot silently alter an unselected
Grade. The same packaged route copies the embedded LUT from one open document
to another, remaps its asset id and verifies the destination at Strength 62
after the asynchronous GPU upload has settled.

### Packaged 4K interaction baseline

`npm run audit:desktop:grade-interaction` generates a 3840 x 2160 diagnostic,
opens it through the packaged desktop product route and performs real pointer
drags on both a fused tonal control and the conditional wavelet Detail path.
The window must remain presented: Chromium intentionally throttles a never-
shown background window and that would measure automation policy instead of
editor interaction.

On the reference RTX 5090 system, two consecutive runs each delivered 50 live
GPU updates from 50 pointer moves without a main-thread task above 250 ms. The
first accepted run measured Exposure at 24.03 fps and Luminance Noise Reduction
at 24.02 fps. Both used the topmost processing suffix cache. Activating wavelet
noise reduction raised estimated GPU texture residency from 547,465,152 to
746,530,752 bytes: exactly three 4K `rgba16float` scratch textures
(`3840 * 2160 * 8 * 3`), matching the bounded runtime design. Neutral Detail
still returns the input texture without encoding the eight wavelet passes; the
scratch textures remain resident for reuse until the document runtime is
destroyed.

The current acceptance floor is 12 presented frames per second at 4K and the
interaction scheduler must remain below 45 fps. This is a regression guard,
not the final performance ceiling; lower-power GPU and Apple Silicon evidence
remains part of the final owner/platform review.
