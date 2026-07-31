# Lighttable Desktop — High-End GPU Warp Tool & WarpNode Specification

**Status:** Proposed production specification  
**Target:** Lighttable Desktop, WebGPU, TypeScript, layered `rgba16float` render pipeline  
**Scope:** Non-destructive brush-based reshaping with a dedicated GPU node, designed to match or exceed Pixelmator Pro's current reshape workflow and to support a later structured grid/cage warp editor without replacing the backend.

---

## 1. Product goal

Implement a professional **Warp tool mode** that lets a user push, twist, pinch, expand, smooth, protect, and reconstruct local image regions with immediate GPU feedback.

The tool must:

- feel direct at 60–120 Hz;
- remain non-destructive;
- preserve the upstream layer source;
- work as a persistent `WarpNode` in the layer render stack;
- support raster, RAW-derived, text, vector, generated, 3D-rendered, and video layer outputs;
- integrate with selections, masks, layer transforms, undo/redo, serialization, caching, and export;
- remain architecturally compatible with a future grid/cage warp editor;
- avoid cumulative image resampling while editing.

The core is a **dense inverse source-coordinate field**. Conceptually, every output pixel stores a 2D pointer into the upstream layer texture.

```text
output pixel p
    ↓
source coordinate C(p)
    ↓
sample upstream layer at C(p)
```

The GPU field may be stored as displacement:

```text
D(p) = C(p) - p
C(p) = p + D(p)
```

The field is similar to a per-pixel UV map, but uses signed layer-local pixel coordinates internally for precision and predictable scaling.

---

## 2. Competitive baseline

As of Pixelmator Pro 4.0, the current Apple implementation separates two related interaction models:

1. brush-based reshape tools for Distort, Bump, Pinch, and Twirl;
2. a structured Warp tool with a point grid, arbitrary splits, 3×3/4×4/5×5 grids, presets, content-area controls, and content refitting.

Pixelmator's structured Warp also applies to images, shapes, text, and video layers. Lighttable should treat these capabilities as the minimum external benchmark, while differentiating through a single non-destructive render-node architecture, high-quality GPU sampling, pressure support, freeze masks, reconstruction, and a unified brush/grid backend.

### 2.1 Required Lighttable parity

The first production release must include:

- Push/Distort;
- Twirl clockwise and counter-clockwise;
- Pinch;
- Bloat/Bump;
- Smooth;
- Reconstruct;
- Freeze and Thaw masks;
- selections as an influence constraint;
- pressure-sensitive size and strength;
- one-step and progressive application modes;
- live 16-bit compositing;
- persistent non-destructive node;
- per-stroke undo/redo;
- linked layer-mask warping;
- high-quality final rendering.

### 2.2 Required architectural parity for the next release

The `WarpNode` must already allow a second editor frontend with:

- default 3×3, 4×4, and 5×5 grids;
- arbitrary horizontal, vertical, and cross splits;
- point insertion and removal;
- curve/tangent handles;
- common presets such as Arc, Flag, Bulge, Cylinder, Perspective, and Fisheye;
- content-area bounds;
- refit/reparameterize content;
- saved reusable warp templates.

The first brush implementation must not create a dead-end data model that prevents this.

---

## 3. UX and tool-mode behavior

### 3.1 Entry

The user enters the mode through:

```text
Toolbar → Warp
```

On entry:

1. validate the selected layer type;
2. locate an existing enabled `WarpNode` selected for editing;
3. otherwise offer or automatically create a new `WarpNode` at the canonical stack position;
4. initialize or restore the GPU coordinate field;
5. switch the canvas overlay to the Warp interaction controller;
6. show the Warp options panel.

Creation should be immediate and should not rasterize text, vector, video, RAW, or generated content.

### 3.2 Exit

Leaving Warp mode:

- commits the current pointer stroke if one is active;
- keeps the node live and editable;
- releases temporary scratch textures and transient undo resources;
- retains or evicts the authoritative field according to the GPU cache budget;
- does not bake the result unless the user explicitly chooses Rasterize/Apply Permanently.

### 3.3 Subtools

```ts
export type WarpBrushMode =
  | "push"
  | "twirl-cw"
  | "twirl-ccw"
  | "pinch"
  | "bloat"
  | "smooth"
  | "reconstruct"
  | "freeze"
  | "thaw";
```

Suggested shortcuts:

| Subtool | Shortcut |
|---|---:|
| Push | W |
| Twirl CW/CCW | R / Shift+R |
| Pinch | P |
| Bloat | B |
| Smooth | S |
| Reconstruct | E |
| Freeze | F |
| Thaw | Shift+F |

Actual shortcuts must pass through the central Lighttable shortcut registry and remain configurable.

### 3.4 Core controls

Every brush mode should expose only controls that affect it.

Common controls:

- Brush Diameter;
- Strength;
- Hardness;
- Flow/Rate;
- Spacing;
- Pressure → Size;
- Pressure → Strength;
- Stylus Tilt influence, optional;
- Edge Pinning;
- Protect Transparency;
- Selection influence;
- Quality: Auto, Interactive, Full;
- Preview toggle;
- Reset Node;
- Reconstruct All.

Mode-specific controls:

- Push: directional response and velocity scaling;
- Twirl: angular rate and direction;
- Pinch/Bloat: radial rate;
- Smooth: radius and iterations;
- Reconstruct: restoration amount and target checkpoint;
- Freeze/Thaw: mask opacity and hardness.

### 3.5 Brush semantics

Brush diameter is stored in **layer-local pixels**, not screen pixels. The cursor is transformed by zoom so that a 200 px brush always affects 200 source-space pixels.

Optional later preference:

```text
Brush sizing: Layer Pixels | Screen Pixels
```

Default must remain Layer Pixels because it is deterministic across zoom levels, export, replay, and different displays.

### 3.6 Continuous versus stationary tools

Push is driven by pointer movement. Twirl, Pinch, Bloat, Smooth, Reconstruct, Freeze, and Thaw can continue applying while the pointer is stationary.

For stationary tools, the engine emits rate-based stamps:

```text
amount = strength × pressure × elapsedSeconds × toolRate
```

This makes behavior independent of frame rate.

---

## 4. Render-stack integration

### 4.1 Canonical placement

Recommended per-layer order:

```text
Layer Source / Decoder / Generator
    ↓
Source orientation and crop domain
    ↓
WarpNode
    ↓
Per-layer tonal and color adjustments
    ↓
Effects that should follow geometry
    ↓
Linked or unlinked layer mask evaluation
    ↓
Layer transform into document space
    ↓
Opacity / blend mode
    ↓
Document compositor
```

The `WarpNode` operates in **layer-local source space**. Canvas input is transformed through the inverse document and layer transform before becoming a brush sample.

This gives four important properties:

1. rotating or scaling a layer does not alter the stored warp;
2. the pointer maps correctly into the source domain;
3. the source is sampled only once by the warp node;
4. changing upstream text, vector, video, or generated content automatically flows through the same warp.

### 4.2 Mask behavior

A pixel mask can be either linked or unlinked:

- **Linked mask:** sample image and mask through the same coordinate field;
- **Unlinked mask:** warp image content while the mask remains fixed in layer-local output space.

Selections are not permanently embedded into the node unless explicitly converted to a freeze mask. During editing, the active selection multiplies the brush influence.

### 4.3 Alpha behavior

All image sampling must use premultiplied linear alpha internally.

Requirements:

- no dark or bright halos near transparency;
- optionally protect transparent pixels from being pulled into opaque regions;
- support `transparent`, `clamp`, `mirror`, and `extend-edge` boundary modes;
- default to transparent outside the source domain for ordinary layers;
- optionally use edge extension for photo-retouching workflows.

### 4.4 Node bypass and solo

`WarpNode` must implement:

- enabled/bypassed state;
- before/after hold shortcut;
- node-specific solo preview;
- reset to identity;
- temporary low-quality interactive preview;
- node revision number for render-cache invalidation.

---

## 5. Node and document data model

```ts
export interface WarpNodeState extends RenderNodeState {
  readonly type: "warp";
  readonly version: 1;

  enabled: boolean;
  opacity: number;

  domain: WarpDomain;
  field: WarpFieldDescriptor;
  brushHistory: WarpStroke[];
  checkpoints: WarpCheckpointRef[];

  freezeMask?: WarpMaskRef;
  maskLinkMode: "linked" | "unlinked";
  borderMode: WarpBorderMode;
  topologyMode: "artistic" | "protected";
  edgePinning: number;

  structuredWarp?: StructuredWarpState;
  quality: WarpQualitySettings;
}

export interface WarpDomain {
  originPx: readonly [number, number];
  sizePx: readonly [number, number];
  sourceRevision: number;
  coordinateConvention: "top-left-y-down";
}

export interface WarpFieldDescriptor {
  encoding: "displacement-pixels";
  precision: "f32" | "f16-packed";
  resolution: readonly [number, number];
  tileSize: 128 | 256 | 512;
  checkpointRevision: number;
}

export type WarpBorderMode =
  | "transparent"
  | "clamp"
  | "mirror"
  | "extend-edge";
```

### 5.1 Stroke model

```ts
export interface WarpStroke {
  id: string;
  mode: WarpBrushMode;
  settings: WarpBrushSettingsSnapshot;
  samples: WarpInputSample[];
  affectedBoundsPx: RectI;
  affectedTiles: number[];
  startedAtMs: number;
  durationMs: number;
}

export interface WarpInputSample {
  positionPx: readonly [number, number];
  deltaPx: readonly [number, number];
  pressure: number;
  tilt: readonly [number, number];
  timeMs: number;
}
```

