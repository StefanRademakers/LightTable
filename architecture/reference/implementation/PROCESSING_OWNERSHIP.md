# LightTable explicit processing ownership

Status: authoritative ownership contract; progress reconciled with code on
31 July 2026.

This document replaces ambiguous document-wide creative processing with one
rule: every editable creative operation has a visible owner. It complements:

- `LIGHTTABLE_LAYER_SCOPE_AND_PSD_MAPPING.md`
- `archive/LIGHTTABLE_PER_LAYER_ADJUSTMENTS_AND_FUTURE_NODE_GRAPH.md`
- `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md`

The code now implements explicit Grade and Lens Fx ownership plus a registered,
ordered processing-node runtime. The generic runtime is real, but not every
Grade module has its own GPU executor yet; the combined Grade shader remains an
intentional bridge.

## Product model

### Grade

There are two forms:

1. **Grade Layer**: a real layer-tree node that grades eligible content below
   it. It supports order, groups, clipping, visibility, opacity, a mask,
   persistence and independent GPU state.
2. **Local Grade**: an editable stack owned by one raster/drawable layer and
   evaluated before that layer's transform, mask, styles and compositing.

Selecting either owner makes the Grade panel edit that exact owner. Selecting
an unsupported owner disables the panel. LightTable must never silently fall
back to a hidden global creative grade.

A raster row displays a local-grade badge when it owns a non-null stack. A new
Grade Layer starts neutral; it must not copy a stale panel value from the
previous owner.

### Lens Fx

Lens Fx should use the same two ownership forms:

1. **Lens Fx Layer**: an explicit effect layer over content below.
2. **Local Lens Fx**: an ordered effect stack attached to one drawable or Smart
   Object.

The common ownership model does not imply identical processing rules. Every
effect declares its valid domain, coordinates, bounds expansion and supported
owners. Lens blur, distortion and chromatic aberration cannot be moved between
scopes by merely copying parameters.

Lens Fx now use serialized owner-tagged stacks, registered GPU node executors,
local raster badges/toggles and explicit Lens Fx Layers. The renderer still has
scope-specific adapters while the full generic evaluator is being completed;
that limitation must remain visible in tests rather than being hidden as a
document-output fallback.

### Document output

Only technical operations remain implicit:

- working/display/output color conversion;
- HDR/SDR mapping;
- encoding, dithering and export resize;
- explicitly defined output sharpening.

Creative Grade and Lens Fx do not belong in this hidden stage.

## Current render contract

For a raster layer:

```text
decoded/generated source
-> local Grade
-> future local Lens Fx / filters
-> authoritative layer transform
-> layer mask
-> Layer Styles
-> opacity, fill and blend
-> parent composite
```

For a Grade or future Lens Fx Layer:

```text
lower composite
-> owned processing stack
-> layer mask, opacity and blend
-> parent composite
```

For final presentation:

```text
layer-tree composite
-> temporary document Lens Fx (until migrated)
-> technical output/display processing
-> screen/export
```

Internal image textures use linear premultiplied alpha unless a module
explicitly declares another domain. A module may not guess its coordinate
space.

## Processing stack direction

Do not build a free-form node editor yet. First introduce a reusable ordered
stack that can later compile into a graph.

```ts
interface ProcessingStack {
  id: string;
  revision: number;
  nodes: ProcessingNodeInstance[];
}

interface ProcessingNodeInstance<TSettings = unknown> {
  id: string;
  type: string;
  enabled: boolean;
  revision: number;
  opacity: number;
  settings: TSettings;
  maskId?: string;
}
```

Node definitions belong in one registry:

```ts
interface ProcessingNodeDefinition<TSettings> {
  type: string;
  label: string;
  category: 'grade' | 'lens' | 'spatial' | 'stylize' | 'output';
  allowedOwners: Array<
    'raster' | 'smart-object' | 'effect-layer' | 'group' | 'document-output'
  >;
  inputDomain: ProcessingDomain;
  outputDomain: ProcessingDomain;
  coordinateSpace: 'source' | 'layer' | 'group' | 'document' | 'display';
  alphaBehavior: 'preserve' | 'modify' | 'generate' | 'consume-mask';
  boundsBehavior: 'preserve' | 'expand' | 'replace';
  defaultSettings(): TSettings;
  compile(instance: ProcessingNodeInstance<TSettings>): GraphFragment;
}
```

Each definition must also declare:

- whether Web and Desktop backends support it;
- required texture format/precision;
- resource and cache policy;
- exact default/bypass behavior;
- PSD import/export adapters;
- whether rasterization is supported.

Disabled and default nodes are exact bypasses and allocate no effect-specific
GPU resources. An invalid optional node is reported and bypassed; it may not
brick image loading.

## Operation families and order

The final order is owned by the stack and node contracts, not by scattered
shader conditionals:

```text
source interpretation
-> source/local geometry (lens correction, distortion, CA)
-> Grade (tone, color, curves, mixer, grading)
-> spatial detail (blur, sharpen, texture, clarity, dehaze)
-> creative optical effects (halation, vignette)
-> transform/mask/composite
-> technical output
-> final grain/dither when configured as output texture
```

Some effects need a different legal location:

- Lens distortion and CA require declared source/layer geometry.
- Lens blur needs image plus optional depth/mask and can expand bounds.
- Halation is linear spatial processing.
- Grain may be local only after its working domain and scale behavior are
  defined; output grain remains a separate valid mode.
- Layer Styles are alpha-derived compositing operations and stay in
  `styleStack`, not in Grade/Lens stacks.

## Rasterize, merge and flatten

All non-destructive owners must be bakeable through the same evaluator used
for live preview.

Rasterizing a local stack:

1. render source plus the complete owned stack;
2. write the result at the document's supported precision;
3. replace source pixels;
4. clear the baked stack;
5. preserve transform and mask unless the command explicitly includes them;
6. produce one undo step.

Merging layers renders the exact selected subtree, including local stacks,
effect/Grade Layers, clipping, masks, styles, transforms, opacity and blend.
The merged raster receives identity transform only when pixels were baked into
document coordinates, and its visible bounds are recalculated from the baked
alpha. No baked stack may remain attached and run twice.

Current local raster Grade is included in merge/flatten evaluation. Dedicated
`Merge Down`/`Rasterize` behavior for a Grade Layer itself remains an explicit
next implementation item.

## PSD mapping

LightTable's document model is intended to be a superset, not a PSD wrapper.
The original PSD is not embedded in a saved LightTable document.

| Photoshop construct | LightTable owner |
|---|---|
| Pixel/paint layer | Raster/drawable layer |
| Group and order | Group/tree structure |
| Layer mask | Layer mask |
| Adjustment Layer | Typed Grade/Adjustment Layer |
| Clipped Adjustment Layer | Clipped Grade Layer |
| Smart Object | Asset-backed drawable with placed transform |
| Smart Filter | Ordered local processing stack on Smart Object |
| Camera Raw Smart Filter | Local typed Grade/filter nodes when parseable |
| Blur/sharpen/distort filters | Typed local spatial/lens nodes |
| Layer Styles | Separate Layer Style stack |
| Image > Adjustments | Already baked raster pixels |

An imported Photoshop node is classified as:

- **native**: same semantics and editable;
- **approximate**: editable but visibly reported as an approximation;
- **preserved**: descriptor retained for future/export work;
- **node preview**: only that node's raster fallback, never the whole document;
- **missing**: unsupported and reported.

Unknown descriptors and reusable external assets may be preserved, but not by
duplicating the complete PSD. Comparison tests render the reconstructed
LightTable tree and compare it with Photoshop's embedded composite or a
reference export.

## Persistence

The LightTable format serializes:

- layer tree and stable IDs;
- local and effect-layer stacks in order;
- node type, settings, enabled state and revisions;
- transforms, bounds, masks, clipping, styles and blend state;
- referenced source assets and preservation metadata.

GPU textures, transient passes and caches never enter the document.

LightTable is alpha 0.1. There is deliberately **no compatibility contract for
older experimental LightTable files** and no migration code should be added.
The current schema is corrected directly; old alpha documents may stop
loading. PSD compatibility is a separate import concern and does not justify
legacy branches in LightTable's own format.

The native format is frozen only for an actual public release. At that point
the schema, processing semantics, version policy, migration rules and open
format specification must be established and documented together. Until that
release checkpoint, current code and current files stay lean: no speculative
compatibility branches for discarded alpha schemas.

## Multi-document and hosts

Every document session owns its tree, history, selection, processing state,
GPU resources and caches. Only the active document publishes contextual Grade
or Lens controls and runs interactive scopes. The registry and evaluator are
shared services.

The same serializable model and processing contracts must work in:

- Web;
- Electron Desktop;
- the StoryBuilder host adapter.

Host capabilities may differ, but documents and node semantics may not.

## Cache and memory rules

Cache keys include node revision plus all input/source/mask/transform revisions
that affect output. Expensive nodes may retain one valid output; transient
ping-pong textures come from a shared pool. Active-document resources get
priority. Inactive documents may keep serialized state while releasing
rebuildable GPU caches.

No premature full-document stamping is allowed. Destructive stamping is a
user command; caching is an invisible engine optimization.

## Verification

Required test layers:

- unit tests for ownership, targeting, serialization and exact bypass;
- GPU golden tests for each module and processing order;
- local-stack merge/flatten equivalence;
- masked and clipped Grade/Effect Layer cases;
- transform plus mask coordinate tests;
- Web and Electron smoke tests;
- PSD fixture reconstruction against Photoshop reference composites;
- resource lifecycle and multi-document switching tests.

## Staged implementation

- [x] Raster layers can own a serialized local Grade stack.
- [x] Grade Layers own independent serialized Grade stacks.
- [x] Selecting either owner targets the Grade panel explicitly.
- [x] Hidden document creative Grade is removed from normal rendering.
- [x] Local raster Grade uses the shared GPU Grade evaluator.
- [x] Local raster Grade is included in merge/flatten rendering.
- [x] Local Grade presence is visible on the raster layer row.
- [ ] Disable Grade controls with a clear target message for unsupported
      selections.
- [ ] Add explicit Rasterize Local Grade.
- [ ] Add Merge Down/Rasterize semantics for Grade Layers.
- [x] Replace the fixed Lens Fx sequence with registered Lens nodes in
      serialized stack order.
- [x] Add Local Lens Fx ownership and layer-row badge/toggle.
- [x] Add Lens Fx Layer creation using the canonical mask, order, group and
      clipping model.
- [x] Introduce the generic `AdjustmentStack`/processing-node registry behind
      current adapters.
- [x] Prove the registry with spatial nodes and exact disabled-node bypass.
- [x] Register distortion, CA, blur, halation and grain as node executors.
- [ ] Add Smart Object assets and ordered Smart Filter stacks.
- [ ] Map supported PSD filters to typed nodes and report all fallbacks.
- [ ] Finish revision caches, texture pooling and explicit inactive-document
      eviction. Inactive renderer suspension and multiple resource owners are
      implemented; the final eviction policy is not.
- [ ] Replace the combined Grade bridge with per-module executors in the
      ordered evaluator. A graph UI remains a later product step.

The immediate production checkpoint is two differently graded raster layers,
one masked Grade Layer and one clipped Grade Layer surviving undo/redo,
save/open, merge/flatten and Web/Desktop rendering without a hidden global
creative state.
