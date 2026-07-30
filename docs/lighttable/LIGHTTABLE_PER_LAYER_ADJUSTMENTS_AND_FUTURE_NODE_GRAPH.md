# Lighttable — Per-Layer Adjustments, Adjustment Layers and Future Node-Graph Architecture

> **Scope/PSD companion:** `LIGHTTABLE_LAYER_SCOPE_AND_PSD_MAPPING.md` defines
> how the existing Grade and Lens Fx controls map to layer-local processing,
> Adjustment Layers, Smart Objects, Smart Filters, Layer Styles and
> document-output processing.

**Status:** implementation proposal for an AI coding agent  
**Target project:** Lighttable / StoryBuilderOnline  
**Primary goal:** move Lighttable from one document-wide grade to a familiar Photoshop-like layered adjustment workflow, while retaining Lighttable's richer Lightroom-style controls and preparing the render engine for a future Resolve-like node graph.

---

## 1. Executive summary

Lighttable currently has a working layered paint/document system with:

- serializable documents and stable layer IDs;
- WebGPU linear `rgba16float` compositing;
- opacity, masks and blend modes;
- selections and brush painting;
- undo/redo;
- layered save/open;
- one Lighttable grading/effects pipeline applied after the complete layer composite.

The current render order is approximately:

```text
all drawable layers
→ layer masks / opacity / blend modes
→ full document composite
→ document-wide Lighttable grade and effects
→ display transform
```

That was correct for the first layered-paint milestone, but is now a limitation. Lighttable should support:

1. **Non-destructive adjustments on an individual layer.**
2. **Photoshop-like adjustment layers affecting everything below them.**
3. **Clipped adjustment layers affecting only the layer or group directly below.**
4. **A clearly separated technical document/output stage.**
5. **A processing engine that is linear-stack friendly today, but DAG/node-graph capable later.**

The intended user experience should feel familiar to Photoshop users, but each layer may use the full Lighttable/Lightroom-style control set: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temperature, Tint, Curves, Color Mixer, Color Grading, Clarity, Dehaze, Texture, Detail and other supported effects.

Do **not** build a Resolve-like node editor in this milestone. Build the processing architecture so that the current linear adjustment stacks compile into a generic processing graph. A future node UI should be able to edit that graph without replacing the renderer.

---

## 2. Current project state

The original `LIGHTTABLE_LAYERED_PAINT_FIRST_STEPS.md` milestone is approximately 90% complete and already includes more functionality than originally required.

### Present capabilities

- Serializable document model.
- Stable layer IDs and revisions.
- Separation between serializable state and GPU resources.
- Layer creation, selection, rename, visibility, lock, delete, reorder, duplicate and merge-down.
- Layer opacity and multiple blend modes.
- Layer masks and mask painting.
- Rectangle, ellipse and free selections with add/subtract/intersect.
- GPU-instanced brush dabs with spacing, pressure, hardness, opacity, flow and color.
- Unified undo/redo for layers, selections, grades and paint operations.
- Layered document save/open.
- Linear `rgba16float` WebGPU compositor.
- Existing Lighttable grading and effects pipeline.

### Known architectural limitations

- `LightTableEditorOverlay.tsx` still contains too much tool/pointer orchestration.
- Full document recomposition is performed for most changes.
- `dirtyBounds` exists but does not yet drive partial compositor updates.
- Brush undo still stores complete layer textures.
- Layer offsets exist in the model but transform/move is not complete.
- Current grade is one hidden/document-wide state applied after all layers.
- Adjustment evaluation is not yet reusable for arbitrary texture inputs.

This specification focuses on the adjustment architecture. Do not allow unrelated brush polish or tool-controller cleanup to expand the scope unless a small refactor is strictly required for the implementation.

---

## 3. Product behavior

## 3.1 The three processing scopes

Lighttable should explicitly distinguish three scopes.

### Scope A — Layer-local adjustments

A normal drawable layer can own a non-destructive adjustment stack.

```text
layer source
→ source interpretation
→ layer-local adjustment stack
→ layer mask
→ layer opacity and blend mode
→ document composite
```

Examples:

- Exposure on one photograph.
- Curves on one rendered 3D layer.
- Temperature/Tint on a background layer.
- Color Mixer on one foreground object.
- Clarity on one image without affecting graphics above or below it.

When a normal drawable layer is selected, the Lighttable controls in the inspector should edit that layer's adjustment stack by default.

### Scope B — Adjustment layers

An adjustment layer processes the composite of the content below it.

```text
Background
Image A
Image B
Curves adjustment layer
Foreground graphic
```

The Curves adjustment affects:

```text
Background + Image A + Image B
```

It does not affect `Foreground graphic`, because that layer is above the adjustment layer.

Adjustment layers must support:

- visibility;
- opacity;
- blend mode;
- mask;
- rename;
- reorder;
- duplicate;
- delete;
- undo/redo;
- serialization;
- clipping to the layer directly below;
- the same adjustment modules used by layer-local adjustments.

### Scope C — Document/output processing

A small set of technical operations stays outside the creative layer stack.

```text
final layer composite
→ technical output processing
→ display transform
→ presentation/export
```

