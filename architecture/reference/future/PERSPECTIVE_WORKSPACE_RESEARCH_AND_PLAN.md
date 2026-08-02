# Lighttable — Perspective Workspace, Spatial Guides and Paint-Over-3D

> **Deferred product research.** Preserve this specification as a future
> direction, but do not use its StoryBuilder-era component paths or proposed
> ownership as current architecture. A future implementation must enter through
> the standalone document, command, processing-node, renderer and host
> boundaries described by `README.md` and
> `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md`.

**Status:** researched product and implementation specification  
**Target:** Lighttable / StoryBuilderOnline  
**Audience:** AI coding agent and product/architecture review  
**Primary goal:** turn the existing Perspective Match and planned 3D-layer work into a coherent, non-destructive perspective drawing and paint-over workspace for concept artists.

---

# 1. Executive summary

Lighttable should not implement perspective as a single modal filter or as a few temporary canvas lines.

The correct long-term abstraction is a document-level **Perspective Scene**: a calibrated or manually authored spatial frame containing a camera, world origin, vanishing directions, optional scale, perspective planes and display/snapping settings.

The same Perspective Scene can then drive:

- the camera used by one or more GLB/3D layers;
- horizon and vanishing-point overlays;
- a perspective ground grid;
- line and brush snapping;
- perspective-aware shapes;
- non-destructive placement of raster, vector and text layers on planes;
- raster painting in plane-local space;
- repeated perspective instances;
- GLB clay, wireframe, silhouette, hidden-line, depth and normal overlays;
- future AI conditioning and harmonization passes.

The intended experience is:

```text
Open image or Blender render
→ Perspective Match, manual guides, or use a GLB camera
→ Lighttable creates one shared Perspective Scene
→ show horizon, axes, ground grid and planes
→ create a paint layer or attach an existing layer to a plane
→ draw freely or temporarily snap to perspective directions
→ optionally hide the 3D blockout
→ continue grading, compositing and AI work in the normal layer stack
```

The important product position is not merely “Photoshop perspective guides.”

It is:

> A familiar layered image editor that understands the spatial camera behind the image.

Existing applications each cover only part of this workflow:

- Photoshop Vanishing Point supports perspective planes and perspective-correct editing, but as a specialized workflow rather than a document-wide 3D-aware layer system.
- Clip Studio Paint has strong perspective rulers and can derive a three-point ruler from a 3D layer camera.
- Krita has extensive painting assistants, including perspective and perspective ellipse assistants.
- Procreate emphasizes a simple Drawing Assist interaction.
- Illustrator and Fresco allow artwork or objects to snap to an active perspective plane.
- fSpy and SketchUp Match Photo focus on camera calibration, origin and scale from a still image.
- Blender Grease Pencil places drawing directly in 3D space.

Lighttable can combine the strongest parts of these into one non-modal, WebGPU-first, layer-aware workflow.

---

# 2. Relationship to the existing Lighttable architecture

Lighttable already has, or is planning:

- a serializable layered document;
- stable layer IDs and revisions;
- a WebGPU `rgba16float` compositor;
- raster painting, selections, masks, blend modes and undo/redo;
- a planned document-level Perspective Match solution;
- planned GLB/3D layers with cached rendering;
- a generic processing graph direction for per-layer adjustments and future node workflows.

This feature must extend those systems rather than create a second editor inside Lighttable.

The architectural boundaries remain:

```text
Serializable document model
    authoritative authored state

Editor session
    active tool, active plane, in-flight stroke, snapping state, overlay state

Runtime/rendering
    GPU buffers, Three.js objects, projection caches, guide geometry and textures
```

GPU resources and Three.js objects must remain reconstructable runtime state.

---

# 3. Research findings

## 3.1 Photoshop Vanishing Point

Adobe Vanishing Point is built around perspective planes on surfaces such as walls and building faces. It supports perspective-correct editing and copying across connected planes.

Useful lessons:

- A plane is a first-class user concept.
- Users understand defining a surface and then editing inside it.
- Connected planes are valuable for architecture.
- Perspective placement is more useful than guide display alone.

Weakness relative to the intended Lighttable workflow:

- It is not the center of a shared 3D/image camera model.
- It does not naturally behave like a reusable document-level spatial scene shared by 3D layers and normal layers.
- The workflow feels specialized and modal compared with normal layer editing.

Lighttable should preserve the familiar “define plane, place content” concept, but make it non-modal and non-destructive.

## 3.2 Clip Studio Paint

Clip Studio Paint has one of the closest existing workflows to the intended feature:

- one-, two- and three-point perspective rulers;
- per-vanishing-point snapping controls;
- perspective grids;
- a 3D layer can create a three-point perspective ruler matching its camera;
- changing the 3D camera updates that ruler.

This proves that artists understand and value a connection between a 3D camera and 2D drawing constraints.

Lighttable’s opportunity is to add:

- still-image Perspective Match as an equal camera source;
- GLB layers rather than a closed material ecosystem;
- non-destructive raster/text/image layer projection onto arbitrary planes;
- a shared spatial object that is independent from any one 3D layer;
- WebGPU compositing, grading and AI handoff in the same stack.

## 3.3 Krita painting assistants

Krita exposes painting assistants as reusable canvas objects. Its assistant set includes vanishing points, two-point perspective, perspective grids and perspective ellipses. Assistants can guide a brush and can have limited influence areas.

Useful lessons:

- Snapping should be optional and local.
- Guide previews matter while drawing.
- A perspective ellipse is a highly practical concept-art tool.
- An influence region prevents one guide from unexpectedly affecting the entire canvas.
- Assistants should be independently visible, editable and saveable.

Lighttable should use these lessons for snap regions, preview lines, plane-local tools and future ellipse/cylinder primitives.

## 3.4 Procreate Drawing Assist

Procreate uses a simple mental model:

```text
drawing guide
+
Drawing Assist
```

The user does not manage a complex constraint graph for normal use.

Useful lesson:

- Advanced perspective math should not result in a complicated default interaction.
- A single clear “Perspective Snap” or “Drawing Assist” toggle is preferable to permanently requiring modifiers.

Lighttable should expose advanced plane and camera controls in a panel, while keeping normal drawing controls compact.

## 3.5 Illustrator and Fresco

Illustrator and Fresco treat the active perspective plane as a target for drawing, moving and snapping objects.

Useful lessons:

- An obvious active-plane selector is essential.
- Snapping should work not only while drawing, but also while moving and transforming objects.
- Left/right/horizontal plane widgets are understandable to artists.

Lighttable should provide quick plane buttons such as:

```text
Ground
Wall X
Wall Z
Custom
```

The names shown to the user can be contextual, while internally using explicit world axes.

## 3.6 fSpy and SketchUp Match Photo

fSpy solves approximate focal length, camera orientation and position from vanishing directions and an origin. It can also use a known reference distance to establish scale.

SketchUp Match Photo similarly exposes:

- vanishing-point bars;
- horizon;
- axes;
- origin;
- model scale;
- projected photo texture workflows.

Critical lessons:

- A camera calibration from vanishing points is only defined up to scale unless the user supplies a reference distance or known geometry.
- Severe lens distortion, stitched panoramas, orthographic images and edited perspective can invalidate a pinhole-camera solve.
- Near-parallel guide pairs produce unstable vanishing points.
- The origin is as important as the vanishing directions.
- Scale must be explicitly calibrated; Lighttable must not invent meaningful metres or centimetres.