Never store raw browser `PointerEvent` objects. Normalize samples at the tool-controller boundary.

### 5.2 Determinism

Stroke replay must be deterministic for the same:

- node version;
- brush settings;
- source-domain dimensions;
- normalized input samples;
- field precision mode.

The exact GPU output can vary at insignificant floating-point levels across vendors, but replay must not visibly diverge.

Brush kernels must therefore avoid random values unless a deterministic seed is stored.

---

## 6. GPU field architecture

### 6.1 Authoritative representation

The canonical field is an **inverse displacement field**:

```text
D(p) = sourcePosition - outputPosition
```

Identity:

```text
D(p) = (0, 0)
```

Render lookup:

```text
sourcePosition = p + D(p)
```

Use layer-local pixel units. Do not use normalized UV values as the authoritative representation because large source images lose practical precision and resizing semantics become less clear.

### 6.2 Texture format strategy

Preferred path:

```ts
format: "rg32float"
```

The implementation must perform adapter capability validation. A portable fallback may use another storage-compatible float format with XY stored in the first two channels.

Because 32-bit float textures are not guaranteed to be filterable on every WebGPU adapter without optional support, the field sampler must provide a manual bilinear path using `textureLoad`. Do not make the implementation dependent on `float32-filterable`.

```ts
export interface WarpGpuCapabilities {
  storageFormat: GPUTextureFormat;
  supportsFloat32Filtering: boolean;
  supportsShaderF16: boolean;
  supportsTimestampQuery: boolean;
  maxTextureDimension2D: number;
}
```

### 6.3 Memory cost

For `rg32float`:

```text
bytes = width × height × 8
```

Examples:

| Resolution | Field memory |
|---:|---:|
| 4000 × 3000 | ~91.6 MiB |
| 6000 × 4000 | ~183.1 MiB |
| 8000 × 6000 | ~366.2 MiB |

A second full-size field would double this. The production architecture must therefore avoid permanent full-image ping-pong textures.

### 6.4 Dirty-region scratch strategy

Use:

- one authoritative full-resolution field;
- one transient scratch texture sized to the current dirty region;
- a storage buffer containing a batch of brush stamps;
- one compute dispatch over the dirty region;
- one texture copy from scratch back into the authoritative field.

```text
Authoritative Field, read-only
        +
Brush Stamp Buffer
        ↓
Compute over Dirty Bounds
        ↓
Dirty Scratch Texture
        ↓
GPU copy into Authoritative Field
```

This avoids:

- a second permanent 90–360 MiB field;
- CPU readback;
- full-frame compute for a local brush;
- read/write hazards on the same storage texture.

### 6.5 Dirty bounds and halo

The CPU calculates the union of stamp influence bounds. The compute pass may sample the previous field outside this rectangle, so the authoritative field remains globally available for reading.

Smooth and reconstruction kernels require a halo:

```text
dispatchBounds = dirtyBounds expanded by sampleRadius
copyBackBounds = dirtyBounds
```

### 6.6 Brush stamp batching

Pointer events are resampled into evenly spaced stamps before upload.

Recommended defaults:

```text
Push spacing:       5–12% of diameter
Twirl spacing:      rate-based plus 8–15% movement spacing
Pinch/Bloat:        rate-based plus 8–15% movement spacing
Smooth/Reconstruct: rate-based
Maximum batch:      32 or 64 stamps
```

One frame can contain several input events. Upload all pending stamps once per render tick.

```ts
export interface WarpGpuStamp {
  centerPx: [number, number];
  deltaPx: [number, number];
  radiusPx: number;
  strength: number;
  hardness: number;
  flow: number;
  pressure: number;
  mode: number;
  elapsedSeconds: number;
}
```

Use a persistently reused mapped staging buffer or queue writes into a preallocated ring buffer. Do not allocate a new GPU buffer for every pointer event.

---

## 7. Correct field composition

A high-end implementation must not simply add a displacement vector to the existing field. Additive accumulation is fast but becomes incorrect for repeated rotations, strong twirls, and large deformations.

For a local inverse brush transform `T⁻¹`, compose the new mapping as:

```text
C_new(p) = C_old(T⁻¹(p))
```

When storing displacement:

```text
q = T⁻¹(p)
source = q + D_old(q)
D_new(p) = source - p
```

WGSL-style pseudocode:

```wgsl
fn compose_inverse_warp(outputPx: vec2<f32>) -> vec2<f32> {
    var q = outputPx;

    // Apply the newest inverse operations in reverse order.
    for (var i = params.stampCount; i > 0u; i--) {
        q = apply_inverse_stamp(q, stamps[i - 1u]);
    }

    let previousDisplacement = sample_field_bilinear(q);
    let originalSource = q + previousDisplacement;

    return originalSource - outputPx;
}
```

This is what allows multiple pushes and twirls to build a coherent vortex without repeatedly resampling the image.

