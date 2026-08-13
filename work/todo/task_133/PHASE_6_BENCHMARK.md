# Phase 6 object-selection benchmark

Date: 2026-08-13

## Scope

The desktop smoke runs the real Electron editor, WebGPU backend, model worker,
selection compositor and GPU overlay. Backend selection is development-only and
does not add a user-facing preference. The same central
`selectionMaskFromLogits` conversion is used by SAM 2.1 and SlimSAM on every
source image: positive SAM logits determine membership, selected interiors are
opaque, and only a one-pixel spatial boundary is antialiased.

## Fixed local corpus

| Case | Source | SHA-256 | Purpose |
| --- | --- | --- | --- |
| Face | `D:\face.jpg` | `AA8CEEE51B8FC47925CAD84DE938C9086315FA7FB1CC6A3166C00F9B4D8F868C` | hair, skin, soft edges |
| Pool | `D:\pool.jpg` | `52950FEE400D73729282CF0D48AA202EC5A75C2983F3D5FB04A06C1D9423B320` | branches and thin structures |
| Illustration | `D:\mediavibe\LightTableTestFiles\AiAndEPS\333014-PA59X6-905.jpg` | `9AF8C548B1C60D6EABA787A34D687F097366462E1784EA665DA2B27476171CB2` | small graphic elements and hard edges |
| Template | `D:\mediavibe\LightTableTestFiles\psd\templates\Save the Date Invitation PSD 6\EHS-396\EHS-396\EHS-396 copy.jpg` | `F63E745CECB9410B93D88BD3D7E28094C00363A1D382446721C3290CC8C3E0E1` | low contrast, texture and overlapping decoration |

## Reproduction

Start the normal desktop development server, then run a case directly against
one backend:

```powershell
node scripts/smoke-desktop-object-selection.mjs D:\face.jpg --backend sam2-small --case benchmark-face-sam2 --x 0.68 --y 0.4
node scripts/smoke-desktop-object-selection.mjs D:\face.jpg --backend slimsam --case benchmark-face-slimsam --x 0.68 --y 0.4 --inference-timeout 30000
node scripts/report-object-selection-benchmark.mjs
```

Each run writes a screenshot and machine-readable report under the ignored
`tmp/object-selection-smoke` directory. Failed runs also retain their partial
backend trace instead of disappearing as a timeout.

## Measurements

SAM 2.1 Small FP16 completed all four cases:

| Metric | p50 | p95 |
| --- | ---: | ---: |
| Visible selection commit | 5696.70 ms | 9619.05 ms |
| Model load | 928.35 ms | 1000.89 ms |
| Image encode | 1794.23 ms | 3829.84 ms |
| Prompt decode | 188.79 ms | 876.33 ms |
| Mask postprocess | 31.69 ms | 97.03 ms |

The selected-pixel mean opacity was between `0.986944` and `0.997892` across
the four unrelated images. This verifies the opacity correction is corpus-wide,
not tuned to one photograph.

SlimSAM loaded on WebGPU and decoded/preprocessed the face image, but did not
finish its image encoder within the 30 second interactive budget. An earlier
diagnostic run also failed to finish within 120 seconds. It therefore cannot
serve as a stable interactive baseline on this machine in its current form.

## Visual review

- Face: the foreground face/hair silhouette is coherent; fine hair still needs
  high-resolution boundary refinement.
- Pool: the prompted tree is found, but many fine branches and nearby structure
  are included. Interior opacity is correct; segmentation scope is not yet.
- Illustration: a small graphic object is isolated with an opaque interior.
- Template: the model selects a broad connected decorative region. This is
  visibly too inclusive and must not be described as finished selection quality.

There are no hand-authored ground-truth masks for this corpus yet, so IoU,
boundary F-score and thin-structure retention remain deliberately unclaimed.

## Decision

Retain SAM 2.1 Small as the Balanced profile primary. Keep SlimSAM only as a
lazy compatibility fallback while its encoder failure is investigated. Do not
mark Phase 6 fully complete yet: opacity and comparative runtime now have real
evidence, but ground-truth quality scoring and memory measurements remain open.
