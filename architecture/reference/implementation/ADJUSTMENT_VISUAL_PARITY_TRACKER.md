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
