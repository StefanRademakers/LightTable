# LightTable — Current Architecture Risks and Recommended Guardrails

## Purpose

This document reviews the current LightTable architecture from a risk-management perspective.

The core architecture is strong enough to support a serious professional editor. The main risk is no longer that the high-level design is fundamentally wrong. The main risk is that rapid feature development gradually bypasses or weakens the architectural boundaries that already exist.

The goals of this document are to:

- identify the most important current architectural risks;
- explain how those risks are likely to surface;
- define practical guardrails;
- propose concrete refactors and diagnostics;
- give the coding agent clear implementation priorities;
- prevent text, PDF, PSD, vector, 3D, AI, and Smart Object work from creating parallel render or document systems.

This is not a recommendation to rewrite LightTable. It is a recommendation to make the current architecture more explicit, measurable, and enforceable.

---

# Executive assessment

LightTable currently has the correct architectural direction:

- `ImageDocument` is the canonical serializable source of truth;
- `DocumentSession` owns transient state for one open document;
- GPU resources are renderer-owned rather than document-owned;
- content rendering is separate from viewport presentation;
- editor overlays are separate from document pixels;
- scene transforms have a centralized model;
- the compositor owns layer evaluation semantics;
- vector source data is separate from vector realization and GPU data;
- caches are derived, revisioned, and disposable;
- host integration is separated from editor logic.

These decisions are suitable for:

- raster editing;
- non-destructive processing;
- vector layers;
- text layers;
- PSD import/export;
- PDF import/export;
- Smart Objects;
- 3D layers;
- AI and procedural nodes;
- multi-document desktop workflows.

The present danger is **architectural erosion**:

```text
good central model
+ quick feature shortcuts
+ duplicated calculations
+ implicit ownership
= difficult-to-debug inconsistency
```

The highest-priority work should therefore focus on enforcing the existing boundaries before adding many more complex node and layer types.

---

# Risk priority overview

| Priority | Risk | Likely impact |
|---|---|---|
| Critical | Transform authority is not used everywhere | Incorrect painting, masks, selections, nested groups, rasterize, PDF placement |
| Critical | Multiple interpretations of layer semantics | Preview/export/merge/rasterize differences |
| Critical | `WebGpuEngine` becomes a god object | Coupling, leaks, impossible scheduling and device-loss recovery |
| High | Large editor facade owns hidden application logic | Fragile lifecycle, difficult testing, unclear dependencies |
| High | Processing is structurally monolithic | Hard to add nodes, reorder operations, fuse safely, support PSD/PDF semantics |
| High | Cache invalidation becomes opaque | Stale frames, unnecessary GPU work, memory growth |
| High | Resource ownership is inconsistently enforced | VRAM leaks, retained document resources, unstable multi-document use |
| High | New content types build private render pipelines | Duplicate compositing, inconsistent masks/styles/export |
| Medium | React state enters high-frequency interaction paths | Pointer latency, unnecessary rerenders, editing jitter |
| Medium | Host capabilities leak into document/editor packages | Electron/web divergence and difficult reuse |
| Medium | Import formats shape the native document model | PSD/PDF quirks contaminate core architecture |
| Medium | Performance decisions are not observable | Regressions remain hidden until documents become large |
| Medium | Commands and previews are not consistently transactional | Broken undo semantics and large histories |
| Medium | Rasterize/merge/export diverge from viewport evaluation | Destructive correctness failures |

---

# 1. Risk: incomplete transform authority migration

## Problem

LightTable has the correct core transform model:

```text
localToParent
```

with world/document transforms derived centrally:

```text
localToDocument =
    parentLocalToDocument * localToParent
```

The risk is that some subsystems may still calculate offsets, bounds, or inverse mappings independently.

Typical offenders include:

- paint tools;
- mask painting;
- selection tools;
- transform previews;
- vector handles;
- clipboard placement;
- bounds calculation;
- hit testing;
- rasterize;
- merge;
- imported PSD/PDF objects;
- group reparenting;
- tool-specific “fix offsets.”

A centralized transform model only works when it is the **exclusive transform authority**.

## Failure symptoms

- painting lands at an offset inside transformed groups;
- mask strokes and layer strokes disagree;
- selections drift after nested transforms;
- bounds are correct for rendering but wrong for gizmos;
- copy/paste changes world position;
- rasterized output shifts;
- PDF objects import at the correct size but wrong position;
- group reparenting changes visual placement;
- bugs only appear at non-identity parent transforms;
- bugs only appear after multiple transform operations.

## Impact

This risk affects almost every future content type. It becomes especially dangerous for:

- text on paths;
- nested vector groups;
- PDF page-object matrices;
- Smart Objects;
- perspective transforms;
- 3D projection;
- warped or deformed content.

## Required guardrail

No tool, importer, renderer, or export path may independently derive a world transform.

Introduce or complete a single transform service:

```ts
interface SceneTransformResolver {
  getLocalToParent(nodeId: NodeId): Matrix3;
  getLocalToDocument(nodeId: NodeId): Matrix3;
  getDocumentToLocal(nodeId: NodeId): Matrix3;
  mapPoint(
    point: Vec2,
    from: CoordinateSpace,
    to: CoordinateSpace
  ): Vec2;
  mapRect(
    rect: Rect,
    from: CoordinateSpace,
    to: CoordinateSpace
  ): Rect;
}
```