Typical output-only operations:

- working-space to display-space transform;
- output color space;
- HDR/SDR output mapping;
- final dithering;
- export resize;
- technical output sharpening when explicitly defined as output sharpening.

Creative color grading should not remain hidden here once adjustment layers exist.

---

## 3.2 Familiar Photoshop-like behavior

The layer panel should use familiar semantics.

### Normal layer

A normal layer has:

- content thumbnail;
- optional mask thumbnail;
- visibility;
- lock state;
- opacity;
- blend mode;
- layer-local adjustment state.

Layer-local adjustments may initially be exposed in the inspector rather than as child rows in the layer panel.

### Adjustment layer

An adjustment layer appears as a real row in the layer panel and has:

- an adjustment/grade thumbnail or icon;
- optional mask thumbnail;
- a descriptive name;
- visibility;
- opacity;
- blend mode;
- clipping state;
- its own adjustment stack.

Example names:

```text
Exposure
Curves
Color Mixer
Color Grading
Lighttable Grade
```

### Add Adjustment Layer menu

Provide familiar quick-add entries:

```text
Add Adjustment Layer
├─ Exposure
├─ Curves
├─ Temperature / Tint
├─ Color Mixer
├─ Color Grading
├─ Black & White
├─ Clarity / Texture / Dehaze
└─ Full Lighttable Grade
```

A quick-add entry creates an adjustment layer with one enabled module. `Full Lighttable Grade` creates a layer containing the reusable creative Lighttable Grade modules.

`Full Lighttable Grade` does not include Lens Fx whose declared scope or
processing domain is incompatible with an Adjustment Layer, and it never
includes technical display/output processing. See
`LIGHTTABLE_LAYER_SCOPE_AND_PSD_MAPPING.md`.

### Default targeting

An un-clipped adjustment layer affects all composited content below it within its current group/context.

### Clipping

A clipped adjustment layer affects only the layer or group immediately below it.

The UI may expose clipping through:

- a clip icon;
- a context-menu command;
- an `Alt`/`Option` interaction between adjacent layer rows later.

The initial implementation only needs one clear and reliable clipping control.

### Groups

Add an explicit group compositing mode to the model now, even if only one mode is fully implemented initially:

```ts
type GroupCompositingMode = "isolated" | "pass-through";
```

Recommended first implementation:

- fully support `isolated` groups;
- preserve the enum and serialization field;
- implement Photoshop-like `pass-through` in a later milestone.

An isolated group is rendered to its own intermediate texture and then composited as one layer.

---

## 4. Important architectural decision

Do not make an ordered array of adjustment parameters the final rendering abstraction.

Use two separate levels:

### Level 1 — User-facing document model

The document contains layers, groups, masks and adjustment stacks. This remains simple, serializable and easy to edit through the current UI.

### Level 2 — Compiled processing graph

The renderer compiles the document tree and linear adjustment stacks into a generic directed acyclic graph (DAG).

Today, most adjustment graphs are simple chains:

```text
Source → Temperature → Exposure → Contrast → Curves → Output
```

Later, a Resolve-like node UI may create branches and merges:

```text
                 → Skin key → Skin grade ┐
Source → Split                         Blend → Output
                 → Background grade ─────┘
```

The current layer/adjustment UI should not need to know about graph execution details.

This separation prevents a future node system from requiring a second color engine or a destructive migration of existing documents.

---

## 5. Processing graph requirements

## 5.1 Generic graph model

Introduce a minimal graph intermediate representation.

```ts
type ProcessingNodeId = string;
type ProcessingPortName = string;

interface ProcessingPortRef {
  nodeId: ProcessingNodeId;
  port: ProcessingPortName;
}

interface ProcessingGraphNode<TParams = unknown> {
  id: ProcessingNodeId;
  type: string;
  enabled: boolean;
  revision: number;
  params: TParams;
  inputs: Record<ProcessingPortName, ProcessingPortRef | null>;
}

interface ProcessingGraph {
  id: string;
  revision: number;
  nodes: Record<ProcessingNodeId, ProcessingGraphNode>;
  outputs: Record<string, ProcessingPortRef>;
}
```

Even when a node currently has only one image input, use named input ports. Future nodes may require:

- primary image input;
- secondary image input;
- mask/key input;
- matte input;
- depth input;
- normal input;
- motion/vector input.

Do not expose all of those in the UI now. Only ensure the type system and evaluator are not hard-coded to one anonymous input.

## 5.2 Linear adjustment stack remains the UI model

The current editing UI can continue to use an ordered stack:

```ts
interface AdjustmentStack {
  id: string;
  revision: number;
  modules: AdjustmentModuleInstance[];
}

interface AdjustmentModuleInstance<TParams = unknown> {
  id: string;
  type: AdjustmentModuleType;
  enabled: boolean;
  revision: number;
  opacity?: number;
  params: TParams;
}
```

Compile it to a graph:

```ts
function compileAdjustmentStackToGraph(
  stack: AdjustmentStack,
  input: ProcessingPortRef
): ProcessingGraphFragment;
```

The compiler should generate one processing node per enabled module and connect them in order.

