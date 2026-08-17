# Rendering and processing

This document describes the current rendering architecture and the direction
in which it is being generalized. Code and tests remain authoritative. Labels
such as **current**, **partial** and **target** are deliberate.

## Three separate products of rendering

LightTable must not treat every visual update as a document render.

1. **Content rendering** evaluates layer sources, local processing, masks,
   styles, clipping, groups and blends into a revisioned document composite.
2. **Presentation rendering** samples a cached content result into the active
   viewport with pan, zoom, comparison and diagnostic presentation state.
3. **Editor overlays** draw selections, paths, handles, brush outlines and
   other interaction feedback over the viewport without changing pixels.

Scopes are analysis consumers of a content revision. They are not part of the
viewport or compositor. Pan, zoom, panel layout, overlay animation and hidden
scope state must never invalidate content.

## Current end-to-end path

```text
host source / native document
        |
application open + cancellation boundary
        |  startDocumentRenderer
WebGpuEngine integration facade
        |
LayerDocumentRenderer + document-owned runtime
        |
pure compositor analysis (compositorGraph)
        |
LayerCompositor encodes the layer tree
        |
ordered document processing/effects
        |
cached content texture and content revision
        +---------------------> scopes/analysis (deferred, revision keyed)
        |
viewport blit/presentation
        |
GPU vector editor overlays
        |
configured canvas
```

`startDocumentRenderer` starts renderer creation and source loading in
parallel and owns cancellation cleanup. `webGpuDocumentRenderer` is the host-
neutral adapter. `WebGpuEngine` currently coordinates the high-level render
frame and dirty domains; it is an integration facade, not a document model.

`LayerDocumentRenderer` owns the document renderer runtime. It synchronizes
canonical layer nodes to revisioned GPU realizations and exposes composition,
painting, transforms, selection operations, thumbnails and document assets.
`LayerCompositor` is the only service allowed to translate document ordering,
groups, clipping chains, masks, transforms, local adjustments and Layer
Styles into ordered GPU passes.

The compositor first builds a pure `CompositorPlan` from the document tree.
GPU encoding consumes that plan; UI code must never reproduce layer-order or
operation-order rules.

## Layer evaluation

A conceptual raster/vector leaf path is:

```text
source realization in layer-local space
-> scene/geometry transform or active transform preview
-> attached local Grade and Lens Fx processing
-> layer mask
-> Layer Styles
-> fill opacity
-> clipping coverage
-> layer opacity and blend mode
-> parent/group composite
```

An adjustment layer uses the accumulated lower composite as its source,
evaluates its processing stack, then applies its own mask, clipping, opacity
and blend semantics. A group evaluates children into an isolated or pass-
through envelope according to its semantics before joining its parent.

No mask is exactly equivalent to constant coverage `1.0`. It is not a
different compositor path. A disabled local processing node is an exact
bypass. Rasterize, merge and flatten evaluate every visible semantic owned by
the affected layers and reset the resulting raster transform to identity with
newly measured bounds.

The current single-full-canvas raster fast path may return the owned source
texture directly when opacity/fill/blend/mask/style/processing/transform state
proves that composition would be a no-op.

## Render contract and coordinate spaces

A texture alone is not a valid renderer boundary. `RasterRenderContract`
ties a realization to:

- texture and dimensions;
- local/document bounds;
- source and geometry revisions;
- source-to-document transform;
- linear-sRGB working semantics;
- premultiplied alpha.

Layer-local, document and viewport spaces are distinct. Content passes use
layer/document transforms. Viewport transforms are presentation only. Pointer
tools invert the same scene transform used by rendering; ad-hoc offset fixes
are forbidden. The detailed scene contract lives in
[Scene transform contract](contracts/SCENE_TRANSFORM_CONTRACT.md).

## GPU ownership and lifetime

The canonical document owns serializable state and revisions, never GPU
handles. Renderer subsystems own their textures, buffers, pipelines and
caches:

- `LayerRuntimeCoordinator` and `LayerRuntimeStore` realize raster layers and
  masks; detached runtimes may be retained for bounded lossless undo.
- `RenderTargetPair` owns compositor ping-pong targets.
- `LayerStyleRenderer`, `VectorLayerRenderer` and effect executors own their
  optional resources and caches.
- `SubmittedResourceRetainer` keeps transient buffers/textures alive until a
  submitted command buffer no longer references them.
- document image/core resource owners allocate only when the current feature
  path needs them.
- `ColorLookupAssetStore` retains exact document-scoped `.cube` sources and
  realizes referenced 3D LUTs as `rgba32float` textures. Sampling is explicitly
  trilinear in the shader so float-filtering support is not a device requirement;
  the identity LUT is the exact bypass for nodes without a custom asset.

Every cache has an owner, key, byte estimate, invalidation rule and destroy
path. A cached handle that is missing invalidates its downstream chain. Device
loss or renderer destruction must release the complete owned graph; React
cleanup must be idempotent under Strict Mode.

## Dirty graph and scheduling

`WebGpuEngine` currently holds the semantic render-dirty coordinator. Content,
processing/effects, blur input, viewport and scope work are separate domains.
The render frame reuses cached intermediate textures when their exact
dependency revisions are unchanged.

