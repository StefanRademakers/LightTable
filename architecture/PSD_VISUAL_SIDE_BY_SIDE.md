# PSD visual side-by-side review

Status: repeatable visual QA route, 2026-08-05.

## Output contract

Every comparison is a flat 800 x 400 PNG:

- left 400 x 400: LightTable;
- right 400 x 400: Photoshop;
- source aspect ratio is preserved inside each square;
- both halves use the same neutral background and resampling step.

The files intentionally contain no UI or labels. A separate gallery adds the
case names while preserving the individual images as direct visual evidence.

## Layer-effects corpus

The current 40 effect comparisons are written to:

`D:\Mediavibe\LightTableTests\Effects`

```text
npm run report:psd-effects-side-by-side
npm run report:side-by-side-gallery -- D:\Mediavibe\LightTableTests\Effects D:\Mediavibe\LightTableTests\Effects\all-comparisons.png
```

These images consume the already verified Photoshop and LightTable renders
from the parameterized effects corpus. They include stroke widths 1, 5, 10,
50 and 200 px plus small, normal and extreme shadow, glow, satin, bevel and
gradient values.

The current eight visual-review cases are also regenerated independently in:

`D:\Mediavibe\LightTableTests\Effects\ReviewCases`

The targeted audit accepts a comma-separated `--ids` list and a separate
`--report` path, so it does not replace the complete 40-case report. The folder
contains eight 800 x 400 comparisons, `review-report.json`, `manifest.json`
and the combined `all-review-cases.png` gallery.

## General PSD corpus

The current 24 unique source documents comprise the 22 PSDs below
`LightTableTestFiles\psd\templates`, plus `D:\TextTest.psd` and
`D:\shapes.psd`. Generated effect PSDs and Electron runtime copies are not
included again.

Prepare the stable manifest:

```text
npm run prepare:psd-side-by-side
```

Run Photoshop's native reference renderer:

```text
"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe" -r D:\mediavibe\LightTable\scripts\photoshop-render-psd-compare-corpus.jsx
```

Then capture the packaged LightTable renderer and compose the comparisons:

```text
npm run capture:psd-side-by-side
npm run report:side-by-side-gallery -- D:\Mediavibe\LightTableTests\PsdCompare\compare D:\Mediavibe\LightTableTests\PsdCompare\all-comparisons.png
```

Outputs live under `D:\Mediavibe\LightTableTests\PsdCompare`. The manifest
maps every collision-safe filename back to its source PSD. `report.json`
retains per-document runtime errors and timings.

## Current visual findings

All 24 documents opened and rendered without a LightTable page error. The
calendar series, shape fixture and text fixture are visually close to the
Photoshop halves at review size. The invitation series is mostly close, with
these visible exceptions retained for follow-up:

- `EHS-395`: substantial top-half texture/color/compositing mismatch; the
  LightTable result is much lighter and greyer than Photoshop;
- `EHS-402`: smaller border and edge-composition differences;
- `EHS-404`: a visible outer-edge/crop difference and minor tonal variation.

The effects gallery confirms that extreme shadow spread/choke, the 200 px
stroke edge, and large bevel/satin relief remain the primary Layer Style
calibration work. The comparison images are evidence, not a claim that these
remaining differences are acceptable.
