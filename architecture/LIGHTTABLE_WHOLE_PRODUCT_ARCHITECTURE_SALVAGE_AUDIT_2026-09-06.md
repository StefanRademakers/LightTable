# LightTable whole-product architecture and salvage audit

Date: 2026-09-06  
Scope: current `main` at `cce15c7c`, including the dirty working tree present during the audit  
Assessment type: static architecture and code-path audit; this is not a release-readiness certificate

## Executive verdict

LightTable is not an empty prototype and it is not technically worthless. It contains a substantial amount of reusable editor work: GPU kernels and shaders, import/export adapters, text and vector engines, a broad filter catalog, provider integrations, UI components, host abstractions, and many individually useful controllers. Throwing all of that away would be wasteful.

The current editor runtime is nevertheless **not a trustworthy product architecture**. Its central problem is not the number of known UI bugs. The problem is that one user-visible document is represented by several authorities that can mutate or publish independently:

- the structural `ImageDocument` and `DocumentSession`;
- renderer-owned raster and mask resources on the GPU;
- active-editor interaction sessions for selection, paint, transform, warp and previews;
- command/history objects containing callbacks and GPU resource identities;
- processing metadata and compatibility aggregates;
- React/editor projections and workspace state.

Those parts usually agree on the happy path, but there is no single enforced transaction contract that makes agreement mandatory. This explains the observed pattern: a local fix passes focused tests, while a different combination of layer type, selection, transform, merge, undo, workspace switch or renderer lifecycle exposes another invalid state.

The honest recommendation is:

1. Do not continue feature development or broad local patching on the existing integration runtime.
2. Do not begin a blind whole-product rewrite either.
3. Preserve the specialized engines and adapters, but replace the editor's integration core through a time-boxed **strangler migration** built around explicit document, resource, transaction, rendering and history contracts.
4. Prove that architecture with three complete vertical workflows before migrating the remaining feature breadth.
5. Stop the rescue and reassess a fuller rebuild if those workflows cannot meet the hard gates in this report within four to six engineering weeks.

The likely salvage ratio is high for algorithms and assets but much lower for orchestration. A provisional estimate is that 70–85% of specialized code can remain or be adapted, while roughly 15–30% of the editor-facing integration code needs replacement or substantial restructuring. That estimate must be revised after the first vertical slice; it is not a promise.

## What this audit did and did not prove

This audit traced the present architecture across:

- all 37 left-toolbar tool definitions and their execution routing;
- selection, paint, transform, warp, vector and text interaction controllers;
- adjustment layers, the P0/P1/P2 filter sets, Layer FX and legacy effect bundles;
- document, workspace, editor and viewport state;
- the shared command contract, editor command service, Actions and MCP;
- undo/redo, resource snapshots and mutation rollback;
- renderer composition, WebGPU resource ownership and device lifetime;
- native/open/save/recovery, PSD, PSB, PNG, JPEG, WebP, TIFF, PDF and SVG routes;
- desktop, browser and embedded host boundaries;
- projects, assets and GenAI provider architecture;
- earlier readiness, stabilization and quality reports versus the current code.

It did not run the full application test suite or mutate runtime code. The working tree already contained user and agent changes, so this report was deliberately kept separate from them. Its conclusions are based on code ownership and state-flow evidence, not on claiming that every individual feature is currently broken.

## Current whole-product mental map

The intended high-level flow is sound:

```text
Desktop / Web / Embedded Host
             |
             v
 LightTableStandaloneApp
             |
             v
 WorkspaceSession -> DocumentSession -> ImageDocument
             |              |
             |              +-> DocumentCommandHistory
             |              +-> document editor/view state
             |
             +-> EditorApplicationSession (global tool/UI state)
             |
             v
 semantic command boundary <- UI / Actions / MCP
             |
             v
 editor controllers -> layer renderer -> compositor -> WebGPU
```

The actual mutable flow is closer to this:

```text
                         +----------------------------+
                         | EditorApplicationSession   |
                         | active tool / global UI    |
                         +--------------+-------------+
                                        |
                                        v
+------------+     +--------------------+---------------------+
| UI/Actions | --> | LightTable command service / capability  |
| MCP        |     | projection / active-or-canonical ports   |
+------------+     +----------+------------------+-------------+
                           active|                  |inactive
                                 v                  v
                    +------------+----+      +------+-----------+
                    | presentation    |      | DocumentSession  |
                    | command port    |      | model commands   |
                    +--------+--------+      +------+-----------+
                             |                      |
               +-------------+-----------+          |
               |                         |          |
               v                         v          v
      interaction sessions     renderer/GPU       ImageDocument
      selection/transform/      raster/masks       metadata/tree
      paint/warp/preview             |                  |
               |                     +--------+---------+
               |                              |
               +----------> history callbacks/resources
```

This is the core architectural defect: command semantics depend on whether a document happens to own the active presentation renderer. Raster and mask pixels live outside `ImageDocument`, while history must coordinate both worlds after the fact.

## Package and subsystem map

### Reusable lower-level packages

The repository already has several sensible package boundaries:

- `filter-core` and `filter-webgpu`: filter contracts and GPU implementations;
- `paint-core`, paint scene and adapters: painting primitives and integration support;
- `text-core`, layout, render and WebGPU packages: shaping and text rendering;
- `vector-core`, SVG, Vello and WebGPU packages: vector model and rendering;
- `pdf-core`, `video-core`: format-specific engines;
- `genai-core` and provider packages: provider-neutral contracts plus adapters;
- `command-contract`: shared command IDs, schemas and transport types;
- `ui`: reusable UI primitives.

These packages are not the main reason the product is unstable. They are the strongest salvage candidates.

### Integration package

`@lighttable/app` depends on nearly every domain package and contains the editor runtime. Production code under `packages/lighttable-app/src/lighttable` is distributed approximately as follows:

| Area | Production files | Approximate lines |
| --- | ---: | ---: |
| Editor | 222 | 52,709 |
| Application | 296 | 46,106 |
| GPU | 39 | 12,210 |
| Text integration | 37 | 8,017 |
| Effects | 49 | 6,379 |
| Image I/O | 19 | 2,083 |
| Processing | 13 | 1,794 |
| Composition | 13 | 1,766 |
| Infrastructure | 9 | 1,245 |

Large integration files are symptoms of mixed authority, not merely a style issue. Current examples include:

- `LightTableEditorOverlay.tsx`: about 9,184 lines;
- `WebGpuEngine.ts`: about 4,314 lines;
- `layerShaders.ts`: about 2,849 lines;
- `useLayerDocumentCommands.ts`: about 2,074 lines;
- `lightTableCommandService.ts`: about 2,038 lines;
- `LayerPanel.tsx`: about 1,900 lines;
- `documentCommands.ts`: about 1,846 lines;
- `useViewportInteractionController.ts`: about 1,607 lines;
- `useSelectionSessionController.ts`: about 1,583 lines.

An August quality audit identified `LightTableEditorOverlay.tsx` at 4,344 lines and `WebGpuEngine.ts` at 2,266 lines as the two primary risks. Both have roughly doubled despite source-size ratchets and thousands of tests. This is direct evidence that the integration pressure was not actually removed.

## State authority audit

| User-visible state | Intended authority | Current additional authority or mirror | Principal risk |
| --- | --- | --- | --- |
| Layer tree, names, transforms, text/vector metadata | `ImageDocument` in `DocumentSession` | renderer projections and UI/editor caches | stale projections and order-dependent publication |
| Raster pixels | conceptually the document | renderer-owned GPU resource repository | document cannot fully reconstruct itself; device/runtime lifetime is data lifetime |
| Layer masks | conceptually the document | renderer-owned GPU textures plus serialized snapshots | selection/mask/history restore can disagree |
| Selection | document editor state | selection session, renderer mask, overlay geometry | visible border, paint clip and copy bounds can diverge |
| Transform preview | interaction session | layer transform metadata, rendered source, committed raster | repeated transforms can resample or revert to stale source |
| Processing | ordered module metadata | compatibility aggregate and fused Grade shader | preview, adjustment layer and rasterized output may use different evaluators |
| History | `DocumentCommandHistory` | closures referencing model and GPU resources | undo is not intrinsically atomic or rebuildable |
| Dirty/save state | history index plus document revision | GPU-only and viewport/editor changes | saved/dirty status may not describe actual pixels |
| Active tool/UI | `EditorApplicationSession` | persistent overlay controller refs | rebinding across documents can target stale session state |
| Opened document | workspace/document session | phased decoder, renderer load, semantic hydration | black/intermediate frames and partially initialized documents |