---

## 8. Brush kernels

### 8.1 Shared falloff

```wgsl
fn brush_falloff(distancePx: f32, radiusPx: f32, hardness: f32) -> f32 {
    let t = clamp(distancePx / max(radiusPx, 0.0001), 0.0, 1.0);
    let hardEdge = clamp(hardness, 0.0, 1.0);
    let inner = hardEdge * 0.95;
    return 1.0 - smoothstep(inner, 1.0, t);
}
```

The exact curve should be tuned perceptually. Store a version identifier if later kernel changes could alter replay.

### 8.2 Push / Distort

Push should respond to cursor travel, not just cursor position.

```wgsl
fn inverse_push(p: vec2<f32>, stamp: WarpStamp) -> vec2<f32> {
    let distancePx = distance(p, stamp.centerPx);
    let w = brush_falloff(distancePx, stamp.radiusPx, stamp.hardness);
    let amount = stamp.strength * stamp.flow * stamp.pressure * w;
    return p - stamp.deltaPx * amount;
}
```

Requirements:

- stable under fast pointer motion;
- no gaps due to low input event frequency;
- optional velocity normalization so a fast drag does not become disproportionately strong;
- optional directional smoothing for stylus jitter;
- support a maximum per-stamp displacement clamp.

### 8.3 Twirl

```wgsl
fn inverse_twirl(p: vec2<f32>, stamp: WarpStamp, direction: f32) -> vec2<f32> {
    let local = p - stamp.centerPx;
    let distancePx = length(local);
    let w = brush_falloff(distancePx, stamp.radiusPx, stamp.hardness);
    let angle = -direction
        * stamp.strength
        * stamp.flow
        * stamp.pressure
        * stamp.elapsedSeconds
        * w;

    return stamp.centerPx + rotate2d(local, angle);
}
```

Angular application must be time-based while stationary and path-based while moving.

### 8.4 Pinch and Bloat

```wgsl
fn inverse_radial(p: vec2<f32>, stamp: WarpStamp, direction: f32) -> vec2<f32> {
    let local = p - stamp.centerPx;
    let distancePx = length(local);
    let w = brush_falloff(distancePx, stamp.radiusPx, stamp.hardness);

    let exponent = direction
        * stamp.strength
        * stamp.flow
        * stamp.pressure
        * stamp.elapsedSeconds
        * w;

    let scale = exp2(exponent);
    return stamp.centerPx + local * scale;
}
```

Use a bounded exponential or another smooth positive scale function so the mapping cannot flip solely because the radial scale crosses zero.

### 8.5 Smooth

Smooth operates on the displacement field rather than image pixels.

Recommended implementation:

1. bilateral or edge-agnostic weighted neighborhood average of displacement;
2. blend current displacement toward the average;
3. optionally preserve the low-frequency deformation while removing local ripples;
4. perform 1–4 separable iterations depending on strength.

```text
D_new = mix(D_old, blur(D_old), amount)
```

A displacement-domain bilateral option can later preserve strong deformation boundaries.

### 8.6 Reconstruct

Two modes:

- **Reconstruct to Identity:** blend displacement toward `(0, 0)`;
- **Reconstruct to Checkpoint:** blend toward a selected checkpoint field.

```text
D_new = mix(D_current, D_target, amount)
```

`Reconstruct All` should animate or preview the reset but commit as one undoable command.

### 8.7 Freeze and Thaw

Freeze writes to a separate one-channel influence mask.

```text
finalBrushInfluence =
    brushFalloff
    × activeSelection
    × (1 - freezeMask)
    × transparencyProtection
    × edgePinning
```

Recommended GPU mask format:

```ts
format: "r8unorm"
```

Freeze and Thaw strokes are undoable and serialized independently of deformation strokes.

---

## 9. Topology and stability

Extreme warps can create strong compression, foldovers, or local inversion. These are valid for artistic work, but the tool should offer two behaviors.

### 9.1 Artistic mode

- permits foldovers and extreme twirls;
- only clamps non-finite values and absurd coordinates;
- matches the expressive behavior expected from liquify tools.

### 9.2 Protected mode

- dampens a stamp when the local coordinate Jacobian approaches a configured minimum determinant;
- optionally performs a local relaxation pass;
- reduces tearing and accidental singularities;
- is suitable for facial and product retouching.

Approximate local Jacobian:

```text
J = ∂C / ∂p
```

The implementation does not need a mathematically perfect diffeomorphic solver in the first release. A practical finite-difference estimate and adaptive strength reduction are sufficient.

### 9.3 Edge pinning

Edge pinning gradually reduces influence near the warp domain boundary.

```text
edgeWeight = smoothstep(0, pinDistance, distanceToBoundary)
```

Controls:

- Off;
- Soft;
- Strong;
- custom 0–100% slider.

This prevents the outer image rectangle from collapsing when adjusting interior regions.

