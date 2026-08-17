# Adjustment visual parity tracker

## Contract

Photoshop 27.11 is the black-box reference for Photoshop-shaped adjustment
nodes. LightTable Grade remains a separate, protected creative workflow. Shared
GPU code may be reused, but a Photoshop parity change must not silently alter
Grade output.

Every adjustment is measured at neutral, small, middle, 80-percent and endpoint
settings. Signed controls cover both directions. The corpus combines diagnostic
grayscale and color ramps with real photographs. Photoshop produces a layered
PSD and reference PNG; LightTable imports that PSD through its production path
and exports its compositor result. Normalized RGB RMSE is measured over every
pixel.

The minimum gate is both:

- overall visual parity of at least 95 percent (`100 * (1 - mean RMSE)`); and
- at least 95 percent of individual cases with RMSE no greater than 5 percent.

Neutral output must remain exact. Improvements are committed per adjustment
only after the same corpus is rerun. A later discovery requires rerunning all
previously accepted adjustments. External captures live under
`D:\mediavibe\LightTableTests\AdjustmentParity`; summaries and implementation
decisions live here.

## Exposure

Status: accepted.

Photoshop's Exposure node was measured to use a power-2.2 bridge: Exposure and
Offset operate after raising encoded values to 2.2, while Gamma Correction is
applied to the encoded result. LightTable previously used its scene-linear value
directly and applied gamma before encoding.

The measured implementation keeps this behavior inside the Photoshop Exposure
branch. Grade exposure remains on LightTable's existing linear-light path.

| Corpus | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | ---: | ---: | ---: | ---: |
| Grayscale ramp | 23 | 0.088% | 0.385% | 99.912% |
| `D:\people.jpg` | 23 | 0.086% | 0.386% | 99.914% |
| `D:\pool.jpg` | 23 | 0.092% | 0.521% | 99.908% |

The old grayscale response had a mean curve RMSE of 1.093 percent and a worst
case of 5.162 percent at Exposure +5. The measured 2.2 response reduces those
figures to 0.104 and 0.374 percent respectively. All three end-to-end corpora
pass the 95-percent gate, including the 80- and 100-percent parameter cases.

## Brightness / Contrast

Status: accepted.

Photoshop 27.11's current Brightness / Contrast is not its legacy affine
operation. Adobe describes it as a proportional, nonlinear adjustment with
protected endpoints; the black-box corpus confirms that Brightness is applied
before Contrast and that Contrast interpolates toward a protected S-curve. The
exact modern transfer function is not public, so LightTable uses a generated,
measured 65-knot transfer family across the full Brightness range, with measured
Contrast endpoints and continuous interpolation between control values. The
runtime remains full-float: the calibration does not quantize rendered pixels.

Legacy behavior is implemented analytically from the oracle: encoded-channel
brightness offset, contrast around `127 / 255`, and Photoshop's measured
sign-dependent operation order. Contrast +100 uses its measured hard threshold.

Both modes operate in the PSD document blend profile before returning to
LightTable's canonical linear-premultiplied sRGB compositor space. This profile
route is supplied as document context to the adjustment node; Grade remains
unchanged. The GPU cost is one CPU-built 65-point LUT per slider update and two
uniform reads per channel, with no extra pass, texture, or readback.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | --- | ---: | ---: | ---: | ---: |
| Grayscale ramp | untagged / 8-bit | 26 | 0.147% | 0.505% | 99.853% |
| `D:\people.jpg` | untagged / 8-bit | 9 | 0.214% | 0.489% | 99.786% |
| `D:\pool.jpg` | untagged / 8-bit | 9 | 0.269% | 0.789% | 99.731% |
| `D:\people.jpg` | Adobe RGB (1998) / 16-bit | 9 | 1.629% | 3.490% | 98.371% |

Every case passes the 5-percent per-case gate. The Adobe RGB corpus includes a
0.243-percent neutral roundtrip baseline, so its residual also covers existing
profile-conversion and 16-bit interchange differences rather than only the
adjustment response. Do not compensate for that residual inside this node.

Calibration can be regenerated with
`npm run generate:photoshop-brightness-contrast-lut`. The reference description
is Adobe's [Brightness / Contrast documentation](https://helpx.adobe.com/uk/photoshop/using/apply-brightness-contrast-adjustment.html);
the oracle, rather than an invented smoothing curve, is the implementation
authority.