Coordinate spaces should be explicit types rather than comments:

```ts
type CoordinateSpace =
  | { kind: 'viewport' }
  | { kind: 'document' }
  | { kind: 'layer-local'; layerId: LayerId }
  | { kind: 'mask-local'; layerId: LayerId }
  | { kind: 'path-local'; layerId: LayerId; pathId: PathId };
```

## Recommended actions

1. Search for all manual matrix multiplications and coordinate offsets.
2. Classify each call site:
   - canonical transform resolution;
   - presentation transform;
   - temporary interaction transform;
   - accidental duplicate transform logic.
3. Replace duplicated scene calculations with the resolver.
4. Add nested-group tests using:
   - translation;
   - rotation;
   - non-uniform scale;
   - negative scale;
   - parent and child transforms together.
5. Test the same geometry through:
   - render;
   - hit test;
   - selection;
   - paint;
   - mask;
   - rasterize;
   - merge;
   - export.

## Acceptance criteria

- The same node bounds are reported by rendering, hit testing, gizmos, rasterize, and export.
- Reparenting preserves document-space appearance.
- No production tool contains a hard-coded visual offset correction.
- Nested transforms pass deterministic snapshot tests.
- Importers only provide local transforms and never write viewport transforms into the document.

---

# 2. Risk: multiple interpretations of layer semantics

## Problem

The compositor is intended to be the only authority that translates the layer tree into ordered rendering operations.

The risk is that other systems independently interpret layer semantics:

- thumbnails;
- export;
- merge;
- rasterize;
- scopes;
- clipboard;
- preview renderers;
- import adapters;
- effect panels;
- special tools.

If each subsystem has its own understanding of masks, clipping, styles, opacity, fill opacity, groups, and adjustment layers, they will eventually disagree.

## Failure symptoms

- viewport looks correct but export differs;
- merged layers do not match the visible result;
- thumbnails ignore clipping or styles;
- scopes analyze a different image from the viewport;
- adjustment layers behave differently during rasterization;
- group opacity differs from Photoshop or from exported output;
- PDF transparency groups render differently after import;
- disabled nodes still affect one path but not another.

## Impact

This is one of the most serious correctness risks because it creates non-local bugs. A user can edit successfully for hours and only discover a mismatch during export or flattening.

## Required guardrail

All evaluation must originate from one pure planning layer:

```ts
interface CompositorPlanner {
  buildPlan(
    document: ImageDocument,
    request: CompositorRequest
  ): CompositorPlan;
}
```

The plan should be independent from WebGPU and testable without a device.

Possible requests:

```ts
type CompositorRequest =
  | ViewportCompositeRequest
  | ExportCompositeRequest
  | RasterizeRequest
  | MergeRequest
  | ThumbnailRequest
  | ScopeInputRequest;
```

Different requests may change:

- output dimensions;
- quality;
- region;
- color space;
- target format;
- included overlays;
- cache strategy.

They must not change the meaning of the document.

## Recommended actions

1. Document the canonical layer evaluation order.
2. Encode that order in the planner, not in UI or individual renderers.
3. Make rasterize, merge, export, thumbnail, and scopes consume a compositor plan.
4. Add a plan inspector for development builds.
5. Add golden tests for:
   - clipping chains;
   - nested groups;
   - adjustment layers;
   - fill opacity versus opacity;
   - masks;
   - Layer Styles;
   - isolated groups;
   - disabled processing nodes.

## Acceptance criteria

- A rendered export matches the viewport at equivalent resolution and color settings.
- Rasterize and merge match the visible document result.
- Thumbnails are produced by a reduced-quality plan, not separate layer semantics.
- The same document fixture produces equivalent operation ordering across all output targets.
- No panel or tool decides layer evaluation order.

---

# 3. Risk: `WebGpuEngine` becomes a god object

## Problem

A central WebGPU engine is useful for low-level infrastructure. It becomes dangerous when it also owns high-level editor coordination.

Potential responsibilities that should not accumulate in one class:

- device creation;
- adapter selection;
- context management;
- resource factories;
- compositor scheduling;
- layer realization;
- vector rendering;
- text rendering;
- scopes;
- overlays;
- export;
- cache eviction;
- document lifecycle;
- tool previews;
- GPU timing;
- device-loss recovery.

## Failure symptoms

- every feature requires editing `WebGpuEngine`;
- renderer packages cannot be tested independently;
- device loss requires special-case recovery throughout one class;
- document cleanup misses resources;
- changes to scopes break layer rendering;
- export depends on viewport state;
- constructors receive many unrelated dependencies;
- the engine holds references to active React/editor objects;
- multi-document scheduling becomes difficult.

## Impact

A god engine slows feature development and makes resource ownership ambiguous. It also makes it nearly impossible to introduce text, PDF, vector, 3D, and procedural rendering cleanly.

## Required guardrail

Reduce `WebGpuEngine` to low-level shared infrastructure:

```ts
interface WebGpuPlatform {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;

  createTexture(...): OwnedGpuTexture;
  createBuffer(...): OwnedGpuBuffer;
  createSampler(...): GPUSampler;

  onDeviceLost(handler: DeviceLostHandler): Disposable;
}
```

Higher-level owners should be separate:

