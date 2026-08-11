# Task 120 result — Dodge, Burn and Sponge

Status: implemented and empirically calibrated on 2026-08-11.

## Delivered

- Photoshop-compatible `O` tool group containing Dodge, Burn and Sponge.
- One shared GPU adjustment-brush path; no CPU pixel readback and no separate stroke engine.
- Existing brush gestures, pressure, smoothing, `[ ]` resize, selections, transforms and one-entry undo are reused.
- Dodge/Burn expose Range, Exposure and Protect Tones; Sponge exposes mode, Flow and Vibrance.
- Tone operations preserve alpha and run in the existing `rgba16float` GPU layer pipeline.
- A repeatable Photoshop black-box oracle now captures grayscale and color corpora and analyzes the output.

## Empirical findings

- Photoshop's Shadows/Midtones/Highlights response is broad and overlapping; hard thresholds are incorrect.
- On neutral ramps and most color bands, protected Dodge/Burn behaves much closer to a per-channel response than to a single Rec.709 luminance mask.
- Photoshop compresses high Exposure buildup non-linearly. LightTable therefore keeps 1–20% literal and calibrates the upper range per operator.
- Protected colored highlights are context and saturation dependent. That remaining behavior cannot be represented faithfully by a crude saturation multiplier and is deliberately left explicit.

## Measured parity

Photoshop and LightTable were both driven over the same full-width 1024 × 256 grayscale ramp with a 128 px, 100% hardness brush and 25% spacing. RMSE is measured over the resulting 256-point curve.

| Protected Midtones | 5% | 20% | 50% |
| --- | ---: | ---: | ---: |
| Dodge RMSE | 0.81 | 1.33 | 5.50 |
| Burn RMSE | 2.16 | 2.82 | 4.79 |

At protected 20%, all six neutral range cases are within roughly 1–5 gray levels RMSE; five are within about 1–3. The largest neutral case is Dodge Highlights at 4.62.

For the color corpus at protected 20%, Shadows/Midtones are approximately 0.7–2.6 RGB RMSE. Highlights remain the open parity edge: Dodge approximately 17.4 and Burn approximately 8.5 RGB RMSE because Photoshop adds saturation/context-aware protection there.

### Real-image accumulation pass

`D:\face.jpg` is now a second, real-world oracle. Photoshop and the packaged LightTable build receive the same Dodge/Midtones/20%, 250 px, 75% hardness dab at the same cheek coordinate. Captures cover 1, 2, 5, 10 and 20 repeated passages with Protect Tones both disabled and enabled.

After calibration, the 20-pass brush-core measurements are:

| Mode | LightTable | Photoshop |
| --- | --- | --- |
| Legacy/off | H15° · S8% · V54% | H15° · S7% · V57% |
| Protected/on | H19° · S21% · V50% | H12° · S21% · V50% |

This pass also found and fixed a separate footprint error: Chromium reports `pressure = 0.5` for a pressed mouse button. LightTable treated that as tablet pressure, shrinking a 250 px mouse brush to roughly 150 px and halving its strength. Mouse input is now normalized to full pressure while real pen pressure remains untouched.

The remaining face-corpus difference is predominantly a small protected hue rotation (LightTable is slightly more yellow; Photoshop slightly more red), not the former major brightness/saturation mismatch.

## Verification

- Focused exposure-calibration tests: 3 passed.
- `@lighttable/app` TypeScript check: passed.
- Production desktop package and distribution-boundary check: passed.
- Automated LightTable and Photoshop screenshots were captured successfully.
- Comparison artifacts live outside the repository at `D:\mediavibe\LightTableTests\ToneBrush`, including the face corpus under `face`.

## Remaining refinement

The tool is usable and its basic range response is no longer the major mismatch. Future parity work should focus narrowly on protected colored highlights and extreme high-exposure buildup. Those should be calibrated from the existing corpus rather than guessed, and they do not justify replacing the shared GPU brush architecture.