### Directionally correct decision: move state toward the document

Moving durable selection and editor state into `DocumentSession` was architecturally better than leaving it entirely inside an active React tool. It made document switching and inactive-document reasoning possible.

The mistake was treating that move as sufficient while raster/mask truth, interaction sessions and command ownership remained split. The result is a document-shaped façade over a runtime that still needs the renderer to know the actual pixels. The decision was correct in direction, incomplete in execution.

## Command, Actions and MCP architecture

### What is good

The shared `command-contract` is a real asset. Commands have stable IDs, schemas, revisions, task and artifact concepts. MCP is not clicking UI controls: the MCP server is a thin, token-protected adapter that consumes the shared contract and talks to the desktop bridge. Actions also call the semantic command service rather than replaying raw mouse input.

The catalog currently covers roughly 72 commands across document, layer, text, vector, selection, transform, warp, raster, grade, file, task and history operations.

### What breaks parity

There is no single executor behind that catalog:

- service-owned commands handle a small model-only subset;
- an active presentation command port owns renderer-dependent commands;
- an inactive/canonical port supports a different subset;
- the command registry chooses the mounted port first and otherwise the canonical port;
- capability projection manually explains why commands require the active renderer.

There is no capability-level fallback from one owner to another. Therefore the same command can be available, unavailable or semantically different depending on active/mounted state. UI, Actions and MCP share a command name, but not necessarily a single implementation or state authority.

This matters for:

- masks and selection commands;
- copy/paste and raster operations;
- fill and gradient operations;
- renderer-dependent exports and previews;
- tool gestures and interactive commits;
- undo/redo involving GPU resources.

MCP itself is relatively clean. It accurately exposes the inconsistency of the editor core rather than causing it. Fixing schemas or adding MCP tests cannot repair runtime ownership.

### Required target contract

Every semantic command must resolve to one document-scoped handler independent of visibility:

```ts
interface DocumentCommandHandler<P, R> {
  prepare(ctx: CommandContext, params: P): PreparedCommand<P>;
  commit(tx: DocumentTransaction, prepared: PreparedCommand<P>): R;
}
```

UI, Actions and MCP must only vary in transport and authorization. They may not select different business logic. Interactive UI may create previews, but the final commit must be the same command used by automation.

## Tool system audit

### Inventory

The left toolbar defines 37 tools:

- navigation: Move/View, Zoom;
- transform: Transform, Warp, experimental Face Warp;
- raster selection: rectangular, elliptical, single-row, single-column, free lasso, polygonal lasso, object selection, magic wand, selection paint;
- vector/path: Pen, add/delete/convert anchor, path selection, direct selection;
- shapes: rectangle, ellipse, triangle, line;
- text: point, paragraph, vertical and path text;
- fill/paint: gradient, fill, brush, healing, clone, erase, dodge, burn, sponge.

The tool registry provides metadata, grouping, icons and shortcuts. It is not the execution authority. Runtime input routing is centralized in `useViewportInteractionController.ts`, which branches on the active tool and delegates to a growing set of specialized hooks and renderer methods.

### Cross-tool lifecycle problem

All authoring tools need the same lifecycle:

```text
idle -> armed -> previewing -> committed
                    |             |
                    +-> cancelled +-> history entry
```

Instead, selection, transform, paint, text, vector and warp each implement variations of this lifecycle across React hooks, renderer state and command callbacks. That creates inconsistent answers to basic questions:

- Does switching tools commit or cancel?
- Does pointer-up commit a final value or only end one drag within a longer tool session?
- What source pixels does the next drag use?
- Which geometry is authoritative while auto-panning or snapping?
- When does a smart/non-destructive layer become raster?
- Which state must undo restore?

The recently observed transform degradation is exactly this class of failure: repeated drags resample an already transformed result instead of retaining one immutable source plus a changing transform until the operation commits.

### Tool-specific maturity

The tools are not uniformly incomplete. Basic paint, vector, text and selection algorithms exist. The risk is combinatorial integration:

- selection geometry versus renderer mask versus overlay;
- non-destructive pasted layers versus pixel editing expectations;
- transform source lifetime versus layer finalization;
- text/vector measurable bounds versus asynchronous rendering;
- warp preview versus committed layer data;
- snapping candidate state versus raw pointer geometry and viewport auto-pan.

The automation catalog itself marks some routes as presentation-only or partial, including vector selection, object-selection model contracts, group/mask/projective transforms and experimental face warp. The UI currently presents more uniformity than the underlying command model provides.

## Processing, adjustments, filters and effects

### Three overlapping processing architectures

LightTable currently has at least three processing paths:

1. ordered processing-module metadata with validators and settings;
2. compatibility aggregates/fused Grade evaluation;
3. specialized legacy/effect implementations with their own GPU lifecycle.

Adjustment layers add another catalog that mixes Photoshop-style adjustments, Grade/Lens FX, filter-backed layers and specialized modules.

### Filter breadth

The registered filter families are substantial:

- P0: Gaussian Blur, Motion Blur, Surface Blur, Displace, Median, Reduce Noise, Smart Sharpen, Unsharp Mask, High Pass, Maximum, Minimum and Offset;
- P1: Box Blur, Radial Blur, Field Blur, Iris Blur, Tilt-Shift, Wave, Ripple, Twirl, Spherize, Polar Coordinates, Dust & Scratches, Despeckle, Mosaic, Color Halftone, Clouds, Lens Flare, Find Edges and Emboss;
- P2: Shape Blur, Smart Blur, Path Blur, Spin Blur, Pinch, Shear, Glass, Crystallize, Mezzotint, Pointillize, Difference Clouds, Fibers, Oil Paint, Glowing Edges, Diffuse, Solarize, Custom, Cutout, Plastic Wrap, Poster Edges, Watercolor, Photocopy, Halftone Pattern, Stamp, Torn Edges and Texturizer.

Registry presence proves discoverability and settings validation, not end-to-end executor, preview, rasterize, undo, save and reopen parity.

### Adjustments and Layer FX

Adjustment-layer creation includes Grade, Lens FX, Photoshop adjustment kinds, filter kinds and several specialized layers. Layer FX include Drop/Inner Shadow, glows, Bevel & Emboss, Color/Gradient/Pattern Overlay, Satin and Stroke.

The user-visible rasterize/merge failures across text, shapes, gradients, filters and Layer FX point to the common finalization boundary, not five unrelated features. A layer with procedural content should implement one `renderForFinalization()` contract. Merge, rasterize, flatten, export and preview should consume that same rendered product.

### Target processing model

There must be one ordered layer-evaluation graph:

```text
source -> layer transform -> masks -> adjustments/filters -> layer effects
       -> opacity/fill/blend/clipping -> parent/group composite
```

Interactive preview may use a cheaper quality policy, but it must evaluate the same graph and converge to the same result. Specialized kernels remain reusable; parallel ownership and duplicate parameter models do not.

## Renderer and WebGPU resource audit

### Useful existing work

The renderer has a central graph assembler and compositor, explicit repositories, caches, preview products and many teardown paths. It is not a trivial canvas wrapper. WebGPU is correctly treated as the performance engine.

### Fundamental ownership error

`DocumentLayerResourceRepository` stores canonical raster and mask textures keyed by document/layer identity and GPU device. History entries preserve resource IDs and disposal callbacks. This makes GPU runtime lifetime part of document correctness.

A renderer should be disposable. Device loss, tab unmount, workspace switch or process recovery should allow it to rebuild from document/resource state. Today, the document cannot always reproduce exact current pixels without renderer-owned resources.

This is why previous claims such as “the canvas/renderer is a projection” were only partially true. The code still uses it as a data authority.

### Required resource architecture

Introduce a document-scoped `PixelResourceStore` independent of WebGPU:

```text
immutable resource revision
  - CPU backing or durable encoded backing
  - dimensions / format / color profile
  - optional current GPU realization
  - reference count / history ownership
  - deterministic content hash
```

GPU textures become cached realizations. A texture can be evicted or recreated without changing document state. Large resources do not need permanent duplicate CPU memory: the store can use encoded tiles, mapped staging buffers or spill storage. The architectural requirement is reproducibility, not one specific backing strategy.

### Performance implication

This need not make LightTable slower. Correct separation enables:

- lazy GPU realization;
- shared immutable source resources for transform previews;
- region/tile invalidation instead of whole-layer recomposition;
- bounded history through copy-on-write resources;
- renderer recreation without re-decoding source files;
- safe pipeline caches keyed by device and shader signature.

The current architecture often recomputes or resamples because it cannot reliably tell source, preview and committed resource revisions apart.

## History and transaction audit

`DocumentCommandHistory` is a serial bounded stack with byte-size and resource accounting. That is a useful mechanism, but its entries are closures coordinating separate model and GPU mutations. It cannot prove atomicity by itself.

There are procedural transaction helpers and pixel mutation snapshots, but rollback depends on every caller registering the correct compensating action before each mutation. A missed publication, selection mask, GPU resource or layer-tree mutation leaves partial state.

The required invariant is:

> A command either publishes one new document revision, one resource revision set and one history entry, or publishes nothing.

Undo and redo should apply a stored revision delta, not re-enact arbitrary closures against whatever renderer happens to be active.

Recommended transaction product:

```ts
type DocumentDelta = {
  beforeRevision: RevisionId;
  afterRevision: RevisionId;
  modelPatch: ModelPatch;
  resourceChanges: readonly ResourceChange[];
  editorStatePatch?: EditorStatePatch;
  byteSize: number;
};
```

The transaction owns temporary resources until commit. Publication happens only after all validation and GPU/CPU work needed for the commit succeeds. On failure it releases temporary resources without changing the session or history.

## Merge, rasterize, flatten and layer finalization

These operations are currently high-risk because they traverse nearly every split authority:

- evaluate procedural/text/vector/adjustment/effect content;
- resolve masks, clipping, blend and transforms;
- create raster resources;
- replace or remove layer-tree nodes;
- update active layer and selection/editor state;
- record resource-aware history;
- invalidate compositor caches;
- publish thumbnails and UI state.

They must not be separate ad hoc implementations. Define one finalization service with explicit products:

```text
render layer subtree at revision R
        -> FinalizedSurface + bounds + profile + alpha semantics
        -> atomic tree/resource delta
```

- Rasterize replaces exactly one procedural layer while preserving its visual result.
- Merge Down evaluates the selected layer and the next eligible lower sibling using normal stack semantics, then atomically replaces both.
- Flatten Group evaluates one subtree and replaces that group.
- Flatten Image evaluates the root and produces the declared background/alpha result.
- Export consumes the same root evaluation but does not mutate the document.

One eligibility function must drive the menu, layer icon, hotkey, command capability, Actions and MCP. The missing rasterize icons and silent `Ctrl+E` failures show that eligibility is currently duplicated or derived from incomplete layer-kind tests.

## Persistence, file formats and recovery

### Format support currently present

- native layered document embedded in a PNG-compatible container;
- flat PNG in 8/16-bit routes;
- JPEG 8-bit with explicit alpha handling;
- WebP 8-bit, non-animated;
- TIFF 8/16-bit, no multipage editing;
- PSD partial editable import/export plus retained flattened appearance;
- PSB open-only support;
- PDF first-page raster open and one-page hybrid/flat export;
- bounded editable SVG import;
- AI/EPS unavailable.

This is valuable, expensive work and should be retained.

### Atomicity problem

Open is multi-phase: renderer-independent preparation, renderer/GPU load, then semantic source hydration. Some routes initially show a retained composite and later replace it with editable content. SVG has its own transient raster path. The app can therefore publish a tab before the full document is ready.

Saving a layered document also has to ask renderer-owned resources for raster blobs, demonstrating that the model is not self-serializable.

Target rules:

- Open builds a complete unpublished `DocumentRevision` and resource manifest.
- The UI may show a separate loading presentation, but the document tab becomes active only after the first valid render product is ready.
- Save pins one immutable revision and serializes only that revision.
- Close waits for or explicitly cancels the save transaction.
- Recovery records refer to durable revision artifacts, not active-renderer callbacks.
- A failed load/save never mutates the previous valid document.

## Desktop, web, projects and GenAI

The `LightTableHost` abstraction is one of the healthier boundaries. Desktop, browser and embedded hosts expose optional clipboard, filesystem, recovery, project, Actions, GenAI and release capabilities without forcing Electron imports into core UI.

