# Lighttable — Vector Shape Tools, Bézier Paths and GPU Rasterization

**Implementation brief for Codex 5.6**  
**Research date:** 31 July 2026  
**Target:** Lighttable desktop/web shared codebase, strict TypeScript, WebGPU compositor  
**Primary goal:** Add Photoshop-familiar live shape tools and precise cubic Bézier path creation/editing without introducing a separate Canvas/SVG rendering subsystem.

---

## 1. Assignment

Implement a native Lighttable vector-shape subsystem that:

1. Starts with Photoshop-familiar **live shape tools**.
2. Adds a native **Pen tool** for straight and cubic Bézier segments.
3. Adds **Path Selection** and **Direct Selection** editing.
4. Keeps vector geometry editable and serializable.
5. Rasterizes vector content through the existing **WebGPU render/compositor stack**.
6. Remains fast while drawing, editing, transforming, panning and zooming.
7. Fits Lighttable's existing layer, document, undo/redo, mask and compositing architecture.
8. Does not make Fabric.js, Paper.js, SVG DOM, HTML Canvas 2D, or another editor framework the permanent runtime architecture.

The implementation may study and reuse permissively licensed source code, subject to license compliance. Reference repositories may be cloned into `.referenceCode/`, which must remain local and excluded from Git.

---

## 2. Non-negotiable architectural rules

### 2.1 Audit before implementation

Before adding production code, inspect and document the existing Lighttable implementation of:

- the serializable document model;
- layer type registration and layer factories;
- stable layer/object IDs;
- revision and dirty-state tracking;
- GPU resource ownership;
- compositor input/output texture conventions;
- premultiplied-alpha conventions;
- linear color-space handling;
- masks, opacity and blend modes;
- tool dispatch and pointer capture;
- selection state;
- command/undo/redo transactions;
- transforms and viewport/document coordinate conversion;
- worker infrastructure;
- save/load and migration/versioning;
- render invalidation and caching.

Do not invent a parallel store, undo system, compositor, transform stack or coordinate system when Lighttable already has one.

Produce a short architecture audit before substantial implementation, for example:

```text
/docs/vector/VECTOR_ARCHITECTURE_AUDIT.md
/docs/vector/ADR_001_VECTOR_LAYER_MODEL.md
/docs/vector/ADR_002_DOCUMENT_SPACE_RASTER_CACHE.md
/docs/vector/ADR_003_VECTOR_RASTER_BACKEND.md
```

### 2.2 No permanent SVG/Canvas island

Do not solve this by embedding SVG-Edit, Fabric.js, Paper.js, an `<svg>` tree or a Canvas 2D scene as a second editor inside Lighttable.

Those projects are reference implementations and possible algorithm donors. The production system must use:

- Lighttable's own document model;
- Lighttable's own tool controllers;
- Lighttable's own command system;
- Lighttable's WebGPU rendering and compositing;
- Lighttable's existing layer panel and properties UI.

An SVG DOM may be used temporarily in tests or import/export tooling, but it must not become the authoritative runtime state.

### 2.3 Strict TypeScript and clean boundaries

- Use strict TypeScript.
- Do not introduce `any` to bypass design work.
- Keep document data serializable and free of GPU objects.
- Keep GPU resources in render/runtime caches, keyed by stable IDs and revisions.
- Keep transient tool state outside the serialized document.
- Avoid circular dependencies between document, tools, UI and renderer.
- Prefer small, testable geometry functions over large tool classes containing math, state and rendering together.

### 2.4 One gesture equals one undo command

Pointer movement must not create hundreds of history records.

- Begin a transaction on pointer down.
- Maintain a transient preview during the gesture.
- Commit one command on pointer up.
- `Escape` cancels and restores the pre-gesture state.
- A completed shape draw, transform, anchor drag, handle drag or property scrub is one undoable operation.

---

## 3. Photoshop research baseline

The feature inventory below was verified against the current Adobe Photoshop desktop documentation on 31 July 2026. The latest documented desktop release at that time is **Photoshop 27.8, June 2026**.

Adobe sources:

- Release notes / current version:  
  https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html
- Drawing tools overview:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html
- Draw shapes:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html
- Shape, path and pixel modes:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html
- Custom shapes:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html
- Star shapes:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html
- Line/arrow tools:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html
- Pen tool:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-paths-with-the-pen-tool.html
- Pen settings:  
  https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/pen-tool-settings.html
- Path editing:  
  https://helpx.adobe.com/photoshop/using/editing-paths.html
- Direct Selection:  
  https://helpx.adobe.com/photoshop/using/tool-techniques/direct-selection-tool.html
- Path management and shape-area modifiers:  
  https://helpx.adobe.com/photoshop/using/paths.html
- Rectangle tool and draw-from-center behavior:  
  https://helpx.adobe.com/photoshop/using/tool-techniques/rectangle-tool.html
- Ellipse tool:  
  https://helpx.adobe.com/photoshop/using/tool-techniques/ellipse-tool.html

### 3.1 Photoshop drawing modes

Photoshop exposes three drawing modes for Line and shape tools:

1. **Shape** — creates an editable vector shape layer with fill/stroke.
2. **Path** — creates/edit paths without directly painting pixels.
3. **Pixels** — directly rasterizes the shape into pixels.

For Lighttable:

- Implement **Shape mode first**.
- Architect the geometry so **Path-only mode** can reuse the same model later.
- Do not prioritize Photoshop's Pixels mode. Lighttable already has raster layers and can offer an explicit Rasterize command later.

### 3.2 Photoshop shape tools

Current Photoshop exposes:

| Photoshop tool | Required Lighttable result |
|---|---|
| Rectangle | Live rectangle and square; editable size and per-corner radius |
| Ellipse | Live ellipse and circle |
| Triangle | Live triangle; editable bounds/rotation/corner radius where supported |
| Polygon | Live regular polygon; editable side count, radius, rotation and rounded corners |
| Star | Live star; editable point count, inner radius, outer radius, rotation and corner radius |
| Line | Editable line with width/stroke properties |
| Arrow | Line with optional start/end arrowheads, width, length and concavity |
| Custom Shape | Reusable normalized path preset that scales into a drawn bounds rectangle |

