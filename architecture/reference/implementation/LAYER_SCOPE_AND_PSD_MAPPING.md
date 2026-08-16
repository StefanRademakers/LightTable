# LightTable layer scope and Photoshop mapping

Status: authoritative semantic contract, 28 July 2026; implementation progress
reconciled elsewhere on 31 July 2026.

The scope definitions and Photoshop mappings in this document remain current.
Its implementation sequence is historical: use
`LIGHTTABLE_EXPLICIT_PROCESSING_OWNERSHIP.md` for current processing ownership,
`PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md` for PSD progress and
`LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md` for the active architecture
milestone. Code and tests are authoritative when an old checklist differs.

This document defines where the existing LightTable Grade and Lens Fx tools
live once layers become independently editable. It also defines how Photoshop
Adjustment Layers, Smart Objects, Smart Filters and Layer Styles map onto the
same engine without becoming parallel systems.

Related documents:

- `archive/LIGHTTABLE_PER_LAYER_ADJUSTMENTS_AND_FUTURE_NODE_GRAPH.md`
- `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md`
- `AG_PSD_FEATURE_PARITY_REFERENCE.md`

## 1. Terms that must not be conflated

| Concept | Owns content? | Input | Typical purpose |
|---|---:|---|---|
| Drawable layer | Yes | Pixel, paint, text, vector, 3D or nested content | Source content in the layer tree. |
| Layer-local adjustment stack | No | One drawable layer before compositing | Independently grade one layer. |
| Adjustment layer | No | Composite of layers below, or one clipped target | Photoshop-like non-destructive grade in the layer tree. |
| Smart Object | Yes, indirectly | Embedded or linked nested asset/document | Preserve source and placed transform. |
| Smart Filter | No | Smart Object result | Re-editable filter owned by a Smart Object. |
| Layer Style | No | Layer alpha/content in compositing context | Shadow, glow, overlay, bevel and stroke. |
| LightTable Lens Fx | No | A declared layer, group or document result | Optical/creative spatial processing. |
| Document output | No | Final composite | Color-management and export/display operations. |

A Smart Object is not an Adjustment Layer. A Smart Filter is not a Layer
Style. LightTable Lens Fx are not automatically Photoshop Layer Styles.

LightTable does not require a user-facing "Convert to Smart Object" step before
non-destructive processing. Every eligible drawable layer is processing-capable
by default and may own an attached adjustment/filter stack. Baking,
rasterization or destructive application must therefore be an explicit
command, not an implicit consequence of adding Grade. This removes Photoshop's
legacy workflow ceremony without claiming that every LightTable layer already
implements linked/embedded Smart Object source semantics.

## 2. Required processing scopes

### Source interpretation

Owned by an asset/source, before creative edits:

- decode and bit-depth interpretation;
- ICC/profile conversion into the working space;
- RAW/demosaic and camera white balance;
- technical lens/profile correction;
- alpha interpretation.

These settings travel with the source asset and are not ordinary Adjustment
Layers.

### Layer-local processing

Owned by one drawable layer:

```text
source or generated content
-> source interpretation
-> content-space Smart Filters/native filters
-> layer-local adjustment stack
-> transform into document space
-> layer masks
-> layer opacity/fill/style/blend
-> parent composite
```

This is how different layers receive different grades. Selecting a normal
drawable layer makes the Grade panel edit this stack.

### Adjustment-layer processing

Owned by a real row in the layer tree:

```text
lower composite
-> adjustment stack
-> adjustment mask and opacity
-> result returned to the parent composite
```

An unclipped Adjustment Layer affects eligible content below it within its
group context. A clipped Adjustment Layer operates on the isolated result of
its clipping target, preserving that target's alpha and compositing semantics.

### Group-local processing

An isolated group may own an adjustment/effect stack over its isolated child
composite. A pass-through group cannot be treated as one simple offscreen
texture without changing Photoshop semantics; its graph must compile into the
parent compositing context.

### Document creative and output processing

Creative whole-image operations may be represented by a visible top-level
Adjustment Layer or native Effect Layer. Only technical operations remain
hidden in document output:

- working-to-display/output color conversion;
- HDR/SDR display mapping;
- final encoding and dithering;
- export resizing;
- explicitly defined output sharpening.

## 3. Mapping the current LightTable controls

The current `BasicAdjustments` object is a temporary UI/state bundle. It must
not become the final module or PSD schema.

### Grade controls

