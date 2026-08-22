# Vello Research & Integration Advice for LightTable

## Status

**Goal:** investigate Vello seriously as a high-performance vector rendering backend and use the result to improve LightTable's complete vector stack.

**Important:** this is **not** a mandate to replace everything LightTable already has with Vello.

The desired outcome is a **best-of-both-worlds rendering architecture**:

- retain LightTable-native paths where they are faster, simpler, more precise, or better suited to editor interaction;
- adopt Vello where its architecture, algorithms, scalability, SVG/vector support, text rendering, or GPU compute approach is materially better;
- improve our own renderer where that is the better solution;
- remove unnecessary coupling between the document model and any one renderer;
- make the final choice from measurements and correctness, not from sunk cost or assumptions.

---

# 1. Core instruction

Do **not** approach this as:

> "Can we bolt Vello onto the existing renderer?"

And do not approach it as:

> "We already have a renderer, therefore we should only borrow ideas from Vello."

Instead ask:

> **What should the ideal LightTable vector rendering stack look like if we are allowed to keep the best parts of our existing renderer, use Vello for the parts it does significantly better, and redesign the boundary between the two?**

That may result in:

- a substantially improved LightTable-native backend;
- a Vello backend;
- specialized native overlay/gizmo rendering;
- separate text shaping/layout and text rasterization paths;
- hybrid scene routing;
- or, if measurements prove it is best, a future Vello-first document vector backend.

The architecture must leave these choices open.

---

# 2. Do not prematurely reject Vello because of the GPU device question

A previous conclusion was roughly:

> "Do not integrate Vello because it would mean a second Rust/wgpu device."

That is **not yet a proven conclusion**.

Vello's public integration model accepts a caller-provided `wgpu::Device` and `wgpu::Queue` and renders to a caller-provided `wgpu::Texture`.

The real LightTable-specific uncertainty is:

```text
TypeScript / Electron
      |
      | navigator.gpu / GPUDevice
      v
Browser WebGPU implementation
      ^
      |
      | Rust WASM / wgpu interoperability ?
      |
Vello
```

The question is therefore not:

> "Does Vello require its own device?"

The question is:

> **Can our Electron/Chromium WebGPU device and resources be shared or interoperated with cleanly from Rust/WASM/wgpu, without CPU readback or GPU-to-CPU-to-GPU copies?**

This must be established experimentally.

Do not architect Vello out before this has been measured.

---

# 3. Run two tracks in parallel

## Track A - aggressively improve the current LightTable renderer

This is valuable regardless of whether Vello is adopted.

The current renderer should be investigated and optimized around:

- scene-level command encoding;
- persistent GPU buffers;
- persistent scene state;
- minimizing render passes;
- minimizing WebGPU state changes;
- minimizing buffer uploads;
- minimizing allocations;
- dirty-object updates;
- dirty-region rendering where applicable;
- stable draw-order preservation;
- cached geometry where possible;
- batching where it does not change semantics;
- reduced JS-side traversal and command generation;
- reduced CPU tessellation/rebuilding;
- pipeline reuse;
- shader/pipeline warm-up strategy.

A proposed "whole vector layer in one WebGPU render pass" optimization is a good idea **if it preserves exact rendering semantics**.

It should be implemented and benchmarked.

But do not confuse:

```text
fewer render passes / fewer draw commands
```

with:

```text
a fundamentally more scalable vector rasterization architecture
```

They solve different classes of bottleneck.

---

## Track B - investigate Vello as a real backend

Vello should be tested as an actual renderer, not only read for inspiration.

The experiment should answer:

1. Can it coexist with our current WebGPU architecture?
2. Can it render into GPU resources that our compositor can consume without readback?
3. What does the JS/WASM boundary cost?
4. What is the cold-start cost?
5. What is the steady-state cost?
6. How does it behave on small, medium, large and pathological vector scenes?
7. How expensive are scene mutations?
8. How expensive are transforms-only updates?
9. How good is SVG coverage in the ecosystem?
10. How useful is its text/glyph path for LightTable?
11. Which current LightTable rendering features are superior and should remain native?
12. Which Vello algorithms or subsystems materially outperform ours?

The goal is not to force Vello into the product.