Photoshop no longer needs a separate architectural Rounded Rectangle primitive: rounded corners can be live properties of the Rectangle shape.

### 3.3 Common shape behavior

Implement a familiar subset of Photoshop interaction behavior:

- Drag to draw.
- Hold `Shift` to constrain proportions:
  - rectangle → square;
  - ellipse → circle;
  - regular shape stays proportionally constrained;
  - line angle snaps to configured increments, initially 45°.
- Hold `Alt/Option` to draw from the center.
- Support `Shift+Alt/Option` together.
- Provide numeric X, Y, width, height and rotation fields.
- Support a click-on-canvas numeric creation dialog later, not as a blocker for the first milestone.
- Show live on-canvas controls where they add real value:
  - corner radius;
  - polygon side count/radius;
  - star point count/inner and outer radius;
  - line endpoints and arrowhead controls.
- New shape defaults to a new vector layer.
- Allow an explicit mode to add a component to the selected compound shape.

### 3.4 Photoshop shape styling

The production model must support:

- fill enabled/disabled;
- solid fill color first;
- stroke enabled/disabled;
- stroke color;
- stroke width;
- stroke alignment: inside, center, outside;
- line caps: butt, round, square;
- line joins: miter, round, bevel;
- miter limit;
- solid, dashed and dotted strokes;
- dash array and dash offset;
- corner appearance/rounding;
- document-space opacity through the existing layer/compositor model.

Gradients and patterns are useful later, but must not force a redesign. Define a brush/fill abstraction now even if only `solid` is implemented initially.

### 3.5 Photoshop path creation/editing tools

Photoshop's path-related tools include:

| Tool | Function |
|---|---|
| Pen | Precise straight and cubic Bézier path creation |
| Freeform Pen | Freehand input converted to a path |
| Curvature Pen | Curve-first path creation with simplified interaction |
| Add Anchor Point | Insert an anchor on an existing segment |
| Delete Anchor Point | Remove an anchor while preserving a usable surrounding curve |
| Convert Point | Convert corner ↔ smooth; create, remove or break direction handles |
| Path Selection | Select/move/transform complete path components |
| Direct Selection | Select/edit anchors, segments and direction handles |

Recommended Lighttable order:

1. Pen.
2. Path Selection.
3. Direct Selection.
4. Add Anchor Point.
5. Delete Anchor Point.
6. Convert Point.
7. Curvature Pen.
8. Freeform Pen with simplification/smoothing.

Curvature Pen and Freeform Pen are not part of the first MVP. The data model must allow them later.

### 3.6 Pen-tool behavior to match

Implement:

- Click to create a corner anchor and straight segment.
- Click-drag to create a smooth anchor with two direction handles.
- Preview the next segment with a Rubber Band option.
- Hold `Shift` to constrain points/handles to 45° increments.
- Click the first anchor to close the subpath.
- Finish an open path through `Enter`, `Ctrl+Enter` / `Cmd+Return`, tool switch, or an explicit Finish command according to Lighttable's shortcut conventions.
- Continue an existing open path by clicking an endpoint.
- Connect two open subpaths by selecting their endpoints in sequence.
- Hold `Alt/Option` while drawing/editing to convert or break handles.
- Temporarily invoke Direct Selection while drawing using the platform-equivalent modifier.
- Auto Add/Delete mode:
  - hover a selected segment → add-point cursor;
  - hover an anchor → delete-point cursor;
  - allow this behavior to be disabled.
- Keep point count minimal; do not add redundant anchors.

### 3.7 Direct Selection behavior

Implement:

- Click an anchor, segment or direction handle.
- Drag a marquee to select anchors/segments.
- `Shift` add/remove from the point selection.
- Drag selected anchors as a group.
- Drag a curved segment to reshape it.
- Drag direction handles.
- Preserve linked smooth handles when appropriate.
- Allow independent corner handles.
- Nudge by one document pixel/unit with arrow keys.
- `Shift+Arrow` nudges by ten.
- Delete selected segment/anchors with predictable topology updates.
- Transform selected anchors/segments through a selection bounds box later.
- Keep on-canvas handles at a constant screen-space size regardless of zoom.

### 3.8 Path Selection behavior

Implement:

- Click to select an entire vector element/path component.
- Marquee-select multiple components.
- `Shift` multi-select.
- Move, scale and rotate selected components.
- Duplicate by modifier-drag if this fits Lighttable's existing transform conventions.
- Align/distribute selected components later.
- Keep selection and transforms based on stable IDs, never array indexes.

### 3.9 Compound path operations

Photoshop supports ordered path-component operations:

- Add / Combine Shapes;
- Subtract Front Shape;
- Intersect Shape Areas;
- Exclude Overlapping Shape Areas;
- Merge Shape Components as a separate destructive operation.

Lighttable must store Add/Subtract/Intersect/Exclude **non-destructively**. Do not require robust destructive cubic-curve booleans for the first shape/path milestone.

A destructive `Merge Shape Components` command can be added later after a reliable boolean geometry implementation exists.

---

## 4. Recommended Lighttable document model

Names below are illustrative. Adapt them to the existing Lighttable naming and serialization conventions.

### 4.1 Layer integration

Add a native vector layer type, for example:

```ts
interface VectorLayerData extends BaseLayerData {
  readonly type: 'vector';
  readonly scene: VectorSceneData;
  readonly schemaVersion: number;
}

interface VectorSceneData {
  readonly elements: readonly VectorElementData[];
}
```

A new shape normally creates a new `VectorLayerData`. A vector layer may eventually contain multiple vector elements, but do not expose unnecessary Illustrator-like complexity in the first UI.

The vector layer must participate in existing:

- visibility;
- lock state;
- layer transform;
- opacity;
- blend mode;
- masks;
- clipping behavior where applicable;
- per-layer adjustments/effects;
- duplicate/delete/reorder;
- merge/rasterize;
- save/load;
- export.

### 4.2 Vector element types

Use a discriminated union:

```ts
type VectorElementData =
  | LiveShapeElementData
  | PathElementData
  | CompoundPathElementData
  | VectorGroupElementData;
```

Minimum useful base fields:

```ts
interface VectorElementBaseData {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly transform: AffineTransform2DData;
  readonly style: VectorStyleData;
  readonly revision: number;
}
```

Do not store cached bounds, meshes, GPU buffers or textures in the serialized object unless the existing document architecture has an explicit safe derived-cache system.

### 4.3 Live parametric shapes

Keep shapes parametric until the user explicitly converts them to a path.

```ts
type LiveShapeGeometryData =
  | RectangleShapeData
  | EllipseShapeData
  | TriangleShapeData
  | PolygonShapeData
  | StarShapeData
  | LineShapeData
  | CustomShapeInstanceData;
```

Suggested parameters:

```ts
interface RectangleShapeData {
  readonly kind: 'rectangle';
  readonly width: number;
  readonly height: number;
  readonly cornerRadii: readonly [number, number, number, number];
  readonly linkedCorners: boolean;
}

interface EllipseShapeData {
  readonly kind: 'ellipse';
  readonly width: number;
  readonly height: number;
}

interface TriangleShapeData {
  readonly kind: 'triangle';
  readonly width: number;
  readonly height: number;
  readonly cornerRadius: number;
}

interface PolygonShapeData {
  readonly kind: 'polygon';
  readonly sides: number;
  readonly radius: number;
  readonly rotationRadians: number;
  readonly cornerRadius: number;
}

interface StarShapeData {
  readonly kind: 'star';
  readonly points: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly rotationRadians: number;
  readonly cornerRadius: number;
}

interface LineShapeData {
  readonly kind: 'line';
  readonly start: Vec2Data;
  readonly end: Vec2Data;
  readonly startArrow: ArrowheadData | null;
  readonly endArrow: ArrowheadData | null;
}

interface ArrowheadData {
  readonly width: number;
  readonly length: number;
  readonly concavity: number; // normalized equivalent of Photoshop -50%..+50%
}
```

Canonical geometry generation converts every live shape to one or more path components for rendering. Do not destructively replace the live parameters with Bézier points during ordinary edits.

### 4.4 Cubic Bézier path representation

Use cubic Bézier segments as the canonical editable path form.

```ts
type HandleMode = 'corner' | 'smooth' | 'symmetric';

interface PathAnchorData {
  readonly id: string;
  readonly position: Vec2Data;
  readonly handleIn: Vec2Data;  // relative to position
  readonly handleOut: Vec2Data; // relative to position
  readonly handleMode: HandleMode;
}

interface SubpathData {
  readonly id: string;
  readonly anchors: readonly PathAnchorData[];
  readonly closed: boolean;
}

interface PathGeometryData {
  readonly subpaths: readonly SubpathData[];
  readonly fillRule: 'nonzero' | 'evenodd';
}
```

For a segment from anchor `A` to anchor `B`:

```text
P0 = A.position
P1 = A.position + A.handleOut
P2 = B.position + B.handleIn
P3 = B.position
```

Rules:

- A straight segment has collapsed relevant handles.
- `smooth`: handles remain collinear but lengths may differ.
- `symmetric`: handles remain collinear, opposite and equal length.
- `corner`: handles are independent or collapsed.
- Coordinates remain in element-local/document units with double precision in JavaScript.
- Convert to GPU `f32` only at upload time.
- For very large documents, subtract a local tile/origin before upload to preserve precision.

### 4.5 Compound path representation

```ts
type PathOperation = 'add' | 'subtract' | 'intersect' | 'exclude';

interface CompoundPathComponentData {
  readonly id: string;
  readonly geometry: PathGeometryData | LiveShapeGeometryData;
  readonly transform: AffineTransform2DData;
  readonly operation: PathOperation;
}

interface CompoundPathElementData extends VectorElementBaseData {
  readonly kind: 'compound-path';
  readonly components: readonly CompoundPathComponentData[];
}
```

The first component must behave as `add`. Later components are applied in order. Components share the compound element's style unless an explicit future design decision introduces per-component styling.

### 4.6 Style model

```ts
type VectorPaintData =
  | { readonly kind: 'none' }
  | { readonly kind: 'solid'; readonly color: DocumentColorData }
  | { readonly kind: 'linear-gradient'; readonly stops: readonly GradientStopData[]; /* future */ }
  | { readonly kind: 'radial-gradient'; readonly stops: readonly GradientStopData[]; /* future */ };

interface VectorStrokeData {
  readonly paint: VectorPaintData;
  readonly width: number;
  readonly alignment: 'inside' | 'center' | 'outside';
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
}

interface VectorStyleData {
  readonly fill: VectorPaintData;
  readonly stroke: VectorStrokeData | null;
}
```

Colors must enter the same document/display color-management path as raster content. Render in linear premultiplied alpha into the compositor's expected format, currently expected to be `rgba16float` unless the architecture audit finds otherwise.

---

## 5. Tool architecture

### 5.1 Separate tool controllers

Do not add more conditionals to a monolithic overlay component. Each tool should have a focused controller implementing Lighttable's existing tool interface or a compatible extension:

```ts
interface EditorToolController {
  readonly id: string;
  activate(context: ToolContext): void;
  deactivate(context: ToolContext): void;
  pointerDown(event: EditorPointerEvent, context: ToolContext): void;
  pointerMove(event: EditorPointerEvent, context: ToolContext): void;
  pointerUp(event: EditorPointerEvent, context: ToolContext): void;
  keyDown(event: KeyboardEvent, context: ToolContext): void;
  cancel(context: ToolContext): void;
}
```

