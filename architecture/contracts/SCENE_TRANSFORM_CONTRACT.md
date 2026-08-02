# LightTable scene transform contract

Status: authoritative foundation for raster, group, mask, vector, selection,
gizmo and future smart-object work.

## Decision

LightTable owns a small 2D scene graph. We learn from mature scene-graph
implementations, but do not add a rendering-library dependency to the engine.

Every spatial document node stores exactly one `localToParent` affine matrix.
The document root is identity. A resolver derives:

```text
localToDocument = parentLocalToDocument * localToParent
documentToLocal = inverse(localToDocument)
localToViewport = documentToViewport * localToDocument
```

`documentToViewport` is editor state. It is never serialized into a layer.
CPU/document matrices remain double precision; conversion to `f32` happens only
when writing GPU data.

The existing `CommonLayer.transform` field is `localToParent`. The current
`RasterRenderContract.transform` is a resolved local/source-to-document matrix.
Callers must stop assuming those two values are interchangeable for nested
layers.

## One transform authority

`editor/document/sceneTransformGraph.ts` is the first pure resolver. The
production runtime may cache its output, but must preserve the same contract.

Renderers, paint, masks, warp, hit testing, selections, bounds and gizmos must
not independently walk parents or reinterpret `layer.transform`. They request:

- local to document;
- document to local;
- local to viewport;
- resolved document bounds.

Direct use of a persisted layer transform is allowed only when editing that
node's local transform or serializing it.

## Hierarchy and reparenting

Groups own transforms and descendants inherit them. Reparenting preserves the
node's document-space appearance:

```text
newLocal = inverse(newParentWorld) * oldWorld
```

If the new parent is singular, the operation is rejected visibly. We do not
silently substitute identity or rasterize.

Moving a group changes no child pixel data. It invalidates derived world
matrices and bounds for the subtree. A cached resolver keys a node result on its
local geometry revision plus its parent's resolved transform revision.

## Coordinate spaces

Names are explicit; generic `transform` variables are avoided at boundaries.

- source/local: pixels or geometry owned by one node;
- parent: coordinate system of the immediate group;
- document: stable image canvas coordinates;
- viewport: pan/zoom/rotation presentation coordinates;
- device: physical output pixels.

Pointer routing is always:

```text
device/viewport -> document -> target-local
```

Rendering is the reverse. This applies equally to rotated/scaled layers and
prevents the historic mask-paint offset class of bugs.

## Masks and selections

A mask attached to a node is authored in owner-local space and follows the
owner transform. A future unlinked mask gets its own local-to-owner matrix; it
does not invent a second coordinate model.

Document selections remain document-space resources. Operations on selected
content snapshot the target's resolved world/inverse matrices at gesture start.
Interactive changes preview against that snapshot and commit as one history
operation.

## Bounds, rasterize and merge

Raster and vector content own local tight bounds. Document bounds are derived
from transformed local geometry. Group bounds are the union of visible child
document bounds; empty pixels never become authoritative bounds.

Rasterize/merge evaluates the complete subtree, masks, attached processing and
styles into a declared target space. The resulting raster owns tight local
bounds and a simple translation into its parent. Baking must not leave an
unexplained historic matrix on the new pixels.

## Vector layers and gizmos

Vector layers use the same outer layer hierarchy. Their internal element tree
uses the identical local-parent accumulation rule. A gizmo receives resolved
geometry in document space and is finally projected with the viewport matrix.
Its handles and strokes remain screen-space sized and are not rasterized into
document pixels.

## Migration gate

Before native vector editing expands beyond its first vertical slice:

1. Replace direct `layer.transform` reads in compositor, paint, warp, transform,
   mask and alignment paths with the resolver contract.
2. Make `RasterRenderContract` accept only an explicitly resolved
   `localToDocument` matrix.
3. Add cached transform/bounds resolution with subtree revision invalidation.
4. Make drag-to-group use world-preserving reparenting.
5. Test web and desktop against the same nested fixtures.

Required tests:

- nested translation, rotation, non-uniform scale and reflection;
- world-preserving reparent across transformed groups;
- linked and unlinked masks;
- paint/hit-test round trips through rotated ancestors;
- selection transform preview/commit/cancel;
- merge/rasterize resets the coordinate contract correctly;
- save/reopen and PSD nested-group import preserve appearance;
- singular and near-singular transforms fail explicitly;
- identical web and desktop results.

## Reference principles

- Three.js separates local `matrix` from derived `matrixWorld`, updates the
  hierarchy, and supports world-preserving attach.
- SVG defines a current transformation matrix as the concatenation of an
  element and all ancestor transforms.

LightTable adopts these proven semantics in a focused 2D implementation while
retaining its own document model, render graph, WebGPU resource lifecycle and
editing UX.