The goal is to make it possible for Vello to **earn its place by measurement**.

---

# 4. First requirement: profile the current renderer properly

Before large architectural changes, produce a representative heavy document and break frame time down into identifiable stages.

At minimum measure:

```text
Document traversal
Scene generation
Path parsing
Bezier flattening
Stroke construction
Tessellation / triangulation
Clip generation
Text shaping
Glyph lookup
Glyph geometry generation
CPU allocations
CPU copies
GPU buffer construction
GPU buffer uploads
Bind group creation/update
Command encoding
Render pass count
Draw call count
Compute pass count
GPU execution
Compositing
Final display pass
```

Add counters for:

```text
vector object count
path count
segment count
glyph count
unique glyph count
clip count
gradient count
GPU bytes uploaded/frame
CPU bytes allocated/frame
draw calls/frame
render passes/frame
pipelines used/frame
```

A useful example breakdown:

```text
Document traversal        2.0 ms
Path processing          24.0 ms
Stroke tessellation      13.0 ms
GPU uploads              10.0 ms
Command encoding          8.0 ms
GPU rendering             4.0 ms
Composite                 1.0 ms
--------------------------------
Total                    62.0 ms
```

In this case, reducing render passes alone does not solve the core issue.

Another scene may show:

```text
Path processing           3.0 ms
GPU uploads               2.0 ms
Command encoding         25.0 ms
GPU rendering             5.0 ms
```

There, scene-level command encoding may be transformative.

**Do not optimize blind.**

---

# 5. Introduce a renderer-neutral Vector Scene IR

This is the most important architectural recommendation.

LightTable's document model should not become a Vello model.

Avoid structures like:

```ts
class VectorShape {
    velloPath: VelloPath;
}
```

Instead define a LightTable-owned renderer-neutral intermediate representation.

Example direction:

```ts
interface VectorScene {
    nodes: VectorNode[];
}

interface VectorNode {
    id: number;
    transform: Matrix3x2;
    opacity: number;
    blendMode: BlendMode;
    clipId?: number;
    content: VectorContent;
}

type VectorContent =
    | PathContent
    | TextContent
    | ImageContent
    | GroupContent;

interface PathContent {
    geometry: PathGeometry;
    fill?: FillStyle;
    stroke?: StrokeStyle;
    fillRule: FillRule;
}
```

The real representation should be designed around LightTable's needs, not this example literally.

Critical properties:

- LightTable owns it;
- deterministic;
- renderer-independent;
- preserves ordering;
- preserves fill/stroke semantics;
- preserves clips/masks where required;
- supports stable object IDs;
- supports dirty updates;
- supports text runs;
- supports future SVG/AI/EPS/PDF import adaptation;
- supports multiple rendering backends.

---

# 6. Backend model

Target a structure conceptually like:

```text
                   LightTable Document
                          |
                          v
                   Vector Scene IR
                          |
            +-------------+-------------+
            |             |             |
            v             v             v
      LT WebGPU       Vello Backend   Future backend
       Backend                         / reference
            |             |
            +------+------+
                   |
                   v
              GPU textures
                   |
                   v
          LightTable compositor
                   |
                   v
       masks / layers / grade / display
```

An interface may conceptually contain operations such as:

```ts
interface VectorRenderBackend {
    createScene(sceneId: number): void;
    applyChanges(sceneId: number, changes: VectorSceneChange[]): void;
    render(sceneId: number, target: GPUTexture, options: RenderOptions): void;
    destroyScene(sceneId: number): void;
}
```

Do not freeze the interface until both the current renderer and Vello path have been investigated.

The interface must be designed from the needs of **both** backends.

---

# 7. Preserve native LightTable fast paths

Do not route every vector-looking thing through a heavyweight document vector renderer.

LightTable has highly dynamic editor overlays that may be better implemented directly in WebGPU.

Examples:

- transform gizmos;
- selection boxes;
- Bezier handles;
- anchor points;
- guides;
- rulers;
- snapping indicators;
- brush cursors;
- crop overlays;
- debug overlays;
- temporary interaction previews;
- simple rect/circle/line overlays.

These should be benchmarked separately.

A likely architecture is:

```text
Document vector content -> Vello or LT vector backend
Editor overlays         -> LT native WebGPU overlay renderer
UI labels               -> specialized glyph-atlas renderer
Raster content          -> existing raster pipeline
```

For overlays, the ideal path is often approximately:

```text
pointer event
   -> tiny transform/uniform update
   -> GPU draw
```

rather than:

```text
pointer event
   -> JS scene rebuild
   -> WASM call
   -> Vello scene mutation
   -> general vector render
```

Do not sacrifice interaction latency merely for architectural uniformity.

---

# 8. Treat text as multiple problems

Do not force document typography and editor overlay labels through exactly the same path.

## 8.1 Document text

For real document text, research the Linebender text ecosystem in addition to Vello:

- Parley for rich text layout;
- font shaping / BiDi / OpenType handling;
- glyph run generation;
- Vello/Glifo glyph rendering and caching;
- variable fonts;
- ligatures;
- kerning;
- CJK;
- Arabic/RTL;
- text on path;
- vertical text if required later.

Conceptual path:

```text
Text object
   -> font selection
   -> shaping
   -> layout
   -> glyph runs
   -> glyph cache
   -> vector/glyph renderer
```

Text layout must not be treated as a GPU rasterizer responsibility.

## 8.2 Overlay/UI text

For gizmos and labels such as:

```text
W: 1248 px
H: 720 px
32.5 deg
```

investigate a cheap cached glyph atlas + instanced quad renderer.

That may outperform a general vector renderer by a large margin for this use case.

---

# 9. Persistent scenes and incremental updates

A key target should be:

> editing one object in a 50,000-object document must not require reconstructing and re-uploading all 50,000 objects.

Separate:

```text
Document state
```

from:

```text
Compiled render scene
```

Conceptually:

```text
Document tree
    |
    v
change detection
    |
    v
Vector Scene IR
    |
    v
persistent backend scene
    |
    +-- update object 173 only
    +-- update affected clips only
    +-- update affected glyph run only
    +-- update affected buffers only
```

Investigate whether the current renderer and Vello each support or can be adapted to efficient persistent scene updates.

For each backend measure separately:

- full scene creation;
- single transform mutation;
- single path mutation;
- fill/stroke mutation;
- text mutation;
- one object added/removed;
- group transform;
- clip change.

---

# 10. Minimize JS <-> WASM traffic

A Vello integration can fail performance-wise even if the renderer itself is fast if the boundary is poorly designed.

Avoid per-path or per-segment JS/WASM calls.

Bad:

```text
for every frame
    for every object
        JS -> WASM
            for every path command
                JS -> WASM
```

Prefer a persistent Rust-side render scene with batched changes.

Conceptually:

```ts
renderer.beginUpdate(sceneId);
renderer.updateTransform(id, matrix);
renderer.updatePath(id, packedPathData);
renderer.updatePaint(id, paint);
renderer.endUpdate(sceneId);
```

Or use compact shared/batched memory representations if they prove faster.

Research:

- typed-array transfer cost;
- copying vs shared memory;
- serialization cost;
- stable IDs;
- command buffers;
- mutation batching;
- WASM memory reuse;
- zero-allocation hot paths.

---

# 11. GPU interoperability spike

This is the highest-risk Vello integration question and should be proven early.

Build a minimal isolated experiment that does only this:

```text
LightTable / Electron / TypeScript
          |
          | WebGPU
          v
      GPU device
          |
          v
Rust/WASM + wgpu + Vello
          |
          | render vector scene
          v
      GPU texture
          |
          v
LightTable existing compositor
```

Acceptance target:

```text
NO GPU readback
NO CPU image transfer
NO PNG/ImageBitmap intermediate
NO GPU -> CPU -> GPU copy
```

Measure:

- device/resource creation;
- target texture interoperability;
- synchronization;
- render latency;
- copy count;
- memory use;
- texture format constraints;
- resize behavior;
- device-loss behavior.

If the exact same resource sharing is impossible, investigate alternatives before rejecting Vello:

- compatible imported/external WebGPU resources;
- a unified Rust-owned wgpu device with a bridge to the rest of LightTable;
- moving more of the final vector/compositor boundary into one side;
- shared native module architecture in Electron instead of browser WASM;
- another zero-copy texture hand-off strategy.