## 3.7 Blender Grease Pencil and line rendering

Blender Grease Pencil demonstrates the value of drawing in a real 3D context. However, Lighttable should not become a complete 3D drawing application.

The useful subset is:

- camera-aware drawing;
- plane-local content;
- line-art overlays;
- 3D blockout visibility modes.

Three.js provides `EdgesGeometry`, line materials and WebGPU post-processing such as Sobel/outline operations. However:

- `EdgesGeometry` extracts geometric feature edges, not a complete production hidden-line result;
- native basic line width is effectively one pixel in WebGL/WebGPU;
- many separate thick-line objects can become inefficient;
- a screen-space line overlay is better implemented as one batched/custom WebGPU path or a small number of `Line2`/node-material batches.

---

# 4. Product definition

## 4.1 Feature name

Recommended internal name:

```text
Perspective Workspace
```

Recommended user-facing workflow name:

```text
Paint Over 3D
```

Supporting feature names:

```text
Perspective Match
Perspective Scene
Perspective Guides
Perspective Planes
Plane Paint
Perspective Instances
```

Avoid naming the entire system “Vanishing Point,” because it is broader than a Photoshop-like vanishing-point tool.

## 4.2 Product promise

The user should be able to begin from any of three sources:

```text
Manual perspective
Still-image Perspective Match
GLB / 3D camera
```

All three create or update the same Perspective Scene.

Once a Perspective Scene exists, every compatible layer and tool can use it.

## 4.3 Core use cases

### Architectural paint-over

```text
Open a Blender blockout render
→ use embedded camera or match the image
→ switch GLB to clay or hidden-line
→ show ground/wall guides
→ paint architecture and detail with axis snapping
→ hide the GLB
```

### Photo concept extension

```text
Open a street photograph
→ match perspective
→ add a facade plane
→ place windows, signs and textures non-destructively
→ repeat elements in plane space
→ paint over the result
```

### Product/signage placement

```text
Open a photograph
→ define one wall/table plane
→ attach logo/text/image layer to the plane
→ move and scale it in plane coordinates
→ preserve the source pixels
```

### Free concept drawing

```text
Create a manual two- or three-point perspective scene
→ enable Drawing Assist
→ draw boxes, ellipses, roads and architecture
→ no 3D layer required
```

### 3D-guided illustration

```text
Import GLB
→ use its camera
→ choose silhouette/wireframe/depth display
→ draw on normal top layers or plane-bound layers
```

---

# 5. Key architectural decision: a document-level Perspective Scene

Do not attach the complete perspective model exclusively to one 3D layer.

A document may contain:

- multiple 3D layers sharing one camera;
- several paint layers using the same ground plane;
- text attached to a wall plane;
- a normal image layer used as the Perspective Match source;
- no 3D layer at all.

The Perspective Scene therefore belongs at document level.

## 5.1 Separate calibration from authored scene state

Use two related concepts.

### Perspective Calibration

A solver or imported 3D camera produces a calibration:

```ts
export interface PerspectiveCalibration {
  id: string;
  source:
    | {
        type: "image-match";
        sourceLayerId: LayerId;
        sourceGeometryRevision: number;
      }
    | {
        type: "three-d-camera";
        sourceLayerId: LayerId;
        cameraId?: string;
      }
    | {
        type: "manual-camera";
      };

  sourceImageSize: {
    width: number;
    height: number;
  };

  camera: CalibratedPerspectiveCamera;

  solveMode: "one-point" | "two-point" | "three-point" | "imported-camera";
  confidence?: number;
  warnings: PerspectiveSolveWarning[];

  revision: number;
}
```

This is the technical camera result.

### Perspective Scene

The authored scene adds origin, scale, planes and display behavior:

```ts
export interface PerspectiveScene {
  id: PerspectiveSceneId;
  name: string;

  calibrationId?: string;

  camera: CalibratedPerspectiveCamera;
  worldFrame: PerspectiveWorldFrame;

  scale:
    | { mode: "unitless" }
    | {
        mode: "reference-distance";
        unit: "mm" | "cm" | "m" | "in" | "ft";
        unitsPerWorldUnit: number;
        reference: PerspectiveReferenceDistance;
      };

  planes: PerspectivePlane[];
  guides: PerspectiveGuideDefinition[];

  display: PerspectiveDisplaySettings;
  snapping: PerspectiveSnappingSettings;

  revision: number;
}
```

This separation allows a user to keep the same calibration while adding or editing planes.

## 5.2 Canonical camera model

Do not store only a Three.js `fov` and transform.

Store a renderer-independent pinhole camera model:

```ts
export interface CalibratedPerspectiveCamera {
  projection: "perspective";

  intrinsics: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
    skew: number; // expected 0 for v1
    imageWidth: number;
    imageHeight: number;
  };

  extrinsics: {
    worldToCamera: Mat4Serialized;
  };

  clipping: {
    near: number;
    far: number;
  };

  distortion:
    | { model: "none" }
    | {
        model: "brown-conrady";
        k1: number;
        k2: number;
        k3?: number;
        p1?: number;
        p2?: number;
      };
}
```

Three.js camera state is derived from this model at runtime.

Reasons:

- crop and resize can update intrinsics explicitly;
- principal point is preserved;
- different renderers can use the same calibration;
- future lens distortion support remains possible;
- tests can compare numeric camera properties without Three.js.

## 5.3 World frame

```ts
export interface PerspectiveWorldFrame {
  origin: Vec3Serialized;
  right: Vec3Serialized;
  up: Vec3Serialized;
  forward: Vec3Serialized;
}
```

Require an orthonormal frame for calibrated scenes.

For artistic/manual guides that are not physically valid, use a separate state and do not pretend they are a calibrated 3D camera.

---

# 6. Manual guide scenes versus calibrated scenes

This distinction is important.

## 6.1 Artistic manual guide

A user may place arbitrary one-, two- or three-point guides that are visually useful but not a physically consistent orthogonal camera.

Such a scene can support:

- line snapping;
- horizon display;
- perspective construction;
- guide-only drawing.

It should not automatically support:

- GLB camera matching;
- accurate world-plane projection;
- meaningful physical scale;
- 3D object placement.

```ts
type PerspectiveSceneValidity =
  | "artistic-guides"
  | "calibrated-camera";
```

## 6.2 Calibrated camera scene

A calibrated scene is required for:

- 3D-layer camera use;
- ground and wall planes in world space;
- plane ray intersection;
- projective layer binding;
- physical measurement after a scale reference.

The UI should clearly show:

```text
Perspective Guides
```

or:

```text
Calibrated Perspective
```

This prevents false precision.

---

# 7. Perspective planes

## 7.1 Plane model

```ts
export interface PerspectivePlane {
  id: PerspectivePlaneId;
  name: string;

  transform: Mat4Serialized; // plane-local to world
  extent: {
    width: number;
    height: number;
  };

  grid: {
    visible: boolean;
    spacingU: number;
    spacingV: number;
    majorEvery: number;
    subdivisions: number;
  };

  display: {
    color: [number, number, number, number];
    opacity: number;
  };

  locked: boolean;
  visible: boolean;
  revision: number;
}
```

