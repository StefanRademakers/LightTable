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