## Levels

Status: accepted.

Photoshop Levels operates on encoded document channels, not on LightTable's
canonical linear-light composite. The standard input range, gamma power, and
output range are therefore applied after encoding to the PSD blend profile and
decoded again before the next compositor node. Neutral remains exact.

A Photoshop Levels descriptor contains four simultaneously active transfer
functions: composite RGB plus Red, Green, and Blue. LightTable previously kept
only the first editable channel, which is commonly Photoshop's neutral RGB
entry, so authored per-channel work could render neutral. The node model, UI,
PSD import/export, and GPU payload now retain all four. Black-box stack testing
also established Photoshop's order: per-channel transfer functions run first,
then the composite RGB transfer function.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | --- | ---: | ---: | ---: | ---: |
| Grayscale and channel ramp | untagged / 8-bit | 20 | 0.314% | 1.842% | 99.686% |
| `D:\people.jpg` | untagged / 8-bit | 9 | 0.282% | 0.996% | 99.718% |
| `D:\people.jpg` | sRGB / 16-bit | 9 | 0.338% | 1.021% | 99.662% |

All cases pass the 5-percent per-case gate, including 80-percent endpoints,
gamma 0.1 and 9.99, isolated R/G/B channels, and a simultaneous composite-plus-
red stack. The original linear-light, single-channel renderer scored 92.180%
with only 42.1% of cases passing; the accepted renderer scores 99.686% with all
cases passing. The largest residual is Photoshop's protected/quantized deep-shadow
response at gamma 2–5 in the 8-bit path (for gamma 5 it disappears above code
8). LightTable deliberately retains its smooth float response rather than
adding an ungrounded shadow curve; this remains a documented holdout for a
future measured transfer implementation.

## Curves

Status: accepted.

Photoshop 27.11 point curves use a natural cubic spline. Candidate fitting on
strong one-point and S-curves rejected linear, Catmull-Rom, and LightTable's
existing monotone Hermite interpolation; the natural spline predicts Photoshop
to roughly 0.1 percent RMSE on those curve shapes before the full render test.

LightTable now records curve interpolation semantics explicitly. Standalone,
attached, and PSD-imported Photoshop Curves nodes use `photoshop-natural`;
Grade continues to use its existing overshoot-safe `monotone` interpolation.
Editing and resetting a Curves node retain its mode, so the parity improvement
does not alter an existing Grade look. R/G/B curves run before the composite
curve, matching the measured Photoshop stack order.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | --- | ---: | ---: | ---: | ---: |
| Grayscale and channel ramp | untagged / 8-bit | 13 | 0.045% | 0.142% | 99.955% |
| `D:\people.jpg` | untagged / 8-bit | 9 | 0.043% | 0.130% | 99.957% |
| `D:\people.jpg` | sRGB / 16-bit | 9 | 0.163% | 0.283% | 99.837% |

All cases are within two output code values, including 80-percent midpoint
moves, endpoint lifts, inverse, isolated color channels, and a simultaneous
composite-plus-red curve. The previous shared monotone implementation scored
99.017% overall, with about 3.9% RMSE on the strongest midpoint cases.

## Hue / Saturation

Status: accepted, including Master, Colorize, and selective color ranges.

Photoshop 27.11 processes Hue / Saturation in encoded document RGB. Its Master
response is not LightTable's perceptual Grade saturation: Lightness first fades
each encoded channel toward black or white, after which Hue and Saturation run
in HSL. Negative saturation scales chroma toward zero; positive saturation uses
the measured reciprocal response and clips at full saturation. This asymmetry is
especially important at +80 and +100. Colorize retains the source HSL lightness
while assigning its authored hue and saturation.

This measured route is confined to the Photoshop adjustment node. Grade keeps
its existing Oklab implementation. PSD import/export now also recognizes
Photoshop's native Colorize descriptor (`a = 256`, with H/S/L stored in the
range fields), and Colorize exposes Photoshop's 0–360 Hue and 0–100 Saturation
ranges in the contextual editor.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | --- | ---: | ---: | ---: | ---: |
| `D:\people.jpg` | untagged / 8-bit | 22 | 0.139% | 1.134% | 99.861% |
| `D:\kleur.jpg` | sRGB / 8-bit | 22 | 0.172% | 1.531% | 99.828% |
| `D:\kleur.jpg` extreme subset | sRGB / 16-bit | 10 | 0.105% | 0.256% | 99.895% |

