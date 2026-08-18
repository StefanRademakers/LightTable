# Photoshop PSD export release candidate

Status: release candidate, 2026-08-05.

## Product route

`File > Export > Photoshop PSD (Editable)...` projects the canonical LightTable
document in a lazy module worker and writes through the active host. Electron
uses the native save route; the web host downloads the same bytes. Automation
exposes the same strict operation as `file.exportPsd` and publishes a
`psd-export` artifact.

The writer is an adapter. PSD-only descriptors are never renderer authority,
and known lossy projections stop export before a file is handed to the user.
The merged composite is always present, while supported layers remain editable.

`Photoshop PSD (Maximum Appearance)...` is a separate, explicit intent for a
document that cannot be represented honestly as editable PSD. It skips all
layer/LUT readback and writes the already settled canonical composite once as
`LightTable Appearance`. No processing descriptor survives above the baked
pixels, so Grade and Lens FX cannot be applied twice. The resulting filename
ends in `-appearance.psd`.

## Release-candidate coverage

| Area | PSD result | Gate |
|---|---|---|
| Canvas/composite | 8-bit RGB merged composite | Photoshop open/render |
| Raster layers | Tight transformed bounds, including off-canvas data; arbitrary affine transforms are GPU-baked | Unit affine fixture + desktop roundtrip |
| Tree | Bottom-to-top order, nested groups, visibility, opacity, fill opacity, blend mode, clipping and locks | ag-psd projection roundtrip |
| Masks | Current effective raster mask, density and feather | Projection/Photoshop descriptor path |
| Text | Editable point and paragraph flow text, runs, paragraphs, affine transforms and warp fields | `D:\TextTest.psd` |
| Imported text on path | Editable when the source TySh path descriptor and document TextFrameSet resource are preserved | `D:\TextTest.psd` |
| Vectors | Editable Bezier paths, solid/gradient fill, no-fill state, stroke paint/width/cap/join/alignment/dash | `D:\shapes.psd` |
| Layer Styles | Drop/inner shadow, glow, color/gradient overlays, color/gradient stroke, satin and bevel descriptor mapping | 40-case Photoshop canonical roundtrip; pattern-backed styles remain gated |
| Commands/hosts | File menu, Electron save, web download and command artifact | desktop Playwright smoke |

## Measured oracle results

The desktop smoke opens the source, exports through the command stack, reopens
the in-memory artifact, invokes the physical File-menu export and checks canvas
and semantic layer signatures. Photoshop 2025 then opens the physical file,
renders it, saves a compatibility copy and that copy is reopened in LightTable.

| Fixture | Photoshop semantic result | Composite comparison |
|---|---|---|
| `D:\TextTest.psd` | 5/5 layers remain Photoshop Text layers, including rotations and imported path text | 0 pixels above 8/255; maximum delta 1/255 |
| `D:\shapes.psd` | 4/4 vectors remain Photoshop Solid Fill shape layers; stroke-only shapes retain disabled dormant fill | 4 of 598,598 pixels above 8/255 (0.000668%); maximum delta 13/255 |
| 40-case layer-effects corpus | 40/40 retain complete editable effect settings; LightTable export/reopen RMSE 0 | 0 structural failures; 8 explicitly retained visual-review cases |

The comparison uses the source PSD embedded composite as reference and
Photoshop's render of the LightTable export as candidate:

```text
npm run smoke:desktop:psd-roundtrip:build -- D:\TextTest.psd
npm run verify:psd-render-parity -- D:\TextTest.psd <photoshop-render.png>
```

`scripts/photoshop-psd-roundtrip.jsx` is the Photoshop open/render/save oracle;
`scripts/compare-psd-render.mjs` enforces the visible-difference tolerance.
The parameterized effects procedure and current residuals are documented in
[Photoshop layer-effects roundtrip corpus](PSD_LAYER_EFFECTS_ROUNDTRIP_CORPUS.md).

## Explicitly gated after this RC

- 16-bit PSD output and representative PSB validation;
- embedded/linked Smart Object source packages and Smart Filters;
- native LightTable adjustments without an exact imported Photoshop descriptor;
- PSD pattern-resource emission for pattern fills/styles;
- newly authored arbitrary text-on-path TextFrameSet generation;
- independent simultaneous user and vector mask export;
- a richer compatibility preflight explaining which editable constructs caused
  the user to choose Maximum Appearance;
- pattern-backed layer styles and the documented extreme spread/choke/bevel
  calibration cases.

These gaps are not silently flattened. The export error identifies the layer or
feature that prevented a verified editable projection.