Browser limitations are expected: downloads replace arbitrary filesystem writes, OPFS/local storage back recovery and some project/GenAI features require a supplied host. These differences need explicit capability UX, not alternate editor semantics.

GenAI provider packages are also comparatively clean: provider-neutral contracts are translated by provider adapters and the desktop registry. The main inconsistency is product policy—generation readiness currently requires a project even where lower layers accept an optional project ID. That is a separate workflow decision, not a renderer-core defect.

Projects form another persistence domain beside documents and workspaces. Their manifest and default-folder validation are relatively coherent, but project state must not become another implicit owner of open documents or generated-document history.

## Why the large test suite did not prevent this

There are about 501 test files under the main app area, concentrated in application and editor units. Earlier reports recorded thousands of passing tests, packaged workflow matrices and endurance cycles. Those results were not fabricated, but their conclusion was too broad.

They proved selected routes on selected builds and hardware. They did not prove the global invariant that all feature combinations share one authority and transaction model.

The failure pattern is predictable:

- local unit tests mock the adjacent owner and cannot detect dual truth;
- route tests cover one active-document state, not owner changes during the route;
- visual tests prove a final screenshot, not intermediate source/preview/commit identity;
- command parity tests cover commands that were selected for the matrix, while capability lists remain manually duplicated;
- memory tests can show stable JS/DOM tails while GPU telemetry is absent or canonical resources remain intentionally retained;
- source-size caps document growth but do not remove mixed responsibility.

The solution is not more tests everywhere. It is fewer, stronger architectural contract tests plus targeted algorithm tests.

## Why previous green audits aged badly

The 7 August final audit explicitly says it was tied to candidate `2643a94c` and became historical after later changes. The 22 August stabilization report claimed the renderer was a projection and bounded UI/Actions/MCP equivalence, while also acknowledging zero useful GPU-release telemetry and active/inactive capability differences.

Since then, 38 commits from baseline `0298946f` changed roughly 300 files with about 13,394 additions and 4,226 deletions. Highest churn occurred in the overlay, GPU engine, command ports, document mutation paths, layer commands and transform/selection controllers—the exact authority boundaries that were supposed to be stable.

A green candidate report cannot function as an architectural proof when later features keep modifying the same integration roots. The missing mechanism was a permanent contract that new code could not bypass.

## Root causes of instability

1. **No single reconstructible document truth.** Structural state is in the document; current pixels and masks may exist only in renderer resources.
2. **Execution changes with presentation state.** Active and inactive documents use different command owners and capabilities.
3. **Transactions are conventions, not enforced boundaries.** Callers coordinate model, GPU, editor state, history and publication manually.
4. **Interaction lifecycles are duplicated.** Tools disagree on preview, commit, cancel, re-entry and source lifetime.
5. **Finalization is fragmented.** Rasterize, merge, flatten and export do not consume one universal evaluated-layer product.
6. **Processing models coexist.** Ordered modules, compatibility aggregates, fused Grade and specialized effects can diverge.
7. **Load and save are phased without one atomic owner.** Partially initialized state can become visible.
8. **Registries are descriptive rather than generative.** Tools, commands, capabilities, Actions/MCP exposure and layer eligibility have parallel lists.
9. **Integration roots absorb behavior.** Large overlay, engine, panel and command-service files make lifecycle ordering difficult to reason about.
10. **Testing validates routes more than invariants.** Thousands of passing tests allow an invalid ownership model to survive.

## What should have been defined before feature breadth

From the beginning, the project needed five hard contracts:

1. **Document contract:** every durable visual result belongs to an immutable document/resource revision that can be saved and rendered without an existing UI mount.
2. **Transaction contract:** a command atomically produces one validated delta or no state change.
3. **Renderer contract:** rendering is a disposable projection of a supplied immutable revision; it never becomes the sole pixel owner.
4. **Interaction contract:** every tool uses the same begin/update/commit/cancel session semantics and one immutable source revision.
5. **Automation contract:** UI, Actions and MCP invoke the same handler and return the same result for the same revision regardless of document visibility.

Feature packages should then have implemented capabilities against those contracts. The present code often built the visible feature first and reconciled ownership later.

## Risk register