Every case passes the 5-percent per-case gate. The corpus covers Hue ±180,
Saturation and Lightness ±100, combined ±80 settings, and Colorize at 80%
saturation. Colorize is the largest 8-bit residual; the independent 16-bit
corpus reduces it to 0.231% RMSE, so no arbitrary hue offset is warranted.

Photoshop also stores Reds, Yellows, Greens, Cyans, Blues, and Magentas as
independent range adjustments. Each uses four hue boundaries: a fully selected
inner interval plus a linear falloff interval on either side, wrapping around
the hue circle for Reds. The model, contextual range selector, GPU payload, and
PSD import/export preserve all six ranges and their authored boundaries. They
add no render pass or texture lookup; the fragment shader evaluates only six
small piecewise-linear weights. Adobe's current
[Hue/Saturation adjustment schema](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2-beta/v1-to-v2/layer-operations-adjustments)
independently documents the same ramp/sustain boundaries and six local-range
channel identifiers.

The hue/lightness ramp exposed a separate local-Lightness rule: positive values
move channels toward that pixel's brightest channel, while negative values move
them toward its darkest channel. This protects the selected color range from a
Master-style fade to white or black. Implementing this measured behavior raised
the six-range `D:\kleur.jpg` corpus from 96.194% parity with one failed case to
99.219% parity with every case passing. A diagnostic Reds ramp scores 99.331%
over isolated Hue, Saturation, Lightness, and combined +80 cases. The strongest
combined Reds photograph remains the largest residual at 3.955% RMSE, inside
the per-case gate; single-range operations measure between 99.448% and 99.981%
parity. No fitted correction curve is applied to that residual.

## Color Balance

Status: measured improvement accepted; photographic extreme-case audit remains
open.

Photoshop 27.11 does not implement Color Balance as a linear RGB offset. The
measured encoded-document response uses sign-dependent toe, midpoint, and
shoulder transfer curves with clipping after each tonal stage. Midtones follow
a symmetric power family (`2^(-amount / 100)`); adding shadow color and
subtracting highlight color use the wider half-strength family. The remaining
toe/shoulder directions retain the classic asymmetric rational falloff found in
GIMP's original Color Balance source. Photoshop's current positive-highlight
shoulder lies between that classic response and a protected complementary power
curve; +20, +80, and +100 captures determine the blend rather than a mild-value
fit.

`Preserve Luminosity` changes the transfer inputs rather than repairing
luminance after clipping. For each three-axis tonal vector, Photoshop removes a
neutral component using the strongest channel as the shadow anchor, the
min/max midpoint as the midtone anchor, and the weakest channel as the highlight
anchor. This explains the measured opponent-channel response and avoids the old
single-lightness-mask approximation. Grade remains unchanged, and the node adds
no pass, texture, readback, or CPU work.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 37 | 1.792% | 12.532% | 98.208% | 36 / 37 |
| `D:\people.jpg` | sRGB / 16-bit | 37 | 2.242% | 14.258% | 97.758% | 32 / 37 |