```text
DocumentRenderer
├── LayerCompositor
├── RasterLayerRenderer
├── VectorLayerRenderer
├── TextLayerRenderer
├── ProcessingExecutorRegistry
├── OverlayRenderer
├── ScopeRenderer
└── DocumentGpuCache
```

Each owner should expose:

- inputs;
- outputs;
- revision dependencies;
- resource ownership;
- disposal;
- device-loss reconstruction.

## Recommended actions

1. Inventory every current responsibility of `WebGpuEngine`.
2. Separate infrastructure from document-specific behavior.
3. Move feature-specific pipelines into dedicated packages or renderer classes.
4. Prevent direct imports from UI/tools into low-level WebGPU infrastructure.
5. Add ownership tests that verify all document-scoped resources are destroyed when a document closes.

## Acceptance criteria

- Adding a new layer type does not require extending a monolithic engine switch in many places.
- Device loss can recreate renderer-owned resources from document state.
- Closing a document destroys its GPU resources without destroying global shared resources.
- The WebGPU platform package does not import React, document commands, or tool controllers.
- Scope, overlay, and export rendering can be disabled without changing core compositing behavior.

---

# 4. Risk: the editor root becomes an integration god component

## Problem

`LightTableEditorOverlay.tsx` or an equivalent root component may still coordinate too many concerns:

- active document;
- active tool;
- keyboard routing;
- panel state;
- viewport state;
- renderer lifecycle;
- dialogs;
- import/export;
- host capabilities;
- command dispatch;
- selection;
- notifications.

A root component may assemble these systems, but it should not define their behavior.

## Failure symptoms

- very large effects with many dependencies;
- difficult lifecycle ordering;
- editor logic cannot run without React;
- actions are implemented as component callbacks;
- tools reach into unrelated UI state;
- render invalidation is triggered directly from UI code;
- desktop and web roots diverge;
- tests require mounting the entire application.

## Required guardrail

The React root should primarily perform dependency wiring and view composition.

Move behavior into explicit controllers:

```text
EditorApplication
├── WorkspaceController
├── CommandDispatcher
├── ToolManager
├── KeyboardRouter
├── SelectionController
├── HostCapabilityAdapter
├── DialogController
└── NotificationService
```

React should subscribe to stable view models rather than owning the editor’s operational logic.

## Recommended actions

1. Extract command and lifecycle logic from the root component.
2. Introduce small controller interfaces.
3. Use React for presentation and low-frequency state.
4. Keep pointer-frequency state outside React.
5. Ensure controllers can be tested without a DOM or GPU where possible.

## Acceptance criteria

- The editor root can be understood as a composition map.
- Tool behavior can be unit-tested without mounting the whole editor.
- Host capabilities are injected through interfaces.
- Renderer invalidation is semantic, not an arbitrary React effect.
- Pointer movement does not cause application-wide React rerenders.

---

# 5. Risk: processing is semantically monolithic

## Problem

Some grading or image-processing functionality may still exist as one large settings object or shader.

Combining compatible operations into a single shader is good for performance. Treating them as one inseparable semantic feature is not.

The correct direction is:

```text
modular semantic operations
→ planner validation and optimization
→ fused GPU execution where compatible
```

Not:

```text
one large shader
→ artificial node labels added later
```

## Failure symptoms

- operation order cannot change safely;
- per-layer and adjustment-layer processing diverge;
- one setting invalidates the entire stack;
- adding PSD adjustment types requires editing a giant shader;
- disabled operations still cost GPU work;
- export and preview use different processing code;
- node fusion cannot explain which semantics were combined.

## Required guardrail

Every processing operation should have a registered descriptor:

```ts
interface ProcessingNodeDescriptor<TSettings> {
  readonly type: ProcessingNodeType;
  readonly inputDomain: ProcessingDomain;
  readonly outputDomain: ProcessingDomain;
  readonly alphaBehavior: AlphaBehavior;
  readonly coordinateSpace: ProcessingCoordinateSpace;

  validate(settings: TSettings): ValidationResult;
  getRevisionDependencies(settings: TSettings): readonly RevisionDomain[];
  createExecutor(context: ExecutorContext): ProcessingExecutor<TSettings>;
}
```

The planner may fuse nodes when:

- order is preserved;
- domains are compatible;
- alpha behavior is compatible;
- precision remains acceptable;
- no intermediate result is externally required.

## Recommended actions

1. Enumerate existing grade and lens operations.
2. Define each as a semantic node even if execution remains fused initially.
3. Add an optimizer that groups compatible nodes into passes.
4. Ensure disabled nodes produce no execution work.
5. Record fused-pass composition in the debug graph.

## Acceptance criteria

- A node can be reordered without rewriting an unrelated shader.
- The same node runs on raster layers and adjustment layers through the same executor contract.
- Disabled nodes create no GPU pass and no shader work.
- Fused execution produces the same output as unfused reference execution within an explicit tolerance.
- Processing order is serialized in the document model.

---

# 6. Risk: cache invalidation becomes opaque

## Problem

Revision-based caching is the right design. As the number of revisions grows, invalidation can become hard to reason about.

Potential revision domains include:

- source pixels;
- layer geometry;
- group geometry;
- masks;
- paths;
- processing;
- styles;
- clipping;
- composite content;
- viewport;
- overlay;
- scopes;
- text shaping;
- text layout;
- glyph realization;
- imported PDF display lists.