Plane-local coordinates:

```text
U = horizontal axis on plane
V = vertical axis on plane
N = plane normal
```

## 7.2 Plane presets

A calibrated Perspective Scene should create common planes quickly:

```text
Ground
Vertical X
Vertical Z
Custom Plane
```

The user-facing labels may be:

```text
Ground
Left Wall
Right Wall
Custom
```

Do not assume “left wall” always corresponds to one fixed world axis; it is a convenient label derived from the current view.

## 7.3 Plane creation methods

Support these progressively:

1. Create from world frame preset.
2. Duplicate and transform an existing plane.
3. Create from four image-space corners.
4. Pick a planar face from a GLB.
5. Create from three 3D points.

For v1, presets plus editable transforms are enough.

## 7.4 Connected planes

Connected planes are useful for rooms, street corners and boxes.

Do not require a complex topology model immediately.

A later helper can create:

```text
Ground + Wall X + Wall Z
```

sharing one origin and orthogonal frame.

---

# 8. Guide rendering

## 8.1 Derived data

Do not serialize thousands of rendered grid segments.

Serialize:

- camera;
- world frame;
- planes;
- guide definitions;
- display settings.

Derive screen-space lines at runtime.

## 8.2 Off-screen vanishing points

Vanishing points may be far outside the canvas.

Do not clamp the mathematical point to the image edge.

Render:

- an edge arrow indicating its direction;
- a label such as `X`, `Y`, `Z`;
- an optional mini-map/zoomed guide mode;
- drag handles represented through guide line pairs rather than requiring direct access to the distant point.

Use double-precision CPU math for vanishing-point and line-intersection calculations where practical. Convert to float32 only for GPU buffers.

## 8.3 Grid rendering strategy

Avoid generating hundreds of independent Three.js line objects.

Recommended options:

### 2D overlay grid

Render a batched screen-space line list in the existing Lighttable overlay renderer.

### Plane grid

Prefer a procedural plane-grid shader:

```text
world/plane position
→ local U/V
→ analytic minor/major grid coverage
→ depth or overlay composition
```

Benefits:

- constant grid complexity;
- crisp lines;
- configurable subdivisions;
- no large line-object collection;
- easy fade by distance or angle.

## 8.4 Guide display settings

```ts
export interface PerspectiveDisplaySettings {
  showHorizon: boolean;
  showVanishingDirections: boolean;
  showOrigin: boolean;
  showPlanes: boolean;
  showGrid: boolean;
  showLabels: boolean;

  opacity: number;
  lineWidthPx: number;

  fadeOutsideActivePlane: boolean;
  dimWhenNotEditing: boolean;
}
```

Guides are editor overlays by default and do not export.

Provide an explicit future command:

```text
Render Guides to Layer
```

rather than silently including them in export.

---

# 9. Snapping and Drawing Assist

## 9.1 Required behavior

Snapping must be:

- optional;
- visible;
- predictable;
- temporarily bypassable;
- selectable per axis/plane;
- stable under stylus jitter;
- compatible with normal free drawing.

## 9.2 Snap candidates

For a stroke starting at image/document point `p0`, each enabled world direction produces a candidate guide.

### Finite vanishing point

```text
line through p0 and vanishing point V
```

### Vanishing point at infinity

```text
line through p0 parallel to projected direction D
```

### Active plane axes

When drawing on a plane, use:

```text
U axis
V axis
optional diagonals
```

in plane-local coordinates.

## 9.3 Direction selection

Recommended interaction algorithm:

1. Pointer down creates an unconstrained start point.
2. Wait until the raw pointer delta exceeds a small activation threshold.
3. Compare the intended raw direction with all enabled snap candidate directions.
4. Select the smallest angular difference below a configurable threshold.
5. Keep the chosen direction using hysteresis.
6. Project subsequent raw samples onto the chosen guide.
7. Show the active guide before committing visible paint.
8. Allow the user to release or change the constraint.

Suggested defaults to validate through user testing:

```text
activation threshold: 4–8 screen px
snap angle: 10–15°
release angle: 18–25°
```

Do not hard-code these without a test panel.

## 9.4 Hysteresis

Without hysteresis, a nearly diagonal stroke can jump between X and Z directions.

Store:

```ts
interface ActivePerspectiveConstraint {
  directionId: string;
  guideLine: Line2D;
  acquiredAtDistancePx: number;
}
```

Remain locked until:

- the stroke returns close to its start and the user changes direction;
- a deliberate axis-cycle action occurs;
- the raw angle exceeds the release threshold;
- the snapping modifier/toggle is released.

Clip Studio Paint’s behavior of allowing direction changes after returning toward the start is worth testing.

## 9.5 Snap strength

A binary constraint is correct for line tools.

For brushes, optionally support:

```text
Snap Strength: 0–100%
```

Conceptually:

```ts
constrained = projectPointToGuide(raw);
result = lerp(raw, constrained, snapStrength);
```

However, v1 should start with exact snapping. Partial snapping can create soft, hard-to-predict curves and should only be added after testing.

## 9.6 Modifier and UI proposal

Recommended default interaction:

```text
Perspective Assist toggle in tool options
X / Y / Z buttons for enabled directions
active plane selector
temporary bypass modifier
```

Do not rely only on obscure modifiers.

Possible keyboard behavior to test:

```text
Shift = force straight/perspective-assisted stroke
X/Y/Z while dragging = explicit direction
Alt/Option = temporarily bypass assist
```

Resolve conflicts with existing Lighttable shortcuts during implementation.

## 9.7 Influence regions

A guide or plane may optionally define an influence region:

```ts
export interface PerspectiveInfluenceRegion {
  type: "entire-canvas" | "rect" | "polygon";
  points?: Vec2Serialized[];
}
```

Only guides whose influence region contains the stroke start participate in auto snapping.

This is useful for:

- multiple buildings with different perspective;
- comic panels;
- separate rooms or objects;
- multiple Perspective Scenes in one document.

Defer the UI for arbitrary polygons if needed, but keep the concept possible.

---

# 10. Perspective-aware layer placement

This is one of the highest-value features and should arrive before fully editable plane-space brush strokes.

## 10.1 Attach Layer to Plane

The user selects a raster, text, vector or generated layer and chooses:

```text
Attach to Perspective Plane
```

The layer retains its original source pixels/content.

The binding stores only spatial parameters.

```ts
export interface LayerPerspectiveBinding {
  perspectiveSceneId: PerspectiveSceneId;
  planeId: PerspectivePlaneId;

  localTransform: {
    translation: [number, number];
    rotationRadians: number;
    scale: [number, number];
    pivot: [number, number];
  };

  localBounds: {
    width: number;
    height: number;
  };

  sampling: {
    filter: "linear" | "nearest";
    mipmaps: boolean;
    maxAnisotropy?: number;
  };

  depthBehavior: "overlay"; // extend later
  revision: number;
}
```

## 10.2 Rendering

For a fixed perspective camera and plane, the mapping from a rectangular plane surface to the image is projective and can be represented by a 3×3 homography.

Recommended render path:

```text
source layer texture
→ inverse projective sampling shader
→ bounded document-space output
→ normal mask / opacity / blend processing
```

Do not destructively warp the source texture.

For each destination pixel:

1. map destination/document coordinates through the inverse homography;
2. obtain plane-local/source UV;
3. reject samples outside the source bounds;
4. sample with correct color/alpha semantics;
5. composite through the normal Lighttable pipeline.

When the camera or plane changes:

```text
recompute matrix
→ invalidate projection node
```

The source remains unchanged.

## 10.3 Camera-derived projection versus arbitrary four-corner warp

When a layer is attached to a real Perspective Plane, derive the mapping from:

```text
plane transform
camera projection
layer local transform
```

Do not solve an arbitrary homography every frame from manually adjusted corners.

A four-corner mode can exist as a separate generic perspective transform tool.

## 10.4 Editing interaction

When a plane-bound layer is selected:

- show its projected quad;
- move/rotate/scale in plane-local coordinates;
- snap movement to grid;
- optionally constrain to U or V;
- provide `Edit Content Front-On`.

### Edit Content Front-On

This is a powerful later workflow:

```text
double-click plane-bound layer
→ show the source surface orthographically/front-on
→ edit or paint normally
→ return to composition
→ projection updates automatically
```

It feels similar to editing a Smart Object while remaining native to Lighttable.

## 10.5 Baking and detaching

Provide explicit operations:

```text
Detach from Plane
Bake Projection to Raster
```

`Detach` should ask or choose one defined behavior:

- preserve current visual result as a normal transformed layer; or
- return to the unprojected source state.

Do not silently destroy the original source.

---

# 11. Plane Paint

## 11.1 Recommended implementation strategy

The initial proposal to store every stroke as `PlaneSpaceStroke[]` is architecturally elegant but is not required for the first useful version.

Lighttable already has a GPU raster paint engine.

A more compatible first implementation is:

```text
plane-local raster surface
+
normal Lighttable brush engine
+
pointer ray/plane mapping
+
non-destructive projective display
```

The paint pixels live in a plane-local texture instead of a document-sized texture.

```ts
export interface PlanePaintLayer extends BaseDrawableLayer {
  kind: "plane-paint";

  surface: {
    pixelSourceId: string;
    width: number;
    height: number;
    pixelsPerWorldUnit?: number;
  };

  binding: LayerPerspectiveBinding;

  brushScaleMode: "plane-space" | "screen-space";
}
```

If adding a new layer kind is undesirable, use a normal raster/paint layer with:

```ts
contentSpace:
  | { type: "document" }
  | { type: "perspective-plane"; binding: LayerPerspectiveBinding };
```

The exact structure should follow the current layer model.

## 11.2 Pointer mapping

For each pointer event:

```text
screen/document point
→ camera ray
→ intersect active plane
→ plane-local U/V
→ plane surface pixel coordinate
```

Reject or warn when:

- the ray is parallel to the plane;
- the intersection is behind the camera;
- the plane is nearly edge-on;
- the result is outside the editable surface.

## 11.3 Brush scale modes

### Plane-space brush

The brush radius is stored in plane/world units.

Result:

- the brush becomes smaller on screen with distance;
- patterns and line thickness follow perspective;
- ideal for windows, markings and surface detail.

### Screen-space brush

The brush appears approximately constant in screen/document pixels.

Result:

- better for loose sketching and paint-over marks;
- not physically scaled on the plane.

Expose the choice clearly.

Recommended default for a plane-paint layer:

```text
Plane Space
```

Recommended default for a normal paint layer using only directional snapping:

```text
Screen Space
```

## 11.4 Surface resolution

Plane-local raster painting requires an explicit surface resolution.

Options:

- user-selected width/height;
- pixels per world unit when scale is calibrated;
- adaptive preset based on projected screen size;
- fixed presets such as 1K/2K/4K.

Do not continuously resize the surface as the camera moves.

Recommended creation dialog:

```text
Plane Paint Layer
Resolution: 2048 × 2048
Plane Extent: inherited from active plane
Brush Scale: Plane Space
```

## 11.5 Editable strokes later

A future vector/stroke layer can store pressure samples and re-rasterize.

Do not block the MVP on that system.

Keep the brush renderer independent enough that a future stroke-command source can target the same plane surface.

---

# 12. Perspective-aware shape tools

After line snapping and layer projection, add high-value shape tools.

## 12.1 Rectangle and polygon

Draw in active plane coordinates.

The projected result is automatically perspective-correct.

## 12.2 Circle and ellipse

A circle in plane-local space projects to a conic, normally an ellipse in the image.

Do not approximate it by manually scaling a screen-space ellipse.

Render:

```text
plane-local circle geometry
→ camera projection
```

or generate the correct conic/Bezier approximation.

This is especially useful for:

- wheels;
- pipes;
- arches;
- circular windows;
- cylinders;
- mechanical concept art.

## 12.3 Box tool

A box tool should create a wireframe cuboid aligned to the Perspective Scene axes.

Interaction:

```text
drag base rectangle on active plane
→ drag height
→ commit box guide or vector object
```

## 12.4 Cylinder tool

```text
draw base circle on plane
→ set height along plane normal or world up
→ show projected top/bottom ellipses and side tangents
```

## 12.5 Scale references

When the scene has a calibrated reference distance, offer:

```text
Human 1.8 m
Door 2.1 m
Car length preset
Custom measurement
```

Do not show physical-size presets in a unitless scene without a clear warning.

---

# 13. Perspective Instances

Perspective Instances are a strong differentiator.

## 13.1 Behavior

The user creates or selects one source layer/object and chooses:

```text
Repeat on Plane
```

Example:

```text
Count U: 8
Count V: 4
Spacing U: 1.8
Spacing V: 1.2
```

Because repetition occurs in plane-local space, the instances automatically:

- shrink with distance;
- converge toward the correct vanishing direction;
- maintain physical spacing;
- remain editable as one generator.

## 13.2 Data model

```ts
export interface PerspectiveInstanceLayer extends BaseDrawableLayer {
  kind: "perspective-instances";

  sourceLayerId: LayerId;
  binding: {
    perspectiveSceneId: PerspectiveSceneId;
    planeId: PerspectivePlaneId;
  };

  layout:
    | {
        type: "grid";
        countU: number;
        countV: number;
        spacingU: number;
        spacingV: number;
      }
    | {
        type: "path";
        pathId: string;
        count: number;
        spacing: number;
      };

  randomization?: {
    scale?: number;
    rotation?: number;
    offset?: number;
    seed: number;
  };
}
```

## 13.3 Rendering

Prefer GPU instancing or repeated projective quads.

Do not flatten every copy into independent layers.

## 13.4 Use cases

- windows;
- columns;
- panels;
- road markings;
- lights;
- fences;
- tiles;
- seats;
- sci-fi greebles;
- signs;
- trees or props along a street.

Defer this until the single plane-bound layer path is stable.

---

# 14. GLB Paint-Over Mode

## 14.1 One-click workflow

Add:

```text
3D > Paint Over 3D
```

When invoked on a 3D layer:

1. ensure a Perspective Scene exists from the current 3D camera;
2. link the 3D layer to that scene;
3. create a normal paint layer above it;
4. enable Perspective Guides;
5. set the active plane to Ground;
6. open the compact Paint-Over controls;
7. keep normal layer-panel behavior.

Optional setup choices:

```text
Paint freely with directional snapping
Create Plane Paint layer
Create normal paint layer
```

## 14.2 3D display modes

Recommended modes:

```text
Beauty
Clay
Wireframe
Feature Edges
Hidden Line
Silhouette
X-Ray
Ambient Occlusion
Depth
Normals
Object ID
Perspective Guides Only
```

Not all modes need to launch in the first release.

## 14.3 Implementation notes per mode

### Clay

Override materials with a neutral material while preserving alpha and lighting.

### Wireframe

Triangle wireframe is easy but visually busy.

Treat it as a diagnostic mode rather than the primary concept-art outline.

### Feature Edges

Use geometric crease/boundary edges such as `EdgesGeometry`, generated when asset geometry changes.

Limitations:

- depends on mesh topology;
- may expose unwanted triangulation or miss smooth silhouette behavior;
- must be depth-tested for a useful result.

### Hidden Line

Recommended multi-pass approach:

```text
depth prepass
→ feature/silhouette line pass with depth test
→ optional faint hidden edges
```

This is more useful than raw wireframe.

### Silhouette

Use depth/normal discontinuities or a front/back-face expansion method.

A screen-space normal/depth edge pass is often better for complex meshes.

### AO, depth and normals

Render dedicated passes or use existing TSL/WebGPU post-processing where appropriate.

These passes are also useful later for AI harmonization or control images.

### Guides Only

Hide the visible GLB beauty result but keep:

- the shared camera;
- origin;
- planes;
- guides;
- optionally selected feature/silhouette overlays.

## 14.4 Caching

The existing no-continuous-render-loop rule remains.

Cache by:

```text
asset revision
object transform revision
camera / Perspective Scene revision
display mode
material override revision
render dimensions
pass configuration
```

A guide overlay change should not require re-rendering the GLB beauty texture unless the chosen 3D pass itself changes.

---

# 15. Processing graph integration

Perspective projection should be a normal spatial processing node.

## 15.1 Projection node

```ts
interface PerspectiveProjectNodeParams {
  perspectiveSceneId: PerspectiveSceneId;
  planeId: PerspectivePlaneId;
  localTransform: PlaneLocalTransform;
  sampling: PerspectiveSamplingSettings;
}
```

Graph:

```text
Layer source
→ layer-local color adjustments
→ PerspectiveProjectNode
→ mask / opacity / blend
→ document composite
```

The exact ordering between adjustments and projection should be explicit.

Recommended default:

```text
source interpretation
→ layer-local non-spatial adjustments
→ project to document space
→ document-space mask
→ opacity / blend
```

Spatial filters that must operate after projection should be separate nodes.

## 15.2 Plane paint graph

```text
plane-local paint surface
→ optional plane-local adjustments
→ PerspectiveProjectNode
→ document-space mask / blend
```

## 15.3 Future node graph

A future node UI may expose:

```text
Image
→ Repeat on Plane
→ Project Through Camera
→ Composite
```

or:

```text
3D Depth
→ Edge Detect
→ Colorize
→ Composite over Paint
```

The current layer UI does not need to reveal these nodes.

---

# 16. Coordinate spaces

Define these spaces explicitly and do not mix them.

```text
Client space
CSS pixels relative to browser viewport

Canvas/device space
physical canvas pixels

Editor viewport space
pan/zoom/rotation presentation coordinates

Document space
Lighttable document pixels

Source layer space
original layer pixels/content coordinates

Normalized image space
0..1 relative to a calibration source

Camera space
3D coordinates relative to camera

World space
Perspective Scene coordinates

Plane-local space
U/V/N coordinates on one Perspective Plane

Plane surface pixel space
raster pixels of a plane-paint source
```

Provide tested conversion functions.

```ts
clientToDocument(...)
documentToClient(...)

documentToCameraRay(...)
intersectRayWithPlane(...)

planeLocalToWorld(...)
worldToDocument(...)

documentToPlaneLocal(...)
planeLocalToDocument(...)
```

Use one canonical matrix convention throughout the TypeScript and WGSL code.

Document:

- row-major versus column-major;
- vector multiplication order;
- image Y direction;
- camera forward axis;
- NDC conventions;
- WebGPU depth range.

---

# 17. Camera matching and scale rules

## 17.1 Vanishing directions

A vanishing point is the projection of a 3D direction.

Two line segments believed to be parallel in 3D define one vanishing direction through their image-space intersection.

## 17.2 Two-point solve

Two orthogonal vanishing directions plus assumptions about the principal point can estimate focal length and camera orientation.

Do not claim exact calibration.

Return warnings for:

- near-parallel guide lines;
- vanishing points too close together;
- inconsistent orthogonality;
- implausible focal length;
- principal point far outside expected range;
- severe image distortion.

## 17.3 One-point solve

One-point perspective requires additional information such as:

- focal length/FOV;
- another direction;
- known camera properties.

Do not silently invent a focal length without labeling the result as assumed.

## 17.4 Three-point solve

A third perpendicular vanishing direction can improve or solve principal-point information.

Still validate the result.

## 17.5 Reference distance

Without a known distance:

```text
camera/world solution is scale ambiguous
```

The origin and relative axes are usable, but metre-based spacing is not.

Add an optional reference-distance tool:

```text
choose two points along known world axis
enter 20 cm
```

Store the measurement and unit.

## 17.6 Lens distortion

V1 assumption:

```text
approximately pinhole / low distortion
```

For images with visible barrel/pincushion distortion:

- warn the user;
- allow solving from an undistorted proxy later;
- keep a distortion field in the camera model;
- do not bend straight guide lines incorrectly while pretending the model is exact.

A future distortion-aware display path can distort projected guides back into source-image space.

## 17.7 Crop and resize

Store calibration relative to the original source dimensions and principal point.

Different operations have different behavior.

### Canvas resize

Camera intrinsics may remain valid while document placement changes.

### Image resize

Scale `fx`, `fy`, `cx`, `cy` with the image.

### Crop

Translate the principal point by the crop offset and update dimensions.

### Free transform/perspective transform of source layer

Mark the source relationship stale unless the transform can be composed exactly.

Do not silently keep an invalid solve.

---

# 18. Performance strategy

## 18.1 Overlay rendering

Target:

- one or a few draw calls;
- no per-grid-line React objects;
- no document recomposition for overlay changes;
- no GLB re-render for 2D guide display changes.

## 18.2 Thick lines

Three.js basic line width is effectively fixed at one pixel in WebGL/WebGPU.

Use one of:

- custom screen-space quad line shader;
- batched `Line2`/`Line2NodeMaterial`;
- analytic guide shader.

Prefer the existing Lighttable WebGPU overlay path for large guide sets.

## 18.3 Projection cache

Cache key:

```ts
interface PerspectiveProjectionCacheKey {
  layerId: LayerId;
  sourceRevision: number;
  sourceAdjustmentRevision: number;

  perspectiveSceneId: PerspectiveSceneId;
  perspectiveSceneRevision: number;
  planeId: PerspectivePlaneId;
  planeRevision: number;
  bindingRevision: number;

  outputWidth: number;
  outputHeight: number;
  samplingHash: string;
}
```

## 18.4 Bounds

Compute the projected quad bounds in document space.

Render only the intersecting document rectangle where possible.

Handle clipping against:

- document bounds;
- camera near plane;
- invalid/behind-camera vertices.

## 18.5 Mipmaps and aliasing

Perspective projection can heavily minify textures.