The diagnostic corpus passes the full tracker gate. The 16-bit photograph
passes the overall 95-percent visual-parity requirement but not yet the strict
per-case requirement. Its misses are concentrated in endpoint shadows and the
deliberately adversarial case that drives all three tonal ranges to alternating
80-percent extremes; ordinary and isolated midtone cases are approximately
99.4–99.8% parity. This residual remains explicit rather than being hidden by a
photo-specific correction. Adobe documents the tone ranges and default
luminosity protection in its
[Color Balance guide](https://helpx.adobe.com/uk/photoshop/using/applying-color-balance-adjustment.html);
the historic transfer-family reference is GIMP's
[original Color Balance implementation](https://raw.githubusercontent.com/GNOME/gimp/GIMP_1_0_4/app/color_balance.c).

## Black & White

Status: accepted.

Photoshop 27.11 evaluates Black & White in encoded document RGB. It decomposes
each pixel into its neutral minimum channel plus chroma, then multiplies that
chroma by a hue-interpolated value from the Red, Yellow, Green, Cyan, Blue, and
Magenta sliders:

`gray = min(R, G, B) + (max(R, G, B) - min(R, G, B)) * mixer(hue) / 100`

This preserves neutral pixels naturally and makes each slider the exact output
percentage for its fully saturated primary or secondary color. It also explains
Photoshop's full -200..300 range without a special endpoint curve. The old
LightTable implementation scaled linear luminance relative to the default mix,
which changed neutral pixels and scored only 80.194% on the diagnostic corpus.

Tint reuses Photoshop's encoded `SetLum` / `ClipColor` operation: the authored
tint supplies chroma and hue while the monochrome result supplies luminosity.
Grade remains unchanged; the adjustment adds no pass, texture, or readback.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 22 | 0.075% | 0.477% | 99.925% | 22 / 22 |
| `D:\people.jpg` | sRGB / 16-bit | 22 | 0.185% | 0.246% | 99.815% | 22 / 22 |

The corpus covers every mixer independently at -200 and +300, Red at +100,
uniform and alternating endpoint combinations, the default mix, and neutral,
red, and blue tint colors. Every 16-bit photographic case is within two output
code values by the tracker metric. Adobe documents the same six color sliders,
Auto behavior, and optional Tint color in its current
[Black & White guide](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html).

## Photo Filter

Status: accepted.

Photoshop 27.11 models Photo Filter as optical transmittance in its D50 profile
connection space. Source and filter colors are transformed to linear D50 XYZ;
Density linearly interpolates the filter's three XYZ transmissions from the D50
white point. The filtered XYZ value is transformed back to document RGB. This
accounts for the cross-channel response on saturated colors that an RGB
multiply cannot reproduce.

`Preserve Luminosity` first clips that filtered RGB result to gamut, then applies
Photoshop's encoded-document `SetLum` / `ClipColor` operation with the classic
0.30 / 0.59 / 0.11 blend luminosity. The ordering matters at high density and
on primary colors. No fitted falloff curve, extra render pass, lookup texture,
or readback is used.

PSD interchange was part of the measured defect. Photoshop commonly stores the
Photo Filter color as normalized CIE Lab and Density as a 0..1 fraction.
LightTable now converts that Lab descriptor through D50 to sRGB, imports the
fraction into its 1..100 UI range, and exports the inverse representation.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 15 | 0.219% | 0.311% | 99.781% | 15 / 15 |
| `D:\people.jpg` | sRGB / 16-bit | 28 | 0.188% | 0.250% | 99.812% | 28 / 28 |

The corpus covers Density 1, 20, 50, 80, and 100; preserve on and off; warm,
red, blue, green, neutral gray, white, and black filters. Every photographic
case is within two output code values by the tracker metric. Adobe describes
Photo Filter as a photographic color-transmission simulation, Density as its
strength, and Preserve Luminosity as protection of image luminosity in the
[Photo Filter guide](https://helpx.adobe.com/sg/photoshop/using/applying-color-balance-adjustment.html).

## Channel Mixer

Status: accepted.

Photoshop 27.11 applies each Channel Mixer output matrix directly to encoded
document RGB, adds that output channel's Constant in the same -2..2 domain, and
then clips to the document range. Monochrome evaluates the Gray matrix once and
copies it to all three outputs. The old LightTable node used the same authored
matrix in linear compositor RGB, which happened to make identity, pure channel
swaps, and fully clipped endpoints exact while producing large errors for mixed
positive values.

The corrected implementation only adds the existing document encode/decode
bridge around the matrix. It changes neither Grade nor the stack structure and
adds no pass, texture, lookup, or readback.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 15 | 0.032% | 0.191% | 99.968% | 15 / 15 |
| `D:\people.jpg` | sRGB / 16-bit | 15 | 0.057% | 0.256% | 99.943% | 15 / 15 |

The corpus covers identity, Red/Blue swap, source coefficients at -200 and
+200, a full three-output matrix, Constant at -200, +80, and +200, and four
monochrome mixes including Photoshop's infrared preset and adversarial
endpoints. Every case is within two output code values by the tracker metric.
Adobe documents the same -200..200 coefficient and Constant ranges, negative
source inversion, output-channel matrices, and Monochrome behavior in its
[Channel Mixer guide](https://helpx.adobe.com/ie/photoshop/using/color-monochrome-adjustments-using-channels.html).

## Invert

Status: accepted.

Photoshop 27.11 inverts each encoded document channel (`1 - channel`) and then
returns to the compositor working space. LightTable previously inverted linear
RGB, which scored 71.745% on the diagnostic color corpus. The corrected node is
exact on both measured corpora and does not affect Grade.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity |
| --- | --- | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 1 | 0.000% | 0.000% | 100.000% |
| `D:\people.jpg` | sRGB / 16-bit | 1 | 0.000% | 0.000% | 100.000% |

## Posterize

Status: accepted.

Photoshop 27.11 assigns each encoded document channel to one of the authored
number of discrete buckets. A value exactly on a bucket boundary remains in the
lower bucket, expressed by `ceil(channel * levels) - 1`, clamped to the valid
bucket range. LightTable previously applied `floor(channel * levels)` in linear
RGB, which moved both the boundaries and the displayed output levels.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 9 | 0.120% | 0.222% | 99.880% | 9 / 9 |
| `D:\people.jpg` | sRGB / 16-bit | 9 | 0.427% | 3.004% | 99.573% | 9 / 9 |

The corpus covers 2, 3, 4, 8, 16, 32, 64, 128, and 255 levels. The 16-bit
Level 3 residual comes from pixels immediately around the one-third and
two-thirds code boundaries; all other photographic cases are within two output
code values. LightTable retains continuous float bucket values instead of
injecting an ungrounded 8-bit epsilon into its 16-bit compositor.

## Threshold

Status: accepted.

Photoshop 27.11 evaluates Threshold from encoded-document blend luminosity,
using the same `0.30 R + 0.59 G + 0.11 B` coefficients as its classic blend
luminosity. In an 8-bit document that luminosity is rounded to an 8-bit code
before comparison; in a 16-bit document Photoshop retains the finer value.
The selected threshold code is inclusive: values at or above it become white.
LightTable previously compared Rec.709 luminance in linear compositor RGB.

The GPU payload now carries authored document bit depth as well as blend
profile. Adjustment Layer render resources refresh both values when a document
is attached; previously their initial configuration could precede the document
and retain fallback color context. This corrects Threshold and prevents other
local/Adjustment Layer nodes from silently using sRGB semantics for an Adobe
RGB PSD. The change adds no render pass, texture, lookup, or readback.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Cases <= 5% RMSE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 8 | 0.429% | 0.960% | 99.571% | 8 / 8 |
| Hue/lightness diagnostic ramp | sRGB / 16-bit | 8 | 0.586% | 1.473% | 99.414% | 8 / 8 |
| `D:\people.jpg` | sRGB / 16-bit | 8 | 1.840% | 4.795% | 98.160% | 8 / 8 |

The corpus covers threshold codes 1, 2, 64, 127, 128, 192, 254, and 255, so
both endpoints, the central boundary, and high-strength behavior are measured.
On the unrendered 8-bit source oracle, rounded blend luminosity disagrees with
Photoshop on only 14 of 1,474,560 binary pixel decisions. Remaining rendered
differences are boundary flips caused by import/profile precision; no fitted
falloff or threshold epsilon was added.

## Selective Color

Status: accepted.

Photoshop Selective Color stores nine simultaneously active CMYK correction
ranges: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals, and
Blacks. LightTable previously evaluated only the range currently selected in
the Properties dropdown and used one generic chroma weight. Merely changing
the editor dropdown could therefore change the rendered document, while most
authored PSD range data was ignored.

The corrected node evaluates every stored range in encoded document RGB and
adds its contribution from the original pixel. Primary/secondary ranges use
the distance from maximum/minimum to the middle channel. Whites and Blacks
fall off from the upper and lower half-range; Neutrals use the complementary
maximum/minimum distance around mid-gray. Relative corrections scale by the
remaining amount of each RGB component, while Absolute corrections use the
authored CMYK amount directly. Per-component and final gamut protection match
Photoshop's bounded response. No LUT, extra pass, or readback is used.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Within two code values |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 37 | 0.042% | 0.112% | 99.958% | 37 / 37 |
| `D:\people.jpg` | sRGB / 16-bit | 37 | 0.126% | 0.273% | 99.874% | 37 / 37 |

The corpus measures neutral plus all nine ranges with Relative Cyan +100,
Relative Black -100/+100, and an Absolute C/M/Y/K mix of +80/-60/+40/+100.
Before replacement, the same diagnostic corpus scored 90.082% with only 20 of
37 cases inside the 5-percent gate; the accepted implementation passes all 74
measured renders across both bit depths. Adobe defines the nine ranges and
Relative versus Absolute semantics in its
[Selective Color documentation](https://helpx.adobe.com/photoshop/using/mix-colors.html).
The range and correction equations were cross-checked against FFmpeg's
[Photoshop-derived Selective Color implementation](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/master/libavfilter/vf_selectivecolor.c).

## Gradient Map

Status: accepted for Photoshop Classic descriptors; explicit Perceptual,
Linear, Smooth, noise-gradient, and dither-pattern parity remain separate work.

Photoshop's classic Gradient Map maps encoded-document blend luminosity through
a symmetric cubic color ramp. For a normalized segment amount `t`, its measured
curve is `t + 0.5*t*(1-t)*(2*t-1)`. Segment midpoint metadata belongs to the
right-hand stop, unlike the native Grade widget's existing left-stop contract.
LightTable previously used encoded Rec.709 linear-light luminance, linear color
interpolation, and left-stop midpoint ownership.

The corrected renderer activates these semantics only for Photoshop-compatible
Gradient Map nodes. Existing Grade gradients keep their prior interpolation,
opacity, and midpoint behavior. Photoshop also preserves opacity-stop metadata
in Gradient Map PSD descriptors but ignores it during adjustment rendering;
two independent transparency probes were pixel-identical to their fully opaque
counterparts. Imported Photoshop Gradient Maps therefore use opaque internal
stops, while native Grade gradients continue to support functional opacity.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Within two code values |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 9 | 0.353% | 2.622% | 99.647% | 8 / 9 |
| `D:\people.jpg` | sRGB / 16-bit | 9 | 0.485% | 2.580% | 99.515% | 8 / 9 |

The corpus covers black/white, Reverse, midpoint 20/80, red/blue,
blue/orange, three stops with extreme midpoints, and two adversarial opacity
layouts. All 18 renders pass the 5-percent gate. The three-stop extreme is the
only case outside two code values. Adobe documents Classic as cubic,
Perceptual as OKLab, Linear as linear-color interpolation, and confirms that
Gradient Maps participate in these modes in its
[Gradient interpolation guide](https://helpx.adobe.com/sg/photoshop/using/gradient-interpolation.html).

## Color Lookup

Status: accepted for embedded 3D `.cube` assets.

LightTable already evaluated portable `.cube` assets with trilinear sampling in
encoded document RGB. Two Photoshop-authored, compiled LUTs validate that path
across a warm photographic look and the adversarial Night From Day transform.
Both pass the visual gate without a fitted correction curve.

| Corpus | Profile / depth | Cases | Mean RGB RMSE | Worst RGB RMSE | Visual parity | Maximum error |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hue/lightness diagnostic ramp | sRGB / 8-bit | 2 | 0.240% | 0.264% | 99.760% | 5 code values |

The PSD writer previously embedded the original `.cube` bytes but omitted the
compiled ICC DeviceLink that Photoshop uses for rendering. Such a layer opened
as Color Lookup while producing no visual change. Export now deterministically
generates Photoshop's ICC v4 RGB DeviceLink representation: a 17x17x17 float
CLUT in the `D2B0` multi-process tag, with RGB data and BGR table order. A
Night From Day PSD created with this generated profile renders pixel-identically
to the same LUT loaded through Photoshop 27.11's own Properties panel: 100.000%
parity and zero maximum error. The portable `.cube` remains embedded byte-exact
for editable LightTable import and cross-application recovery.

`.3dl`, `.look`, Abstract Profile, Device Link Profile, and combined 1D
shaper/3D formats remain outside this accepted scope. LightTable's three named
creative presets are native looks rather than claims of equivalence to Adobe's
similarly named installed LUT files.
