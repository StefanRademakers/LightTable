# Document and scene model

## Canonical document

`ImageDocument` is the source of truth. Its layer arrays are bottom-most first,
matching compositor and PSD import semantics. Current first-class nodes are:

- raster layers with pixels, optional local adjustment stack and raster mask;
- group layers with children and pass-through or isolated compositing;
- adjustment layers with an ordered stack and optional mask;
- vector layers with editable vector elements and optional mask;
- semantic text layers with editable text/layout/path authority.

All common layers have identity, visibility, locks, opacity, fill opacity,
blend mode, clipping state, style stack, local-to-parent transform, revisions
and optional Photoshop import metadata. See
`packages/lighttable-app/src/lighttable/editor/document/documentTypes.ts`.

Smart Objects and complete Smart Filter semantics are a target, not yet a
first-class `LayerNode` variant. PSD metadata and preserved source assets do not
by themselves mean the Smart Object model is complete.

The first Gaussian Blur implementation is intentionally narrower: it is a
full-frame adjustment-layer-shaped filter over the accumulated lower
composite. The filter parameters live in its serializable processing module;
the layer's existing mask controls that effect. This does not redefine a
content layer's own mask and does not imply attached Smart Filter support.
When attached filters are introduced, their ordered stack and stack mask must
be separate canonical data owned by the content layer, not an overloaded
`AttachedAdjustment` or Layer Style.

Document assets are immutable source payloads referenced by canonical IDs.
The registry currently covers patterns, embedded fonts, preserved interchange
sources and 3D Color Lookup tables. A Color Lookup asset records its cube size,
input domain and byte length in `ImageDocument`; the original `.cube` bytes are
stored beside layer pixels in the layered LightTable container. Runtime GPU
textures are derived resources and never enter the document model.

The current layer union is not a closed-world product limit. Planned native
node kinds include text, embedded/smart documents, 3D scene layers and
AI/procedural content whose result can be resolved to the same render contract.
Each new kind must own serializable canonical state, bounds, transforms,
revisions and an explicit realization boundary. It may not hide mutable GPU,
worker or host state inside the saved scene model.

## Document, editor and renderer authority

These authorities must remain separate:

- `DocumentSession` owns canonical content, document selection/active target,
  viewport, source/saved revisions and history for one open document.
- `EditorApplicationSession` owns application-wide editing choices such as the
  active tool. Dockview owns the application workspace layout and floating-panel
  placement. Switching documents or presets may reproject these choices but may
  not publish a document edit.
- One editor/canvas/Dockview runtime binds to the active session. Inactive
  sessions do not own hidden React editor trees or active renderer loops.
- Renderer state (raster resources, PaintScene, render islands, Vello scenes,
  meshes, textures and previews) is a deterministic disposable projection of
  canonical revisions.

Document content changes only through an explicit user gesture, semantic
command, Action, MCP operation, recovery/open operation or other named canonical
mutation. Viewing, tab switching, workspace rearrangement, tool switching,
preview generation, device recovery and cache eviction are not edits.

A stale asynchronous decode, hit test, normalization, preview or renderer
result must prove document/session identity and expected revision before it can
publish. If its source snapshot is obsolete, retry safely or discard it; never
replace newer canonical data.

## Visible processing ownership

- A raster/vector-compatible layer may own a local processing stack. `null`
  means exact bypass.
- An adjustment/Grade layer processes the composite beneath it and may be
  masked, grouped or clipped.
- Lens Fx follows the same visible ownership rule; it is not an invisible
  document singleton.
- Rasterizing or merging evaluates the relevant stacks and resets the result
  to plain raster pixels.

No-mask is semantically a constant mask of `1.0`. The same opacity/mask blend
path should be used whether or not a mask texture exists; absence must select a
cheap constant/bypass, not a separate behavior.

## Coordinate contract

Each scene node stores one affine `localToParent` transform. World transforms
are derived only by ordered multiplication:

```text
localToDocument(node) = localToDocument(parent) * localToParent(node)
```

The document root is identity. Viewport pan/zoom is presentation and never
serialized into layer geometry. CPU scene math uses doubles; GPU uniforms may
use `f32`.

Pointer operations resolve viewport to document, then document to owner-local
space. Rendering applies the inverse path. Paint, mask paint, bounds, hit tests,
selection clipboard and compositing must use the same transform authority—no
tool-specific offset fixes.

For a world-preserving reparent:

```text
newLocal = inverse(newParentWorld) * oldWorld
```

## Bounds and masks

Texture dimensions are not visible-content bounds. Tight bounds derive from
non-transparent pixels, vector geometry or the effective selection threshold.
Feathering needs padding beyond the hard selection bounds; clipping the blur
envelope produces the visibly cut feather defect.

`application/geometry/layerGeometryQuery.ts` is the shared cheap document-space
projection for snapping, transform picking and bounded external inspection. It
retains one index per immutable document snapshot. Its conservative visual
bounds are rejection-only broad-phase geometry: being outside proves a miss,
while being inside still requires exact vector, texture-alpha, mask and
clipping evaluation. This one-way rule prevents performance caches from
silently becoming editing semantics.

Masks live in the owning layer's local space and follow its transform. A
selection lives in document space while being authored and is clipped to the
canvas only when committed to pixel/mask data. All selection tools may begin
or travel outside the canvas.

After merge or rasterize, pixels, masks, styles, clipping and processing are
baked into new pixels; the new raster gets newly measured bounds and an
identity transform. This is the boundary that prevents accumulated transforms
from leaking into ordinary paint.

## Relevant implementation

- `editor/document/documentTypes.ts`
- `editor/document/sceneTransformGraph.ts`
- `editor/rendering/renderContract.ts`
- `editor/rendering/compositorGraph.ts`
- `editor/rendering/RenderIslandPlanner.ts`
- `editor/rendering/RetainedRenderIslandRegistry.ts`
- `application/geometry/layerGeometryQuery.ts`
- `application/workspace/editorApplicationSession.ts`