Validate:

- mipmap generation for source textures;
- anisotropic filtering where supported;
- alpha edge handling;
- premultiplied-alpha sampling;
- texture bleeding outside source bounds.

For plane paint surfaces, generate/update mipmaps after committed strokes or in bounded batches, not necessarily after every dab if too expensive.

## 18.6 GLB edge modes

Generate static geometric edges only when:

- asset changes;
- topology changes;
- threshold settings change.

Camera movement should not rebuild `EdgesGeometry`.

Screen-space depth/normal edge passes rerender when the 3D layer rerenders.

---

# 19. Undo, serialization and collaboration

## 19.1 Undo transaction boundaries

One meaningful action per history entry:

```text
Create Perspective Scene
Edit Perspective Match guides
Move origin
Set reference distance
Create plane
Transform plane
Attach layer to plane
Move/scale layer on plane
Toggle snapping/display
Create plane-paint stroke
Change 3D display mode
Create perspective instances
```

During drag:

```text
pointer down
→ begin transaction

pointer move
→ transient preview state

pointer up
→ commit one command
```

## 19.2 Serialization

Serialize:

- calibration inputs/results;
- camera intrinsics/extrinsics;
- source relationship and source image size;
- world origin/frame;
- scale reference;
- plane transforms/extents;
- guide definitions;
- display and snapping settings;
- layer plane bindings;
- plane-paint surface references;
- 3D display mode;
- stable IDs and revisions.

Do not serialize:

- GPU buffers;
- generated line vertices;
- Three.js objects;
- derived homography matrices if reproducible;
- cached projection textures;
- post-process render targets.

## 19.3 Missing dependencies

If a source 3D layer or calibration source is missing:

- preserve the Perspective Scene;
- mark source linkage unavailable;
- keep the last serialized camera;
- allow manual repair/relink;
- do not delete plane-bound content.

## 19.4 Collaboration

Stable IDs make Perspective Scene edits compatible with future collaborative documents.

Avoid storing drag-only transient handles in the shared document.

---

# 20. UI design

## 20.1 Main menu

```text
Perspective
├── Create Manual Perspective…
├── Match Perspective from Image…
├── Use Selected 3D Camera
├── Manage Perspective Scenes…
├── Add Plane
│   ├── Ground
│   ├── Vertical X
│   ├── Vertical Z
│   └── Custom
├── Attach Selected Layer to Plane
├── Detach Selected Layer
├── Create Plane Paint Layer
├── Show / Hide Guides
├── Enable / Disable Perspective Assist
├── Set Reference Distance…
└── Render Guides to Layer…
```

Some 3D-specific commands may also remain in the 3D menu, but avoid duplicate ownership.

## 20.2 Perspective panel

Suggested sections:

```text
Scene
  active scene
  source
  calibrated/artistic status
  confidence/warnings

Camera
  focal length / FOV
  principal point
  reset/rematch

Origin & Scale
  origin
  reference distance
  units

Planes
  list
  visibility
  active plane
  add/duplicate/delete/lock

Guides
  horizon
  axes
  grid
  opacity
  line width

Snapping
  assist on/off
  X/Y/Z
  nearest direction
  active plane only
```

## 20.3 Compact tool-options row

When Brush, Line or Shape tool is active:

```text
Perspective Assist [on]
Plane [Ground ▼]
Directions [X] [Y] [Z]
Snap [Nearest ▼]
```

Do not force the full panel open for ordinary drawing.

## 20.4 Layer-panel indicators

A plane-bound layer shows:

- a small perspective/plane badge;
- linked scene/plane in tooltip;
- broken link warning;
- optional chain line or icon.

A Plane Paint layer shows its source-surface thumbnail, not only the projected quad.

## 20.5 On-canvas controls

Show only controls relevant to the active Perspective tool:

- horizon;
- origin;
- guide-pair handles;
- plane corners/axes;
- active plane tint;
- off-screen VP arrows;
- reference-distance handles.

When another tool is active, dim controls and retain guides.

---

# 21. Recommended MVP

The first release should be narrower than the complete vision.

## MVP A — Guides and snapping

1. Reuse the planned document-level Perspective Match result.
2. Create `PerspectiveScene` around that camera/origin.
3. Display horizon and X/Y/Z vanishing directions.
4. Display a procedural ground grid.
5. Support manual calibrated two-point editing.
6. Add Perspective Assist to Line and Brush tools.
7. Allow explicit axis enabling and temporary bypass.
8. Save/open and undo/redo all scene state.

This already creates a useful concept-art feature.

## MVP B — Plane placement

1. Add Ground/Vertical X/Vertical Z planes.
2. Attach a raster/image layer to an active plane.
3. Render it non-destructively through a projective transform node.
4. Move/rotate/scale it in plane coordinates.
5. Support detach and bake.
6. Add grid snapping for transforms.

This expands usefulness far beyond drawing.

## MVP C — GLB paint-over presentation

1. Derive the same Perspective Scene from a 3D-layer camera.
2. Add Clay, Feature Edges/Hidden Line, Silhouette and Guides Only.
3. Add one-click `Paint Over 3D`.
4. Create a normal paint layer with Perspective Assist.

Do not require Plane Paint for the first marketing demo.

---

# 22. Later phases

## Phase 0 — audit and technical spikes

Before production implementation:

- inspect the existing Perspective Match plan and code;
- inspect the current tool-controller architecture;
- inspect layer transforms and graph compiler;
- validate camera-coordinate conventions;
- validate overlay integration;
- build isolated numeric and visual test cases.

Required spikes:

### Spike 0A — Camera projection parity

Given one synthetic camera and known 3D points:

- project using the calibration math;
- project using derived Three.js camera;
- project in WGSL;
- compare within tolerance.

### Spike 0B — Guide overlay

Render:

- horizon;
- three vanishing directions;
- off-screen indicators;
- procedural ground grid.

Confirm no document recomposition.

### Spike 0C — Perspective brush constraint

Create a small test harness with:

- raw pointer path;
- selected candidate direction;
- acquisition/release thresholds;
- hysteresis;
- preview and final constrained path.

Test mouse and stylus-like noisy input.

### Spike 0D — Plane projection

Render a checkerboard and alpha-edged logo onto a plane.

Test:

- camera changes;
- plane transforms;
- edge-on cases;
- minification;
- alpha;
- mipmaps;
- linear working-space behavior.

### Spike 0E — GLB concept modes

Compare:

- raw wireframe;
- `EdgesGeometry`;
- depth-tested feature edges;
- depth/normal Sobel;
- silhouette.

Choose the smallest useful v1 set.

## Phase 1 — Perspective Scene foundation

- document types;
- migrations from existing `PerspectiveSolution`;
- active scene session state;
- camera/world-frame conversion;
- save/load;
- undo commands;
- validation and warnings.

## Phase 2 — overlays and manual editing

- horizon/axis display;
- guide-pair editor;
- off-screen VP controls;
- ground grid;
- origin;
- opacity/color/spacing;
- artistic versus calibrated status.

## Phase 3 — Drawing Assist

- line tool constraints;
- brush constraints;
- axis enable/disable;
- active plane;
- bypass and preview;
- influence region foundation;
- tests.

## Phase 4 — plane-bound raster layers