Without observability, two bad outcomes appear:

1. stale caches remain visible;
2. too much work is invalidated and performance collapses.

## Failure symptoms

- edits sometimes do not appear until another action;
- pan/zoom triggers full composites;
- changing layer color reshapes text;
- changing opacity rerenders vector geometry;
- disabled nodes invalidate outputs;
- inactive documents continue submitting work;
- VRAM usage grows after repeated edits;
- cache bugs disappear when debugging.

## Required guardrail

Every derived cache should declare:

```ts
interface DerivedCacheDescriptor {
  readonly ownerId: string;
  readonly cacheId: string;
  readonly dependencyKey: string;
  readonly estimatedBytes: number;
  readonly lastUsedFrame: number;
  readonly qualityBucket?: string;

  dispose(): void;
}
```

A cache key should be generated from explicit dependencies, not from vague “document changed” flags.

## Required diagnostic tool

Create a development-only render and cache inspector showing:

- which revisions changed;
- why a stage became dirty;
- which cache key missed;
- which cache entry was reused;
- GPU bytes allocated;
- GPU bytes released;
- CPU cache bytes;
- GPU pass count;
- queue submissions;
- timing per stage;
- active/inactive document work.

Example:

```text
TextLayer 24
  shaping cache      HIT
  paragraph layout   HIT
  glyph realization  MISS: paintRevision 34 → 35
  source texture     REBUILT
  compositor input   UPDATED
```

## Recommended actions

1. Standardize cache descriptors.
2. Add debug names to all GPU resources.
3. Add a global cache registry per `DocumentSession`.
4. Add budget-based eviction.
5. Add assertions for resource use after disposal.
6. Add deterministic invalidation tests.

## Acceptance criteria

- Developers can explain every render pass from the inspector.
- Pan/zoom does not invalidate content caches.
- A layer transform does not invalidate source pixels or text shaping.
- Document closure returns document-scoped GPU memory near baseline.
- Disabled processing nodes do not invalidate downstream output when irrelevant.
- Cache eviction is measurable and deterministic under fixed budgets.

---

# 7. Risk: GPU resource ownership is inconsistent

## Problem

The document correctly does not own GPU resources. The remaining risk is unclear ownership among renderers, caches, sessions, and global services.

Particularly risky resources:

- texture atlases;
- temporary submission buffers;
- compositor ping-pong targets;
- layer source textures;
- vector geometry buffers;
- text glyph atlases;
- PDF page caches;
- scope textures;
- export targets;
- shared samplers and pipelines.

## Failure symptoms

- closing documents does not lower VRAM usage;
- shared atlases are destroyed while still in use;
- resources survive device loss incorrectly;
- duplicate pipelines are created per document;
- temporary resources are retained indefinitely;
- inactive documents retain full-resolution page caches;
- export leaks large textures.

## Required guardrail

Classify resources explicitly:

```text
Global device resources
- immutable shared pipelines
- common samplers
- shared shader modules

Workspace resources
- optional shared font/glyph caches
- cross-document asset caches with budgets

Document resources
- layer realizations
- composite targets
- per-document vector/text/PDF caches

Frame/submission resources
- temporary buffers
- staging textures
- transient render targets
```

Every owner must implement deterministic disposal.

## Recommended actions

1. Add an owner ID and debug label to every allocation wrapper.
2. Track bytes by:
   - global;
   - workspace;
   - document;
   - frame.
3. Verify that each cache has a device-loss rebuild path.
4. Use explicit submission fences or lifetime management for transient resources.
5. Build stress tests that repeatedly:
   - open documents;
   - edit;
   - close;
   - import PDF;
   - export;
   - simulate device loss.

## Acceptance criteria

- Resource reports identify the owner of every large texture or buffer.
- Document resources are released on close.
- Shared resources survive document closure.
- Device loss restores the visible document from canonical state.
- Multi-document memory remains within configured budgets.
- No command or document node stores a GPU object.

---

# 8. Risk: new content types create private rendering systems

## Problem

Text, PDF, Smart Objects, 3D, and AI/procedural nodes are complex. The temptation will be to give each feature its own rendering and compositing logic.

This would undermine the current architecture.

Examples of dangerous parallel systems:

- text renderer applies its own masks and opacity;
- PDF importer renders a complete page separately;
- 3D layer bypasses layer styles and clipping;
- Smart Object preview has its own transform model;
- AI result nodes store live GPU textures in the document;
- vector export uses different path realization from viewport rendering.

## Required guardrail

Every first-class content type should follow the same package pattern:

```text
<type>-core
    serializable source model and commands

<type>-rendering
    immutable realization and CPU/WASM caches

<type>-webgpu
    GPU resources, pipelines, atlases, and execution
```

Each content type must produce a common compositor-facing realization:

```ts
type LayerSourceRealization =
  | RasterSourceRealization
  | VectorSourceRealization
  | TextSourceRealization
  | ProceduralSourceRealization
  | ThreeDSourceRealization;
```

The compositor remains responsible for:

- masks;
- processing;
- Layer Styles;
- fill opacity;
- clipping;
- layer opacity;
- blend mode;
- parent composite.

## Recommended actions

