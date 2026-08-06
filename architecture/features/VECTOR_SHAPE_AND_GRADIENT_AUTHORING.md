# Vector shape and gradient authoring

Status: active contract, verified 2026-08-06.

## Canonical model

Every editable shape is a `VectorElement` in layer-local coordinates. A path
owns one or more open/closed subpaths; a live shape owns parametric geometry.
Both use the same `VectorStyle`:

- fill is absent, solid linear-light RGBA, or a shared gradient paint;
- stroke is absent or owns paint, width, independent opacity, alignment, cap,
  join, miter limit, dash pattern and dash offset;
- element opacity multiplies both fill and stroke;
- layer and element transforms remain separate and may place content outside
  the document canvas.

Renderer meshes, thumbnails and retained previews are derived data. They never
replace the path, paint or transform authority.

## Authoring and UI

The Shape property bar is the single authoring surface for native and imported
vectors. It uses the shared checkbox, color, number, select and gradient-editor
components. Selecting a color is explicit solid-paint intent and enables the
corresponding fill or stroke. Fill and stroke gradients use the same
`GradientAssetEditor` used by the Gradient tool, text and layer effects.

New Pen and live-shape elements are projected from the same
`VectorToolStyleSettings` used to edit a selected element. No separate creation
style exists. A fill-only or opacity edit must preserve an authored no-stroke
state; enabling or choosing stroke paint is the only implicit stroke creation.

## Rendering

Curves are flattened adaptively and cached by geometry revision and tolerance.
Strokes are one connected, union-friendly triangle mesh per realized contour,
with joined segment wedges and adaptive round arcs. Segment-local quads are not
a render path. The WebGPU backend multiplies stroke-only opacity at draw time,
so a translucent imported stroke does not fade its fill.

The compositor clips only the final document result. Off-canvas geometry and
large outside strokes remain valid document content. Layer thumbnails are
exported from evaluated scene textures, including layer and element transforms.

## Persistence and interchange

Native save/reopen stores the complete vector model. PSD import groups
compatible compound paths, retains open paths, maps solid/gradient paint and
stroke properties, and reports unsupported boolean operations or paint as
unsupported/preview-backed rather than silently claiming editability.

PSD export emits editable Photoshop vector masks/fill/stroke descriptors when
all elements in the layer share a representable style. Element opacity is
baked into fill transparency and multiplied into Photoshop stroke opacity;
stroke-only opacity remains independent. Mixed or unsupported styles produce a
warning and use preserved Photoshop descriptors or the raster preview.

## Verification

`smoke:desktop:vector-authoring` authors a gradient-filled and
gradient-stroked 200 px shape in `D:\shapes.psd`, validates every exposed
property through the automation contract, native-save/reopens it, PSD
roundtrips it and writes raw/difference captures. Unit coverage evaluates
connected 1/10/50/200 px stroke meshes, native persistence, import/export,
paint-intent behavior and stroke opacity. A successful native visual roundtrip
requires a non-empty capture and a declared RMSE threshold.
