# Vector system

LightTable owns a GPU-first vector stack. SVG and Canvas may be import/export
or fallback tools, but they are not the rendering authority.

## Package boundaries

### `@lighttable/vector-core`

Serializable paths and live shapes, affine/vector math, Bézier evaluation,
adaptive flattening, selection and mutation sessions, pen-path construction
and topology. No DOM and no WebGPU resources.

### `@lighttable/vector-rendering`

Backend-neutral realization: convert canonical paths/strokes/editing state to
immutable document-space geometry, selection frames and revision-keyed cache
entries. It also gates stale asynchronous work.

### `@lighttable/vector-webgpu`

GPU buffers, shaders, pipelines and encoding. The current fill backend uses
stencil-then-cover and supports nonzero/evenodd rules. The editing overlay
backend draws anchors, handles and vector overlays through the same GPU family.

## Core rules

- Canonical geometry remains curves/shapes; flattened triangles are caches.
- Adaptive tolerance depends on output scale/quality, not arbitrary point
  counts.
- Document coordinates are canonical; viewport pixels are presentation.
- GPU resources are revisioned, bounded, explicitly destroyed and never saved
  in the document.
- Fills and strokes composite in premultiplied linear color.
- Selection outlines, Bézier editing lines, transform gizmos and brush cursors
  should converge on shared overlay primitives for consistent sharpness and
  performance. They are views, not document content.
- Vector layer anti-aliasing is a render setting, not an always-visible layer
  list control.

## Shared field model

Warp displacement, masks, blur painting and future deformation tools can share
a useful model: a document-aligned field texture plus a transform and revision.
The operations are not identical, but the infrastructure—brush scheduling,
dirty regions, preview/final quality, field sampling and overlay visualization—
should be shared instead of copied into each tool.

## Current gaps

- Complete stroke semantics and coverage quality need broader fixtures.
- Device-loss recovery and browser/device validation need hardening.
- All selection/gizmo overlays have not yet migrated to the vector backend.
- Bounded cover geometry and cache budgets need production measurement.
- Shape/path editing needs continued UX work without weakening the core model.