Suggested controllers:

```text
RectangleShapeTool
EllipseShapeTool
TriangleShapeTool
PolygonShapeTool
StarShapeTool
LineShapeTool
CustomShapeTool
PathSelectionTool
DirectSelectionTool
PenTool
AddAnchorPointTool
DeleteAnchorPointTool
ConvertPointTool
```

Shared behavior belongs in reusable services, not copied between tools:

- drag-to-create bounds;
- modifiers;
- snapping;
- hit testing;
- transform handles;
- command transactions;
- overlay drawing;
- cursor resolution;
- live-shape handle manipulation.

### 5.2 Tool transient state

Tool transient state may include:

- pointer ID and capture state;
- drag origin/current point;
- pre-gesture document snapshot/patch;
- active component/anchor/handle IDs;
- snap result;
- preview geometry;
- current modifier state;
- interactive quality level.

None of this belongs in the serialized document.

### 5.3 Coalesced pointer updates

- Consume at most one geometry update per animation frame on the main thread.
- Use `getCoalescedEvents()` when available for freehand tools later.
- Never run expensive full-layer rebuilding for every raw pointer event.
- Keep the last pointer state and process it in the next frame.

### 5.4 Selection overlay

Render editing UI in a separate overlay pass:

- selected path outline;
- anchors;
- handle lines and direction points;
- live-shape controls;
- bounds/transform box;
- snap guides;
- hover highlight.

Overlay controls must stay constant in screen pixels and must not dirty the vector layer's document-space raster cache.

A DOM overlay is acceptable for numeric popovers and properties panels. Geometry outlines and high-frequency handles should use Lighttable's GPU overlay path when practical.

---

## 6. Geometry services

Create a renderer-independent geometry package/module.

Minimum services:

```text
CubicBezier.evaluate(t)
CubicBezier.derivative(t)
CubicBezier.split(t)
CubicBezier.bounds()
CubicBezier.flatness()
CubicBezier.flatten(tolerance)
CubicBezier.nearestPoint(query)
CubicBezier.length(tolerance)
Path.bounds()
Path.transform()
Path.reverse()
Path.hitTestFill()
Path.hitTestStroke()
Path.insertAnchorAt(segmentId, t)
Path.deleteAnchor(anchorId)
Path.convertAnchorMode(anchorId, mode)
Path.generateLiveShapePath(shape)
Stroke.expand/tessellate()
```

### 6.1 Add-anchor correctness

Adding an anchor to a cubic segment must use De Casteljau splitting so the visible curve remains identical before and after insertion.

### 6.2 Delete-anchor behavior

Deleting an anchor should not simply join neighboring points with a straight line. Implement a curve-fit/reconstruction strategy or a predictable simpler fallback and cover it with tests. A first version may preserve tangents and fit a replacement cubic within a documented tolerance.

### 6.3 Hit testing

Use two stages:

1. Broad phase:
   - cached element/path bounds;
   - optional spatial index for larger scenes.
2. Narrow phase:
   - screen-pixel tolerance converted to document units;
   - handle → anchor → segment → stroke → fill priority;
   - cubic nearest-point or adaptive subdivision, not only polyline vertex distance.

Suggested default hit radii should be expressed in screen pixels and account for device pixel ratio.

### 6.4 Snapping

Architect for:

- document/canvas edges and center;
- guides and grid;
- shape bounds and centers;
- anchors and segment extrema;
- 45° angle constraints;
- future perspective guides.

Keep snap thresholds in screen pixels. Return an explicit snap result containing source, target, delta and guide visualization.

---

## 7. Rendering architecture

## 7.1 Recommended first production backend

Use **CPU-side adaptive path realization/tessellation plus GPU rasterization**.

This still qualifies as GPU rasterization:

- CPU/worker converts editable curves and strokes into renderable geometry or edge data.
- WebGPU performs triangle rasterization, coverage, shading and compositing.

This is a lower-risk first implementation than immediately porting a complete Vello-style compute rasterizer.

Create an abstraction so the backend can be replaced later:

```ts
interface VectorRasterBackend {
  prepareElement(
    element: VectorElementData,
    context: VectorRealizationContext
  ): Promise<PreparedVectorElement> | PreparedVectorElement;

  rasterizeTiles(
    encoder: GPUCommandEncoder,
    prepared: readonly PreparedVectorElement[],
    target: VectorRasterTarget,
    dirtyTiles: readonly VectorTileKey[]
  ): void;

  releaseElement(elementId: string): void;
}
```

Initial backend:

```text
CpuTessellationWebGpuRasterBackend
```

Future/experimental backend:

```text
ComputePathWebGpuRasterBackend
```

Do not make the document or tools depend on a backend-specific mesh format.

### 7.2 Fill rendering

Do not rely solely on Earcut for all production fills. Earcut is useful for clean flattened polygons but is not a complete answer for arbitrary self-intersecting Bézier paths and all winding cases.

Evaluate these approaches in a small benchmark/prototype:

1. **Stencil-and-cover after adaptive curve flattening**
   - good fit for concave paths, holes and winding rules;
   - avoids full polygon triangulation;
   - hardware rasterization remains fast.
2. **Robust tessellation to triangles**
   - useful for simple paths and cached geometry;
   - study Lyon and Paper.js behavior.
3. **GPU edge/compute rasterization**
   - Vello-style future backend;
   - not a phase-one dependency.

Pick the simplest backend that correctly handles:

- nonzero fill rule;
- even-odd fill rule;
- open versus closed subpaths;
- holes;
- concave contours;
- self-intersection test cases;
- anti-aliased edges.

Document the selected algorithm in `ADR_003_VECTOR_RASTER_BACKEND.md`.

### 7.3 Stroke rendering

The first production backend may tessellate strokes on CPU/worker and rasterize the resulting triangles on WebGPU.

Stroke geometry must account for:

- width;
- caps;
- joins;
- miter limit;
- dashes;
- closed/open paths;
- inside/center/outside alignment;
- arrowheads;
- non-uniform transforms.

For interactive transforms, it is acceptable to preview a cached stroke raster and rebuild exactly at commit.

### 7.4 Compound path operations

Keep operations non-destructive in the document.

A practical first GPU implementation can rasterize component coverage into an offscreen mask and combine components in order:

```text
add       = union
subtract  = destination minus component
intersect = destination intersect component
exclude   = XOR
```

Possible implementation routes:

- stencil operations and cover passes;
- multisampled coverage masks with render/compute combination;
- Porter-Duff-like coverage composition where mathematically correct.

Hide this behind the raster backend. Do not bake operations into permanent geometry unless the user invokes a later destructive merge command.

### 7.5 Output and compositor integration

The rasterized vector layer must:

- output transparent premultiplied color;
- use the compositor's linear working space;
- use `rgba16float` or the compositor's established high-precision format;
- respect layer opacity/blend/mask after vector rendering;
- pass through existing per-layer/global adjustments in the correct order;
- avoid an extra sRGB encode/decode cycle;
- produce identical content for normal preview and export at the same target resolution.

---

## 8. Critical caching and zoom policy

### 8.1 Default policy: document-space rasterization

Lighttable is a raster image editor with editable vector layers. A Photoshop-like vector shape layer must normally be rasterized at the **current document pixel resolution**.

Therefore:

> **Panning and zooming the viewport must not rerasterize an unchanged vector layer.**

Viewport zoom only changes how the already rasterized document texture is sampled/displayed. At high zoom, the document's pixels should become visible, just like the rest of the image.

This gives:

- WYSIWYG document preview;
- predictable anti-aliasing;
- no tessellation churn while zooming;
- stable cache keys;
- lower CPU/GPU usage;
- identical results between vector and raster layers at the same document resolution.

Rerasterize only when one of these changes:

- path geometry;
- live-shape parameters;
- element/component transform committed into geometry realization;
- stroke geometry properties;
- fill/stroke paint affecting the raster output;
- compound path operation/order;
- target document dimensions/resolution;
- vector-layer effects that belong inside the vector raster stage;
- export target resolution differs from the document realization.

Viewport pan/zoom, selection changes, hover and edit overlays are not raster invalidations.

### 8.2 Transform-preview policy

During move/scale/rotate gestures:

1. Reuse the last valid vector-layer or element texture.
2. Apply the interactive transform on the GPU at display/composite time.
3. Update transform handles and bounds every frame.
4. On pointer up, commit one command and generate the exact final realization.

This keeps interaction near 60 Hz without rebuilding the vector geometry every frame.

If a long-running transform produces visibly poor preview quality:

- allow opportunistic refresh at approximately 15–30 Hz;
- only refresh when the scale/quality error crosses a threshold;
- use hysteresis to prevent repeated rebuilds around a boundary;
- discard stale asynchronous results using element/layer revision tokens.

Do not make low-frequency refresh the default for simple shapes. Most simple shape/path edits should remain cheap enough for one update per animation frame.

### 8.3 Anchor-edit policy

Anchor and handle dragging changes the actual curve, so the selected path may need a new realization during the gesture.

Use adaptive quality:

```text
Interactive curve tolerance: approximately 0.75–1.0 target document pixel
Final/commit tolerance: approximately 0.20–0.30 target document pixel
```

Guidelines:

- simple paths: update once per animation frame;
- expensive paths: move tessellation/flattening to a worker;
- if frame budget is exceeded, cap heavy preview updates around 30 Hz;
- always generate final-quality geometry on pointer up;
- stale worker output must never overwrite a newer revision.

### 8.4 Tile-based raster cache

Prefer document-space tiles over rebuilding one full-document texture for every small edit.

Start by evaluating 256×256 and 512×512 document-pixel tiles. Choose based on benchmark results and alignment with Lighttable's existing cache system.

Dirty region:

```text
dirtyBounds = union(previousBounds, newBounds)
              expanded by stroke radius
              expanded by anti-alias margin
              expanded by applicable local effects
```

Only tiles intersecting dirty bounds should rerasterize.

Suggested cache key dimensions:

```text
layerId
element/component revision
tileX / tileY
target document resolution
working color space
anti-alias/quality mode
raster backend version
```

Use an LRU or the existing GPU memory manager. Release caches when layers/documents close or GPU memory pressure requires it.

### 8.5 Geometry cache

Cache separately from raster tiles:

- generated canonical path for each live shape;
- flattened contours by geometry revision and tolerance bucket;
- fill realization;
- stroke mesh by geometry revision plus stroke-geometry revision;
- bounds and extrema;
- hit-test acceleration data.

Changing only fill color must not rebuild path geometry or stroke meshes.

Changing only layer opacity/blend mode must not rerasterize the vector layer if those are applied by the existing compositor.

### 8.6 Optional resolution-independent viewport mode

A future vector-focused preview could rasterize directly at viewport resolution to stay optically smooth above 100% zoom. Do not make this the default for the first Lighttable implementation because it can differ from final document pixels.

If explored later:

- keep it a separate preview realization;
- use discrete scale buckets rather than every zoom value;
- use 20–25% hysteresis between buckets;
- never replace the document-resolution cache used for export/compositing truth.

---

## 9. Threading and scheduling

### Main thread

Keep on main thread:

- pointer routing;
- tool state;
- selection state;
- small shape parameter updates;
- command transaction boundaries;
- GPU command submission;
- overlay rendering.

### Worker

Move to worker when thresholds show it is worthwhile:

- adaptive flattening of large paths;
- stroke tessellation;
- complex bounds/intersections;
- freeform path simplification;
- destructive boolean geometry later;
- large SVG/custom-shape import parsing.

Use transferable typed arrays for render geometry. Do not serialize large nested object graphs every frame.

Every job must include:

```text
documentId
layerId
elementId
geometryRevision
styleGeometryRevision
quality/tolerance
requestId
```