This gives Lighttable a simple Lightroom-like UI today and a graph-capable engine tomorrow.

## 5.3 Module definitions

Adjustment behavior should be registered through module definitions rather than large switch statements spread through UI and renderer code.

```ts
interface AdjustmentModuleDefinition<TParams = unknown> {
  type: AdjustmentModuleType;
  label: string;
  category: AdjustmentCategory;
  defaultParams: () => TParams;

  allowedScopes: Array<
    "layer" | "adjustment-layer" | "group" | "document-output"
  >;

  createRenderNode: (
    instance: AdjustmentModuleInstance<TParams>,
    context: AdjustmentCompileContext
  ) => ProcessingGraphNode<TParams>;

  parameterSchema: AdjustmentParameterSchema;
}
```

Benefits:

- one definition drives defaults, serialization and inspector UI;
- the same module can run on a normal layer or adjustment layer;
- modules can declare scope restrictions;
- future node-browser menus can reuse the same registry;
- new effects do not require modifying one monolithic renderer.

## 5.4 Node evaluator

Implement deterministic topological evaluation.

```ts
interface ProcessingNodeEvaluator {
  type: string;

  evaluate(
    node: ProcessingGraphNode,
    inputs: Record<string, RenderResource>,
    context: ProcessingEvaluationContext
  ): Promise<Record<string, RenderResource>> | Record<string, RenderResource>;
}
```

The evaluator must:

- validate acyclic execution;
- topologically order dependencies;
- reuse valid cached outputs;
- allocate/reuse intermediate textures;
- never store GPU resources in the serializable document;
- produce deterministic output for the same node/input revisions;
- expose useful profiling information.

The runtime distinguishes three intentionally different states:

- **live** — editable parameters are evaluated from their recipe;
- **cached** — a revision-keyed output texture is reused while all inputs are
  unchanged;
- **stamped/rasterized** — an explicit destructive document command replaces
  semantic processing with pixels.

Caching is an engine decision and does not change the document. Stamping is a
user action and must participate in undo/redo. Spatial effects may retain one
cached output, while their blur/noise/ping-pong intermediates should come from
a shared transient texture pool and be released after their last graph
consumer.

The status bar reports `GPU ~N MB/GB`: an estimate of texture bytes owned by
LightTable, not total driver VRAM (which WebGPU does not expose). Use it to
validate lazy allocation and cache eviction policies rather than promising an
OS-level memory reading.

A future node graph may fan one texture into multiple nodes. The texture lifetime manager must therefore use graph consumer counts or an equivalent lifetime strategy rather than assuming every intermediate has one consumer.

---

## 6. Layer document model

Adapt the exact names to existing project conventions, but preserve these concepts.

```ts
type LayerKind =
  | "pixel"
  | "paint"
  | "video"
  | "3d"
  | "adjustment"
  | "group";

interface BaseLayer {
  id: string;
  kind: LayerKind;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  revision: number;
  mask?: LayerMaskState;
}

interface DrawableLayer extends BaseLayer {
  adjustments: AdjustmentStack;
  transform: LayerTransform;
}

interface PixelLayer extends DrawableLayer {
  kind: "pixel";
  sourceId: string;
}

interface PaintLayer extends DrawableLayer {
  kind: "paint";
  paintSurfaceId: string;
}

interface VideoLayer extends DrawableLayer {
  kind: "video";
  sourceId: string;
}

interface ThreeDLayer extends DrawableLayer {
  kind: "3d";
  sceneId: string;
}

interface AdjustmentLayer extends BaseLayer {
  kind: "adjustment";
  adjustments: AdjustmentStack;
  clipping: AdjustmentClipping;
}

type AdjustmentClipping =
  | { mode: "all-below" }
  | { mode: "layer-below" };

interface GroupLayer extends BaseLayer {
  kind: "group";
  children: LayerNode[];
  compositingMode: GroupCompositingMode;
  adjustments?: AdjustmentStack;
}

type LayerNode =
  | PixelLayer
  | PaintLayer
  | VideoLayer
  | ThreeDLayer
  | AdjustmentLayer
  | GroupLayer;
```

### Stable IDs

All modules and graph nodes must have stable IDs. Reordering a module must not generate a new ID. This is needed for:

- undo/redo;
- cache reuse;
- inspector selection;
- future node graph editing;
- document diffing/collaboration.

### Revisions

Use fine-grained revisions:

- layer revision;
- source revision;
- transform revision;
- mask revision;
- adjustment-stack revision;
- per-module revision;
- graph-node output revision.

Do not increment every document node for every edit. Fine-grained invalidation is essential once multiple adjustment layers exist.

---

## 7. Rendering semantics

## 7.1 Normal drawable layer

Recommended initial order:

```text
source texture / generated layer content
→ source interpretation and source-specific corrections
→ layer-local adjustment graph
→ layer-local spatial result
→ layer transform into document space
→ layer mask in matching document/layer space
→ opacity and blend mode
→ composite
```

The exact transform/mask ordering must match the existing mask model. Do not silently alter current mask behavior. Add tests before changing it.

### Source-specific corrections

