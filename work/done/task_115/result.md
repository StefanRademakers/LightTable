# Task 115 result — GPU Clone Stamp

## Delivered

- Clone Stamp is a first-class paint tool with Photoshop-compatible `S`.
- `Alt` / `Option` click stores a document-space source and its source layer.
- The source remains anchored when painting non-destructively on another or empty layer.
- Aligned and unaligned source mapping are supported.
- Current Layer, Current & Below and All Layers use the existing document compositor.
- Size, hardness, opacity, flow, spacing, smoothing, pressure and ordinary brush tips reuse the normal brush path.
- One immutable `rgba16float` GPU source snapshot is captured per stroke. There is no pixel readback or CPU image processing.
- Source and destination cannot feed back within the same stroke.
- The source ring and cross use the existing dirty GPU vector overlay.
- Completion and cancellation reuse normal pixel history and publish at most one undo entry.

## Architecture

`toolbar/session → SampledBrushSourceController → normal paint gesture/dabs → filtered compositor snapshot → sampled WGSL paint source → existing raster history`

Clone is implemented as a sampled paint source, not as a second brush engine. The source descriptor already separates mapping from the operator so future rotation, scale, flip or saved sources do not require rewriting brush mechanics.

## Verification

- Full workspace `npm run verify`: passed.
- App suite: 350 files / 1,922 tests passed.
- Real Electron/WebGPU smoke: source sampled from `Background`, destination `Paint Layer`, thumbnail changed, visible clone stroke, zero page/debug/WebGPU errors.
- Boundary checks, all workspace typechecks, web build and desktop package verification passed.
- Regression coverage includes source-layer retention, aligned/unaligned mapping, sample-mode filtering, snapshot lifecycle, cancel, one history entry, sampled pipeline routing and GPU marker geometry.

## Research baseline

- Adobe Clone Stamp behavior and source overlay concepts were checked against Adobe's tool documentation.
- A true source-pixel overlay beneath the destination cursor remains an optional later UX enhancement; the exact source marker and brush outline required for this task are GPU-rendered now.
