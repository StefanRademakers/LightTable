# Canvas bounds and unbounded editor space

Status: architectural requirement. Not implemented completely yet.

## Decision

The pixel document and the editor workspace are different things.

- The **canvas** is the finite output rectangle: `0..width × 0..height`.
- **Document space** uses canvas pixels as its unit and origin, but coordinates
  may be negative or larger than the canvas dimensions.
- The **editor workspace** is the visible, pan-and-zoomable area around the
  canvas. It is not a pixel surface and has no fixed bounds.

The canvas defines which pixels are rendered, saved and exported. It must not
act as an input fence for selection, transform, path or object gestures.

## Required interaction

A user must be able to:

- begin, continue and close a selection outside the canvas;
- place polygonal-lasso vertices outside the canvas;
- drag rectangle, ellipse and free selections beyond any canvas edge;
- manipulate transform handles and pivots outside the canvas;
- move layer content partly or completely outside the canvas;
- pan and zoom without changing document coordinates.

The interaction surface therefore covers the complete document viewport, not
only the rendered canvas element. Screen-to-document conversion must return
unclamped coordinates:

```text
documentPoint = inverse(viewTransform) * screenPoint
```

It must not perform:

```text
documentPoint = clamp(documentPoint, canvasBounds)
```

Pointer capture remains active when a gesture crosses the canvas or viewport
edge.

## Selection model

Selection geometry lives in unbounded document space. Its visible overlay may
therefore extend into the workspace surrounding the canvas.

Raster selection coverage is evaluated only where pixels currently exist:

```text
effectiveCoverage = selectionGeometry ∩ canvasBounds
```

This clipping is an evaluation/output rule, not an authoring rule. Rectangle,
ellipse, polygon and free-path geometry must not be rewritten to the clipped
canvas rectangle.

The current canvas-sized GPU selection texture can remain an evaluation cache,
but it cannot be the only long-term source of truth. Retaining semantic
selection geometry is required for:

- accurate overlays outside the canvas;
- moving or transforming a selection later;
- feathering across a canvas boundary;
- future crop/canvas expansion without silently losing authored geometry.

Boolean selection operations are defined in document space. Their raster
result is clipped only when sampled against canvas pixels.

## Rendering and persistence

- Viewport background outside the canvas is UI, never image data.
- Layers may have transforms and visible bounds outside the canvas.
- Compositing, scopes, save and export evaluate the canvas rectangle only.
- Merge/rasterize clips its output to the chosen destination raster bounds.
- A future Expand Canvas/Crop command changes canvas bounds explicitly; normal
  selection or transform gestures never do so implicitly.
- GPU textures may remain canvas-sized as an implementation detail. Texture
  allocation bounds are not interaction bounds.

## Coordinate ownership

The coordinate path must remain explicit:

```text
screen space
  -> inverse viewport transform
unbounded document space
  -> inverse layer transform where required
layer-local or mask-local space
```

Only the raster-writing or raster-sampling boundary clips against its target
texture. Tools, overlays and document commands must not each invent their own
canvas clamping.

This extends the rules in `coordinate_contract.md`; it does not replace its
layer/mask transform contract.

## Implementation checkpoints

- [ ] Make the document viewport, rather than the canvas element, the pointer
      interaction surface.
- [ ] Return unbounded points from the shared screen-to-document conversion.
- [ ] Remove per-tool canvas clamping from all selection gestures.
- [ ] Render selection drafts and committed outlines outside the canvas.
- [ ] Keep GPU selection evaluation clipped and safe at texture boundaries.
- [ ] Preserve semantic selection geometry alongside its raster cache.
- [ ] Audit transform, brush, fill, paste and auto-align hit testing for the
      same canvas/workspace distinction.
- [ ] Add Web and Electron tests for negative and beyond-width/height
      coordinates at multiple zoom levels.

## Acceptance tests

1. Start a rectangular selection left of the canvas and release inside it.
2. Draw an ellipse whose center is outside the canvas.
3. Close a polygonal selection entirely from workspace clicks while it crosses
   the canvas.
4. Draw a free selection across all four canvas edges.
5. Pan and repeat the tests at 25%, 100% and 800% zoom.
6. Confirm that overlays remain visible outside the canvas while copied,
   filled or transformed pixels remain limited to actual canvas pixels.
7. Confirm identical behavior in Web and Electron Desktop.