These normally belong to the source, not to a generic adjustment layer:

- image decode interpretation;
- embedded color profile conversion;
- RAW/demosaic parameters;
- camera lens correction;
- source chromatic-aberration correction;
- source white-balance interpretation when tied to RAW metadata.

A creative lens-distortion effect may still exist as a normal adjustment module later. Keep technical source correction and creative effects conceptually separate.

## 7.2 Un-clipped adjustment layer

For a bottom-to-top compositor:

```ts
const originalComposite = compositeBelow;
const adjustedComposite = evaluateAdjustmentStack(
  originalComposite,
  adjustmentLayer.adjustments
);

compositeBelow = blendWithMaskAndOpacity({
  destination: originalComposite,
  source: adjustedComposite,
  mask: adjustmentLayer.mask,
  opacity: adjustmentLayer.opacity,
  blendMode: adjustmentLayer.blendMode,
});
```

This is important: adjustment-layer opacity and mask should interpolate/blend between the unadjusted lower composite and the adjusted result.

## 7.3 Clipped adjustment layer

A clipped adjustment layer must process the isolated result of the layer directly below, not the already flattened composite of all lower content.

Conceptually:

```text
lower document composite
+ target layer source/result
+ clipped adjustment chain
→ composite adjusted target over lower document composite
```

Do not implement clipping by applying the adjustment to the entire lower composite and multiplying by target alpha unless verified equivalent for the supported blend/alpha semantics. That shortcut can produce incorrect results with transparency, non-normal blend modes and premultiplied alpha.

Recommended approach:

1. Keep the target layer's isolated pre-composite output available.
2. Apply the clipped adjustment graph to that isolated output.
3. Preserve/use the target layer alpha as the clipping basis.
4. Composite the adjusted target using the target layer's blend semantics.

If Photoshop-exact clipping across arbitrary blend modes is too large for the first pass, document and test the supported subset. `Normal` blend with standard alpha must be correct from the start.

## 7.4 Adjustment masks

An adjustment layer's mask controls where the adjusted result replaces/blends with the original lower composite.

```text
result = blend(
  originalComposite,
  adjustedComposite,
  adjustmentMask × adjustmentOpacity
)
```

The mask must participate in undo/redo, save/open and GPU cache invalidation.

## 7.5 Alpha handling

Define and document whether internal textures use straight or premultiplied alpha. Do not allow individual passes to guess.

Preferred rule:

- use one consistent internal alpha convention throughout compositing;
- adjustment/color passes must not unintentionally modify alpha;
- nodes that intentionally modify alpha must declare that capability;
- source and destination blending must use matching equations;
- graph node contracts must state whether alpha is preserved, generated or consumed.

Add alpha-specific golden tests with partially transparent colored pixels.

---

## 8. Color-management rules

All creative adjustment nodes should operate in the existing linear working pipeline unless the module explicitly requires another domain.

```text
decoded source
→ source color-space conversion
→ linear working space / rgba16float
→ layers and adjustment graph
→ document output transform
→ display/export
```

### Required safeguards

- Do not apply display conversion inside a layer adjustment stack.
- Do not repeatedly convert between sRGB and linear between modules.
- Preserve HDR values above `1.0` inside the working pipeline.
- Avoid clamping between adjustment passes unless a module explicitly requires it.
- Centralize any log/perceptual encoding used by tone controls.
- Existing images must retain current appearance after migration, within defined numerical tolerance.

### Domain-aware nodes

A future node may request a different processing domain:

```ts
type ProcessingDomain =
  | "linear-rgb"
  | "log-luminance"
  | "perceptual"
  | "mask"
  | "data";
```

Do not build a complex automatic color-domain conversion framework now. However, keep node metadata extensible enough to describe the expected domain. The compiler may insert explicit conversion nodes later.

---

## 9. Reusing the existing Lighttable grade

The existing grade/effects implementation must become an input-agnostic processor.

Current conceptual form:

```ts
renderDocumentGrade(fullComposite, globalGradeState);
```

Target conceptual form:

```ts
evaluateAdjustmentStack(
  inputTexture,
  adjustmentStack,
  renderContext
): RenderResource;
```

The same implementation must work with:

- one pixel layer texture;
- one paint layer texture;
- a 3D layer render target;
- an isolated group texture;
- a lower-layer composite entering an adjustment layer;
- the legacy whole-document composite during migration.

Do not duplicate shaders for per-layer and document-wide use. Parameter packing, bind-group creation, auxiliary textures and compute/render passes should be shared.

### Existing multi-pass modules

Modules such as Clarity and Dehaze may require downsampled luminance or blur resources. Model these as graph dependencies or node-internal subgraphs, not as global singleton textures tied to the whole document.

For example:

```text
input
├─ downsample luminance → blur pyramid ┐
└────────────────────────────────────── clarity/dehaze → output
```

A module may initially compile into several internal render nodes while remaining one item in the user-facing adjustment stack.

---

## 10. Migrating the current global grade

Do not permanently keep both:

```text
hidden global creative grade
+
visible adjustment layers
```

That would be confusing in the UI and would complicate serialization, undo and rendering order.

### Migration strategy