---

## 10. Render sampling and image quality

### 10.1 Interactive path

During active dragging:

- sample the displacement field manually bilinear if needed;
- sample the upstream image bilinear;
- use source mipmaps where available;
- run only at viewport-required resolution when the document is heavily zoomed out;
- keep the coordinate field authoritative at full resolution inside touched regions;
- allow temporary dynamic-resolution rendering without changing node data.

### 10.2 Final path

When the stroke ends, the user pauses, or export occurs:

- render full resolution;
- use gradient-aware LOD selection;
- use high-quality reconstruction filtering;
- sample in linear premultiplied alpha;
- preserve 16-bit float pipeline precision.

Recommended quality levels:

```ts
export type WarpSamplingQuality =
  | "interactive-bilinear"
  | "high-bicubic"
  | "ultra-ewa";
```

Suggested policies:

- Interactive: bilinear, 1 source sample plus field samples;
- High: bicubic/Catmull–Rom, approximately 16 taps;
- Ultra: elliptical weighted average or anisotropic approximation for extreme local compression.

### 10.3 Derivatives and mip selection

The source coordinate field can produce large local minification. Compute source-coordinate derivatives in the fragment shader:

```wgsl
let sourceUv = sourcePx / sourceSize;
let ddx = dpdx(sourceUv);
let ddy = dpdy(sourceUv);
```

Use gradient-aware texture sampling when supported by the current render path. Mipmaps must be generated in linear premultiplied color.

### 10.4 Field upsampling

If preview uses a lower-resolution field representation, never directly treat it as the final field. Upsampling must be smooth and should preserve large displacement gradients. Full-quality finalization must update or reconstruct the full-resolution field.

---

## 11. Performance architecture

### 11.1 No CPU readback during interaction

The pointer-to-preview loop must contain no GPU-to-CPU readback.

Allowed CPU work per frame:

- normalize pointer samples;
- resample brush path;
- calculate dirty bounds;
- write stamp parameters;
- encode compute/render commands;
- update UI state.

### 11.2 Resource reuse

Preallocate and reuse:

- stamp storage buffer ring;
- uniform buffers;
- bind groups where resource identities are stable;
- common pipelines per subtool;
- dirty scratch texture buckets;
- undo tile atlas pages.

Scratch texture bucket sizes can be powers of two:

```text
128, 256, 512, 1024, 2048, 4096
```

Reuse the smallest bucket that contains the dirty rectangle.

### 11.3 Workgroup sizing

Start with:

```wgsl
@compute @workgroup_size(8, 8, 1)
```

Benchmark `8×8`, `16×8`, and `16×16` per adapter family. Do not assume one workgroup size is optimal across Apple, NVIDIA, AMD, and Intel GPUs.

### 11.4 Pipeline variants

Use shader overrides or a small controlled set of pipeline variants for:

- field format;
- brush mode family;
- selection present/absent;
- freeze mask present/absent;
- topology protection enabled/disabled;
- quality tier.

Avoid an unbounded pipeline permutation matrix.

### 11.5 GPU timing and diagnostics

When timestamp queries are available, record:

- field update compute time;
- scratch copy time;
- render sampling time;
- full-quality settle render time.

Expose these only in the internal performance HUD.

### 11.6 Target budgets

Primary target at 4000×3000 source resolution and a 2560×1600 viewport:

- pointer-to-preview latency: under 20 ms;
- normal brush frame: 60 fps minimum on a modern midrange discrete GPU or Apple Silicon Pro-class GPU;
- high-end GPU: 120 fps where display and compositor allow;
- no full-document recompute for a local brush stroke;
- under 2 ms CPU-side tool processing per frame;
- stroke-end full-quality settle: typically under 100 ms for ordinary brush bounds;
- no visible pause when entering an existing node already cached in GPU memory.

Performance must be measured on Windows/NVIDIA, macOS/Apple Silicon, and Linux/AMD or Intel where WebGPU is supported.

---

## 12. GPU memory and caching

### 12.1 Active node

While editing, keep resident:

- authoritative coordinate field;
- optional freeze mask;
- current upstream source texture or render target;
- temporary dirty scratch;
- transient GPU undo tiles;
- viewport output.

### 12.2 Inactive static node

For a static raster source:

- cache the warped output texture;
- allow eviction of the coordinate field under memory pressure;
- retain compressed CPU/disk checkpoints and stroke history;
- restore asynchronously when the node is edited again.

### 12.3 Dynamic source node

For text, vector, generated, procedural, 3D, or video content that can change upstream:

- keep or rapidly restore the field;
- apply the same map to each new upstream frame;
- invalidate only the warped output, not the warp field;
- never replay strokes for every video frame.

### 12.4 Cache priority

Suggested eviction priority:

1. scratch textures;
2. old redo resources;
3. inactive output caches outside the viewport;
4. inactive Warp fields with a valid compressed checkpoint;
5. upstream source caches that can be regenerated.