1. Define the common realization contract before implementing text/PDF.
2. Prevent feature renderers from accessing parent composites directly unless explicitly required by a processing node.
3. Require new layer types to document:
   - canonical source;
   - revision domains;
   - realization cache;
   - compositor output;
   - bounds;
   - disposal;
   - device-loss behavior;
   - export behavior.
4. Review every new renderer for duplicated mask/blend/style logic.

## Acceptance criteria

- New content types integrate without duplicating compositor semantics.
- Text and vector sources can share path and fill infrastructure.
- PDF page objects become native layer sources or explicit fallback objects.
- A 3D layer produces a normal premultiplied source realization.
- AI-generated content is represented by serializable parameters/assets, not live renderer state.

---

# 9. Risk: high-frequency interaction enters React state

## Problem

Pointer-driven tools require updates at interaction frequency. React is suitable for controls and application state, but not as the authoritative path for every pointer move.

## Failure symptoms

- transform gizmos stutter;
- brush cursors lag;
- panel rerenders occur during painting;
- pointer events generate many document mutations;
- undo history receives preview states;
- resizing docked panels affects canvas responsiveness;
- tool behavior depends on React effect timing.

## Required guardrail

Use a transactional tool interaction model:

```text
pointer down
→ start interaction transaction

pointer move
→ update disposable preview state
→ coalesce to animation frame
→ invalidate overlay or required preview stage

pointer up
→ force final preview
→ commit one document command
→ release temporary resources
```

React may display current values, but the preview controller should remain outside high-frequency component state.

## Recommended actions

1. Audit all pointer handlers.
2. Move gesture state into tool controllers.
3. Coalesce preview evaluation per frame.
4. Separate overlay dirty state from document content dirty state.
5. Ensure property panels receive throttled view-model updates.

## Acceptance criteria

- A continuous gesture produces one undo entry.
- Pointer movement does not serialize the document each frame.
- Overlay-only movement does not recomposite layer content.
- React profiler shows no broad application rerender during brush or transform movement.
- Pointer-up always commits the final displayed state.

---

# 10. Risk: host capabilities leak into editor architecture

## Problem

LightTable targets web, Electron desktop, and StoryBuilder integration. Host-specific logic can gradually leak into core packages.

Examples:

- direct Electron APIs in tools;
- browser clipboard assumptions in document commands;
- filesystem paths in serializable document nodes;
- host dialogs triggered inside renderers;
- desktop-only font discovery in text core;
- StoryBuilder-specific media objects in the layer model.

## Required guardrail

Use explicit capability interfaces:

```ts
interface HostCapabilities {
  readonly files: FileCapability;
  readonly clipboard: ClipboardCapability;
  readonly fonts: FontDiscoveryCapability;
  readonly dialogs: DialogCapability;
  readonly media: MediaLibraryCapability;
  readonly shell: ShellCapability;
}
```

Core packages should depend on abstract asset IDs and services, not on host objects.

## Recommended actions

1. Search for Electron, DOM, and StoryBuilder imports in shared packages.
2. Move them behind adapters.
3. Keep serialized documents host-neutral.
4. Add a minimal test host that runs core/editor logic without Electron.
5. Make font discovery separate from font parsing and shaping.

## Acceptance criteria

- The same document opens in web and desktop.
- Text core does not depend on system font APIs.
- Renderer packages do not invoke dialogs or filesystem operations.
- Clipboard operations convert through document-level transfer objects.
- StoryBuilder integration remains an adapter rather than a special document mode.

---

# 11. Risk: PSD and PDF define the native architecture

## Problem

PSD and PDF contain valuable semantics, but also format-specific behavior and historical quirks. It would be a mistake to reshape the LightTable core model around every external detail.

## Failure symptoms

- layer nodes contain PSD-only fields used by normal rendering;
- PDF operator state leaks into generic tools;
- import IDs become permanent runtime identities;
- unsupported external semantics are silently approximated;
- round-trip preservation data controls native editing;
- internal nodes become difficult to understand without format specifications.

## Required guardrail

Use adapter layers:

```text
external format
→ parsed external representation
→ normalized import/display model
→ native LightTable nodes
```

Preservation metadata should remain separate:

```ts
interface ExternalPreservationData {
  readonly format: 'psd' | 'psb' | 'pdf';
  readonly sourceObjectId?: string;
  readonly opaqueBlocks?: readonly AssetId[];
  readonly unsupportedFeatures?: readonly ImportIssue[];
}
```

Native editing should operate on native semantics. Preservation metadata is for round-trip support, diagnostics, or fallback.

## Recommended actions

1. Create normalized PSD/PDF import models.
2. Generate explicit import reports.
3. Track separate parity dimensions:
   - structural;
   - editable semantic;
   - visual;
   - preservation.
4. Preserve unsupported data without letting it become active renderer state.
5. Use external reference renderers for fidelity comparison.

## Acceptance criteria

- Imported documents can be represented without PSD/PDF classes in the compositor.
- Unsupported semantics are reported rather than silently discarded.
- Native layers remain understandable independent of source format.
- Round-trip metadata can be removed without breaking native rendering.
- PDF positioned text and LightTable flow text share downstream glyph rendering but retain different source semantics.

---

# 12. Risk: rasterize, merge, flatten, and export diverge

## Problem

Destructive operations are correctness boundaries. They must evaluate all visible semantics exactly once and then replace them with a simpler result.

Required semantics include:

- source pixels or vector/text realization;
- transforms;
- masks;
- processing;
- Lens Fx;
- Layer Styles;
- clipping;
- group behavior;
- blend modes;
- color management;
- alpha behavior.

## Failure symptoms

- rasterized text shifts or changes appearance;
- merged layers lose clipping;
- layer styles are cropped;
- flattening changes group appearance;
- exported bounds omit effect padding;
- rasterized layers retain historical transforms unexpectedly;
- precision differs between export and viewport.

## Required guardrail

All destructive operations must use the compositor planner and a defined output contract.

Expected rasterized result:

```text
evaluated visible result
→ tight bounds including required effect padding
→ new raster asset
→ identity local transform or explicitly documented placement transform
→ no hidden historical processing semantics
```

## Recommended actions

1. Make rasterize and merge explicit compositor requests.
2. Centralize tight-bounds measurement.
3. Define effect padding and clipping behavior.
4. Test linear-premultiplied alpha correctness.
5. Test at multiple bit depths and color spaces.
6. Compare before/after images with GPU and CPU-readable fixtures.

## Acceptance criteria

- Rasterize is visually equivalent within declared tolerance.
- New raster layers have predictable bounds and transforms.
- Merge-down matches the visible pair including masks/styles/clipping.
- Export and flatten use the same semantic plan as the viewport.
- Precision and color transforms are explicit.

---

# 13. Risk: command and preview semantics drift

## Problem

Tools should commit one meaningful command per user gesture. Temporary preview state must not become document history.

As tools become more advanced—warp, vector editing, text, path text, 3D transforms—preview and command logic can diverge.

## Failure symptoms

- hundreds of undo entries from one drag;
- cancel leaves partial document mutations;
- redo produces a different result than the original interaction;
- preview looks different from committed output;
- temporary GPU resources survive after cancel;
- asynchronous processing commits stale results.

## Required guardrail

Every interactive tool must implement:

```ts
interface ToolGestureTransaction<TPreview, TCommand> {
  begin(context: GestureBeginContext): void;
  update(input: GestureInput): TPreview;
  commit(): TCommand;
  cancel(): void;
  dispose(): void;
}
```

The committed command must derive from the final preview state or shared parameters, not from a separate approximation.

## Recommended actions

1. Standardize tool transaction interfaces.
2. Add cancellation tests.
3. Add stale async result guards using document and node revisions.
4. Ensure preview caches are disposable.
5. Ensure undo commands store semantic state or assets, never live GPU resources.

## Acceptance criteria

- One gesture creates one undo entry.
- Cancel restores the pre-gesture document exactly.
- Redo reproduces the committed result.
- Async work cannot overwrite a newer document revision.
- Preview and committed rendering use the same realization logic.

---

# 14. Risk: insufficient architecture and performance observability

## Problem

A complex GPU editor cannot be optimized reliably from intuition alone.

Without diagnostics, regressions are detected only after:

- large documents;
- many layers;
- nested effects;
- multiple open documents;
- integrated GPUs;
- high-DPI screens;
- large PDF pages;
- complex text layouts.

## Required development tooling

Create an internal diagnostics workspace with:

### Render graph

```text
Layer source
→ processing nodes
→ mask
→ styles
→ clipping
→ blend
→ parent target
```

### Dirty graph

Show:

- changed revision;
- affected stages;
- reason;
- downstream invalidation.

### GPU memory

Show bytes by:

- document;
- renderer;
- cache;
- texture format;
- buffer;
- transient versus persistent.

### Timing

Show:

- CPU layout/planning time;
- command encoding time;
- GPU pass time;
- queue submissions;
- text shaping/layout time;
- vector realization time;
- scope analysis time.

### Cache behavior

Show:

- hits;
- misses;
- evictions;
- rebuild reason;
- quality bucket;
- last use.

## Recommended actions

1. Build the inspector before text/PDF significantly expand the render graph.
2. Add debug labels to all WebGPU resources and passes.
3. Add performance fixtures to CI or repeatable local benchmarks.
4. Record baseline performance before major package refactors.
5. Test both high-end discrete GPUs and integrated/low-memory configurations.

## Acceptance criteria

- A developer can identify why a frame was submitted.
- A developer can identify the largest document cache owners.
- Performance benchmarks are repeatable.
- Integrated-GPU regressions are visible before release.
- New layer types expose their revision and cache behavior in the inspector.

## Measured large-document baseline (2026-08-06, Task 095)

The repeatable desktop audits now cover the ten Save-the-Date PSD templates,
ordinary raster files, canvas tools, text caret presentation and the compositor,
vector and text engines. On the current discrete-GPU reference machine:

- the ten PSD first-use samples range from 1,197 to 2,644 ms; EHS-396 is 1,871 ms;
- the 3000 x 4242 EHS-396 canvas holds about 1.82 GiB before transient Warp resources;
- a representative PNG reaches first useful frame in 260 ms; the 12.7 MP JPEG in 886 ms;
- text caret overlay work reaches GPU completion at 15.8 ms median and 18.2 ms p95;
- settled documents submit zero background frames;
- six-round corpus interaction samples retain no GPU bytes and no growing listeners.

