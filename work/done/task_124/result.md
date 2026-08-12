# Task 124 result

Implemented the Photoshop-oriented snapping V1 from `snapping.MD`.

- One CPU snap solver with an 8 logical-screen-pixel tolerance and independent X/Y resolution.
- Retained target geometry for visible layers, document edges, guides and nearby grid lines; no GPU readback during interaction.
- Transform and selection translation use the same solver, immutable drag origins and Ctrl/Cmd temporary bypass.
- Multi-selected layers use union content bounds and receive one identical document-space transform. Nested selected children are not transformed twice.
- Manual guides support ruler creation, movement, Alt/Option orientation switching, Shift ruler-tick quantization, drag-out removal, locking, numerical creation and one undo entry per gesture.
- Rulers, grid, persistent guides and Smart Guides render through the existing WebGPU overlay path and only dirty the overlay.
- Snap, Snap To, Show and Guides commands are exposed in View; guide data persists in LightTable documents.

Verification:

- LightTable app typecheck passed.
- Boundary verification passed.
- 20 focused snapping/guide/transform tests passed.
- Desktop Playwright smoke passed against `D:\shapes.psd`: two selected shape layers moved with one identical document-space delta and no runtime error.

Deliberately postponed items remain those explicitly listed as out of scope in the specification, including equal-spacing guides, path-anchor snapping, rotation snapping and transform-resize snapping.