For existing documents with non-default global grade settings:

1. Create a top-level adjustment layer named `Document Grade`.
2. Convert the legacy grade state into an `AdjustmentStack`.
3. Place the layer at the top of the document layer stack.
4. Preserve its enabled/disabled state.
5. Leave only technical output settings in the document-output stage.
6. Increment document format version.

Example:

```ts
function migrateLegacyDocumentGrade(
  document: LegacyLighttableDocument
): LighttableDocument {
  const migrated = migrateBaseDocument(document);

  if (!isDefaultLegacyGrade(document.grade)) {
    migrated.layers.push(
      createAdjustmentLayer({
        name: "Document Grade",
        adjustments: convertLegacyGradeToAdjustmentStack(document.grade),
        clipping: { mode: "all-below" },
      })
    );
  }

  migrated.outputSettings = extractTechnicalOutputSettings(document.grade);
  return migrated;
}
```

### Output parity

Before migration, create representative baseline renders. After migration, compare GPU output against those baselines.

The migration is not complete until the old document and migrated document render visually the same within a documented tolerance.

### New documents

Recommended default:

- do not create a hidden grade;
- optionally create one visible `Document Grade` adjustment layer for the Photography workspace/template;
- allow a blank layered document to start without any adjustment layer.

---

## 11. Inspector and layer-panel UI

## 11.1 Selected normal layer

When a normal drawable layer is selected:

- the Lighttable controls edit `selectedLayer.adjustments`;
- the inspector clearly labels the scope, for example `Layer Adjustments`;
- reset affects the selected layer only;
- adding a module affects that layer only;
- controls should not silently edit a global grade.

## 11.2 Selected adjustment layer

When an adjustment layer is selected:

- the inspector edits `adjustmentLayer.adjustments`;
- show adjustment-layer mask controls;
- show clipping state;
- show opacity/blend mode consistently with other layers;
- allow one-module and multi-module adjustment layers.

## 11.3 Output/document settings

Create a separate explicit UI scope for technical output settings, for example:

```text
Document / Output
```

Do not place technical display/output controls among normal layer adjustments when they cannot be evaluated per layer.

## 11.4 Scope indication

Always show what is being edited:

```text
Layer: Background Photo
Adjustment Layer: Color Grade
Document Output
```

This avoids one of the most common UX failures in mixed Lightroom/Photoshop-style editors: controls appearing identical while silently changing a different scope.

## 11.5 One module versus full grade

Internally all adjustment layers may contain an ordered stack. In the UI:

- quick-created adjustment layers usually start with one module;
- `Full Lighttable Grade` exposes the full familiar Lighttable panel set;
- advanced users may add more modules to the same adjustment layer later;
- do not require one physical layer per slider group.

---

## 12. Undo/redo and command model

Every operation must participate in the existing unified history.

Required commands include:

- add adjustment layer;
- delete adjustment layer;
- reorder adjustment layer;
- toggle visibility;
- change opacity/blend mode;
- toggle clipping;
- add/remove/reorder adjustment module;
- change module parameters;
- enable/disable module;
- reset module;
- paint/edit adjustment mask;
- migrate legacy grade when opening a document without adding user-visible undo noise.

Parameter drags should coalesce into one meaningful undo step where the existing inspector already supports coalescing.

Undo must restore:

- serialized parameter state;
- graph revisions/invalidation state;
- visual output;
- selected layer/module where practical.

Do not store GPU textures directly in normal adjustment history entries. Re-evaluate from serialized state and cached sources.

---

## 13. Serialization and versioning

Increase the document format version.

Serialize:

- layer-local adjustment stacks;
- adjustment layer type;
- adjustment modules and stable IDs;
- module parameters;
- enabled states;
- module order;
- adjustment masks;
- clipping mode;
- group compositing mode;
- technical output settings separately from creative adjustments.

Do not serialize:

- `GPUTexture`;
- bind groups;
- render pipelines;
- cached graph outputs;
- transient profiling data;
- temporary compilation IDs that can be recreated deterministically.

### Unknown module handling

A document may later contain an adjustment module unavailable in the current build. Preserve unknown serialized module payloads where possible and mark them unavailable rather than deleting them during load/save.

```ts
interface UnknownAdjustmentModuleInstance {
  id: string;
  type: string;
  enabled: boolean;
  revision: number;
  rawParams: unknown;
  unavailable: true;
}
```

This is useful for forwards compatibility and optional plugins later.

---

## 14. Caching and invalidation

Adjustment layers increase the cost of full recomposition. Implement graph-level cache invalidation before attempting complex tile-based compositing.

## 14.1 Cache key

A node output cache key should include at least:

```text
node type
node revision / parameter hash
input output revisions
working format
output dimensions
relevant render mode / quality tier
```

Conceptually:

```ts
interface NodeCacheKey {
  nodeId: string;
  nodeRevision: number;
  inputVersions: Record<string, number>;
  width: number;
  height: number;
  format: GPUTextureFormat;
  quality: RenderQuality;
}
```

## 14.2 Layer-stack compilation

Compile the layer tree into a document render graph. Cache useful boundaries such as:

- source output;
- layer-local adjustment output;
- transformed/masked layer output;
- composite after each significant layer/group boundary;
- adjustment-layer output;
- final pre-display composite;
- display result when viewport/output settings are unchanged.

When one layer changes, only invalidate:

- that layer's dependent nodes;
- composites above that layer;
- adjustment layers above that point;
- final output/display nodes.

Lower unaffected layers and their composite boundaries should remain reusable.

## 14.3 Dirty bounds

Keep propagating `dirtyBounds`, but do not make partial texture updates a prerequisite for the first correct adjustment-layer implementation.

Recommended order:

1. correct full-frame graph evaluation;
2. node/subtree cache reuse;
3. performance instrumentation;
4. dirty-bound propagation through graph nodes;
5. partial/tiled compositing where measurements justify it.

Each node should eventually declare how it transforms dirty regions:

- preserves bounds;
- expands bounds by radius;
- transforms bounds geometrically;
- invalidates the full frame;
- depends on global image statistics.

Example:

```ts
type DirtyRegionBehavior =
  | { type: "preserve" }
  | { type: "expand"; radiusPx: number }
  | { type: "transform" }
  | { type: "full-frame" };
```

Curves may preserve dirty bounds. Blur expands them. Histogram-dependent auto adjustments may require full-frame invalidation.

---

## 15. GPU resource management

The graph evaluator should use a texture/resource pool.

Requirements:

- reuse compatible intermediate textures;
- avoid allocating one permanent texture per graph node;
- retain cached outputs only at useful cache boundaries;
- release transient textures after their final consumer;
- support fan-out in future graphs;
- track approximate GPU memory use;
- degrade cache retention gracefully under memory pressure.

Suggested resource abstraction:

```ts
interface RenderTextureResource {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
  version: number;
  alphaMode: InternalAlphaMode;
  colorDomain: ProcessingDomain;
}
```

Avoid passing raw `GPUTexture` values without metadata throughout the evaluator.

---

## 16. Performance instrumentation

Add development instrumentation before aggressive optimization.

```ts
interface LighttableRenderStats {
  compiledNodeCount: number;
  evaluatedNodeCount: number;
  cachedNodeCount: number;
  compositorPassCount: number;
  adjustmentPassCount: number;
  transientTextureCount: number;
  cachedTextureCount: number;
  estimatedGpuBytes: number;
  uploadedBytes: number;
  copiedBytes: number;
  cpuCompileMs: number;
  cpuSubmissionMs: number;
  gpuTimeMs?: number;
}
```

At minimum, provide a development-only console/debug panel view showing:

- which nodes were evaluated;
- which nodes were reused;
- why a node was invalidated;
- total pass count;
- current texture-pool usage.

This will be valuable both for adjustment stacks and the future node graph.

---

## 17. Future Resolve-like node graph compatibility

The following are architectural requirements for this milestone, not UI features to implement now.

### Required now

- Processing is represented by a DAG-capable IR.
- Nodes have stable IDs.
- Inputs and outputs use named ports.
- Graph evaluation is topological.
- A node may have multiple inputs in the type system.
- One output may feed multiple consumers.
- Modules are registered through definitions/evaluators.
- Linear adjustment stacks compile to graph fragments.
- The document/layer tree compiles to the same graph/evaluation system.
- Masks are representable as graph resources/ports.
- Node output caching is revision-based.
- Serialization does not depend on GPU implementation details.

### Explicitly not required now

- node editor UI;
- draggable nodes;
- connection wires;
- arbitrary user-created branches;
- qualifiers/keys;
- parallel mixer nodes;
- tracking nodes;
- temporal node evaluation;
- OFX compatibility;
- Fusion/Resolve project import;
- node groups/macros;
- scripting of arbitrary shaders.

### Development-only future-proofing test

Add one small graph evaluator test that is not generated from a linear stack:

```text
Input
├─ Exposure A ─┐
└─ Exposure B ─┴─ Mix → Output
```

The mix node may be a minimal internal test node. This verifies that the evaluator is genuinely DAG-capable and not only a linked list hidden behind graph types.

This test does not need to be exposed in the production UI.

---

## 18. Proposed implementation phases

Do not perform a single high-risk rewrite. Keep the editor rendering correctly after each phase.

## Phase 0 — Audit and baseline

1. Locate the current global grade state, shader passes and render orchestration.
2. Document the exact current pass order.
3. Identify which settings are creative adjustments, source corrections and output-only settings.
4. Capture representative baseline renders and parameter presets.
5. Add basic output comparison helpers/golden tests.

**Exit criterion:** current rendering behavior is documented and testable.

## Phase 1 — Adjustment module abstraction

1. Create `AdjustmentStack` and stable `AdjustmentModuleInstance` types.
2. Create an adjustment module registry.
3. Wrap the existing Lighttable grade controls as module definitions without changing visual behavior.
4. Extract input-agnostic adjustment evaluation.
5. Continue applying it only to the full document composite initially.

**Exit criterion:** the existing document-wide grade renders through the new reusable module/stack API with output parity.

## Phase 2 — Processing graph IR and evaluator