| Current control/group | Layer-local | Adjustment Layer | Group | PSD mapping |
|---|---:|---:|---:|---|
| Temperature/Tint | Yes | Yes | Yes | Native LightTable module; map only when PSD semantics are equivalent. |
| Exposure | Yes | Yes | Yes | Map to PSD Exposure only through a PSD-compatible parameter/evaluator variant. |
| Contrast | Yes | Yes | Yes | Native module; do not assume Photoshop Brightness/Contrast equivalence. |
| Highlights/Shadows | Yes | Yes | Yes | Native LightTable tone module; PSD fallback may be custom/preserved. |
| Whites/Blacks/Lift | Yes | Yes | Yes | Native LightTable tone module. |
| Vibrance/Saturation | Yes | Yes | Yes | PSD Vibrance/Hue-Saturation adapters where parameter semantics match. |
| Color Mixer | Yes | Yes | Yes | Native module; possible HSL export adapter, never silent approximation. |
| Color Grading | Yes | Yes | Yes | Native module; may require rasterization or LUT-style export. |
| Curves | Yes | Yes | Yes | Strong candidate for exact PSD Curves mapping. |
| Texture/Clarity/Dehaze | Yes | Yes, with full-frame input | Yes | Spatial native modules; normally Smart Filter/native payload or raster fallback in PSD. |
| Vignette | Yes with explicit bounds | Yes with document bounds | Yes | Native spatial effect, not a standard PSD Adjustment Layer. |

Spatial modules must declare their coordinate reference:

- source/layer bounds;
- transformed layer bounds;
- isolated group bounds;
- complete document bounds.

Without that declaration, moving the same module between scopes changes its
meaning unpredictably.

### Lens Fx

| Current effect | Current stage | Initial allowed scope | Photoshop representation |
|---|---|---|---|
| Lens distortion | Source geometry | Drawable layer, Smart Object, document effect | Smart Filter where supported, otherwise native/preserved fallback. |
| Chromatic aberration | Source geometry | Drawable layer, Smart Object, document effect | Smart Filter/native effect; not an Adjustment Layer. |
| Lens blur | Linear spatial | Drawable layer/Smart Object and isolated group; document effect | Smart Filter when compatible; keep depth asset and filter mask. |
| Halation | Linear spatial | Layer/group/document native effect | No direct standard Layer Style mapping; preserve as LightTable-native or rasterize on PSD export. |
| Grain | Display-post today | Document creative/output only initially | No exact editable PSD adjustment mapping; rasterize or preserve in LightTable format. |

Grain cannot simply be moved into every layer stack while its implementation
runs after the display transform. Per-layer grain requires a defined working
domain and blend behavior first.

Lens Fx should use the same graph/evaluator infrastructure as adjustments, but
remain a distinct module category with stricter `allowedScopes`.

## 4. Photoshop semantic mapping

### PSD Adjustment Layer

Maps to:

```ts
interface AdjustmentLayer {
  kind: 'adjustment';
  adjustments: AdjustmentStack;
  maskStack: MaskStack;
  clipping: AdjustmentClipping;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
}
```

Each Photoshop adjustment gets a typed module. Reuse LightTable controls and
shader primitives where possible, but retain the original Photoshop parameter
schema when formulas differ.

For example, these are distinct module types even if they share UI primitives:

```text
lt.exposure
psd.exposure
lt.color-mixer
psd.hue-saturation
```

An adapter may prove two types equivalent and export between them. Approximate
mapping must be visible in the export capability report.

### Smart Object

Maps to an asset-backed drawable layer:

```ts
interface SmartObjectLayer {
  kind: 'smart-object';
  sourceAssetId: AssetId;
  sourceMode: 'embedded' | 'linked';
  placedTransform: AffineMatrix;
  warp?: PreservedWarp | EditableWarp;
  filters: SmartFilterStack;
  fallbackPreview: PixelResourceId;
}
```

The source asset may be a nested PSD, raster image or other supported document.
Double-click/Open Contents opens a separate document session. Editing the
nested document invalidates the Smart Object result and all dependent graph
nodes.

Required UI:

- Smart Object layer icon and preview;
- Open/Edit Contents;
- Replace Contents;
- Relink, Embed and Update for linked assets;
- reset/replace placed transform;
- missing-link status;
- expandable Smart Filters;
- Convert to Smart Object for supported LightTable layers/groups;
- explicit Rasterize command.

### Smart Filter

Maps to an ordered filter stack owned by a Smart Object:

```ts
interface SmartFilterStack {
  revision: number;
  filters: FilterModuleInstance[];
  mask?: MaskStack;
}
```

Smart Filters can reuse registered LightTable adjustment/effect evaluators,
but preserve Photoshop filter descriptors independently. The UI appears as
expandable children below the Smart Object, with visibility, reorder, edit,
delete and filter-mask controls.

A LightTable layer-local grade does not automatically export as Smart Filters.
Export performs an explicit module-by-module capability mapping.

### Layer Style

Maps to a compositing/style stack, not the general grade stack:

```ts
interface LayerStyleStack {
  revision: number;
  effects: LayerStyleInstance[];
}
```

It owns Photoshop shadows, glows, bevel, overlays, satin and strokes. Styles
depend on layer alpha, fill opacity and group/compositing context, so evaluating
them as ordinary color adjustments is incorrect.

## 5. Serializable module contract