`ViewportPresentationController` translates DOM viewport measurements into
retained GPU uniforms, owns interactive-linear to settled-nearest sampling,
and disposes its settle timer. GPU resource recreation republishes the retained
uniforms without manufacturing a document or content change.

Rules:

- a viewport-only change performs a viewport blit, not a composite;
- an overlay-only change redraws overlays, not document pixels;
- scopes rerun only for a new analyzed content revision or changed scope
  options;
- a disabled node setting change does not wake its executor;
- no executable dirty stage means no GPU submission;
- pointer motion may coalesce to one update per animation frame, while
  pointer-up flushes the final value and final-quality work;
- inactive documents keep canonical state but do not run recurring work.

The target is to make this dependency graph explicit enough that each
processing node declares its inputs and output revision rather than relying on
broad facade flags. Dirty-region and tiled evaluation are future extensions,
not excuses to invalidate the full graph today.

## Processing nodes

A processing definition declares a stable type, settings schema, category,
allowed owner scopes, color/data domain, alpha behavior, coordinate space and
optional PSD semantic candidates. An instance adds identity, enabled state,
revision and serializable settings. Stack order is authoritative.

Current concepts include white balance, light, global color, color mixer,
color grading, curves, detail, vignette, lens distortion, chromatic
aberration, lens blur, halation, grain and warp. Definitions live in
`processing/moduleDefinitions.ts`.

**Current:** effect-category nodes have independent executors and resources;
`DocumentEffectRuntime` evaluates them in validated serialized order inside
constrained coordinate/data stages.

Post-crop Vignette is a document-output Lens FX node. Its controls and stack
ownership are independent from Grade, while its pixel work is fused into the
existing output transform before display-post Grain. Neutral or disabled
settings are an exact bypass and do not allocate or submit an extra pass.

**Partial:** some Grade controls are still packed into combined
`BasicAdjustments` shader paths, and not every operation is yet a standalone
generic executor. `WebGpuEngine` and `LayerDocumentRenderer` still expose
broad transitional surfaces.

**Target:** every ordered operation is evaluated through a registered executor
contract that supports fullscreen, neighborhood, multipass, analysis-backed
and multi-input nodes. The product UI may remain purpose-built; users do not
need to see an internal node graph.

```ts
interface ProcessingNodeExecutor<Settings> {
  prepare(context: RenderContext, settings: Settings): void;
  encode(
    context: RenderContext,
    inputs: readonly TextureHandle[],
    node: ProcessingNode<Settings>
  ): TextureHandle;
}
```

Blur/sharpen use neighborhood passes; warp/distortion use inverse coordinate
mapping; halation uses extract/blur/composite; Lens Blur consumes analysis and
depth resources; masks and blends consume multiple inputs. The contract must
describe these differences rather than force every effect into one shader.

## Vector and overlay path

Vector document content is realized through `vector-core`,
`vector-rendering` and `vector-webgpu`, then enters the same compositor as a
revisioned premultiplied texture contract. Editing geometry remains vector
data; it is rasterized only for display/composite or an explicit rasterize
command.

Selections, paths, handles and brush/warp outlines should share the GPU vector
overlay primitives. They are presentation data and must be clipped by the
viewport, not by authoring input bounds. See [Vector system](VECTOR_SYSTEM.md).

## Color, alpha and precision

The intended color path is explicit:

```text
decoded source + embedded/input profile
-> normalized linear working representation
-> premultiplied-alpha content processing
-> document-declared blend and coverage domain where compatibility requires it
-> output gamut/chroma fit and display transform
-> display encoding or requested export encoding/bit depth
```

Modules that require perceptual or display domains declare the conversion.
The compositor does the same for document blend behavior: linear texture
storage does not imply that every blend equation or opacity interpolation is
evaluated in linear light. Required transfer functions are fused into the
existing blend pass and the result returns to the linear premultiplied working
representation. They must not add CPU readback/upload or an avoidable
full-frame pass. The authoritative Photoshop-facing contract and measured
baseline live in
[Photoshop color and blend parity](PHOTOSHOP_COLOR_AND_BLEND_PARITY.md).

Intermediate textures preserve precision; quantization occurs at an explicit
export/presentation boundary, never incidentally between effects. Eight- and
sixteen-bit source metadata must not be confused with internal precision or
export capability. Wide-gamut/HDR support must extend this contract rather
than add browser-specific color assumptions.

## Extensibility

Future 3D, AI and procedural systems are texture/data producers, not special
cases in the compositor:

- a 3D layer can produce color, alpha, depth and object-ID contracts;
- an AI task can produce a revisioned layer/source plus provenance;
- a procedural/vector source can regenerate from canonical parameters.

Asynchronous producers carry document/session IDs, cancellation and source
revision guards. A stale result may be offered as a new explicit asset, but it
must never overwrite newer document state silently. Expensive producers stay
dormant until their own inputs are dirty.

## Verification

Rendering changes require tests at the lowest stable boundary:

- pure compositor-plan and processing-order tests;
- disabled-node exact-bypass tests;
- color/alpha/transform fixtures;
- WebGPU validation-scope checks and representative pixel/golden comparisons;
- cache hit/invalidation/lifetime tests;
- web and Electron smoke builds;
- integrated-GPU/Mac interaction checks for selection, scopes, sliders, paint
  and panel resizing.

Remaining migration work is tracked in
[Current state and roadmap](CURRENT_STATE_AND_ROADMAP.md).