1. Add generic graph/node/port types.
2. Add stack-to-graph compilation.
3. Implement deterministic graph validation and topological evaluation.
4. Add node cache keys and resource metadata.
5. Add a minimal branched graph test.
6. Keep the production graph linear at this stage.

**Exit criterion:** current document grade runs through the graph evaluator; a development test proves branch/merge evaluation.

## Phase 3 — Per-layer adjustments

1. Add `adjustments` to drawable layers.
2. Compile each layer source and adjustment stack into the document render graph.
3. Add inspector scope selection and clear scope labels.
4. Add history commands for layer adjustment edits.
5. Add serialization/versioning.
6. Ensure masks, opacity and blend modes retain current semantics.

**Exit criterion:** two layers can have visibly different independent Lighttable grades, survive undo/redo and save/open, and render correctly.

## Phase 4 — Adjustment layers

1. Add `AdjustmentLayer` to the document model.
2. Add layer-panel creation, selection, rename, reorder, visibility, opacity, blend mode and deletion.
3. Evaluate un-clipped adjustment layers against the lower composite.
4. Support adjustment-layer masks.
5. Add quick-add adjustment menu entries.
6. Add full-grade adjustment layer.

**Exit criterion:** adjustment layers affect all content below and no content above; masks and opacity behave correctly.

## Phase 5 — Clipping and groups

1. Add clipping to the layer below.
2. Preserve isolated target-layer output as required.
3. Add isolated group rendering if not already available.
4. Add group compositing-mode field.
5. Add focused alpha/blend tests.

**Exit criterion:** a clipped adjustment can grade one semi-transparent layer without modifying lower unrelated layers.

## Phase 6 — Legacy grade migration

1. Split creative grade settings from technical output settings.
2. Migrate legacy creative grade to a visible top-level `Document Grade` adjustment layer.
3. Preserve old document output.
4. Update save/open and format version.
5. Update stale implementation documentation.

**Exit criterion:** existing projects open with the same appearance and no hidden creative global grade.

## Phase 7 — Cache/instrumentation hardening

1. Add graph-level cache reuse.
2. Add invalidation diagnostics.
3. Add texture-pool metrics.
4. Measure common workflows.
5. Only then consider dirty-bound or tiled compositor updates.

**Exit criterion:** editing one upper layer does not unnecessarily re-evaluate unaffected lower layer-processing nodes.

---

## 19. Tests and acceptance criteria

## 19.1 Unit tests

- Adjustment stack serializes/deserializes with stable module IDs.
- Reordering modules changes processing order without replacing IDs.
- Module enable/disable does not delete parameters.
- Legacy grade converts to equivalent adjustment stack.
- Unknown module payload survives load/save.
- Graph cycle detection rejects invalid graphs.
- Topological sorting is deterministic.
- Cache invalidates when a node parameter or input version changes.
- Cache remains valid when unrelated nodes change.

## 19.2 GPU/render smoke tests

Use small deterministic textures where possible.

- Exposure affects one layer only.
- Adjustment layer affects all layers below only.
- Layer above an adjustment remains unchanged.
- Reordering an adjustment changes the expected target set.
- Adjustment-layer opacity `0` equals unadjusted lower composite.
- Adjustment-layer opacity `1` equals fully adjusted lower composite.
- White mask equals full adjustment.
- Black mask equals no adjustment.
- Half-gray mask produces the expected interpolation.
- Clipped adjustment affects only the immediate lower layer.
- Transparent target pixels remain transparent after color-only adjustments.
- Blend-mode behavior remains unchanged after introducing per-layer adjustments.
- Save/open produces the same render.
- Undo/redo restores the same render.
- Cached and uncached evaluation produce matching output.
- Existing legacy documents render within tolerance after migration.

## 19.3 UI acceptance tests

- Selecting a normal layer edits only that layer.
- Selecting an adjustment layer edits that adjustment layer.
- Scope is visible in the inspector.
- Add Adjustment Layer creates a visible layer-panel row.
- Adjustment layer can be renamed, moved, hidden and deleted.
- Mask thumbnail and active thumbnail state are clear.
- Clipping state is visible.
- Output controls are not presented as ordinary layer-local controls.

## 19.4 Performance acceptance

For a representative document with multiple 4K layers and several adjustments:

- no unbounded GPU texture accumulation;
- changing one module does not rebuild static source resources;
- unchanged lower processing nodes are reused where valid;
- debug statistics correctly report evaluated versus cached nodes;
- interaction remains responsive enough for current Lighttable expectations.

Do not set arbitrary frame-time thresholds before measuring the existing editor and target hardware. Record the baseline and compare regressions.

---

## 20. Edge cases

Handle or explicitly document:

- adjustment layer at the bottom of the stack;
- clipped adjustment without a valid lower drawable layer;
- multiple clipped adjustments above one target;
- hidden target layer;
- hidden adjustment layer;
- locked adjustment layer;
- empty group;
- adjustment layer inside an isolated group;
- masks with different dimensions or transforms;
- transparent layers;
- HDR values;
- disabled modules;
- missing/unavailable modules;
- layer deletion while inspector edits its adjustment;
- undo after document migration;
- resizing canvas/document with spatial adjustment caches;
- effects that expand bounds;
- effects requiring full-frame statistics.