Never silently discard document-authoritative data.

---

## 13. Undo, redo, and checkpoints

### 13.1 One command per stroke

A pointer-down to pointer-up sequence is one history command.

```ts
interface WarpStrokeCommand extends HistoryCommand {
  nodeId: string;
  strokeId: string;
  affectedTiles: number[];
  beforeTiles?: GpuUndoTileRef[];
  replayData: WarpStroke;
}
```

### 13.2 Fast immediate undo

Use copy-on-first-write per touched tile:

1. divide the coordinate field into logical 256×256 tiles;
2. before the stroke first modifies a tile, copy that tile into a GPU undo atlas;
3. continue updating the authoritative field;
4. undo copies saved tiles back;
5. redo replays the stroke or restores redo tiles.

This avoids snapshotting the entire 90–360 MiB field per stroke.

### 13.3 Persistent checkpoints

Create a compressed checkpoint after:

- a configurable number of strokes, such as 20–50;
- a command-log byte threshold;
- explicit save;
- node deactivation under memory pressure.

Checkpoint encoding:

- tile-based;
- skip identity tiles;
- quantize only when visual error stays below tolerance;
- compress with a fast native codec available to the Electron desktop layer;
- version the encoding.

On load:

1. restore nearest checkpoint;
2. upload only non-identity tiles or reconstruct a dense field;
3. replay later strokes on GPU.

### 13.4 History editing

Deleting or reordering an old warp stroke is not required for the first UI release, but the storage model should allow rebuilding from a prior checkpoint.

---

## 14. Serialization and project persistence

The project file stores:

- node settings;
- brush history;
- freeze/thaw history or freeze-mask checkpoint;
- structured warp state when present;
- checkpoint references;
- content-domain metadata;
- format and kernel versions.

Do not serialize WebGPU handles.

Suggested package layout:

```text
project/
  document.json
  resources/
    warp/<node-id>/
      checkpoint-0004.json
      field-tile-0004-0012.bin.zst
      field-tile-0004-0013.bin.zst
      freeze-mask-0002.bin.zst
```

Saving must be asynchronous and crash-safe:

1. write new resource files to temporary names;
2. flush;
3. update project manifest;
4. atomically replace the prior manifest;
5. remove obsolete resources later.

---

## 15. Structured grid/cage warp extension

The brush tool and structured Warp editor should share the same `WarpNode`, but maintain separate editable components:

```ts
interface StructuredWarpState {
  mode: "grid" | "cage";
  domain: RectF;
  points: WarpControlPoint[];
  horizontalSplits: number[];
  verticalSplits: number[];
  preset?: WarpPresetId;
  contentArea?: RectF;
  refitMode: "none" | "fit" | "preserve-density";
}
```

### 15.1 Unified output mapping

The node's final coordinate mapping is conceptually:

```text
C_final = C_brush ∘ C_structured
```

Implementation options:

1. rasterize the structured deformation into the same inverse coordinate field, then compose brush detail;
2. render structured warp through a dense tessellated mesh and apply the brush field as a second source-coordinate step;
3. cache a combined field when the structured editor is not actively moving.

Recommended production direction:

- store grid/cage parameters analytically;
- rasterize their inverse source coordinates into a GPU field on change;
- compose the persistent brush-detail field afterward;
- cache the combined field for rendering.

This allows a user to create broad shape deformation with a grid and then add local brush detail without baking either operation.

### 15.2 Content area and refit

Content-area controls define which upstream rectangle should fill the warp domain. Refit recalculates parameterization after grid splits or domain changes to reduce uneven stretching.

The content area is metadata, not a destructive crop.

---

## 16. TypeScript architecture

```ts
export interface WarpToolController extends EditorToolController {
  readonly id: "warp";

  enter(context: WarpToolContext): Promise<void>;
  leave(reason: ToolLeaveReason): Promise<void>;

  pointerDown(event: NormalizedPointerEvent): void;
  pointerMove(event: NormalizedPointerEvent): void;
  pointerUp(event: NormalizedPointerEvent): void;
  pointerCancel(event: NormalizedPointerEvent): void;

  setMode(mode: WarpBrushMode): void;
  setSettings(patch: Partial<WarpBrushSettings>): void;
  resetNode(): Promise<void>;
}

export interface WarpNodeRuntime extends RenderNodeRuntime<WarpNodeState> {
  ensureFieldResident(context: GpuRenderContext): Promise<void>;
  applyStamps(batch: WarpStampBatch): void;
  render(input: RenderTexture, context: NodeRenderContext): RenderTexture;
  settleQuality(bounds?: RectI): void;
  createCheckpoint(reason: CheckpointReason): Promise<WarpCheckpointRef>;
  releaseTransientResources(): void;
}

export interface WarpFieldStorage {
  readonly resolution: readonly [number, number];
  readonly format: GPUTextureFormat;

  ensureResident(): Promise<void>;
  getSampledView(): GPUTextureView;
  applyBatch(batch: WarpStampBatch): void;
  restoreTiles(tiles: readonly WarpTileSnapshot[]): void;
  checkpoint(): Promise<WarpCheckpointRef>;
  evict(): Promise<void>;
  dispose(): void;
}
```