The agent should **design the best solution for LightTable**, not stop at the first integration inconvenience.

---

# 12. Vello research targets

Study the implementation, not only the public API.

Focus on:

- scene encoding;
- path representation;
- GPU prefix-sum strategy;
- clipping architecture;
- tiling/binning;
- stroke handling;
- antialiasing;
- memory allocation strategy;
- compute dispatch structure;
- resource lifetime;
- text/glyph architecture;
- glyph caching;
- scene reuse;
- CPU/GPU work split;
- Vello Classic vs newer/hybrid paths where applicable;
- WebGPU limitations;
- WASM-specific cost;
- browser Chrome/Electron behavior;
- shader compilation and warm-up.

Do not copy algorithms blindly.

For each important Vello technique, ask:

1. Is Vello already better enough that we should use Vello directly?
2. Is this technique useful in our native backend?
3. Does our current renderer already have a better fast path?
4. Can the two coexist?

---

# 13. SVG stack research

Vello has a separate `vello_svg` integration, and the wider Linebender ecosystem contains `usvg` / `resvg`.

Investigate a pipeline such as:

```text
SVG
  -> usvg normalization
  -> LightTable Vector Scene IR
  -> Vello or LT backend
```

This is preferable to coupling the LightTable document model directly to a Vello SVG representation.

Also consider `resvg` as:

- a correctness/reference renderer;
- SVG parser/normalizer ecosystem;
- regression oracle;
- fallback for unsupported SVG edge cases if appropriate.

The long-term import architecture should make future formats possible:

```text
SVG -----+
AI ------+
EPS -----+--> importer/normalizer --> LightTable Vector IR
PDF -----+
          |
          +--> renderer backend
```

Do **not** start implementing AI/EPS now unless required for the Vello investigation.

Design today's interfaces so those importers do not require another architectural rewrite later.

---

# 14. Rendering correctness is non-negotiable

Performance optimizations may not change visual or document semantics unless explicitly accepted as a different rendering mode.

Preserve:

- path order;
- fill rule;
- fill before/after stroke semantics as defined by LightTable;
- stroke width;
- joins;
- caps;
- miter limits;
- dashes;
- opacity;
- blend modes;
- transforms;
- clip stacks;
- masks;
- gradients;
- color space assumptions;
- compositing order;
- text positioning;
- antialiasing quality targets.

Do not perform geometry union merely to reduce draw calls if it changes semantics or editability.

Do not mutate the document just to optimize rendering.

Rendering caches and compiled scene representations are allowed and encouraged.

---

# 15. Build a renderer bake-off

Create one benchmark harness that can render the **same logical Vector Scene IR** using multiple backends.

At minimum:

```text
Current LightTable renderer
Optimized LightTable renderer
Vello backend
```

Optionally use a reference CPU renderer for correctness comparisons.

The backend should be selectable in development builds.

Example:

```text
Renderer:
[x] LT Legacy
[ ] LT Scene/Batched
[ ] Vello
```

Display live statistics.

---

# 16. Benchmark corpus

Do not benchmark only one giant SVG.

Create synthetic and real-world scenes.

## Geometry

```text
1k paths
10k paths
100k paths
1M path segments
```

Test:

- simple polygons;
- cubic Beziers;
- quadratic Beziers;
- highly curved geometry;
- tiny segments;
- huge paths;
- many small paths;
- few extremely large paths.

## Strokes

Test:

- thick/thin;
- round/bevel/miter joins;
- round/butt/square caps;
- dashed paths;
- extreme zoom;
- animated stroke width if applicable.

## Paint

Test:

- flat fills;
- many unique colors;
- gradients;
- transparency;
- overlapping translucent shapes;
- nested clipping.

## Real SVG

Include at least:

- Ghostscript Tiger;
- Paris-30k style complex vector scene;
- complex icon sets;
- exported Illustrator-style SVGs;
- SVGs with nested transforms and clips;
- SVG text where supported.

## Text

Test:

- 100 glyphs;
- 5,000 glyphs;
- 50,000 glyphs;
- repeated glyphs;
- many fonts;
- variable fonts;
- Latin;
- Arabic/RTL;
- CJK;
- ligatures;
- mixed scripts;
- text on path when implemented.

