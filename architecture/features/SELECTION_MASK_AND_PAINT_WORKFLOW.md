# Selection, mask and paint workflow

Status: **current**, with preserved-only editing for imported Photoshop vector
masks.

## Canonical ownership

- Selection coverage is document-scoped GPU state. It is not a layer and is
  never serialized.
- `layer.mask` is the editable raster mask and owns its independent pixel,
  density, feather and enabled revisions.
- An imported Photoshop vector mask that is not the artwork geometry of a
  native vector layer remains separate in
  `layer.photoshop.preserved.vectorMask`. If a layer also has a raster mask,
  neither operand overwrites the other. The raster combined preview is only a
  visual cache, never vector editing authority.
- The active edit target distinguishes layer pixels from the raster mask.
  Clicking the mask thumbnail changes that target; it does not change the
  layer selection.

Native vector-mask editing is still a target. Until it exists, compatibility
reports and command queries expose the preserved operand explicitly instead of
claiming that it is editable.

## Interaction contract

Rectangle, ellipse, freehand, polygon, single-row and single-column selections
share new, add, subtract and intersect operations. Coordinates may leave the
canvas while authoring; final sampling clips at the render boundary. Feather
is part of the selection operation, not a destructive blur of layer pixels.
Rectangle and ellipse tool settings capture free, ratio or fixed geometry plus
a bounded feather radius when a gesture starts. Pixel snapping is always on
for those marquee coordinates. A marquee feather is rasterized into that new
shape before add/subtract/intersect combines it with existing coverage; changing
the tool setting never retroactively feathers the current selection.

Selection ants use the GPU overlay renderer. Their bounded 500 ms phase change
may submit an overlay presentation frame, but must execute zero document
composite, correction, style or content stages. Carets and gizmos obey the same
rule.

Brush and eraser gestures are coalesced until pointer-up. A completed gesture
creates one history entry whose payload contains dirty tiles, not a copy of the
whole layer. Pressure is sampled per dab. Selection coverage gates pixel and
mask paint. Lock Transparent Pixels preserves destination alpha for Brush and
makes Eraser an exact no-op; mask editing is intentionally unaffected.

## Persistence and interchange

The native layered format round-trips raster mask pixels and the independent
preserved Photoshop vector-mask descriptor. PSD export projects both operands
back into their separate PSD fields. Query responses report `maskContent`,
`preservedVector` and `simultaneousRasterAndVector`, so automation and future
MCP clients do not infer semantics from thumbnails.

Merge and rasterize evaluate masks, transforms, styles and selection coverage
through the renderer before creating the bounded raster result. Unsupported
semantic operands remain visible in the compatibility report rather than being
silently discarded.

## Verification

- Unit suites cover all selection families and combine modes, feather,
  pressure, mask targets, dirty-tile history and transparency-preserving GPU
  blend descriptors.
- `npm run smoke:desktop:selection-dimensions` verifies row/column and
  options-bar dimensions in the packaged application.
- `npm run audit:desktop:canvas` exercises all selection families, combine
  modes, feather, off-canvas input, raster/mask paint, one-entry undo and stable
  GPU/heap retention. It resets and queries render telemetry around animated
  ants and rejects any document-composite execution.
- `npm run smoke:desktop:psd-roundtrip -- --source <file.psd>` includes raster
  and preserved vector-mask semantics in its before/after signature.