```ts
type ProcessingScope =
  | 'source'
  | 'layer'
  | 'smart-filter'
  | 'adjustment-layer'
  | 'group'
  | 'document-creative'
  | 'document-output';

interface ProcessingModuleDefinition<TParams> {
  type: string;
  label: string;
  category: 'tone' | 'color' | 'spatial' | 'lens' | 'style' | 'output';
  allowedScopes: ProcessingScope[];
  inputDomain: ProcessingDomain;
  outputDomain: ProcessingDomain;
  alphaBehavior: 'preserve' | 'generate' | 'modify' | 'consume-mask';
  coordinateSpace?: 'source' | 'layer' | 'group' | 'document';
  defaultParams(): TParams;
  compile(instance: ProcessingModuleInstance<TParams>): ProcessingGraphFragment;
  psdAdapters?: PsdModuleAdapter[];
}
```

Module instances have stable IDs, enabled state, opacity, revisions, typed
parameters and optional preservation payload. GPU resources never enter the
serializable document.

## 6. Grade panel behavior

The Grade panel is contextual and always states its target.

Examples:

```text
Grade - Layer: Portrait
Grade - Adjustment: Curves
Grade - Group: Characters
Grade - Smart Filter: Camera Raw
Grade - Document Grade
```

### Normal drawable layer selected

- Show its ordered layer-local modules.
- `Add adjustment` adds a module only to this layer.
- Current Grade controls may initially appear as one compound
  `LightTable Grade` module.
- A disclosure and indented Grade-icon + `Grade` child in the Layers panel indicate a
  present local grade; its eye toggles that local processing owner.

### Adjustment Layer selected

- Show that layer's adjustment modules.
- Expose mask, clipping, opacity and blend state in their appropriate
  Layers/Properties controls.
- Quick-add Adjustment Layers may start with one module.
- `Full LightTable Grade` creates the standard creative grade modules, not
  Lens Fx and not technical output processing.

### Group selected

- Show group-local modules only when the group has an isolated result that can
  be processed correctly.
- Pass-through group restrictions are visible rather than silently rendering
  with isolated semantics.

### Smart Object or Smart Filter selected

- Selecting the Smart Object edits its layer-local grade by default.
- Selecting an expanded Smart Filter edits that filter's parameters.
- Opening contents switches to the nested document; it does not repurpose the
  parent document Grade panel.

### Nothing editable selected

- Disable the controls and explain why.
- Do not silently fall back to a hidden global grade.

## 7. Layer-panel behavior

Recommended row structure:

```text
eye | type thumbnail | mask thumbnail | name | local-grade | fx | link | lock
```

Children may include:

- nested group layers;
- Smart Filters and their shared filter mask;
- Layer Styles;
- optional expanded local adjustment modules later.

Footer/add menu:

- Pixel/Paint Layer;
- Group;
- Adjustment Layer submenu;
- Text Layer;
- Shape Layer;
- Smart Object from file/selection;
- mask creation commands.

The UI may expose only implemented creation types. Imported unsupported layer
types remain visible, selectable, movable and preservation-safe.

## 8. Render graph examples

### Two independently graded layers

```text
Photo A source -> A local grade -> A transform/mask -+
                                                     +-> composite
Photo B source -> B local grade -> B transform/mask -+
```

### Unclipped Adjustment Layer

```text
lower layer graph -> lower composite
                         +-> adjustment stack -> adjusted
                         +----------------------> mix by mask/opacity
```

### Clipped Adjustment Layer

```text
lower composite ------------------------------------------------+
target isolated result -> clipped grade -> preserve target alpha +-> composite
                                                               -+
```

### Smart Object with Smart Filters and local grade

```text
embedded/linked document
-> nested composite cache
-> Smart Filter stack + filter mask
-> layer-local grade
-> placed transform/warp
-> layer mask/style/blend
-> parent composite
```

## 9. Migration from the current global state

The current `BasicAdjustments` must be split, not copied wholesale onto every
layer.

1. Extract reusable creative Grade modules.
2. Extract Lens Fx into their own effect modules and allowed scopes.
3. Keep technical display/output processing outside the layer tree.
4. Convert an existing non-default creative grade into a visible top-level
   `Document Grade` Adjustment Layer.
5. Keep current Lens Fx at document scope unless the user explicitly moves or
   recreates them at another supported scope.
6. Keep current grain document-level until its processing domain is redesigned.
7. Verify the migrated output against the pre-migration render.

## 10. Implementation order

- [ ] Inventory every current parameter and assign module, domain, scope and
      coordinate-space metadata.
- [ ] Create the module registry and serializable `AdjustmentStack`.
- [ ] Make the current complete-document grade render through the registry
      without visual change.
- [ ] Add grade state to one drawable layer and render it before compositing.
- [ ] Add contextual Grade panel targeting; local Grade ownership is already
  projected as an expandable Grade processing child.
- [ ] Add Adjustment Layers with masks and opacity.
- [ ] Add clipping using isolated target output.
- [ ] Add isolated groups, then verified pass-through groups.
- [ ] Add Smart Object asset nodes and nested document sessions.
- [ ] Add Smart Filter stacks and PSD adapters.
- [ ] Separate Layer Style evaluation from general adjustments.
- [ ] Add golden tests for every scope and cross-scope combination.

The first production checkpoint is not "the sliders moved to the layer." It is
two differently graded layers, one masked Adjustment Layer and one clipped
Adjustment Layer surviving undo/redo and save/open with identical output.