| Risk | Likelihood | Impact | Detectability before user test | Blast radius |
| --- | --- | --- | --- | --- |
| Model and GPU resource divergence | High | Critical data/visual corruption | Low with local tests | selection, paint, merge, undo, save |
| Active/inactive command divergence | High | High automation and document-switch failures | Medium | UI, Actions, MCP |
| Partial rollback on failed mutation | Medium-high | Critical | Low | history, resources, layer tree |
| Repeated preview resampling | High in affected tools | High fidelity loss | Medium | transform, warp, procedural layers |
| Processing evaluator mismatch | Medium | High visual mismatch | Low without golden output | adjustments, filters, effects, export |
| Device/renderer loss loses canonical state | Medium | Critical | Low on normal hardware | open documents and recovery |
| Non-atomic open/hydration | High | High black/stale frames | High in interactive testing | formats, workspace switching |
| Capability/catalog drift | High | Medium-high | Medium | menus, icons, hotkeys, Actions, MCP |
| God-object regression | High | High | Low in review | entire editor lifecycle |
| Unbounded or opaque GPU retention | Medium | High | Low due telemetry gap | long sessions, large documents |

## Salvage versus rebuild options

### Option A — continue patching the current runtime

Estimated effort: at least 3–6 months of uncertain solo work, with no credible completion bound.  
Risk: very high.  
Recommendation: do not choose this.

It preserves short-term velocity but keeps paying the combinatorial regression tax. Each fix must understand several implicit owners and can create more transitional code.

### Option B — replace the integration core incrementally

Estimated effort: 8–14 engineer-weeks for a credible core and representative migration; likely 2–4 calendar months for one experienced engineer working carefully, followed by feature-tail work.  
Risk: high but measurable.  
Recommendation: preferred.

Preserve:

- algorithms, shaders and filter kernels;
- text/vector/paint packages;
- format parsers and serializers where their contracts can be adapted;
- UI library and host abstraction;
- command schemas, provider adapters and many panels;
- fixtures and focused algorithm tests.

Replace or substantially restructure:

- document/resource ownership;
- active-versus-canonical command-port selection;
- transaction/history representation;
- interaction session lifecycle;
- layer finalization/evaluation boundary;
- phased publication during open/save;
- integration wiring currently concentrated in overlay/engine/service roots.

### Option C — full product rewrite

Estimated effort: 6–12+ months solo before comparable breadth, with a substantial chance of reproducing the same mistakes.  
Risk: extremely high.  
Recommendation: only after the Option B proof fails its time box.

A full rewrite can feel cleaner but must re-integrate all formats, filters, effects, text, vector, paint, GenAI and host behavior. It does not automatically provide better product judgment or architecture.

## Recommended recovery program

### Phase 0 — freeze and evidence baseline (3–5 days)

- Freeze features and broad UI migration.
- Preserve the current branch and a known usable historical build separately.
- Select a small representative file corpus, including large raster, layered native, PSD text/vector/effects, alpha/masks and 16-bit content.
- Record current output hashes/screenshots and known failures without fixing them.
- Define memory and latency measurements that include GPU allocations.

Exit: reproducible baseline with no ambiguity about tested build or files.

### Phase 1 — write executable contracts (1–2 weeks)

- Define immutable `DocumentRevision`, `PixelResourceStore`, `DocumentTransaction`, `RenderProjection` and `InteractionSession` interfaces.
- Generate capability exposure from command registrations instead of parallel tables.
- Build a headless command harness that does not require React or a mounted editor.
- Make renderer destruction/recreation a normal test operation.

Exit: a synthetic document can be mutated, rendered, saved, destroyed, restored, undone and redone without the LightTable UI.

### Phase 2 — new document/resource runtime proof (2–3 weeks)

- Implement immutable/copy-on-write raster and mask resource revisions.
- Make GPU textures disposable realizations.
- Implement atomic delta history.
- Add exact content hashing and bounded resource accounting.
- Keep the existing renderer kernels behind a new projection adapter.

Exit: device/renderer recreation preserves exact model and pixel hashes; failed commands leave no changes.

### Phase 3 — three vertical slices (2–4 weeks)

Slice A: raster selection -> move -> copy -> paste -> transform -> paint -> undo/redo -> save/reopen.  
Slice B: text and vector creation/edit -> transform -> rasterize -> merge -> undo/redo.  
Slice C: adjustment/filter/Layer FX -> preview -> rasterize/flatten -> export -> reopen.