Recommended implementations:

```text
DenseWarpFieldStorage       // first production backend
TiledCheckpointStore        // undo and persistence
SparseWarpFieldStorage      // later, only if profiling justifies runtime indirection
```

Do not begin with a sparse GPU page-table implementation unless memory profiling proves it necessary. A dense sampled field is simpler and generally faster during active rendering.

---

## 17. Command and render flow

### 17.1 Pointer frame

```text
Pointer events
    ↓
Canvas → layer-local coordinate transform
    ↓
Input smoothing and pressure normalization
    ↓
Path resampling into stamps
    ↓
Accumulate stamps until animation frame
    ↓
Calculate dirty bounds and touched tiles
    ↓
Capture first-write undo tiles
    ↓
Dispatch Warp field compute
    ↓
Copy dirty scratch into authoritative field
    ↓
Increment WarpNode GPU revision
    ↓
Invalidate only affected viewport region when possible
    ↓
Render compositor preview
```

### 17.2 Stroke end

```text
Flush final stamps
    ↓
Finalize one history command
    ↓
Schedule full-quality settle render
    ↓
Optionally generate/update field mip or derived cache
    ↓
Release temporary stroke buffers
```

### 17.3 Document render

```text
Resolve upstream node texture
    ↓
WarpNode samples coordinate field
    ↓
Sample upstream image using selected quality
    ↓
Return rgba16float output
    ↓
Continue layer stack
```

---

## 18. Error handling and device loss

### 18.1 WebGPU device loss

On device loss:

- stop accepting field mutation;
- preserve normalized pending stroke data on CPU;
- discard invalid GPU handles;
- recreate pipelines and resources after device recovery;
- restore the field from the latest checkpoint;
- replay later committed strokes;
- replay or cancel the in-progress stroke consistently;
- show a non-destructive recovery status, not a generic crash.

### 18.2 Allocation failure

If the full-resolution field cannot be allocated:

1. evict lower-priority GPU caches;
2. retry;
3. offer adaptive field resolution with a clear quality indicator;
4. never silently rasterize or flatten the layer;
5. preserve strokes so full quality can be reconstructed later on a capable device.

### 18.3 Source-domain changes

When the upstream source dimensions change:

- preserve the node when the change is a simple scale or resolution increase;
- resample displacement in normalized domain while scaling vector magnitudes appropriately;
- require user confirmation for incompatible crop/domain changes;
- support `Fit Warp to New Content` and `Keep Absolute Pixel Warp` policies.

---

## 19. Testing strategy

### 19.1 Unit tests

- coordinate transforms between document, layer, field, and source space;
- brush path resampling;
- pressure normalization;
- dirty-bounds union and clipping;
- stroke serialization/versioning;
- checkpoint selection;
- source-domain resize policies;
- deterministic command replay metadata.

### 19.2 GPU correctness tests

Use small synthetic fields with known expected output:

- identity mapping;
- constant translation;
- radial pinch;
- radial bloat;
- 90° analytical twirl;
- repeated push composition;
- two opposite strokes restoring approximately to identity;
- boundary handling;
- linked versus unlinked mask;
- premultiplied-alpha edges;
- freeze-mask exclusion;
- selection exclusion;
- manual bilinear field sampling.

Compare GPU output against a CPU reference with explicit tolerance.

### 19.3 Visual regression tests

Canonical images:

- checkerboard and UV grid;
- human face;
- fabric/product mock-up;
- transparent logo;
- thin line art;
- high-frequency texture;
- 16-bit gradient;
- text and vector content;
- video frame sequence.

Store both field visualization and final rendered output.

### 19.4 Stress tests

- 1,000 sequential strokes;
- 10 minutes continuous twirl;
- 8K source;
- 20 active Warp nodes;
- extreme zoom in/out while painting;
- rotate/scale layer during active node session;
- undo/redo spam;
- save while field updates are queued;
- GPU memory pressure;
- device loss and recovery;
- long video playback through a live Warp node.

### 19.5 Cross-vendor test matrix

At minimum:

- NVIDIA/Windows;
- AMD/Windows or Linux;
- Intel integrated/Windows or Linux;
- Apple Silicon/macOS.

All fallback format and manual filtering paths must be exercised in CI or dedicated hardware testing.

---

## 20. Acceptance criteria

### 20.1 Functional

