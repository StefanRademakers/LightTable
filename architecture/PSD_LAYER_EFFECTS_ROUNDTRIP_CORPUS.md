# Photoshop layer-effects roundtrip corpus

Status: repeatable release-candidate gate, 2026-08-05.

## Purpose

This corpus checks three separate promises for every supported Photoshop layer
effect:

1. Photoshop and LightTable produce substantially the same visible result.
2. A LightTable PSD export preserves the editable effect and all of its
   parameters when reopened.
3. Reopening that export in LightTable produces exactly the same pixels as the
   pre-export LightTable render.

The generated PSD and PNG binaries live outside the repository at
`D:\mediavibe\LightTableTestFiles\psd\layer-effects-roundtrip`. Only the
generators, audit and this contract belong in Git.

## Reproduce the gate

Run these commands from the repository root:

```text
npm run generate:psd-effects-corpus
"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe" -r D:\mediavibe\LightTable\scripts\photoshop-layer-effects-corpus.jsx
npm run package:desktop:verify
npm run audit:psd-effects-corpus -- --strict
npm run report:psd-effects-corpus
```

Photoshop opens each generated source, duplicates and flattens it to create the
golden PNG, and saves a canonical PSD. A normal duplicate is required: using
Photoshop's `mergeLayersOnly` duplicate path can reuse a stale merged
composite. The LightTable audit opens the canonical PSD at 100%, captures the
exact 768 x 768 canvas, exports PSD through the public command stack, reopens
that artifact, and compares both the complete effect data and the rendered
pixels.

Each contact sheet shows `Photoshop | LightTable | 4x difference`. The JSON
report retains per-case metrics, timings, parameter comparisons and paths to
the individual images.

## Coverage

The current 40 cases deliberately include small, normal and extreme values:

| Family | Cases |
|---|---|
| Drop Shadow | blur 3/10/30/100, spread 25/50, distance 0/80 |
| Inner Shadow | blur 3/30, choke 50, distance 80 |
| Outer Glow | blur 3/30/100, choke 50 |
| Inner Glow | blur 3/30/100, choke 50 |
| Stroke | outside 1/5/10/50/200, inside 50, center 50 |
| Color Overlay | one blend/opacity case |
| Gradient Overlay | linear, radial, angle, reflected and diamond |
| Satin | size 10/60 |
| Bevel and Emboss | size 3/20/80 |
| Combined | shadow+stroke+glow and overlay+bevel+satin |

The amber source silhouette contains straight edges, rounded corners, a hole,
a concave join and a separate triangle. It is centered with enough margin for
the 200 px stroke so the oracle does not accidentally measure canvas clipping.

## Current measured result

The 2026-08-05 run passed all 40 semantic roundtrips:

- 40/40 preserve full editable effect settings;
- 40/40 reopen with a pixel-identical LightTable render (RGB RMSE 0);
- 0 structural visual failures (Photoshop-versus-LightTable RGB RMSE above 20);
- 8 cases remain in the visual-review band (RGB RMSE above 8).

Important measured improvements from the first corrected Photoshop oracle to
the current renderer include:

| Case | Earlier RMSE | Current RMSE |
|---|---:|---:|
| Drop Shadow, blur 3 | about 13.5 | 6.62 |
| Inner Shadow, blur 3 | 13.06 | 4.83 |
| Stroke outside 5 | 14.50 | 4.05 |
| Stroke outside 10 | 20.51 | 4.14 |
| Stroke outside 50 | 44.94 | 4.72 |
| Stroke outside 200 | 106.96 | 12.12 |
| Stroke center 50 | 35.72 | 3.16 |
| Gradient Overlay, linear | 12.34 | 3.32 |
| Satin, size 10 | 9.93 | 4.61 |
| Combined shadow/stroke/glow | 18.26 | 7.66 |

The visual review confirms that 1, 5, 10 and 50 px strokes closely track the
Photoshop silhouette and no longer produce disconnected radial spokes.
Gradient direction, origin and scale are also close to Photoshop.

## Known calibration work

The following are real residual fidelity differences, not export data loss:

- extreme 25% and 50% shadow spread/choke have a different density/falloff
  profile from Photoshop;
- the 200 px stroke is structurally correct but its outer edge is more finely
  faceted;
- large 80 px bevel relief and the combined bevel/satin case still have a
  different highlight/shadow profile;
- 50% outer-glow choke remains slightly stronger than Photoshop.

These cases remain in the corpus so future quality work is measurable. A fix
must improve the relevant oracle metrics without changing the zero-RMSE
LightTable self-roundtrip or making small effects slower unnecessarily.

## Extension rule

Every new effect mode, interpolation mode, contour, noise path or pattern-backed
style must add a minimal case plus at least one stress case. Do not weaken the
strict semantic gate to admit a visually plausible flattened result. If a PSD
construct cannot remain editable and faithfully serialized, export must report
it as unsupported.