Recommended fallback for an invalid clipped adjustment target: render it as having no effect and show a clear inactive/broken-clipping state, rather than silently affecting all layers below.

---

## 21. Suggested source organization

Adapt to the repository's established naming and folders. A possible organization is:

```text
client/src/features/lighttable/
├─ model/
│  ├─ layers/
│  ├─ adjustments/
│  │  ├─ AdjustmentStack.ts
│  │  ├─ AdjustmentModuleInstance.ts
│  │  ├─ AdjustmentModuleRegistry.ts
│  │  └─ adjustmentSchemas.ts
│  └─ migrations/
│     └─ migrateDocumentGradeToAdjustmentLayer.ts
├─ render/
│  ├─ graph/
│  │  ├─ ProcessingGraph.ts
│  │  ├─ ProcessingGraphCompiler.ts
│  │  ├─ ProcessingGraphEvaluator.ts
│  │  ├─ ProcessingGraphCache.ts
│  │  └─ ProcessingResourcePool.ts
│  ├─ nodes/
│  │  ├─ source/
│  │  ├─ adjustment/
│  │  ├─ composite/
│  │  ├─ mask/
│  │  └─ output/
│  └─ compositor/
├─ history/
│  └─ adjustmentCommands.ts
├─ ui/
│  ├─ adjustments/
│  ├─ inspector/
│  └─ layers/
└─ tests/
   ├─ adjustment-stack/
   ├─ processing-graph/
   ├─ compositor/
   └─ migrations/
```

Do not mechanically create this tree if equivalent abstractions already exist. Prefer extending coherent current modules over duplicating systems.

---

## 22. Guardrails for the coding agent

1. **Inspect the current code before proposing final file changes.** Reuse existing grade shaders, parameter types, history commands, layer models and compositor utilities.
2. **Do not replace the working compositor wholesale.** Introduce graph compilation around existing passes incrementally.
3. **Preserve current visual output during extraction.** Add baselines first.
4. **Do not build the node-editor UI.** Only build the graph-capable engine and a development branch/merge test.
5. **Do not duplicate the grade engine.** Per-layer and adjustment-layer processing must call the same adjustment module/evaluator implementation.
6. **Keep GPU resources outside serializable state.**
7. **Use stable IDs and fine-grained revisions.**
8. **Keep technical output transforms separate from creative adjustments.**
9. **Do not optimize blindly.** Add instrumentation and graph-level cache reuse before tiled/partial rendering.
10. **Preserve current masks, blend modes, selection behavior and undo semantics.**
11. **Update documentation after implementation.** The existing milestone note is already behind the codebase.
12. **Stop and report conflicts rather than silently changing color or alpha semantics.**

---

## 23. Required implementation report

After completing each phase, report:

- files added and modified;
- old and new render flow;
- document-model changes;
- migration behavior;
- tests added and their results;
- measured performance before and after;
- known limitations;
- any visual-output differences;
- next recommended phase.

For architectural changes, include one concise diagram of the compiled graph for:

1. two independently adjusted pixel layers;
2. one un-clipped adjustment layer;
3. one clipped adjustment layer;
4. one isolated group;
5. the future branch/merge development test.

---

## 24. Definition of done

This milestone is complete when:

- normal drawable layers have independent non-destructive Lighttable adjustment stacks;
- adjustment layers visibly exist in the layer panel and affect content below;
- adjustment layers support masks, opacity, visibility, reorder, save/open and undo/redo;
- clipping to the immediate lower layer works for the defined supported compositing cases;
- the legacy document-wide creative grade migrates to a visible top-level adjustment layer;
- technical output/display processing remains separate;
- the existing grade implementation is reused rather than duplicated;
- linear stacks compile to a generic DAG-capable processing graph;
- a development test proves branch/merge graph execution;
- graph outputs support revision-based caching and instrumentation;
- current documents preserve their visual appearance within documented tolerance;
- user interaction feels familiar to Photoshop users while retaining Lighttable's richer Lightroom-style controls.

---

## 25. Final intended architecture

```text
Serializable document tree
│
├─ Pixel / Paint / Video / 3D layers
│  └─ layer-local Lighttable adjustment stacks
│
├─ Adjustment layers
│  └─ Lighttable adjustment stacks + mask + clipping
│
├─ Groups
│  └─ isolated/pass-through compositing semantics
│
└─ Technical document/output settings

                compile
                  ↓

Generic processing DAG
│
├─ source nodes
├─ adjustment nodes
├─ auxiliary-analysis nodes
├─ transform nodes
├─ mask nodes
├─ composite nodes
├─ group nodes
└─ output/display nodes

                evaluate
                  ↓

WebGPU graph evaluator
├─ topological execution
├─ texture pooling
├─ revision-based caching
├─ dirty-region metadata
├─ profiling
└─ final display/export result
```

The user-facing editor remains a familiar layer stack and Lightroom-style inspector. The underlying engine becomes flexible enough to support a Resolve-like node workflow later without replacing the grading or compositing pipeline.