## Editor mutation cases

These matter more than static benchmarks:

```text
pan continuously
zoom continuously
move one vector object
move one anchor point
change one fill
change one stroke
transform a 10k-object group
edit one character in a long text layer
show/hide one large group
add/remove an object
```

---

# 17. Metrics

For every benchmark record:

```text
parse time
scene compilation time
first frame CPU time
first frame GPU time
warm frame CPU time
warm frame GPU time
mutation latency
GPU upload bytes
CPU allocation bytes
JS/WASM transfer bytes
render-pass count
draw-call count
compute-dispatch count
pipeline compile time
VRAM / GPU memory estimate
WASM memory
scene cache size
```

Also report:

```text
median
p95
p99
```

for interactive mutation tests.

Do not rely only on average FPS.

Interactive editor latency matters more.

---

# 18. Pixel-diff correctness suite

For every representative scene:

```text
Reference render
      |
      +--> LT backend render
      |
      +--> Vello backend render
```

Produce image differences.

Classify differences into:

- exact match;
- acceptable antialiasing difference;
- color/compositing difference;
- geometry error;
- unsupported feature;
- backend bug.

Maintain the corpus as a permanent regression suite.

This is especially useful if `resvg` is used as an SVG reference renderer.

---

# 19. Decide per workload, not ideologically

The end result may look like this:

| Workload | Preferred backend |
|---|---|
| simple editor gizmos | LT native WebGPU |
| guides / handles | LT native WebGPU |
| overlay labels | LT glyph atlas |
| simple small vector documents | whichever wins benchmarks |
| large vector scenes | likely Vello if measurements support it |
| complex path-heavy SVG | likely Vello |
| document typography | dedicated shaping/layout + best raster backend |
| unsupported Vello edge case | LT/reference/fallback path |

Runtime routing is allowed **only if** it stays understandable, deterministic and maintainable.

Do not create a maze of micro-heuristics before measurement proves it useful.

---

# 20. What to do if LightTable is already better

This is explicitly part of the assignment.

If LightTable currently does something better than Vello, **do not replace it merely for consistency**.

Instead determine why it is better.

Examples:

### Case A - overlays are much faster natively

Keep them native and formalize an `OverlayRenderer` fast path.

### Case B - LightTable's compositing order or masks are richer

Keep compositing in the LightTable render graph and use Vello only to rasterize vector content into an intermediate GPU target.

### Case C - our small-scene renderer beats Vello

Keep both and select the correct backend at scene level if switching overhead is negligible and the policy remains stable.

### Case D - our text interaction is better but Vello glyph rasterization is faster

Keep LightTable's text editing/layout representation and use Vello only downstream for glyph/path rendering.

### Case E - Vello integration causes unacceptable JS/WASM overhead

Do not immediately discard Vello. Investigate a persistent scene API, lower-frequency mutation bridge, packed commands, shared memory, native Electron module, or moving the rendering ownership boundary.

### Case F - our exact visual semantics differ

Preserve the LightTable semantics. Write an adapter or retain the native path for that feature.

The goal is not architectural purity.

The goal is the **fastest, most capable, predictable professional renderer we can reasonably maintain**.

---

# 21. What not to do

Do not:

- rewrite Vello from scratch;
- port individual algorithms before testing the actual library;
- bind the document format directly to Vello types;
- replace working editor gizmos with a slower generic scene path;
- introduce CPU readback into the main render path;
- rebuild complete scenes every pointer move;
- serialize enormous vector scenes every frame through WASM;
- union editable geometry purely for draw-call reduction;
- change pixel/compositing semantics silently;
- optimize only for one synthetic benchmark;
- use FPS alone as the success metric;
- assume "one render pass" solves all vector performance bottlenecks;
- assume "Vello is alpha" means it is unsuitable;
- assume "Vello needs a second device" without proving it;
- throw away good LightTable-native code purely because a library exists.

---

# 22. Recommended implementation phases

## Phase 0 - establish baseline

- build instrumentation;
- identify current bottlenecks;
- create the benchmark corpus;
- save current correctness renders;
- establish current memory/latency numbers.

**Deliverable:** baseline performance report.

---