Each slice must work through UI, Actions and MCP using the same command handlers.

Exit: all hard gates below pass. If they do not pass within the time box, stop and reassess full rebuild or project termination.

### Phase 4 — migrate feature breadth (3–6 weeks)

- Move remaining tools onto the common interaction lifecycle.
- Move all P0/P1/P2 filters and effects onto the single processing graph.
- Migrate group, clipping, mask and advanced transform cases.
- Remove replaced compatibility paths as each family lands; do not retain two permanent implementations.

### Phase 5 — formats, hosts and operational parity (2–3 weeks)

- Exercise open/save/recovery across declared formats and bit depths.
- Verify desktop/web capability UX and memory limits.
- Complete Actions/MCP conformance and error reporting.
- Run physical Windows and Apple Silicon cells.

## Hard gates and stop criteria

The rescue is not accepted because the test count increases. It is accepted only if these invariants hold:

1. Destroying and recreating the renderer at any committed revision produces identical document and pixel hashes.
2. Simulated GPU device loss does not lose committed raster or mask data.
3. A failed command leaves document revision, resource set, selection/editor state and history index unchanged.
4. The same command and revision produce the same result through UI, Actions and MCP, active or inactive.
5. One hundred mixed undo/redo cycles return to exact hashes and bounded CPU/GPU memory.
6. Repeated transform or warp previews always sample one immutable source and do not accumulate quality loss.
7. Rasterize, merge, flatten and export consume the same evaluated visual product.
8. A selection's visible overlay, paint clipping, copy result and saved mask share one revision/bounds source.
9. Open publishes either a complete first render or a deliberate loading state—never stale/black/intermediate document pixels.
10. Save pins one immutable revision; close cannot discard an in-flight successful save.
11. Capability and eligibility are generated from actual handlers; menus, layer icons, hotkeys, Actions and MCP cannot drift independently.
12. Representative large documents stay within declared latency and memory budgets on Windows discrete GPU and Apple Silicon.

Stop criteria:

- If Phase 1 cannot produce a renderer-independent command/history harness in two weeks, the existing core is less separable than expected.
- If the three Phase 3 slices cannot pass gates 1–9 after four additional weeks, suspend the rescue.
- If adapting the existing renderer requires keeping canonical pixels in both old and new owners indefinitely, do not proceed with a hybrid half-state.
- If product funding cannot support at least the proof period plus owner-led interaction testing, archive the project instead of resuming patch-based feature work.

## A better test strategy

Retain focused algorithm tests, but reorganize product confidence around a small conformance matrix:

| Contract | Required variants |
| --- | --- |
| Command atomicity | success, validation failure, GPU failure, cancellation |
| Ownership | active, inactive, renderer destroyed/recreated |
| Surface | UI, Actions, MCP |
| Layer source | raster, text, vector, procedural, adjustment, effects, mask/group |
| Lifecycle | preview, commit, cancel, undo, redo, save/reopen |
| Format | 8-bit, 16-bit, alpha, large document |

Use deterministic document/resource hashes and a limited set of golden rendered outputs. Test intermediate revisions, not only final screenshots. Run focused suites during implementation and the cross-contract matrix at phase gates, rather than running thousands of tests after every small edit.

## Immediate next actions

1. Make no further broad runtime changes on the current working tree.
2. Review this diagnosis against the code with the product owner and correct factual errors before accepting the plan.
3. Preserve a clean rescue branch from a deliberately chosen baseline; do not assume newest or `0298946f` is automatically best.
4. Write the five core contracts as short architecture decision records before implementation.
5. Build the headless raster-selection vertical slice first because it crosses document, resources, command, selection, transform, history and persistence.
6. Hold a decision gate after two weeks and again after the three-slice proof.

## Final assessment

LightTable is in a **recoverable but failed integration state**. It is not currently suitable for external testers, and continued feature-by-feature repair is economically irrational. The project has enough valuable domain work to justify one bounded rescue attempt, but not enough architectural coherence to justify confidence without proof.

The key decision is not “fix or rewrite every feature.” It is whether the existing specialized engines can be made clients of one new, enforced document transaction and resource model. That question can be answered in weeks with the proposed vertical slices. It should not be left to another open-ended period of local fixes and optimistic test reports.

