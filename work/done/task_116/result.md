# Task 116 result — GPU Healing Brush

## Delivered

- Healing Brush is a first-class paint tool with Photoshop-compatible `J`.
- It shares Clone Stamp's Alt/Option source, source-layer retention, Aligned state and three layer sampling modes.
- The implementation is the ordinary explicit-source Healing Brush, not Spot Healing's automatic neighborhood selection.
- A GPU-only frequency-separation pass retains sampled detail while adapting it to destination color and luminance.
- The operation shares normal brush dynamics, stable per-stroke source snapshots, GPU overlays and pixel undo/redo.
- Effect-only Blur/Liquify presets cannot leak into sampled tools; switching from such a preset resolves to the existing Round paint tip.

## Architecture

Clone and Healing share one `Sampled Brush` core. Only the fragment operator differs:

- Clone: direct premultiplied sampled pixels.
- Healing: sampled high-frequency detail plus destination low-frequency appearance.

The nine-tap low-frequency estimate is bounded, brush-size-aware and remains in the same WebGPU render pass. No GPU-to-CPU roundtrip is introduced.

## Verification

- Full workspace `npm run verify`: passed.
- Real Electron/WebGPU smoke on an empty destination layer: source accepted, destination texture changed, zero page/debug/WebGPU errors.
- Contrasting source/destination run verified the adaptive route without modifying the source layer.
- Unit coverage verifies shared source semantics, operator routing, finish/cancel cleanup and the existing single history transaction.

## Research baseline

- Adobe's documentation distinguishes Healing Brush (explicit Alt/Option source) from Spot Healing Brush (automatic nearby sampling). Task 116 deliberately implements the former; the supplied spot-healing icon is used provisionally until a dedicated Healing Brush icon is available.