- User can create and edit a persistent Warp node without rasterizing the layer.
- Push, Twirl, Pinch, Bloat, Smooth, Reconstruct, Freeze, and Thaw work.
- Multiple twirls and pushes compose correctly rather than behaving as simple additive offsets.
- Selection and freeze masks constrain deformation.
- Linked masks follow the warp; unlinked masks remain fixed.
- Undo/redo is one command per stroke and feels immediate.
- Node survives save/load with visually identical output.
- Text, vector, and video source changes remain live through the warp.
- Bypass and before/after preview are instant.

### 20.2 Quality

- No cumulative blur from editing strokes.
- No alpha halos on transparent content.
- High-quality mode remains clean under strong local minification.
- Identity node output is pixel-equivalent to bypass within render-pipeline tolerance.
- Reconstruct to identity returns a visually exact or near-exact original mapping.

### 20.3 Performance

- Local strokes dispatch only their dirty bounds.
- No CPU readback occurs during interaction.
- A 12 MP image is comfortably interactive on the target hardware class.
- GPU memory is released according to cache policy after leaving the tool.
- Long histories do not require replay from stroke zero during normal editing.

### 20.4 Architecture

- Warp is a real render node, not an overlay-owned destructive effect.
- Tool controller, node state, GPU runtime, persistence, and UI are separately testable.
- The node can accept a future structured grid/cage frontend.
- No Pixelmator-specific assumptions leak into the generic render graph.

---

## 21. Recommended implementation phases

### Phase 1 — Field prototype

- identity field;
- full-resolution dense field;
- manual bilinear field sampler;
- Push brush;
- dirty scratch compute;
- basic render-node sampling;
- visual field debug mode.

**Exit condition:** repeated pushes remain sharp and compose correctly at 4K.

### Phase 2 — Production brush engine

- path resampling;
- batching;
- Twirl, Pinch, Bloat;
- pressure and rate semantics;
- Smooth and Reconstruct;
- selection and freeze masks;
- linked mask handling;
- per-stroke undo tiles.

**Exit condition:** complete high-quality reshape workflow at 60 fps target.

### Phase 3 — Persistence and resilience

- checkpoint format;
- project save/load;
- cache eviction and restoration;
- device-loss recovery;
- source-domain changes;
- cross-vendor fallbacks.

**Exit condition:** production-safe editable nodes across sessions.

### Phase 4 — Quality and topology

- gradient-aware mip selection;
- bicubic and EWA quality modes;
- protected topology mode;
- adaptive performance HUD;
- detailed visual regression suite.

**Exit condition:** strong twirls and product warps remain visually clean.

### Phase 5 — Structured Warp editor

- grid/cage UI;
- splits and point insertion;
- presets;
- content area and refit;
- rasterized inverse coordinate field;
- composition with brush-detail field.

**Exit condition:** matches the current structured Warp capability expected from Pixelmator-class software while remaining fully non-destructive.

---

## 22. Initial implementation decisions

These should be treated as the default unless profiling or device validation disproves them:

1. Use a dense inverse displacement field in layer-local pixel coordinates.
2. Prefer `rg32float`; detect capabilities and provide a storage-format fallback.
3. Use manual bilinear field sampling unless float32 filtering is explicitly available.
4. Keep one authoritative full field and one dirty-region scratch texture.
5. Batch 32–64 stamps per compute dispatch.
6. Compose mappings as `C_new(p) = C_old(T⁻¹(p))`; never rely on additive displacement for the production result.
7. Keep source imagery immutable and sample it only during render.
8. Use per-tile copy-on-first-write undo and periodic compressed checkpoints.
9. Render interactively with bilinear sampling and settle/export with gradient-aware high-quality filtering.
10. Place `WarpNode` in layer-local space before per-layer color adjustments and document-space transform.
11. Keep brush and future structured warp as two editors over one generic node architecture.
12. Implement dense runtime storage first; add sparse GPU indirection only when real memory profiling justifies the complexity.

---

## 23. Debug and developer tooling

Provide an internal Warp debug overlay with:

- displacement field visualized as RG flow colors;
- arrow grid at configurable spacing;
- coordinate grid preview;
- Jacobian determinant heatmap;
- dirty rectangle;
- active workgroup bounds;
- touched undo tiles;
- field residency and memory use;
- compute and render GPU timings;
- source mip level visualization;
- foldover indicator;
- current node and source revision.

This tooling is essential. Warp failures are otherwise difficult to distinguish between coordinate-space errors, field-composition errors, filtering artifacts, and cache invalidation bugs.

---

## 24. Reference baseline

Official product baseline consulted for this specification:

- Apple, **Pixelmator Pro 4.0 release notes**, published June 30, 2026.
- Apple Pixelmator Pro User Guide, **Reshape areas of an image**.
- Apple Pixelmator Pro User Guide, **Warp a layer**.
- W3C, **WebGPU Specification**.
- W3C, **WebGPU Shading Language Specification**.

The architectural design in this document is a proposed Lighttable implementation and is not a claim about Pixelmator's private internal implementation.