Large-canvas Warp is intentionally newest-state bounded. Documents up to four
megapixels stay at display cadence, four to eight megapixels use a 100 ms floor,
and larger documents use a 500 ms floor while the exact pointer-up state is
always rendered. On EHS-396 this reduced a fixed gesture from 34 to 16 full
composites and from 11.1 s to 9.2 s. Packing its two existing half-float
displacement channels into one `r32uint` texture preserves the same precision
while reducing transient Warp growth from 305.4 MiB to 203.6 MiB.

Two attractive startup changes were measured and rejected: parallel preview
and semantic serialization in the same PSD worker worsened first frame from
1,717 to 1,901 ms, and an early-preview protocol produced no repeatable first-
use gain. Do not reintroduce either without a new isolated-worker A/B result.

The performance gate remains settled visual equality, zero steady-state GPU
growth, bounded post-GC heap/DOM/listeners, zero unchanged background frames,
and per-action render telemetry. Short two-round DOM warm-up spikes must be
retested over six rounds before being classified as a leak.

---

# 15. Risk: abstraction grows faster than product needs

## Problem

LightTable is becoming a general document and scene engine. That is useful internally, but excessive abstraction can make ordinary editor features unnecessarily difficult to implement.

## Failure symptoms

- a simple adjustment requires many generic graph objects;
- common Photoshop-like actions become awkward;
- generic systems expose too much complexity to UI code;
- plugin-style abstraction appears before stable internal contracts exist;
- performance is sacrificed for theoretical extensibility.

## Required guardrail

Keep a distinction between:

```text
generic internal execution architecture
and
task-specific editor commands and UI
```

The user should interact with:

- layers;
- tools;
- adjustments;
- properties;
- masks;
- paths;
- text.

The internal planner may use nodes and render contracts without exposing a node graph unless a specific workspace benefits from it.

## Recommended actions

1. Prefer clear feature-oriented commands over generic mutation APIs.
2. Introduce extension points only after two or more real use cases exist.
3. Measure overhead of abstraction in hot paths.
4. Keep serialized models explicit and readable.
5. Avoid turning every property into a graph node.

## Acceptance criteria

- Common operations remain straightforward to implement.
- Internal node execution does not force node-based UI.
- Hot paths avoid unnecessary allocation and dynamic dispatch.
- New abstractions have documented current use cases.

---

# Recommended package-boundary rules

The architecture should be reinforced with package import constraints.

## Suggested dependency direction

```text
document-model
    ↓
commands / history
    ↓
feature core packages
    ↓
feature realization packages
    ↓
feature WebGPU packages
    ↓
compositor integration
    ↓
editor controllers
    ↓
React UI / host adapters
```

More concretely:

```text
@lighttable/document-model
@lighttable/scene-transforms
@lighttable/commands
@lighttable/render-contracts
@lighttable/compositor-core
@lighttable/compositor-webgpu

@lighttable/raster-core
@lighttable/raster-webgpu

@lighttable/vector-core
@lighttable/vector-rendering
@lighttable/vector-webgpu

@lighttable/text-core
@lighttable/text-layout
@lighttable/text-rendering
@lighttable/text-webgpu

@lighttable/pdf-core
@lighttable/pdf-import
@lighttable/pdf-export

@lighttable/editor-core
@lighttable/editor-react

@lighttable/host-web
@lighttable/host-electron
@lighttable/host-storybuilder
```

## Forbidden dependencies

### Document model must not import

- WebGPU;
- React;
- Electron;
- DOM;
- workers;
- host capabilities;
- renderer caches.

### Feature core packages must not import

- React;
- host APIs;
- GPU objects;
- compositor implementation.

### WebGPU packages must not import

- React components;
- document mutation APIs;
- dialogs;
- filesystem;
- host-specific media objects.

### UI packages must not

- store GPU resources;
- calculate independent scene transforms;
- decide compositor evaluation order;
- directly mutate serializable document structures outside commands.

## Enforcement

Use:

- TypeScript project references;
- package `exports`;
- ESLint restricted imports;
- dependency-cruiser or Madge checks;
- CI architecture tests.

---

# Recommended common realization contract

Before adding more layer types, formalize the boundary between source realization and compositing.

Example direction:

```ts
interface LayerSourceRealization {
  readonly layerId: LayerId;
  readonly sourceRevisionKey: string;

  readonly localBounds: Rect;
  readonly alphaMode: 'premultiplied';
  readonly colorDomain: 'scene-linear';

  readonly output:
    | TextureSourceOutput
    | VectorCommandOutput
    | ProceduralPassOutput;

  readonly estimatedBytes: number;
}
```

The compositor should not know:

- how text was shaped;
- how a vector path was flattened;
- how a PDF text object was decoded;
- how a 3D layer was rendered;
- how an AI node generated pixels.

It should know:

- the source bounds;
- the source revision;
- the source output contract;
- how to apply document semantics.

---

# Recommended development-only inspectors

The following tools should be treated as architecture infrastructure, not optional polish.

## 1. Transform inspector

For a selected node, show:

- `localToParent`;
- `localToDocument`;
- `documentToLocal`;
- local bounds;
- document bounds;
- parent chain;
- transform revision.

## 2. Compositor-plan inspector

Show ordered operations and targets.

## 3. Dirty-revision inspector

Show changed domains and propagation.

## 4. GPU-resource inspector

Show owner, bytes, format, dimensions, lifetime, and last use.

## 5. Cache inspector