## Phase 1 - improve current renderer without changing semantics

Implement the safest/highest-value changes first:

- scene-level command encoding;
- persistent buffers;
- reduced render passes;
- reduced state changes;
- cached scene representation;
- dirty object updates;
- reduced allocation/upload churn.

Re-run all benchmarks.

**Deliverable:** `LT Scene Backend` benchmark report vs baseline.

---

## Phase 2 - renderer-neutral IR

Introduce the minimum useful Vector Scene IR and adapt the current renderer to consume it.

Do not attempt to model every future vector feature yet.

Validate that introducing the IR does not create measurable interaction overhead.

**Deliverable:** current renderer operating through the renderer-neutral boundary.

---

## Phase 3 - Vello interoperability experiment

Prove:

- build in Electron/WASM environment;
- device/resource strategy;
- zero-readback target integration;
- vector scene -> GPU texture -> existing compositor;
- basic profiling.

**Deliverable:** minimal end-to-end Vello render inside LightTable's render graph.

---

## Phase 4 - real Vello backend

Implement enough of the Vector Scene IR adapter to compare meaningful production scenes:

- fills;
- strokes;
- gradients;
- transforms;
- opacity;
- clips;
- basic text/glyph runs if appropriate.

Do not chase complete feature parity before performance value is proven.

**Deliverable:** Vello backend selectable in dev builds.

---

## Phase 5 - bake-off and architecture decision

Compare:

```text
LT legacy
LT optimized scene backend
Vello
```

For every workload class.

Document:

- winner;
- margin;
- correctness;
- integration cost;
- maintenance implications;
- missing features.

**Deliverable:** decision matrix.

---

## Phase 6 - hybrid production architecture

Based on actual evidence, define final routing.

Example only:

```text
Raster content           -> LT raster engine
Complex document vectors -> Vello
Small/simple vectors     -> LT or Vello based on evidence
Document text            -> shaping/layout stack -> selected vector backend
Gizmos/guides            -> LT overlay renderer
UI text                   -> LT glyph atlas
Compositing/grade         -> LT WebGPU render graph
```

Add fallbacks where necessary.

---

# 23. Success criteria

The project is successful if it produces a renderer that is materially better for real LightTable documents, not merely if Vello compiles.

Target outcomes:

- large vector documents become genuinely interactive;
- zoom/pan remain smooth at high scene complexity;
- single-object edits do not rebuild unrelated geometry;
- text remains responsive;
- no CPU image readback in the normal vector path;
- renderer boundaries are clean;
- current superior LightTable features remain superior;
- SVG import becomes easier to expand;
- future AI/EPS/PDF-style importers can target a stable Vector IR;
- the architecture can replace or upgrade a backend later without changing the document format.

---

# 24. Final engineering principle

Do not optimize for protecting the code we already wrote.

Do not optimize for using Vello everywhere either.

Optimize for this:

> **LightTable should own the document model, scene semantics, editing model and compositing architecture. Specialized renderers should be interchangeable implementation tools underneath that model.**

If our renderer is better for a task, keep it and improve it.

If Vello is dramatically better for a task, use it.

If Vello contains an algorithm that improves our own specialized fast path, study and adopt the idea where licensing and maintainability allow it.

If the integration boundary is the bottleneck, redesign the boundary.

The desired result is not "LightTable with Vello".

The desired result is:

> **a serious, scalable, high-performance LightTable vector rendering stack that combines the strongest parts of our existing WebGPU engine with the strongest parts of Vello and its ecosystem.**

---

# Primary research sources

- Vello: https://github.com/linebender/vello
- resvg / usvg: https://github.com/linebender/resvg
- Parley: https://github.com/linebender/parley
- Vello SVG integration: https://github.com/linebender/vello_svg

Vello's current public documentation describes it as a Rust, GPU-compute-centric 2D renderer using `wgpu`, designed for large interactive 2D scenes. It explicitly accepts caller-provided `wgpu::Device` and `wgpu::Queue`, renders into a `wgpu::Texture`, provides a separate SVG integration, targets WebGPU-capable environments, and notes that its web path and some renderer areas remain under active development. Those facts should be treated as inputs to experiments rather than reasons to reject or adopt it without measurement.