- plane model;
- projective graph node;
- attach/detach/bake;
- plane-local transforms;
- layer indicators;
- sampling/mipmap validation;
- cache and bounds.

## Phase 5 — GLB Paint-Over Mode

- derive scene from 3D camera;
- shared camera updates;
- clay;
- hidden/feature lines;
- silhouette;
- guides-only;
- one-click setup.

## Phase 6 — Plane Paint

- plane-local raster surfaces;
- ray-plane pointer mapping;
- brush scale modes;
- front-on editing;
- mipmap update policy;
- masks and undo.

## Phase 7 — perspective shapes

- rectangles;
- circles/ellipses;
- boxes;
- cylinders;
- scale references.

## Phase 8 — Perspective Instances

- grid repetition;
- path repetition;
- GPU instancing;
- editable spacing/count;
- deterministic randomization.

## Phase 9 — advanced spatial compositing

- depth-aware 2D/3D occlusion;
- GLB face picking for planes;
- decals;
- image projection onto mesh surfaces;
- lens-distortion-aware guides;
- multiple scene/camera shots;
- AI depth/normal/ID conditioning;
- node UI exposure.

---

# 23. Tests

## 23.1 Numeric camera tests

- known intrinsics/extrinsics project expected points;
- inverse camera ray passes through expected points;
- Three.js and Lighttable math match;
- crop updates principal point correctly;
- resize scales intrinsics correctly;
- world frame remains orthonormal;
- vanishing directions agree with projected world axes.

## 23.2 Solver tests

- synthetic one-, two- and three-point cases;
- known FOV;
- known camera rotation;
- image aspect ratios;
- principal point offset;
- near-parallel guides;
- inconsistent guides;
- lens-distorted fixture warning;
- crop and resized fixture;
- invalid orthographic/panorama cases.

## 23.3 Snapping tests

- same intended path sampled at different event rates produces equivalent constrained line;
- no axis flicker near boundaries;
- hysteresis releases at expected angle;
- finite and infinite VPs work;
- stroke start exactly at VP does not generate NaN;
- off-screen VP with very large coordinates remains stable;
- active-plane U/V constraints work;
- bypass works mid-stroke according to defined behavior;
- pointer cancel restores/commits according to existing brush rules.

## 23.4 Projection tests

Use deterministic checkerboard and alpha textures.

- source corners project to expected document points;
- inverse mapping samples correct UV;
- camera/plane update invalidates only dependent nodes;
- opacity/masks/blend modes preserve existing semantics;
- premultiplied alpha has no dark fringe;
- mipmaps reduce minification aliasing;
- edge-on plane fails safely;
- plane behind camera is hidden;
- projected bounds are correct;
- save/open reproduces output.

## 23.5 Plane paint tests

- pointer ray maps to expected UV;
- plane-space brush shrinks with distance on screen;
- screen-space brush remains approximately constant;
- strokes clip at surface bounds;
- undo restores plane-local pixels;
- front-on edit and perspective view share the same source surface;
- camera changes do not alter source pixels.

## 23.6 GLB display tests

- no continuous render loop;
- mode changes invalidate 3D cache;
- guide-only changes do not invalidate beauty pass;
- feature edges are depth tested;
- silhouette remains stable under camera change;
- resource disposal occurs after asset replacement/removal;
- output alpha and working color remain compatible with compositor.

## 23.7 UI tests

- scene/plane selection is clear;
- active plane is visible;
- plane-bound layer has badge;
- broken source link is shown;
- snapping can be disabled quickly;
- guides remain hidden from export;
- invalid calibration warnings are actionable;
- one-click Paint Over 3D creates the expected layer order.

---

# 24. Acceptance criteria for the first meaningful release

The feature is ready for an initial concept-artist release when:

1. A user can create a Perspective Scene from a still image or a 3D camera.
2. The scene displays a correct horizon, axis directions, origin and ground grid.
3. Vanishing points outside the canvas remain usable.
4. Line and brush strokes can snap predictably to enabled perspective directions.
5. Normal free drawing remains available without changing tools.
6. A raster/image layer can be attached non-destructively to a plane.
7. The attached layer can be moved, rotated and scaled in plane-local space.
8. Camera or plane edits update the projection without resampling the source destructively.
9. A 3D layer can use at least clay, useful edge/silhouette and guides-only modes.
10. `Paint Over 3D` sets up a useful layer stack in one action.
11. Save/open and undo/redo restore the complete authored state.
12. Guide editing does not trigger full document or GLB recomposition unnecessarily.
13. Existing Lighttable color, alpha, masks and blend behavior remain correct.
14. The feature works without a 3D layer.
15. The feature does not claim physical measurement unless scale was explicitly calibrated.

---

# 25. Non-goals for the first implementation

Do not build immediately:

- a full Blender replacement;
- arbitrary mesh painting;
- UV unwrapping;
- material authoring;
- full Grease Pencil;
- camera tracking for video;
- curved/fisheye perspective;
- six-point perspective;
- automatic AI vanishing-point detection as a dependency;
- depth-aware 2D/3D occlusion;
- editable vector stroke history for all paint;
- arbitrary node-graph UI;
- hundreds of 3D display modes;
- a complete CAD measurement system.

Keep interfaces extensible, but prioritize a coherent vertical slice.

---

# 26. Important risks and decisions

## Risk 1 — feature breadth

This can expand into a complete spatial editor.

Control scope by shipping:

```text
shared camera
guides
snapping
one plane projection
useful GLB overlays
```

before Plane Paint and instances.

## Risk 2 — snapping feel

Mathematically correct snapping can still feel bad.

Build the interaction spike and tune:

- activation;
- angle threshold;
- hysteresis;
- preview;
- modifier behavior;
- stylus noise.

## Risk 3 — perspective scene invalidation after image edits

Crop, transform and lens correction can make a calibration stale.

Store source geometry revisions and explicit invalidation status.

## Risk 4 — line rendering performance

Avoid one object per guide line.

Batch or render analytically.

## Risk 5 — alpha and color fringes

Projective sampling of transparent art can reveal dark fringes.

Validate internal alpha convention, texture borders, mipmaps and linear sampling.

## Risk 6 — false scale

Never label grid spacing as metres in an unscaled solve.

## Risk 7 — GPL source reuse

fSpy is GPL-3.0.

Use it for mathematical and behavioral research, but independently implement solver code unless Lighttable’s licensing strategy explicitly permits direct reuse.

## Risk 8 — Three.js/WebGPU interop

The existing 3D-layer plan already requires a technical spike around device/resource sharing and alpha/color output.

Perspective overlays and normal 2D projection nodes should remain in Lighttable’s own WebGPU renderer where possible, reducing dependency on private Three.js internals.

## Risk 9 — topology-dependent edge extraction

Raw mesh edges are not equivalent to clean concept-art line art.

Validate geometric and screen-space approaches and label modes honestly.

---

# 27. Recommended product sequence

The strongest practical order is:

```text
1. Finish shared Perspective Match / Perspective Scene
2. Add guides and Drawing Assist
3. Add non-destructive Attach Layer to Plane
4. Add GLB clay/edge/silhouette/guides-only modes
5. Ship Paint Over 3D workflow
6. Add Plane Paint
7. Add perspective shapes
8. Add Perspective Instances
```

This order delivers visible value early while keeping the architecture correct.

The highest-value combination for marketing is likely:

```text
GLB blockout
→ camera-aware guides
→ edge/silhouette overlay
→ perspective-snapped windows/architecture
→ plane-attached signage
→ hide blockout
```

---

# 28. Twenty-second demonstration script

```text
0–3 s
Open a Blender GLB blockout and a background image.

3–6 s
Click “Use 3D Camera.” Horizon, origin and ground grid appear instantly.

6–10 s
Switch the GLB to Hidden Line. Create a paint layer.

10–14 s
Draw facade lines and windows with perspective snapping.

14–17 s
Drop a sign/logo onto the wall using Attach to Plane.

17–20 s
Hide the GLB. The final paint-over remains, with correct perspective.
```

On-screen message:

> Paint over 3D without leaving your image editor.

Secondary line:

> Lighttable understands the camera behind the image.

---

# 29. Coding-agent guardrails

1. Inspect the actual current Lighttable code before naming files or changing types.
2. Reuse the existing document IDs, revisions, commands, tool dispatch and compositor conventions.
3. Do not create a parallel 3D/perspective document store.
4. Keep serialized authored state separate from runtime objects and GPU caches.
5. Do not make guides part of the exported image by default.
6. Do not directly copy GPL fSpy implementation code without an explicit licensing decision.
7. Keep manual artistic guides distinct from physically calibrated perspective.
8. Do not invent physical scale.
9. Preserve current color and alpha semantics.
10. Add numeric tests before UI polish.
11. Build snapping as an isolated testable constraint service.
12. Keep projective placement non-destructive.
13. Implement one correct plane path before connected planes, instances or mesh decals.
14. Batch guide rendering.
15. Do not add a continuous 3D render loop.
16. Report measured invalidation and pass counts.
17. Stop and report coordinate-system or color/alpha conflicts rather than silently compensating.
18. Update the existing 3D-layer/Perspective Match specification so both documents share one canonical model.

---

# 30. Required implementation report

After each phase, report:

- files added and modified;
- document-model changes;
- migrations;
- coordinate-system conventions;
- old and new render graph;
- cache keys and invalidation behavior;
- CPU/GPU pass counts;
- tests added and results;
- visual reference comparisons;
- known limitations;
- next recommended phase.

For the projection phase, include one diagram for:

```text
normal document-space paint layer
plane-bound raster layer
plane-paint layer
3D layer sharing the same Perspective Scene
```

---

# 31. Final intended architecture

```text
Lighttable Document
│
├─ Perspective Scenes
│  ├─ calibrated/manual camera
│  ├─ origin and world frame
│  ├─ optional physical scale
│  ├─ perspective planes
│  └─ guide/snapping settings
│
├─ Pixel / Paint / Text / Vector layers
│  └─ optional Perspective Plane binding
│
├─ Plane Paint layers
│  └─ plane-local raster surfaces
│
├─ 3D layers
│  ├─ shared Perspective Scene camera
│  ├─ beauty/clay/edge/depth/normal passes
│  └─ cached render output
│
└─ Perspective Instance generators

                 compile
                    ↓

Generic Processing Graph
│
├─ source nodes
├─ layer-local adjustment nodes
├─ perspective projection nodes
├─ transform/mask nodes
├─ 3D pass nodes
├─ instance nodes
├─ composite nodes
└─ output/display nodes

                 evaluate
                    ↓

WebGPU / Three.js Runtime
├─ batched guide overlay
├─ projective texture sampling
├─ cached 3D output
├─ graph-level cache reuse
├─ texture/resource pooling
└─ final compositor
```

The user sees a familiar layer stack, normal brushes and a compact Perspective Assist control.

The underlying document understands a camera, origin and planes shared by 2D and 3D content.

---

# 32. Primary sources

## Perspective drawing and paint assistants

- Adobe Photoshop — Vanishing Point:  
  https://helpx.adobe.com/photoshop/using/vanishing-point.html
- Adobe Photoshop — Perspective Warp / defining planes:  
  https://helpx.adobe.com/in/photoshop/desktop/repair-retouch/clean-restore-images/define-planes-to-adjust-perspective.html
- Clip Studio Paint — Perspective Rulers:  
  https://help.clip-studio.com/en-us/manual_en/510_ruler/Perspective_Rulers.htm
- Clip Studio Paint — Drawing along a perspective ruler:  
  https://help.clip-studio.com/en-us/manual_en/510_ruler/Drawing_along_a_perspective_ruler.htm
- Clip Studio Paint — 3D import and camera-linked ruler behavior:  
  https://help.clip-studio.com/en-us/manual_en/660_3d/Importing_3D_Files.htm
- Clip Studio Paint — Set camera angle:  
  https://help.clip-studio.com/en-us/manual_en/660_3d/Set_camera_angle.htm
- Krita — Painting with Assistants:  
  https://docs.krita.org/en/user_manual/painting_with_assistants.html
- Krita — Assistant Tool:  
  https://docs.krita.org/en/reference_manual/tools/assistant.html
- Procreate — Perspective Guide:  
  https://help.procreate.com/procreate/handbook/guides/guides-perspective
- Procreate — Drawing Assist:  
  https://help.procreate.com/procreate/handbook/guides/guides-drawing-assist
- Adobe Illustrator — Perspective drawing:  
  https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/about-perspective-drawing.html
- Adobe Illustrator — Draw and modify objects on perspective grid:  
  https://helpx.adobe.com/uk/illustrator/using/draw-and-modify-objects-perspective-grid.html
- Adobe Fresco — Perspective grids and snapping:  
  https://helpx.adobe.com/il_he/fresco/using/grids-alignment.html

## Camera matching and projective geometry

- fSpy — Basics:  
  https://fspy.io/basics
- fSpy — Tutorial:  
  https://fspy.io/tutorial
- fSpy — Source repository and GPL-3.0 license:  
  https://github.com/stuffmatic/fspy
- SketchUp — Photo Matching:  
  https://help.sketchup.com/en/sketchup/matching-photo-model-or-model-photo
- OpenCV — Homography concepts:  
  https://docs.opencv.org/4.4.0/d9/dab/tutorial_homography.html
- OpenCV — Geometric image transformations:  
  https://docs.opencv.org/4.13.0/da/d6e/tutorial_py_geometric_transformations.html
- OpenCV — Perspective-n-Point pose computation:  
  https://docs.opencv.org/4.13.0/d5/d1f/calib3d_solvePnP.html

## 3D drawing and WebGPU line/edge rendering

- Blender — Grease Pencil introduction:  
  https://docs.blender.org/manual/en/latest/grease_pencil/introduction.html
- Blender — Grease Pencil drawing:  
  https://docs.blender.org/manual/en/latest/grease_pencil/modes/draw/introduction.html
- Blender — Line Art:  
  https://docs.blender.org/manual/en/latest/scene_layout/object/properties/line_art.html
- Three.js — EdgesGeometry:  
  https://threejs.org/docs/pages/EdgesGeometry.html
- Three.js — LineBasicMaterial and line-width limitation:  
  https://threejs.org/docs/pages/LineBasicMaterial.html
- Three.js — WebGPU Sobel example:  
  https://threejs.org/examples/webgpu_postprocessing_sobel.html
- Three.js — TSL render pipeline, outline/Sobel/depth/normal operations:  
  https://threejs.org/docs/TSL.html