Show keys, dependencies, hits, misses, and evictions.

## 6. Frame submission inspector

Show why a GPU submission occurred.

These tools will significantly reduce the cost of implementing text, PDF, Smart Objects, and 3D.

---

# Recommended immediate implementation order

## Priority 1 — correctness boundaries

1. Finish centralized transform migration.
2. Ensure rasterize, merge, export, thumbnails, and scopes use compositor plans.
3. Define common layer source realization contracts.
4. Add package import restrictions.

## Priority 2 — ownership and diagnostics

5. Inventory and split `WebGpuEngine` responsibilities.
6. Add GPU resource ownership accounting.
7. Add dirty/cache/render graph inspectors.
8. Add document-close and device-loss stress tests.

## Priority 3 — interaction and processing

9. Standardize tool gesture transactions.
10. Move high-frequency state outside React.
11. Convert grading/effects to semantic node descriptors.
12. Add safe node fusion in the execution planner.

## Priority 4 — future content readiness

13. Add the text packages using the same core/rendering/WebGPU separation.
14. Add normalized PDF import representation.
15. Add Smart Object and 3D layers only through the common realization contract.
16. Require every new layer type to declare revisions, caches, bounds, disposal, and export behavior.

---

# Required architecture review checklist for new features

Every significant new feature should answer the following before implementation.

## Canonical state

- What is serialized?
- What is the source of truth?
- Which IDs are stable?
- Which state is temporary?

## Coordinate spaces

- In which coordinate space is source data stored?
- Which service performs mapping?
- Are bounds local or document-space?

## Revisions

- Which revision domains can change?
- Which derived outputs depend on them?
- Which changes must not invalidate this feature?

## GPU ownership

- Who owns each texture and buffer?
- What is the byte estimate?
- How is it disposed?
- How is it rebuilt after device loss?

## Compositor integration

- What source realization is produced?
- Which existing compositor semantics apply?
- Does the feature duplicate masks, opacity, clipping, styles, or blending?

## Interaction

- What is preview state?
- What is committed state?
- How many undo commands does one gesture create?
- How is cancellation handled?

## Export and destructive operations

- How does rasterize evaluate it?
- How does merge evaluate it?
- How is it exported?
- What is the fallback if semantic export is unsupported?

## Performance

- What is cached?
- What are cache keys?
- What are quality buckets?
- What happens when the layer is inactive?
- What happens under a memory budget?

## Compatibility

- How does it map to PSD?
- How does it map to PDF?
- Which semantics are native, approximated, preserved, or unsupported?

---

# Tests that should exist before major expansion

## Transform fixtures

- deeply nested groups;
- non-uniform scale;
- rotation;
- negative scale;
- reparenting;
- transformed masks;
- transformed vector/text nodes.

## Compositor fixtures

- clipping chains;
- nested groups;
- adjustment layers;
- masks;
- fill versus opacity;
- styles;
- group isolation;
- disabled nodes.

## Lifecycle fixtures

- open and close many documents;
- switch active documents repeatedly;
- device loss and recreation;
- cache eviction;
- export cancellation;
- async operation invalidation.

## Interaction fixtures

- one gesture equals one command;
- cancel restores exact prior state;
- redo matches committed state;
- preview/final output equivalence.

## Import/export fixtures

- PSD structure and visual comparison;
- PDF page-object placement;
- embedded fonts;
- positioned text;
- transparency groups;
- rasterize and export equivalence.

## Performance fixtures

- many raster layers;
- many vector paths;
- many text glyphs;
- large paragraph layout;
- large PDF page;
- high zoom;
- integrated GPU memory budget;
- multiple inactive documents.

---

# Definition of architectural success

The architecture is functioning correctly when the following statements are true:

1. The document model can fully reconstruct the editor after device loss.
2. A viewport-only change never triggers document compositing.
3. Overlay-only changes never mutate document pixels.
4. All scene coordinate mapping uses one authority.
5. All layer semantics are planned by one compositor authority.
6. Rasterize, merge, export, thumbnails, and scopes share document evaluation semantics.
7. Every GPU resource has a clear owner, budget, and disposal path.
8. Every derived cache has explicit revision dependencies.
9. One user gesture creates one semantic undo command.
10. New content types integrate through common realization contracts.
11. PSD and PDF remain adapters rather than core architectural authorities.
12. Developers can inspect why a frame rendered and where GPU memory is used.
13. Inactive documents consume bounded resources and perform no unnecessary work.
14. The React UI does not become the runtime authority for tools or rendering.
15. Performance optimizations such as pass fusion do not weaken semantic modularity.

---

# Final recommendation

Do not redesign LightTable from scratch.

The current architecture has the right foundations. The next step is to convert architectural intent into enforceable contracts:

```text
central authority
+ package boundaries
+ explicit revisions
+ deterministic ownership
+ shared evaluation
+ diagnostics
= scalable editor architecture
```

The most important near-term investments are:

1. finish transform centralization;
2. make the compositor planner the shared evaluator for every output path;
3. split oversized runtime coordinators;
4. introduce common realization contracts;
5. make caching and GPU ownership observable;
6. enforce package dependency rules;
7. require all new layer systems—especially text, PDF, Smart Objects, 3D, and AI—to fit these contracts.

If those guardrails are added now, LightTable should be able to grow substantially without another major structural rewrite.
