# Task 094 completion evidence

Completed 2026-08-06.

## Delivered

- Added a canonical `lt.gradient-map` adjustment with editable color/opacity
  stops, midpoint interpolation, reverse and dither.
- Wired the same representation through native documents, recipes, the shared
  gradient editor, WebGPU uniforms/shader execution and editable PSD
  import/export. Solid Photoshop Gradient Maps are native; noise gradients are
  preserved/no-op and non-classic interpolation remains explicitly approximate.
- Corrected exterior glow choke coverage generically. Outer Glow choke 50%
  improved from RMSE 13.67 to 8.13 without changing shadow choke/spread cases.
- Added large-document Layer Style preview backpressure. Controls remain local
  and native-rate; documents up to 32 layers preview at 30 Hz, larger documents
  publish only the newest stack at 10 Hz and always flush the final value.
- Split Gradient Map WGSL into a focused source fragment and kept the renderer
  source-size architecture gates within their existing limits.
- Updated the Photoshop parity contract, effects corpus metrics and generated
  layered-interchange matrix (15 processing modules).

## Measured verification

- App unit suite: 317 files / 1,712 tests passed.
- TypeScript: passed.
- Architecture docs/boundary: passed (108 docs, 51 links).
- Production desktop package and WGSL validation: passed.
- Strict Photoshop effects corpus: 40/40 passed, 0 failures, review cases
  reduced from 8 to 6.
- Photoshop blend/profile matrix: 48/48 passed; worst RMSE 0.79.
- Full parity quality profile: passed.
- EHS-395 import: 47 layers, 3 adjustment layers, 8 editable flow-text layers,
  14 vectors, no renderer/page errors. Both Gradient Maps are native; their
  perceptual interpolation is reported as approximate.
- EHS-395 Layer Style gesture (121 Blur inputs): 53 to 14 compositor frames,
  8.68 s to 2.95 s, exact final value, no crash, no interaction long task above
  250 ms. EHS-396 contains no enabled Layer Style, so EHS-395 is the applicable
  same-class workload oracle.

## Quantified remaining calibration

The six retained effects review cases are Drop Shadow spread 50% (13.53),
Stroke outside 200 px (12.11), Bevel 80 px (11.47), Outer Glow 100 px (8.53),
Outer Glow choke 50% (8.13), and combined overlay/bevel/satin (8.06). They are
visual calibration differences, not semantic/export loss.

Photo Filter (5 corpus instances), Color Balance (2), Hue/Saturation (1) and
Brightness/Contrast (1) remain descriptor-preserving explicit approximations.
They require isolated Photoshop transfer-function oracles before native claims;
this task deliberately does not relabel the existing grading approximations.