Reject stale results on receipt.

---

## 10. Reference source repositories

These repositories are for architecture study, behavior comparison and carefully attributed reuse. They are not all recommended runtime dependencies.

### 10.1 Primary references

| Repository | License | Study for | Git URL |
|---|---|---|---|
| SVG-Edit | MIT | Complete browser editor, shape tools, path editing interactions, SVG import/export | https://github.com/SVG-Edit/svgedit.git |
| Graphite | Apache-2.0 at repository level; inspect directory-specific licensing | Modern non-destructive vector/raster editor architecture, tools, layers/nodes, vector topology | https://github.com/GraphiteEditor/Graphite.git |
| Paper.js | MIT | Mature path/segment model, curve math, hit testing, path operations | https://github.com/paperjs/paper.js.git |
| Fabric.js | MIT | Selection, controls, object transforms, serialization and interaction patterns | https://github.com/fabricjs/fabric.js.git |
| Bezier.js | MIT | Focused JavaScript quadratic/cubic Bézier math | https://github.com/Pomax/bezierjs.git |

### 10.2 GPU/tessellation references

| Repository | License | Study for | Git URL |
|---|---|---|---|
| Lyon | MIT / Apache-2.0 | Turning SVG-like paths and strokes into GPU triangles | https://github.com/nical/lyon.git |
| Vello | MIT / Apache-2.0 | Compute-centric 2D GPU renderer using wgpu; future backend ideas | https://github.com/linebender/vello.git |
| Kurbo | MIT / Apache-2.0 | Accurate curve/path algorithms and tolerance-driven math | https://github.com/linebender/kurbo.git |
| Earcut | ISC | Fast polygon triangulation fallback for suitable clean polygons | https://github.com/mapbox/earcut.git |

### 10.3 Optional interaction reference

| Repository | License | Study for | Git URL |
|---|---|---|---|
| Excalidraw | MIT | Robust editor state, gestures, selection, undo/redo and collaboration patterns | https://github.com/excalidraw/excalidraw.git |

### 10.4 Reference-use guidance

Priorities:

1. **SVG-Edit:** concrete Photoshop-like editing behavior and SVG path interaction.
2. **Graphite:** modern architecture and non-destructive design, not direct TypeScript integration.
3. **Bezier.js/Paper.js/Kurbo:** geometry algorithms and tests.
4. **Lyon:** stroke/fill tessellation concepts.
5. **Vello:** long-term GPU compute research only; it currently describes itself as alpha and is Rust/wgpu based.
6. **Fabric.js:** interaction ideas only; do not let its Canvas scene model dictate Lighttable architecture.
7. **Earcut:** limited fallback, not the only production fill solution.

Graphite's 2025 vector work moved significant geometry functionality toward Kurbo for performance/reliability. Prefer studying current Graphite/Kurbo code rather than assuming older `bezier-rs` locations are still authoritative.

---

## 11. `.referenceCode` clone and Git-ignore instructions

Codex is allowed to clone the repositories above into a local `.referenceCode/` directory at the Lighttable repository root.

### 11.1 Mandatory Git exclusion

Do not overwrite the existing `.gitignore`. Add exactly one ignore rule if it does not already exist:

```gitignore
# Local third-party source references; never commit
.referenceCode/
```

Verify it:

```bash
git check-ignore -v .referenceCode/ || true
```

The entire directory, including nested repositories and notes inside it, must remain untracked.

### 11.2 Suggested clone commands

Run from the Lighttable repository root:

```bash
mkdir -p .referenceCode

# Add only when absent; do not duplicate the line or replace .gitignore.
grep -qxF '.referenceCode/' .gitignore 2>/dev/null \
  || printf '\n# Local third-party source references; never commit\n.referenceCode/\n' >> .gitignore

git clone --depth 1 --filter=blob:none https://github.com/SVG-Edit/svgedit.git .referenceCode/svgedit
git clone --depth 1 --filter=blob:none https://github.com/GraphiteEditor/Graphite.git .referenceCode/graphite
git clone --depth 1 --filter=blob:none https://github.com/paperjs/paper.js.git .referenceCode/paperjs
git clone --depth 1 --filter=blob:none https://github.com/fabricjs/fabric.js.git .referenceCode/fabricjs
git clone --depth 1 --filter=blob:none https://github.com/Pomax/bezierjs.git .referenceCode/bezierjs
git clone --depth 1 --filter=blob:none https://github.com/nical/lyon.git .referenceCode/lyon
git clone --depth 1 --filter=blob:none https://github.com/linebender/vello.git .referenceCode/vello
git clone --depth 1 --filter=blob:none https://github.com/linebender/kurbo.git .referenceCode/kurbo
git clone --depth 1 --filter=blob:none https://github.com/mapbox/earcut.git .referenceCode/earcut

# Optional
git clone --depth 1 --filter=blob:none https://github.com/excalidraw/excalidraw.git .referenceCode/excalidraw
```

If a directory already exists, inspect/update it instead of deleting work blindly.

### 11.3 Record exact reference commits

Create an ignored local file:

```text
.referenceCode/REFERENCE_COMMITS.local.md
```

Record:

```bash
for d in .referenceCode/*/.git; do
  repo="${d%/.git}"
  printf '%s  %s\n' "$(git -C "$repo" rev-parse HEAD)" "$repo"
done
```

When source is actually copied or substantially adapted into Lighttable, record the originating repository, commit and file in a committed `THIRD_PARTY_NOTICES.md` or equivalent compliance file.

### 11.4 License rules

Before copying code:

- read the license at the exact cloned commit;
- inspect file headers and subdirectory-specific licenses;
- check whether assets, test data or bundled shapes use different licenses;
- preserve required copyright and license notices;
- document substantial copied/adapted portions;
- do not import GPL/AGPL code into the product;
- do not assume a repository's top-level license automatically covers every bundled asset;
- prefer behavior study or focused reimplementation when copying would create unnecessary coupling.

