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