MIT, ISC and Apache-2.0 are permissive, but their notice obligations still apply. Apache-2.0 may also require preserving NOTICE information and marking modifications where applicable.

### 11.5 No runtime imports from `.referenceCode`

Production code must never import modules using paths under `.referenceCode/`.

The directory is:

- local research material;
- not a package workspace;
- not part of builds;
- not part of CI;
- not part of release packaging.

Any selected dependency must be added normally through the project package/dependency system after an explicit architectural and license decision.

---

## 12. Implementation milestones

## Milestone 0 — Audit, prototypes and decisions

Deliver:

- architecture audit;
- reference repository clones locally;
- license inventory;
- ADRs for vector model, cache policy and raster backend;
- small isolated fill/stroke rendering benchmark;
- measured decision between stencil-and-cover and tessellated-fill approach;
- no broad UI implementation before the backend boundary is clear.

Prototype cases:

- rounded rectangle;
- ellipse with hole;
- concave star;
- self-intersecting path;
- cubic path with thick round stroke;
- Add/Subtract/Intersect/Exclude components;
- 4K document tile render.

## Milestone 1 — Native vector layer and basic live shapes

Implement:

- serializable vector layer;
- backend interface;
- document-space raster cache;
- rectangle and ellipse;
- solid fill;
- center stroke first, with architecture for all alignments;
- properties panel integration;
- layer panel integration;
- save/load and schema migration;
- draw/transform undo/redo;
- export at document resolution.

Acceptance:

- rectangle/ellipse remain editable after save/reopen;
- opacity, blend mode and masks behave like raster layers;
- panning/zooming causes zero vector rerasterizations;
- changing only layer opacity causes zero geometry rebuilds;
- only dirty tiles rebuild after a localized shape edit.

## Milestone 2 — Complete Photoshop-style live shape set

Implement:

- triangle;
- polygon;
- star;
- line;
- start/end arrowheads;
- per-corner rectangle radii;
- polygon/star controls;
- caps, joins, miter limit;
- dashes;
- inside/center/outside stroke if not completed in milestone 1;
- Shape Properties panel;
- convert live shape to path.

Acceptance:

- live parameters survive transforms and serialization;
- no destructive conversion occurs unless requested;
- shape handles remain constant-size in screen space;
- transform preview remains smooth and final commit becomes exact.

## Milestone 3 — Path Selection and transforms

Implement:

- whole component selection;
- multi-selection;
- move/scale/rotate;
- marquee selection;
- duplicate-on-drag if consistent with Lighttable shortcuts;
- stable selection IDs;
- component ordering/path operation property.

Acceptance:

- one undo step per transform;
- cancelled transforms restore exact prior state;
- preview uses cached raster where possible;
- transform selection overlay does not dirty raster tiles.

## Milestone 4 — Pen and Direct Selection

Implement:

- straight and cubic Pen creation;
- open/closed subpaths;
- Rubber Band preview;
- corner/smooth/symmetric anchor model;
- handles and handle modes;
- continue/connect open paths;
- Direct Selection anchors/segments/handles;
- marquee and shift selection;
- segment drag;
- nudge/delete;
- Add/Delete/Convert Point tools;
- De Casteljau anchor insertion.

Acceptance:

- inserting an anchor does not visually change the path;
- curve editing updates interactively under typical loads;
- final geometry rerenders at final tolerance on pointer up;
- save/reopen preserves every anchor ID and handle mode;
- no history spam during dragging.

## Milestone 5 — Compound operations and custom shapes

Implement:

- ordered Add/Subtract/Intersect/Exclude;
- path component selection and reordering;
- custom-shape preset format using normalized Lighttable paths;
- save selected path as a custom shape;
- import/export adapter for SVG path data where practical;
- built-in Lighttable shape preset library using original/permissively licensed assets only.

Do not copy Adobe custom-shape assets.

Acceptance:

- operations remain editable/non-destructive;
- compound shape output is stable at multiple document resolutions;
- custom presets preserve aspect ratio and scale cleanly;
- imports cannot create unbounded memory/segment counts without validation.

## Milestone 6 — Advanced parity later

Defer until the core is solid:

- Curvature Pen;
- Freeform Pen and path simplification;
- destructive Merge Shape Components;
- advanced gradients/patterns;
- text on path;
- vector masks based on the same geometry core;
- SVG round-trip fidelity beyond the supported subset;
- compute-centric direct path raster backend;
- vector animation/keyframes;
- Resolve-like node exposure of vector operations.

---

## 13. Performance instrumentation

Add debug counters/telemetry visible in development builds:

```text
vector.geometryBuildCount
vector.flattenCount
vector.fillRealizationCount
vector.strokeTessellationCount
vector.tileRasterCount
vector.fullLayerRasterCount
vector.cacheHitRate
vector.workerJobsQueued
vector.workerJobsDiscardedAsStale
vector.gpuUploadBytes
vector.cpuGeometryMs
vector.gpuRasterMs
```

Required regression assertion:

> Repeated viewport zoom and pan over an unchanged document must not increment geometry, tessellation or tile-raster counts.

Suggested performance scenes:

1. 4K document with 100 mixed live shapes.
2. 4K document with 1,000 simple shapes.
3. One path with 1,000 anchors.
4. One 200-point star with thick rounded dashed stroke.
5. Compound path with 50 components and mixed operations.
6. Continuous anchor drag for ten seconds.
7. Continuous zoom/pan loop.
8. Large document resize/export realization.

Targets are goals, not hard assumptions across all hardware:

- normal shape creation/editing near 60 Hz;
- main-thread geometry work usually below 4 ms for typical edits;
- no full-document rebuild for localized edits;
- no unbounded cache growth;
- no synchronous long task for large paths when a worker path is available;
- stable output with no stale async result flashes.

---

## 14. Test plan

### 14.1 Geometry unit tests

Cover:

- cubic evaluation/derivative;
- extrema and exact/conservative bounds;
- split invariance;
- adaptive flattening error tolerance;
- nearest point and hit tests;
- open/closed subpaths;
- anchor mode constraints;
- insert/delete anchor;
- live-shape path generation;
- rounded rectangle edge cases;
- polygon/star minimum and extreme point counts;
- zero/negative/degenerate dimensions;
- transformed paths;
- stroke caps/joins/dashes;
- arrowhead concavity boundaries;
- fill rules;
- operation ordering.

### 14.2 Serialization tests

- round trip all vector data;
- preserve stable IDs;
- migrate old schema versions;
- reject malformed/oversized input safely;
- no runtime/GPU objects in persisted JSON;
- deterministic output where existing Lighttable serialization is deterministic.

### 14.3 Tool tests

- one command per gesture;
- cancel with Escape;
- pointer capture loss;
- modifier changes during drag;
- drawing from center;
- constrained shapes;
- close/open/continue path;
- handle linking/breaking;
- multi-selection;
- keyboard nudge/delete;
- zoom/DPI-independent hit targets.

### 14.4 Rendering golden tests

Render reference images for:

- each live shape;
- rounded corners;
- concave/self-intersecting paths;
- holes and fill rules;
- all stroke caps/joins;
- dashed strokes;
- arrowheads;
- compound operations;
- transparent edges over light and dark backgrounds;
- multiple document resolutions;
- linear color/premultiplied-alpha correctness.

Use tolerant pixel comparisons appropriate for GPU vendors, but do not permit obvious topology or alpha-fringe differences.

### 14.5 Cache tests

Explicitly assert:

- zoom does not invalidate;
- pan does not invalidate;
- selection/hover does not invalidate;
- fill color does not rebuild geometry;
- layer opacity does not rerasterize;
- local geometry edit dirties only intersecting tiles;
- stale worker results are discarded;
- transform preview does not cause uncontrolled rebuilds;
- final commit produces final-quality geometry.

---

## 15. UI/UX expectations

The feature should feel familiar to a Photoshop user, but use Lighttable's visual language.

Provide:

- shape tool group in the toolbar;
- press-and-hold/flyout or explicit subtool selection;
- options bar/contextual controls;
- properties panel for exact values;
- fill/stroke swatches;
- path operation selector;
- live on-canvas handles;
- Pen/Path Selection/Direct Selection cursors;
- obvious active layer/element/component state;
- tooltips with shortcuts;
- sane defaults remembered through existing tool-preset/state conventions.

Do not expose every advanced option before the fundamental interactions are reliable.

Recommended initial defaults:

```text
Creation mode: New vector layer
Fill: current foreground color or last-used shape fill
Stroke: disabled or last-used shape stroke, according to existing UX decision
Path operation: Add/new component
Rectangle radius: 0
Polygon sides: 5
Star points: 5
Star inner radius: 50% of outer radius
Line cap: butt
Line join: miter
```

---

## 16. Security and robustness

For SVG/custom-shape import later:

- parse data, not active DOM content;
- no scripts, external URLs, event handlers or embedded HTML;
- cap file size, path count, segment count and nesting depth;
- reject NaN/Infinity and pathological coordinate magnitudes;
- guard recursive subdivision with maximum depth;
- guard tessellation and cache memory;
- cancel worker work when document/layer closes;
- do not allow malformed paths to crash the render loop.

---

## 17. Explicit decisions Codex must not make silently

Stop and document an ADR before changing any of these assumptions:

- replacing the existing WebGPU compositor;
- making Fabric/Paper/SVG DOM authoritative runtime state;
- introducing Rust/WASM as a required production dependency;
- changing the document coordinate system;
- rasterizing vector layers at viewport zoom by default;
- storing GPU meshes/textures in serialized documents;
- using destructive path booleans as the only representation;
- adding a new global undo or state-management framework;
- adding a GPL/AGPL dependency;
- bypassing the existing color pipeline.

Codex may make a well-reasoned alternative proposal, but must benchmark and explain it before implementation.

---

## 18. Definition of done for the first usable release

The first vector release is ready when a user can:

1. Create Rectangle, Ellipse, Triangle, Polygon, Star and Line/Arrow shape layers.
2. Edit their live parameters numerically and on canvas.
3. Set solid fill and production-quality stroke properties.
4. Select, move, scale and rotate vector components.
5. Convert a live shape to a path.
6. Draw an open or closed custom cubic Bézier path with the Pen tool.
7. Select and edit anchors, segments and handles.
8. Add, delete and convert anchors.
9. Save, close and reopen without losing editability.
10. Undo/redo each completed gesture as one action.
11. Composite vector layers through Lighttable's existing opacity, blend, mask and adjustment stack.
12. Pan and zoom without rerasterizing unchanged vector content.
13. Edit typical paths interactively without visible UI stutter.
14. Export at document or requested output resolution with predictable results.
15. Pass the geometry, serialization, rendering, cache and performance regression suites.

---

## 19. Recommended implementation conclusion

The recommended Lighttable architecture is:

```text
Serializable Lighttable Vector Model
        ↓
Live-shape canonical path generation
        ↓
Renderer-independent cubic path geometry
        ↓
Cached adaptive realization / stroke tessellation
        ↓
WebGPU document-space tiled rasterization
        ↓
rgba16float premultiplied vector-layer texture
        ↓
Existing Lighttable layer compositor
        ↓
Existing masks, opacity, blend, adjustments and display transform
```

Use CPU/worker geometry realization plus WebGPU rasterization first. Keep a clean backend boundary for a future Vello-like compute renderer, but do not block the feature on that research.

Most importantly:

> **An unchanged vector layer is a document-space cached image for compositing purposes. Viewport zoom is not a content change and must not trigger rerasterization.**

This gives Lighttable Photoshop-familiar behavior, predictable document pixels, fast interaction and an architecture that can grow later into more advanced vector, masking, node and motion-graphics workflows.
