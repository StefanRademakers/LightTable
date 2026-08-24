# LightTable architecture responsibility audit

Status: completed structural audit and migration design. Production refactoring
has not started; packaged journey validation remains Phase 0 of execution.

## 1. Purpose

LightTable has accumulated regressions in features that appear unrelated to the
large vector-rendering work. This audit determines why those regressions can
cross system boundaries, which responsibilities currently have multiple or
unclear owners, and how to separate them without another disruptive rewrite.

The audit starts from code, not from desired class names. A large file is not
automatically wrong; a small helper can still duplicate a critical semantic
decision. The primary question is always: **who owns this fact, and how do all
consumers learn that it changed?**

## 2. Non-negotiable invariants

These are acceptance criteria for the resulting plan.

### Canonical data

- One canonical `ImageDocument` per open document session.
- Document content changes only through an explicit mutation transaction.
- Tab, workspace, focus, panel, viewport, device and renderer lifecycle events
  never mutate canonical content.
- History, dirty state, autosave, recovery and save all observe the same commit.
- Renderer caches and preview state are disposable and reconstructible.

### Editor and workspace state

- One editor shell and one active canvas/runtime bind to the active document.
- Workspace layout, floating panel geometry and panel visibility are editor UI
  state, independent of document content.
- Tool choice and tool options have one editor-level authority unless a feature
  explicitly documents a per-document value.
- Switching workspace updates chrome and overlays without replacing document
  content or creating hidden editor runtimes.

### Interaction

- Pointer-hot previews run outside React state and do not commit on every move.
- A gesture has an explicit start revision, target, preview owner, commit and
  cancellation path.
- Mouse-up produces at most one canonical mutation and one history entry.
- Stale async hit tests, measurements and previews cannot apply to a different
  layer, channel, document or revision.

### Rendering

- The renderer is a projection of canonical data plus explicit preview state.
- Layer ordering, clipping, masks, opacity, blending, processing and styles have
  one semantic evaluation order.
- Content rendering, viewport presentation, editor overlays and scopes analysis
  are distinct lifecycles even when they share a GPU device.
- Dirty propagation is explicit; correctness must not rely solely on object
  identity comparisons or scattered manual invalidation calls.
- Native WebGPU and Vello are backend choices below one renderer-neutral scene
  and compositing contract.

### Product preservation

- Bitmap, vector, text, group, grade, adjustment, mask and generated layer kinds
  retain their supported operations.
- Render, select, transform, rasterize, merge, thumbnail, clipboard, export,
  save/reopen and recovery remain consistent for every supported layer kind.
- Unsupported combinations fail explicitly and preserve data.

## 3. Evidence rules

Every material finding is labeled:

- **Proven:** directly established by source, test or captured runtime trace.
- **Inferred:** strongly implied by multiple source paths but not exercised.
- **Unverified:** plausible but still requires tracing or runtime evidence.

Every proposed boundary must include:

- current owner or competing owners;
- canonical inputs and outputs;
- state lifetime and identity;
- threading or async behavior;
- invalidation and cache dependencies;
- failure and recovery behavior;
- current test coverage;
- migration seam and rollback route.

## 4. Audit inventory

This preserves the opening audit ledger. `[x]` means the area received both a
source trace and direct focused evidence during the audit. `[ ]` means its
ownership/source path was inspected, but its full packaged or parity behavior
was not executed here. It does **not** mean the area was ignored; the exact
execution limits are recorded in Section 15.

### Applications and hosts

- [x] Desktop renderer/preload host boundary and initial bootstrap
- [x] Browser/web host bootstrap
- [ ] Desktop main-process service and IPC ownership
- [ ] App startup, file association and initial-document publication
- [ ] Desktop packaging, production/debug profiles and distribution boundary
- [ ] MCP server, authentication and command dispatch
- [ ] Local AI provider and external provider boundaries

### Canonical models and application state

- [ ] `ImageDocument`, layers, masks, effects and attached processing
- [x] Open-document/session registry and active-document binding
- [x] Editor-global versus document-bound interaction state model
- [ ] Mutation controller and all document command boundaries
- [ ] History, undo/redo and dirty-state ownership
- [ ] Autosave, recovery checkpoints and crash recovery
- [ ] Assets, embedded resources and external resource lifetime

### Rendering and analysis

- [ ] Renderer-neutral paint/vector/text scene contracts
- [ ] Canonical-to-render projection
- [ ] Layer compositor and ordered processing semantics
- [ ] Hybrid native/Vello render-island planning and retained resources
- [ ] Raster, vector and text source realization
- [x] Top-level GPU device/context and engine ownership
- [ ] Complete GPU device-loss recovery path
- [x] Top-level dirty graph, render-state equality and invalidation reasons
- [x] Top-level viewport presentation ownership
- [x] Top-level editor overlay ownership
- [x] Top-level histogram/scopes scheduling ownership
- [ ] Thumbnail and navigator rendering
- [ ] Export, flatten, merge and rasterization paths

### Input and editing

- [ ] Input routing, focus, keyboard and menu command dispatch
- [ ] Tool registry, toolbar projection and tool-option state
- [ ] Hit testing and auto-select ordering
- [ ] Transform interaction for raster, vector, text and multi-selection
- [ ] Selection/mask editing and marching-ants overlay
- [ ] Brush, fill, erase, clone and local-grade interactions
- [ ] Vector path/shape creation and path selection
- [ ] Text creation, editing, shaping and commit
- [ ] Clipboard internal and operating-system roundtrips
- [ ] Color picker, dialogs and focus restoration

### Formats and persistence

- [ ] Bitmap open/decode and color/profile handling
- [ ] SVG normalize/import/edit/save/export
- [ ] PSD/PSB import/export and unsupported-node preservation
- [ ] PDF and future AI/EPS common-vector boundaries
- [ ] Native LightTable document serialization and migrations
- [ ] Save, Save As, close prompts and atomic writes

### UI and workspace

- [ ] App shell and active document tabs
- [ ] Dockview/workspace ownership and persistence
- [ ] Floating panels and stable placement across documents/workspaces
- [ ] Layer panel selection, hierarchy, context actions and capability policy
- [ ] Properties/inspector target routing
- [ ] GenAI, assets, actions, debug and scopes panels
- [ ] Preferences and agent-access lifecycle

### Verification and operations

- [ ] Package-level unit and contract tests
- [ ] Cross-package integration tests
- [ ] Renderer pixel/parity tests
- [ ] Real desktop interaction tests
- [ ] Save/reopen/recovery tests
- [ ] Performance, memory and device-loss tests
- [ ] Build scripts on Windows and macOS
- [ ] Test duplication, brittle implementation assertions and obsolete fixtures

## 5. Critical runtime flows to trace

These boxes deliberately remain unchecked where the complete packaged journey
was not run. Source routes were traced to build the responsibility map; Phase 0
turns them into executable release evidence.

Each flow must be followed from external event to visible result and durable
state. No flow is considered understood from one facade alone.

- [ ] Cold app start with no document
- [ ] Warm packaged app open by double-clicking a bitmap
- [ ] Open and publish a complex SVG
- [ ] Switch between two documents without content mutation
- [ ] Switch workspaces without content mutation or panel drift
- [ ] Select a layer through the layer panel
- [ ] Auto-select the top visible layer through canvas hit testing
- [ ] Drag one raster layer with the transform tool
- [ ] Drag one vector object through Transform and Path Selection
- [ ] Transform a mixed multi-selection and compute union bounds
- [ ] Apply, toggle, reorder, remove and rasterize attached processing
- [ ] Create a shape, then transform it immediately
- [ ] Copy merged pixels internally and through the OS clipboard
- [ ] Calculate scopes after a raster or vector change
- [ ] Save, close and reopen a layered document
- [ ] Recover after a simulated interruption
- [ ] Lose and restore the GPU device
- [ ] Execute the equivalent mutation through MCP

## 6. Responsibility record template

For every subsystem:

| Field | Evidence |
| --- | --- |
| Product responsibility | |
| Current source owner(s) | |
| Canonical inputs | |
| Outputs/projections | |
| State and lifetime | |
| Async/thread boundary | |
| Invalidation dependencies | |
| Failure behavior | |
| Tests and blind spots | |
| Competing/duplicated owners | |
| Candidate boundary | |
| Migration risk | |

## 7. Initial hotspots requiring full tracing

These are starting points, not final conclusions:

- `LightTableEditorOverlay.tsx`: app/editor orchestration, React projections,
  tool controllers and many cross-system effects.
- `WebGpuEngine.ts`: GPU lifecycle, document binding, content rendering,
  overlays, operations, scopes, export and scheduling.
- `LayerCompositor.ts`: authoritative layer evaluation and GPU encoding.
- `LayerDocumentRenderer.ts`: broad renderer facade and capability surface.
- `useLayerDocumentCommands.ts`: canonical planning, GPU operations, history and
  status/error coordination.
- `useTransformSessionController.ts`: preview, hit test, measurement, semantic
  and raster transform commit paths.
- `LayerPanel.tsx`: hierarchy projection, selection, drag/drop, action policy
  and context menus.
- `documentSession.ts` and `useDocumentMutationController.ts`: active binding
  and canonical mutation authority.
- `documentRenderState.ts` and dirty-graph code: change detection and cache
  invalidation.
- `createLayerDocumentRendererRuntime.ts`: composition root; it must be checked
  for wiring versus hidden semantic decisions, not split merely for importing
  many services.

## 8. Questions the final plan must answer

1. Which facts currently have more than one owner?
2. Which derived models are incorrectly treated as authorities?
3. Which operations bypass the canonical mutation boundary?
4. Which invalidations are inferred from identity and which are explicit?
5. Where can UI lifecycle destroy or replace document/render state?
6. Which async results lack document/session/revision identity?
7. Which renderer operations implement their own layer semantics?
8. Which layer capabilities are duplicated across menus, commands and engines?
9. Which caches are safe across visibility, workspace and document changes?
10. Which tests protect architecture contracts versus current implementation
    accidents?
11. What is the smallest useful vertical slice that proves each new boundary?
12. How is each slice compared against the current renderer and user flow?

## 9. Candidate boundaries to validate, not assume

- Canonical mutation result plus explicit document change set
- One layer-evaluation/render-projection planner
- One interaction transaction state machine with backend preview adapters
- Capability-specific renderer ports behind a stable facade
- Separate content, viewport presentation, overlays and analysis runtimes
- Pure layer-panel capability/action model projected by React
- Explicit async operation tokens carrying session and revision identity
- Central layer-kind capability registry used by commands, UI and tests

These candidates may be revised or rejected when complete source tracing shows
that they add coordination cost or conflict with an existing stronger boundary.

## 10. Required migration properties

The final migration plan must:

- avoid a big-bang rewrite;
- keep the current working path available as oracle or rollback where feasible;
- change one user-visible vertical slice at a time;
- add contract tests before moving ownership;
- compare canonical hashes before and after passive UI operations;
- compare pixels for render-path changes;
- exercise real desktop flows, not only unit tests;
- measure pointer latency and React commits for hot interactions;
- keep commits focused and reversible;
- stop when evidence shows a slice regresses stability or performance.

## 11. Audit log

### 2026-08-24 - audit opened

- Task scope and non-negotiable invariants recorded.
- Existing architecture contracts and Task 302 identify the intended model:
  one editor shell/canvas, canonical inactive documents, React-owned chrome and
  explicit document mutations.
- Initial file metrics identify integration hotspots, but no split decision is
  accepted on metrics alone.
- Production code remains unchanged.

### 2026-08-24 - host, session and renderer binding pass

- Read the web and Electron renderer bootstraps, preload contract, standalone
  workspace hook, standalone runtime view, workspace/session classes, editor
  session adapters, document mutation/projection controllers, top-level WebGPU
  engine and document-scoped GPU composition root.
- Confirmed that web and Electron renderer hosts both mount the same
  `LightTableStandaloneApp`; the desktop host is primarily an IPC/service
  adapter around that application surface.
- Confirmed that one `WorkspaceSession` owns document order and activation, one
  `DocumentSession` owns the canonical document and document-bound interaction
  state, and one `EditorApplicationSession` owns application tool/options state.
- Confirmed that the renderer application port does not yet enforce a boundary:
  it aliases the complete concrete `WebGpuEngine` API.
- Confirmed that render invalidation currently combines explicit coarse dirty
  reasons with structural/reference comparisons of selected document fields.
- Confirmed that adjustment and text previews can advance renderer/ref state
  ahead of canonical external-store publication. These paths require complete
  transaction tracing before deciding whether to retain or replace them.

### 2026-08-24 - renderer, interaction, persistence and delivery pass

- Traced compositor/island planning, vector/native/Vello projection, transform
  previews, hit testing, snapping, scopes, attached processing, destructive
  raster evaluation, save/recovery identity and resource retention.
- Traced desktop startup/IPC trust boundaries, release/debug build profiles,
  MCP command/auth/latency routes and the web delivery graph.
- Measured the application import graph and recent change surface. There are no
  runtime import cycles, but central shared editor authorities changed
  repeatedly during the vector integration period.
- Reproduced the delivery-audit failure and source-structure review failures;
  retained them as findings rather than normalizing the baseline.
- Wrote the final responsibility map, eight-phase migration, parity gates,
  rollback discipline and short owner-readable plan. Production code remains
  unchanged.

## 12. Findings

### F-001 - The renderer port is not an isolation boundary

**Status: proven.**

`infrastructure/rendering/webGpuDocumentRenderer.ts` defines
`DocumentRendererPort` as `Omit<WebGpuEngine, never>`. Application and React
code using this type can therefore call every public method of the concrete
engine. The type name communicates separation, but the compiler enforces none.

The concrete engine currently owns or exposes all of these categories:

- document/source lifecycle and binding;
- layer compositing and correction scheduling;
- raster editing, transform, selection and clipboard operations;
- semantic/vector transform previews;
- viewport presentation and editor overlays;
- histogram and scopes;
- thumbnails, palette analysis and export;
- GPU resource estimates and device-loss handling.

This is a high-leverage regression path because a consumer requesting one
capability can depend on unrelated lifecycle and scheduling behavior.

### F-002 - The intended application state authorities are explicit

**Status: proven for the session layer; downstream compliance still under
audit.**

- `WorkspaceSession` owns open document order and the active document id and
  has no React, DOM, host or WebGPU dependency.
- `DocumentWorkspaceController` aligns opaque source handles with the exact
  lifetime of their `DocumentSession`.
- `DocumentSession` owns the canonical `ImageDocument`, document-bound
  selection/channel/vector selection, viewport, processing, loaded source,
  history, tasks and dirty/save revisions.
- `EditorApplicationSession` owns application-wide tool and tool-option state.
- `StandaloneDocumentRuntimeView` mounts one `LightTableEditorOverlay` and
  rebinds it to the active canonical session.

These boundaries should be strengthened rather than replaced. The remaining
question is where overlay/hooks bypass or temporarily compete with them.

### F-003 - Preview publication uses implicit competing timelines

**Status: proven; acceptability unresolved until all gestures are traced.**

`documentProjectionController.ts` keeps an internal preview document that is
published to the renderer without publishing it to the canonical
`DocumentSession`. This is a valid performance technique only if preview
identity, cancellation, rebinding and commit are explicit.

Text editing adds another pending-document slot in
`LightTableEditorOverlay.tsx`. Its own comment records that a React
external-store render can temporarily rewind `imageDocumentRef`, after which
the pending slot restores the newer value on the next animation frame. The
result may be correct today, but correctness depends on event ordering spread
across React, refs, the session store, renderer publication and history.

The final plan must not replace this with pointer-rate React updates. It must
give preview state a formal owner and identity so canonical publication cannot
race or overwrite it.

### F-004 - Render change detection mixes explicit and implicit contracts

**Status: proven.**

`renderDirtyState.ts` explicitly models coarse downstream dependencies between
document composite, corrections, viewport and histogram. However,
`documentRenderState.ts` determines whether `setDocument` crosses the GPU
boundary using a mix of value checks, revision fields and reference identity:

- assets, style stacks, adjustment stacks, attached adjustments and vector
  element arrays depend on reference retention/replacement;
- text uses explicit sub-revisions;
- raster pixels and masks use explicit revisions plus other fields.

This makes every document command part of an unwritten renderer protocol: it
must replace exactly the right references and advance exactly the right
revisions. A missed replacement can update canonical/UI state while leaving
cached pixels unchanged. A needless replacement can wake expensive rendering.

### F-005 - The document GPU composition root is not itself a split target

**Status: provisionally proven.**

`createLayerDocumentRendererRuntime.ts` imports many concrete services because
it assembles the document-scoped GPU graph. The inspected code primarily wires
narrow dependency callbacks and returns the runtime. High import count here is
expected for a composition root. Semantic decisions found inside individual
services still need auditing, but splitting this factory solely by size would
hide rather than improve ownership.

### F-006 - Transform gestures use divergent preview/publication paths

**Status: proven; full tool comparison remains in progress.**

The transform tool does not have one transaction model:

- a normal single-layer transform is renderer-owned during the gesture;
  `TransformController` advances transient GPU state and canonical publication
  is deferred;
- a multi-layer transform constructs a new `ImageDocument` and calls
  `applyDocumentSnapshot` plus React `setState` on pointer movement;
- linked-mask transforms similarly publish document snapshots and React state
  during pointer movement.

The visible transform frame is GPU-rendered. The DOM `svg` in
`TransformOverlay.tsx` is an invisible input and hit surface, so its mere
existence is not proof of a rendering problem. The architectural problem is
that the same user gesture crosses three different mutation and scheduling
paths depending on the selected target. That explains why fixes for one target
can leave group, mask, gradient or gizmo behavior unchanged or regress them.

The target design must preserve pointer-rate GPU preview and avoid canonical
or React publication on every move, while supporting different preview
backends behind one gesture transaction contract.

### F-007 - Layer processing order is centralized, but admission is duplicated

**Status: proven.**

`LayerProcessingRenderer` is a useful authority: it applies local geometry,
grade, spatial and display-post stages in one documented order and then applies
enabled attached adjustments. Interactive compositing and destructive
rasterize/merge/flatten operations can all call this same encoder.

The decision to call it is not authoritative, however:

- `LayerCompositor` defines its own `rasterLayerHasEnabledProcessing` predicate;
- `LayerDocumentAssetService.exportPsd` independently builds a filtered layer
  and tests `adjustmentStack || attachedAdjustments.length`;
- persistence of native layered documents exports raw raster pixels and the
  editable processing descriptors separately, which is intentionally a
  different policy but shares the same fields.

This is not theoretical. If the compositor's admission predicate omits one
processing owner, the correct processing implementation is never reached and
enable/disable appears to do nothing. Export can still take a different path.
The necessary boundary is therefore a layer-evaluation policy that distinguishes
`has enabled render processing`, `must bake for target format`, and `can preserve
editable descriptor`; one Boolean cannot safely represent all three.

### F-008 - Layer command capabilities are centralized only partially

**Status: proven; complete command inventory remains in progress.**

`queryLayerCommandCapabilities` already projects several structural decisions
for the Layers panel, menus and command capability projection. This is the right
direction. It does not yet cover every action, and some consumers weaken its
answers:

- the Layers context menu enables `Rasterize Layer` using only existence and
  pixel-lock state rather than a rasterize capability;
- command capability projection sometimes substitutes coarse counts for the
  exact capability (`layer.merge` uses `layerCount > 1` rather than a valid
  merge plan, for example);
- duplication is currently defined as raster-or-text although general
  rasterization accepts any unlocked canonical node.

The result is that UI, automation and execution can disagree about whether an
operation is valid. The existing query should be completed and made target-
aware; it should not be replaced with another registry that duplicates command
semantics again.

### F-009 - Renderer-backed async file work is not pinned to a renderer binding

**Status: proven from ownership and guards; a reproducing tab-switch test is
still required.**

The standalone editor intentionally owns one reusable renderer and rebinds it
when the active document changes. `useDocumentFileCommands` correctly pins a
save to document/history revisions, but its asynchronous preparation repeatedly
obtains the renderer through the shared `engineRef`. Its `isCurrent` guard
checks task and canonical revision, not that the renderer is still bound to the
same document/generation. Layer-asset, composite and bitmap export all require
that mutable renderer presentation.

Consequently a tab switch during a slow renderer-backed prepare can leave the
old document revision current while the shared renderer has already rebound to
the new document. The code does not currently carry a binding token that lets
the export reject that state. This must be tested before labeling it a user-
visible corruption, but the missing identity contract is concrete.

There is a second ownership mismatch: each `DocumentSession` owns a document-
scoped task registry, while the standalone overlay is explicitly given one
`application-editor` task registry for open/save/export. Session task snapshots
therefore do not necessarily describe the actual file work running for that
document, and same-kind work in another tab can replace it. The audit must
decide which tasks are presentation-global and which are document-owned rather
than presenting both registries as the authority.

### F-010 - Prepared-source publication is ordered, but not one state commit

**Status: proven contract mismatch; observable UI interleaving has not yet been
reproduced.**

`publishPreparedDocument` has no `await` and publishes in a deliberate order,
which prevents a late async continuation halfway through publication. It does
not publish one aggregate snapshot: document, metadata, source, binary assets,
interaction reset, adjustments and diagnostics are separate session stores,
refs and React state setters. Its comment calling this an atomic runtime
snapshot is therefore stronger than the mechanism guarantees.

React may batch the visible result in common cases, but non-React subscribers
and synchronous external-store listeners can observe individual publications.
The correct follow-up is an integration test that records all externally
observable snapshots during open; only if it exposes impossible combinations
should publication be consolidated behind an explicit session transaction.

There is an earlier breach of the same claimed boundary. `loadDocumentSource`
does not only prepare a value: its `DocumentSourceRenderer` can upload source
pixels, initialize the document surface, bind a document, load assets, arm
presentation and wait for presentation. SVG open binds a transient raster
preview document and later binds the editable canonical document before
`prepareDocumentSource` returns. A cancellation check after either renderer
mutation may therefore return `null` even though shared renderer state already
changed. The final `publishPreparedDocument` cancellation guard protects the
session stores, but cannot roll back that renderer mutation.

The format adapters themselves should remain translations into one canonical
model. The correction is to split source decoding/normalization from an
explicit, binding-token-guarded presentation transaction. A transient SVG
first-pixel preview may remain, but it needs its own ephemeral presentation ID
and restoration/cancellation rule; it must not masquerade as the prepared
canonical commit.

### F-011 - Scope option state and mounted-canvas visibility have separate wake paths

**Status: inferred root cause for blank scopes; needs a real Dockview activation
reproduction.**

The scope engine deliberately derives work from both semantic options and the
actual visible area of each canvas. `WebGpuScopeEngine.setOptions` marks
analysis/display dirty, but it does not recompute `canvasVisibility`;
`resize()` owns that recomputation. The React presentation sync calls only
`setScopeOptions` when scope toggles/settings change. `resizeScopes` is driven
separately by container ResizeObservers, document-surface readiness and dock
resize completion.

This leaves a concrete lost-wakeup case: if a scope canvas was hidden when
`resize()` last ran and later becomes visible without changing the observed
container's dimensions, option state can be enabled while the engine still
believes the canvas has no visible area. It then has no visible pending work
and displays a blank retained surface. Dock tab activation and section
expansion must explicitly publish presentation visibility/size to the scope
runtime; relying on incidental ResizeObserver delivery is insufficient.

### F-012 - Vector object movement has a narrow fast path, not one retained edit path

**Status: proven.**

The vector Path Selection tool and the general Transform tool do not merely
present different controls over the same interaction transaction.

`VectorElementSelectionToolController` uses a renderer-owned semantic layer
preview only when the selection is exactly the sole element of one vector
layer. That path calls `updateSemanticLayerTransform` and commits one layer
transform at pointer-up. For a vector layer containing multiple elements, for
multi-element selection, scaling, rotation and gradient-handle changes, it
instead calls `VectorDocumentController.previewElementMutations` on every
pointer move. That method clones/revisions elements, replaces them in a new
canonical `ImageDocument`, and calls `applyDocumentSnapshot` for every sample.

The general Transform tool has the same architectural split at another level:
one semantic layer uses the renderer-owned preview, while multi-layer and
linked-mask gestures construct and publish canonical document snapshots and
React transform state on every update. Thus the perceived speed depends on
selection topology and tool, even when the visible operation is the same
translation.

The document-space gradient compensation in Path Selection is explicit:
`transformVectorElementDocumentPaint` updates paint together with element
geometry. The renderer-owned whole-layer preview instead relies on compositor
projection to move document/user-space paint during the transient gesture.
Those are two separate implementations of the same invariant, which explains
how one tool can keep a gradient attached while the other regresses.

The production boundary should be a retained semantic edit transaction keyed
by stable layer/element identities. It must accept a set of element transforms
and paint-space rules, advance only renderer projection plus GPU overlay state
at pointer frequency, and publish one canonical command/history change at the
gesture checkpoint. Layer selection topology may choose a backend, but must
not choose between canonical React publication and retained preview semantics.

### F-013 - Recovery persistence is strong, but its wake and render identity are indirect

**Status: mixed: persistence proven; two ownership gaps proven.**

The desktop recovery store validates metadata and artifact checksums, writes an
atomic envelope, serializes write/remove/list operations, and prunes by age,
generation, document count and byte budget. This is a sound persistence
boundary and should be preserved.

Checkpoint scheduling is driven only by `DocumentCommandHistory.subscribe`.
The scheduler samples `getCanonicalRevision` when a history event arrives, but
the canonical document store itself is not an input. A canonical mutation that
fails to publish history therefore also fails to wake recovery. The desired
rule is not to add polling; it is to ensure every durable document mutation is
one transaction that publishes canonical state, command history and recovery
revision together.

Recovery preparation calls the same renderer-backed native export path as
normal file work. In the standalone host that renderer can be rebound to a
different document while preparation is running, and the checkpoint has no
renderer binding token. Recovery consequently inherits F-009 rather than
forming an independent snapshot/export authority.

### F-014 - Release disables vector detail tracing, but not all per-frame instrumentation

**Status: proven; measured cost still required.**

The build profile distinction is real:

- release is minified and has no source maps;
- debug is unminified, has source maps, UI devtools and detailed vector
  profiling;
- `run_clean` deliberately uses the release instrumentation profile but still
  runs Vite, HMR and development React;
- `run_release` packages and starts the actual production renderer bundle.

There is no remote product telemetry in the inspected path. Onboarding funnel
events are optional and stored only in local storage. However,
`WebGpuEngine` always owns an enabled `RenderTelemetry`: every executed render
stage performs two `performance.now()` calls and replaces a stage-statistics
object. Counters also run in release. That is not evidence that telemetry is
the main source of the reported 200-pixel drag lag—the canonical/React gesture
paths in F-006/F-012 are much stronger causes—but it means “release without any
debug overhead” is not literally true.

Production profiling should first measure this instrumentation in isolation.
If it is not needed for support builds, its recording implementation should be
selected at build/composition time (no-op versus diagnostic), while retaining
the same query port. Do not scatter environment checks through render code.

### F-015 - Packaged desktop intentionally depends on a loopback HTTP origin

**Status: proven design, product trade-off not yet accepted.**

The packaged app does not use Vite's development port, but it does start a
main-process HTTP server on the first free port in `43119..43123` and loads the
renderer from it. The stated reasons are cross-origin isolation / shared array
buffers and a stable CacheStorage origin for large lazy assets. The server is
loopback-only, constrains paths to the packaged renderer directory and applies
COOP/COEP headers.

This explains why a packaged window can still fail due to a port reservation:
the local server is part of production startup, not an accidental Vite leak.
It also means the product contract currently includes a five-port availability
dependency that is surprising for a self-contained desktop editor.

Before changing it, build a host spike for a privileged secure custom Electron
scheme (or another stable non-network origin) and prove all of: cross-origin
isolation, `SharedArrayBuffer`, WASM/workers, CacheStorage stability, CSP,
navigation/IPC sender trust, packaged Windows/macOS startup and upgrades. The
loopback server should remain until that replacement passes; deleting it based
only on appearance would break explicit runtime requirements.

### F-016 - Mounted and unmounted commands have two execution owners

**Status: proven.**

`LightTableCommandPortRegistry` resolves a document command through a mounted
editor port when available and otherwise through
`createDocumentSessionCommandPorts`. The latter is not merely storage access:
it maintains hand-written command/port allowlists, constructs its own history
and mutation controllers, and directly executes layer, text, vector, SVG,
style, warp and face-warp commands. The mounted Overlay constructs another,
larger implementation of the same document command interface and overrides
the canonical object through a `Proxy`.

This solved a real requirement—model-only commands can address an inactive
document—but it created two application execution owners whose behavior and
capabilities must remain manually aligned. A command can therefore behave
differently depending on whether its tab happens to be mounted, even when it
does not require presentation. The `CANONICAL_PORTS` and `CANONICAL_COMMANDS`
sets are additional hand-maintained projections of that split.

The target is one document command executor with injected optional
presentation capabilities. Model-only operations always use the same executor.
Commands whose plan requires pixels, a canvas, readback or GPU evaluation fail
through a typed missing-capability result when no presentation lease is bound.
Mounting a tab binds those services; it must not replace the semantic command
implementation.

### F-017 - Test volume is high, but invariants are not the organizing unit

**Status: proven structurally; effectiveness inferred from observed regressions.**

The repository currently contains 653 discovered test files, of which 514 are
inside `@lighttable/app`. The suite also has many packaged smoke and audit
scripts. The problem is not an absence of tests. Most recent fixes add focused
tests beside the changed controller or renderer, while a user-visible action
still traverses alternate paths based on active tab, layer type, selection
topology, tool and mounted presentation.

That allows every local unit contract to pass while a cross-product invariant
regresses. Examples from this audit are:

- one-layer versus multi-layer transform publication;
- Path Selection versus Transform gradient behavior;
- mounted versus inactive command execution;
- visible versus previously hidden scope canvas activation;
- ordinary export versus save/recovery after a renderer rebind;
- enabled processing in interactive composite versus destructive rasterize or
  PSD/native export.

The suite should be reorganized around a small set of product invariants and a
target/path matrix, not expanded indefinitely with one regression test per
symptom. Unit tests remain useful underneath. Every architecture migration
must add a contract suite that all implementations run, plus a bounded set of
packaged interaction journeys that prove the observable invariant. Generated
or expensive visual corpora belong in explicit parity/release gates rather
than the default fast feedback loop.

### F-018 - Canonical publication, revision and history are separate side effects

**Status: proven.**

`DocumentSession.setDocument` publishes a new canonical tree but does not
advance `documentRevision` or history. `markChanged` is a separate operation,
and `DocumentCommandHistory.record` is another. The Overlay's
`applyDocumentSnapshot` publishes React/session document state and renderer
state; callers are responsible for recording history through a different
controller. Automation paths then call `session.markChanged` separately.

`DocumentMutationController` guards document identity and can coalesce history,
but its public contract explicitly permits repeated immutable document
snapshots as interaction previews. A normal change first applies the snapshot
and then records history. It does not return or publish an atomic mutation
result containing revision, change set and history command.

This is the central reason unrelated systems can drift: a code path may update
the visible/canonical tree while omitting or delaying history, dirty/recovery
revision, renderer invalidation or command observation. Each downstream owner
then reconstructs “what changed” from references, counters or callbacks.

The first architecture migration must introduce one durable commit envelope,
for example `{documentId, beforeRevision, afterDocument, changeSet,
historyCommand, semanticCommand}`. The session validates and publishes it once;
history, dirty/recovery and renderer projection subscribe to that publication.
Transient previews use a separate identity and never call `setDocument`.
Open/recovery source replacement remains a distinct lifecycle transaction and
must not be disguised as an edit commit.

### F-019 - The source-structure audit detects growth, not responsibility separation

**Status: proven; the repository currently fails its own audit.**

`scripts/audit-source-structure.mjs` is a useful ratchet: it requires large
files to have an ownership review and reopens that review after more than 15%
growth. It does not prove that the reviewed boundary is safe; a
`mixed-authority` file may continue to be accepted when its baseline and prose
are updated. At this checkpoint the audit fails for three concrete reasons:

- `useLayerDocumentCommands.ts` grew 18% after its last ownership review;
- `LayerCompositor.ts` has crossed the hotspot threshold with React UI,
  asynchronous lifecycle and GPU-rendering classifications;
- `VectorLayerRenderer.ts` has crossed it with React UI, asynchronous
  lifecycle, GPU-rendering and command/history classifications.

This is valuable evidence, not a cosmetic CI failure. The baseline must not be
advanced until each flagged file has an explicit authority map, dependency
direction and lifecycle/disposal contract. Passing the script is a guardrail;
it is not the architecture completion criterion.

### F-020 - The retained GPU resource boundary is document-scoped, but device loss is restart-scoped

**Status: ownership and raster reconstruction gap proven; only the vector-only
recovery journey has end-to-end evidence.**

Raster, derived-preview and mask textures are retained by
`DocumentLayerResourceRepository`, keyed by document and shared per
`GPUDevice`. Rebinding the single renderer facade does not copy pixels, and
normal document close explicitly calls `releaseDocumentResources`. Detached
raster resources intentionally survive until the history prune boundary. This
is the correct high-level ownership model and should not be replaced by hidden
per-document renderers.

On device loss the shared device manager invalidates the device and notifies
engines. `WebGpuEngine` forwards loss to the layer renderer and reports the
failure; the Overlay then replaces the renderer/device. The repository is a
`WeakMap` per `GPUDevice`, so the replacement receives an empty repository.
Its existing-document hydration calls `bindExistingDocument`, which creates a
transparent source texture and sets the canonical tree, but does not reload the
retained source/layer/mask/pattern/LUT blobs. That is sufficient for canonical
vector/text content that can be projected again, not for pixels whose only
live copy was a texture on the lost device.

The packaged device-loss audit used VORTEXT: its report proves Vello device
reacquisition and vector preview parity, exactly as Task 303 claims. It does
not prove a source JPEG, painted layer, pasted layer, rasterized layer, mask,
undo-only detached raster or LUT after loss. Recovery journals may hold a
recent serialized artifact, but the automatic renderer replacement does not
restore from that journal and a debounce means it cannot be the lossless live
pixel authority.

Production recovery therefore needs an explicit CPU/durable representation or
checkpoint policy for every non-reconstructible runtime resource, followed by
a replacement-device hydration transaction. Until then, fail safely and offer
recovery rather than presenting a transparent/partial document as recovered.
The release gate must edit unsaved raster pixels, create a pasted/rasterized
layer and mask, retain an undo resource, force device loss, then compare
canonical tree, all pixels, undo/redo and save/reopen across two documents.

### F-021 - A transient Move preview still performs full document work

**Status: proven and directly relevant to the reported drag lag.**

The current single-layer Move route correctly avoids canonical document and
React publication during pointer movement. It stores the transform in the
renderer and updates the GPU editing frame directly. However,
`markDocumentPreviewDirty` invalidates the same `document` render stage used by
a durable edit. Each pointer frame enters `LayerCompositor.encode`, synchronizes
the document, replans render islands, reconciles retained islands, analyzes the
complete layer tree, creates compositing settings buffers and bind groups, and
recomposites the document before presenting the overlay.

For a raster transform the preview texture is document-sized. For a semantic
transform the compositor may cheaply project an existing vector surface for a
pure translation, but the surrounding whole-document planning and composition
still runs. Multi-layer and linked-mask transforms are worse: their `update`
path creates and publishes a replacement canonical document and calls React
`setState` on every pointer sample.

The required boundary is a compositor-owned transient projection plane. A
move-only preview should reuse the last settled composite (or the minimum
affected prefix/suffix cache), project only the affected retained source(s),
draw the GPU gizmo/guides, and present. It must not rebuild the canonical tree,
replan stable islands, wake scopes/thumbnails/history or depend on React. Scale,
rotate, projective transforms, masks, clipping and blend/isolation need explicit
fallback costs, but they use the same preview transaction identity. Pointer-up
publishes exactly one F-018 durable commit and schedules one settled composite.

### F-022 - Hit testing is semantically careful but synchronously waits for GPU readback

**Status: proven design and latency trade-off.**

Move auto-select derives deterministic topmost-first candidates from the
canonical layer tree. Exact vector coverage is tested on the CPU; raster,
derived preview, text and hard-mask alpha are sampled from retained GPU
textures. The sampler batches all one-pixel copies into one submission and one
mapped readback, then retries the whole query if the immutable document
snapshot changed while it was in flight. This correctly handles transparency,
clipping bases, masks and stale results without an invisible SVG hit layer.

The cost is a CPU/GPU synchronization point on click. It is acceptable as a
correctness fallback, but should not become a pointer-move path. A production
picker should first reject candidates through retained bounds/spatial indices,
resolve vector and known-opaque cases synchronously, and issue at most one
readback for the remaining alpha candidates. Cache policy must be revisioned by
pixel/mask/style/processing identity; a stale alpha cache is worse than a slow
click.

### F-023 - Snap geometry is retained, but target construction is still whole-scene work

**Status: proven; current optimization is partial.**

`buildLayerSnapTargets` no longer performs GPU scans and no longer rebuilds a
scene-transform index once per layer. It builds that index once, walks the full
tree, derives visibility, computes semantic/raster/text bounds and allocates a
fresh target array. The Transform overlay exposes this through
`getTransformSnapTargets`. `TransformOverlay` invokes it once when the pointer
gesture begins and stores the immutable result in its ref-owned drag state; it
does not rebuild targets on every move. This part of the hot path is therefore
already directionally correct.

The long-term owner should be a document-revisioned spatial/snap index updated
from the same F-018 change set. Starting a gesture then queries immutable
targets while excluding the moving IDs; pointer moves solve against that
snapshot without revisiting unchanged document data. Guides/grid/tool options
are editor-state overlays on that index, not reasons to reconstruct the layer
geometry.

### F-024 - The shared workspace shell now matches the intended mental model

**Status: proven current direction; regression journeys still required.**

The standalone host now mounts exactly one `StandaloneDocumentRuntimeView` and
one `LightTableEditorOverlay` for the active session. Switching tabs rebinds
that runtime; inactive documents retain canonical session/source/history state
without hidden React editor trees. `LightTableDockWorkspace` owns one Dockview
graph, and its persisted JSON is sanitized so panel parameters cannot retain a
document ID or arbitrary document state. Panel positions, floating bounds,
visibility and preset are application workspace state in one local-storage
record.

This is the architecture the owner requested and it should not be undone by
prewarming canvases or mounting an editor per document. Remaining risk lies in
the rebind effects inside the large Overlay: they must prove that changing the
active session updates projections and tool overlays without resetting the
Dockview graph or publishing one document's derived state into another. Add a
packaged journey that rearranges/floats panels, changes tools, switches among
two edited documents and workspace presets, and asserts both invariant sets:
the layout remains fixed while each canonical document remains unchanged.

### F-025 - Global editor shortcuts do not recognize generic floating controls

**Status: proven boundary inconsistency; exact screenshot symptom needs UI reproduction.**

The editor installs a capture-phase window keyboard binding. It exempts normal
text inputs and scopes marked `data-editor-native-tab-navigation`, but it does
not exempt the generic `data-editor-floating-control` boundary used by color
and gradient popovers. The color picker saturation/value surface is a focusable
`div`, not a text-editing target. While Transform is active, Enter can therefore
resolve as the global `commit-active-operation` even though focus is inside the
picker. Escape is also handled independently by both the picker and the global
editor binding.

Focus visibility itself is an accessibility feature; the desktop bug is the
wrong command scope, not that focus exists. Define one input-scope contract for
dialogs, menus, popovers, native text editing and canvas commands. The global
router should receive a classified scope and only resolve commands permitted
there. Components must not each invent another data attribute and capture
listener. A focused color picker must own Enter/arrows/Escape according to its
control contract without committing a canvas transform behind it.

### F-026 - Destructive raster evaluation is shared, but its transaction contract is not

**Status: proven architecture split; current resource retention is intentional.**

`RasterDocumentOperations` is already the common GPU evaluator for rasterize,
merge, group flatten and image flatten. It composites the selected canonical
node/tree through the normal renderer and copies the result into a new
full-canvas raster runtime. The document union currently has five semantic
node types (`raster`, `group`, `adjustment`, `vector`, `text`), and the generic
Rasterize Layer command admits all five. Local processing, attached raster
adjustments, styles, masks and fill opacity are left on the isolated source and
are therefore baked; outer visibility, opacity, blend and clipping are
neutralized for evaluation and restored as stack relationships on the
replacement. This is the right semantic direction and should remain one
evaluator rather than five type-specific implementations.

The surrounding mutation protocols are different. Text rasterization keeps
the original stable ID and creates a reversible pixel snapshot. Generic
rasterization, merge and flatten create a fresh runtime ID and retain its GPU
texture through the history entry. `LayerRuntimeStore` deliberately keeps
detached textures until `DocumentHistoryController` prunes resources not
reachable from the current document or retained history. This is not an
accidental leak, but it makes the history stack part of the correctness and
lifetime protocol of destructive evaluation. Device loss cannot reconstruct
these runtime-only results from the canonical document object alone.

Introduce one explicit `LayerEvaluationTransaction` contract, not another
renderer implementation. Its result must identify source snapshot/revision,
destination resource, baked versus preserved properties, required text/assets,
undo representation, cancellation owner, document binding and device-loss /
recovery representation. Rasterize, merge, flatten, export baking and future
effect-collapse commands should use that contract. The current common GPU
evaluator can stay behind it. Parity gates must cover every node type plus
styles, masks, attached adjustments, clipping, nested group opacity and undo /
redo after document switching. A separate attached-adjustment row is not a
canonical layer; “rasterize effects” should either bake the owning layer using
the same evaluator or become an explicitly defined partial-stack evaluation,
never a UI-only special case.

### F-027 - Package boundaries exist, but enforcement covers only selected dependency directions

**Status: proven limitation, not evidence that the package split is wrong.**

The package graph has a sensible reusable spine: paint, vector, text and PDF
contracts sit below `@lighttable/app`; desktop and web host the app; provider
packages sit beside it. The vector split in particular distinguishes canonical
data, backend-neutral rendering, SVG normalization/import, native WebGPU and
Vello. That structure is worth preserving.

`verify-boundary.mjs`, however, is a hand-written token scanner over a selected
set of roots. It strongly checks some useful negative dependencies (for
example React/WebGPU must not leak into vector-core and text-core), but omits
entire current packages such as paint-scene, vector-svg, vector-vello and the
SVG normalizer from its scan roots. It does not derive allowed package edges
from manifests, resolve imports, detect cycles or enforce internal application
layer directions. A passing boundary check therefore proves a small set of
forbidden strings, not the architecture as a whole.

Keep the current checks as fast guards, then add a generated dependency graph
and explicit allowlist by responsibility tier: canonical contracts -> backend
neutral planners -> backend implementations -> app orchestration -> hosts.
Inside `lighttable-app`, establish equivalent direction rules for document
model, application transactions, renderer infrastructure and React UI. Permit
named composition roots to depend downward on all required ports; prevent
feature hooks and UI components from importing concrete GPU engines or host
I/O. Gate new cycles and edge additions in CI without forcing arbitrary file
size reductions.

### F-028 - The test estate is broad, but release verification and architecture verification are separate products

**Status: proven from scripts and inventory.**

The repository currently contains 653 unit-test files, including 514 under
`lighttable-app`, plus 70 desktop smoke scripts and 11 desktop audit scripts.
This is substantial evidence, but the entry points do not express one coherent
risk ladder. `npm run verify` runs the basic boundary scanner, typechecking,
all workspace tests, a web build and a desktop package. It does not run
`audit:source-structure`, `audit:architecture-docs`, the desktop smoke corpus or
the quality-profile runner. `run-quality-gates.mjs` separately provides quick,
desktop, parity and full profiles, and dynamically runs every desktop smoke in
the desktop profile. `build.bat`/`build.sh` describe their verification in
broader language than the actual `verify` command provides.

The repository already has a stronger human contract in
`COMPLETE_APP_QUALITY_GATE.md`. It requires a generated capability inventory,
packaged interaction measurements, React commit counts, multi-tab rebinding,
format matrices and stable-tail resource evidence. The runner does not encode
that contract: it discovers scripts by filename and runs them, but has no
machine-readable invariant/platform/budget manifest and does not verify that
each promised measurement was produced. The quality specification and quality
runner can therefore both be "current" while the executable gate omits the
most important proof.

The source-structure audit is also a review/growth ratchet rather than a
separation proof (F-019), while the architecture-doc audit checks links,
inventory counts and package names rather than behavioral truth. None of these
facts makes the tests useless; it explains how thousands of local assertions
can pass while a cross-system journey regresses.

Replace the implied “all tests” concept with named gates tied to invariants and
budgets: pre-commit (contracts/types/targeted units), pull request (critical
cross-path journeys and package graph), release package (packaged startup,
open/edit/save/reopen, document switching, tool gestures, memory/device-loss
policy), and extended parity/soak. Each gate needs a machine-readable manifest,
maximum expected duration, artifact/log ownership and an explicit mapping to
the invariant it protects. Dynamic discovery may supplement a manifest but
must not be the only definition of release-critical coverage.

An audit-time focused contract run on 24 August 2026 selected the processing
renderer, compositor, adjustment projection/transaction, transform session and
workspace session areas. Vitest resolved 135 test files and 879 assertions; all
passed in 6.22 seconds. A later full `npm test` run also passed all 3,675
reported tests/assertions across the root policies and every workspace,
including 2,993 app assertions and 178 desktop-host assertions. This is
positive local evidence and simultaneously demonstrates the boundary gap:
those green contracts do not prove that the real packaged UI route publishes
an attached adjustment, invalidates the correct retained resource and presents
changed pixels, nor that a transform preview contains its source.
Release-critical journeys must assert that full chain, not merely repeat the
same pure mutations at another layer.

### F-029 - The application has no runtime import cycles, but contract placement erodes layer direction

**Status: measured with the TypeScript AST; seven type-level SCCs, zero runtime SCCs.**

A source-graph pass over the 765 production TS/TSX files in
`lighttable-app` found no runtime import cycles. That is a meaningful positive
property. Including type-only imports produced seven strongly connected
components: vector tool/session contracts (7 files), Actions contracts (4),
document session/history/tasks (3), command/artifact contracts (3), and three
two-file renderer/resource pairs.

Most are not runtime hazards, but they show contracts living with their current
implementation owner rather than at the lowest stable semantic boundary. One
concrete example is `editor/tools/vectorToolCatalog.ts`: a basic tool-ID and
activation catalog imports `LiveShapeToolPreset` and `VectorToolMode` from
application controllers. `editor/session/editorSession.ts` then imports that
catalog and application-level snap settings, while those controllers import
editor-session types back. The application works because the edges are
type-only, but the dependency direction is no longer self-explanatory.

Move only genuinely stable data contracts downward: tool IDs, activation
descriptors, snap settings, document task/history entry shapes and backend
ports. Keep behavior and lifecycle in application controllers. Do not create a
generic “types” dumping ground, and do not split cohesive implementations just
to eliminate every type SCC. The gate should require zero runtime cycles and a
reviewed allowlist for type cycles across responsibility tiers.

The same graph quantifies the main composition pressure. The Overlay has 207
local imports, `WebGpuEngine` 70, command service 59, renderer-runtime creation
45 and StandaloneApp 32. High fan-out is expected at named composition roots;
it becomes dangerous when those files also implement workflows, mutation
policy or hot-loop state. Extraction should reduce owned behavior, not chase an
arbitrary import count.

### F-030 - The current delivery audit fails, and its baseline does not own the new renderer assets

**Status: reproduced against the checked-in production web build.**

`node scripts/audit-web-delivery.mjs` currently fails on four findings. The
Vello WASM (2.18 MB), SVG-normalizer WASM (0.76 MB) and a 438 kB shared
JavaScript chunk named after `documentRendererLifecycle` have no declared
load-boundary owner. The shared JavaScript chunk is also referenced by the
initial HTML. The initial JavaScript total is 1.19 MB, which is below the older
2.85 MB regression baseline, so this is not evidence that startup payload grew
overall. It is evidence that the asset-classification contract drifted when the
renderer architecture changed.

The chunk name is not proof that the small `DocumentRendererLifecycle` class is
438 kB. Inspection shows that the chunk contains shared application contracts,
history/tasks, clipboard/recovery, text and SVG conversion code selected by the
bundler. Ownership must therefore be based on import graph and user flow, not a
generated filename. The lazy `StandaloneDocumentRuntimeView` is itself about
2.04 MB of JavaScript and is correctly delayed until the first document, but a
plain JPEG still pays for that full editor runtime before it can be edited.

Make delivery ownership generated and enforce it in the release gate. Every
heavy chunk/WASM needs an owning capability and trigger (`application shell`,
`first bitmap document`, `first vector document`, `text`, `PDF`, `AI`, etc.).
Add separate cold-shell, warm-bitmap-first-pixel and warm-vector-first-pixel
budgets. A lower total byte count must not hide a feature-only dependency that
moved into an earlier path, and a stale filename rule must not block a correct
split. The audit should use the Vite manifest/import graph where available and
fail on unexpected changes in trigger ownership.

### F-031 - The desktop main process is a security composition root and a workflow implementation at once

**Status: proven concentration; extraction must preserve one trust policy.**

`apps/desktop/src/main.ts` has 2,396 lines and registers more than seventy IPC
handlers. It owns Electron lifecycle and renderer origin security, the packaged
loopback server, file open/save, recent files/projects, recovery, clipboard,
fonts, update delivery, project assets, local/remote Agent Access, MCP and the
full GenAI provider/job lifecycle. Most domain helpers already live in focused
modules, but their initialization, validation, mutable registries and request
workflows are still assembled inline in one `app.whenReady()` body.

This file is allowed to be a high-fan-out host composition root. It should not
also remain the implementation owner for unrelated workflows. Extract
registrars with explicit lifetimes (`registerFileIpc`, `registerRecoveryIpc`,
`registerAgentIpc`, `registerGenAiIpc`, `registerProjectIpc`) and injected
services. Keep sender-origin validation and IPC schema validation in one shared
host boundary; do not let every registrar invent a weaker check. The host owns
OS authority and durable I/O, while application packages own editor semantics.
Migration is mechanical only after packaged Windows/macOS open, save, clipboard,
recovery, second-instance and shutdown tests pin the current behavior.

### F-032 - Rasterize/merge storage contradicts the canonical tight-bounds contract

**Status: proven documentation/implementation drift.**

The scene-transform contract says raster and vector content own tight local
bounds and that rasterize/merge produces newly measured tight bounds plus a
simple translation. `DOCUMENT_AND_SCENE_MODEL.md` repeats that rule. The
current commands explicitly create full-document raster layers with identity
transform, zero offsets and `width`/`height` equal to the canvas for text
rasterize, generic rasterize, merge and flatten. The GPU evaluator also targets
that full-canvas destination.

This may preserve pixels, but it makes transparent canvas area canonical
geometry and inflates memory, transform bounds and future tile work. Runtime
alpha measurement can make a gizmo look tighter without repairing the stored
model. Decide the contract explicitly before extracting more code. The
recommended production contract is: evaluate in a declared document-space
region, compute/receive conservative non-empty bounds, store tightly bounded
pixels with an explicit local-to-parent translation, and treat a deliberately
full-canvas result as a named exception. Empty results need a defined minimal
representation. Parity gates must cover transformed/nested sources, shadows
outside source geometry, feathered masks, clipping and undo/save/reopen.

### F-033 - `work/todo` is a human input channel, not an agent-owned backlog

**Status: ownership clarified by the product owner after the source audit.**

The current `work/todo` root is intentionally the human owner's development
input channel, not an autonomous agent backlog or a permanent archive. An
agent must therefore not infer priority from directory order or treat every
folder as concurrently active.

Keep the lifecycle deliberately small: work only from the task the owner points
at; when its implementation/completion contract is met, add a concise result
note and move the complete task directory from `work/todo` to `work/done`.
Human testing happens after that move. A defect or missing behavior found in
that testing becomes a focused new todo instead of making the completed task a
growing mixed log. Do not add a central index, mandatory metadata schema or
dependency database. `work/parked` and `work/todoLater` are used only on
explicit owner direction. Task 302 and Task 304 may inform architecture and
future compatibility, but neither silently broadens the current implementation
scope.

### F-034 - Development and release profiles are distinct; Vite is not the primary transform-lag explanation

**Status: proven from build configuration and the hot render path.**

`run_clean.bat` and `run_clean.sh` run the release instrumentation profile but
remain a Vite/React development runtime with HMR. `run_release.bat` and
`run_release.sh` package the optimized release profile. Release builds use the
normal Vite minifier, no source maps, no UI devtools and no detailed vector
profiling. Debug packages are explicitly unminified, include source maps and
enable those diagnostics. The Windows and macOS scripts now express the same
profile distinction and hybrid renderer; platform differences are installer,
signing and launch mechanics.

There is still always-on local `RenderTelemetry`: integer counters and
`performance.now()` measurements around coarse render stages. There is no
evidence of remote telemetry on the pointer path, and these few calls do not
explain a gizmo trailing a cursor by hundreds of pixels. Vite/HMR and React
development checks can add overhead, so release is the correct performance
oracle. But F-021 proves that even the single-layer fast transform path marks
the whole document projection dirty and reruns compositor planning/resource
work per frame; group and linked-mask paths additionally publish canonical and
React state during the gesture. That architecture is the primary defect and
will remain visible on a fast GPU in a release build.

Keep `run_clean` as the fast development route and `run_release` as the manual
performance route. Add a scripted packaged gesture benchmark that reports
input-to-overlay and input-to-content latency, dropped/coalesced pointer events,
CPU encode time and number of canonical/React publications. Do not disable
useful counters blindly; make detailed timings compile-time optional only after
their measured cost is known.

### F-035 - The regressions crossed features because the vector work repeatedly changed shared editor authorities

**Status: proven by source graph and 22-24 August history.**

The relevant changes were not isolated behind a vector-only backend. In the
97 commits since 22 August, `LightTableEditorOverlay.tsx` changed in 18 commits,
`WebGpuEngine.ts` and `LayerCompositor.ts` in 13 each,
`LayerDocumentRenderer.ts` in 12 and the transform session controller in 7.
Those files are the common route for bitmap layers, vector layers, scopes,
attached processing, document binding, previews, hit testing and editor
overlays. The same period includes explicit fixes for lost document pixels,
workspace switching, transform reactivation, scopes, clipboard color, invert
and attached adjustments alongside Vello/island work. That history is direct
evidence of a shared-boundary problem, not a mysterious unrelated failure.

The hybrid backend itself belongs below a stable projection contract. Instead,
retained-vector lifecycle, active-document rebinding, generic dirty propagation,
transform preview and layer evaluation were evolved together through the same
facades. A locally correct change could therefore alter when every document is
published, which caches survive a switch, whether a full composite is dirty or
which overlay revision is accepted. Unit tests around each helper cannot infer
all those cross-products.

The remedy is not fewer commits or one giant freeze. Establish narrow semantic
seams and migrate one user journey at a time. Backend work may change vector
scene compilation and retained vector resources; it must not change document
commit, workspace binding, generic transform or analysis wake-up policy without
an explicit cross-system contract and gate. Central composition roots may wire
those seams, but may not silently own their mutation rules.

### F-036 - MCP is mostly an adapter over the canonical command contract, not a second editor

**Status: positive boundary with contained duplication.**

The MCP server imports the generated command definitions, schemas and external
allowlists from `@lighttable/command-contract`. Mutations are forwarded as
`command.execute` requests with stable document IDs, optional expected
revisions and unique request IDs. Multi-step work can use one atomic command
batch; accepted async work is polled to completion. The first-context tool
bundles workspace, document, layer and live capabilities, and latency
instrumentation distinguishes MCP/bridge time from model or client startup.
Authentication scopes, bounded artifacts and remote-URL SSRF checks are owned
at the adapter boundary. This is the right direction.

The 51 kB `mcp.mjs` still hand-defines many dedicated convenience schemas and
one product-specific social-design workflow. Those wrappers can drift from the
generic command catalog even though admission allowlists catch command IDs.
Keep dedicated high-value tools, but generate their parameter projection where
possible and require route-equivalence tests against UI/Actions/generic MCP.
The mock client also contains its own small capability list and should never be
used as product capability evidence.

The audit-time `npm test --workspace @lighttable/mcp-server` run passes all 24
tests in about 0.7 seconds, including security, OAuth, reconnect soak, timing
and tool-scope behavior. The prior macOS `node --test test` failure is no longer
present: the package script now correctly uses `node --test`. MCP is therefore
not a priority refactor target for the editor-regression work; it must consume
the same new transaction/capability contracts rather than receive parallel
special fixes.

### F-037 - The desktop window is created only after optional service graphs are assembled

**Status: proven ordering; timing contribution not yet measured.**

In `apps/desktop/src/main.ts`, `app.whenReady()` first starts the packaged
renderer origin, installs session policy, constructs OpenArt, Higgsfield and
local-AI controllers, registers generation runtimes, restores provider state,
loads/creates encrypted Agent Access credentials, constructs/restores the
agent tunnel, constructs local MCP, and registers the entire IPC surface. The
first `createWindow()` call is near the end of that 1,680-line readiness body.
Several restores are fire-and-forget, but module parse, graph construction and
the credential load still precede any visible shell.

A plain bitmap open should not be gated by AI provider, remote agent or MCP
readiness. Keep origin/isolation policy, single-instance/open-file queue and the
minimum trusted preload contract before the window. Publish the shell next,
then start optional host services concurrently or on first use behind explicit
`starting/ready/failed` service states. IPC handlers may be registered early
against lazy service handles; they must return a bounded not-ready result or
await one shared initialization promise rather than using nullable globals.

This finding does not quantify the reported JPEG delay by itself. Add host
timeline marks for process entry, Electron ready, packaged server ready, window
constructed, navigation begun, DOM shell visible, launch bytes available and
first document pixel. Only move initialization after measuring and preserving
security/recovery ordering. No optional service failure may prevent the editor
window from opening.

### F-038 - The generic canvas audit does not execute or measure its declared transform contract

**Status: proven from the executable audit.**

`COMPLETE_APP_QUALITY_GATE.md` requires event-to-preview submission,
event-to-GPU completion, React commit counts, invalidation classes and a real
representative transform path. `audit-desktop-canvas-interactions.mjs` does not
currently produce those proofs. Its `measure` helper records total Playwright
wall time around an action plus two animation frames. It cannot distinguish
driver input steps from application lag, which the quality contract explicitly
warns against. It records renderer aggregate telemetry, but no input event ID,
presented frame ID or React commit/render count.

The transform scenario presses `Ctrl+T`, waits for the controls and immediately
presses Escape. It never drags a raster, vector, gradient, text, group or
multiselection target. Actions above 250 ms are collected in `slowActions` but
do not fail the audit. Consequently this audit can pass while source pixels
stay behind, a gradient detaches, the gizmo leads an empty rectangle or every
pointer move exceeds the 16.7 ms frame budget.

Repair the measurement rather than adding another broad smoke. Stamp each
coalesced input sample with a gesture/frame sequence, propagate it to preview
submission and compositor presentation telemetry, and record React commits
during the gesture. Run actual warm drags for raster and vector-gradient layers
first, then group/multiselect. Fail on percentile and missed-frame budgets plus
pixel/geometry invariants. Playwright wall duration remains useful for overall
completion, but is not the direct-manipulation latency metric.

### F-039 - Layer-target selection has three owners instead of one document-local owner

**Status: proven ownership split; contribution to a particular gizmo failure still requires a packaged reproduction.**

The application already distinguishes global tool state from document-local
interaction state. `EditorApplicationSession` owns the active tool and its
options, while `DocumentSession.editor` owns the active paint channel, pixel
selection and fully layer-scoped vector selection. Ordinary layer selection
does not follow that rule:

- `ImageDocument.activeLayerId` stores the single active layer inside the
  canonical document envelope. `setActiveLayer` deliberately leaves the
  canonical revision unchanged and `documentRenderStatesEqual` ignores it, so
  the implementation already treats this field as editor state in practice;
- `LightTableEditorOverlay` owns `selectedLayerIds` twice, as a React state and
  a mutable ref shared by transform, snapping, merge and delete workflows;
- `LayerPanel` owns the shift-selection anchor in a component ref and uses a
  post-render effect to filter stale IDs and push a repaired selection back to
  the Overlay.

This is not just a naming issue. The one persistent Overlay is rebound from one
document session to another, but its multi-selection and anchor are not part of
either session. Until the panel effect runs, a transform or command can observe
the previous document's selected IDs. Conversely, a UI projection is currently
responsible for repairing application state. That violates the desired rule
that document switching only changes the view binding and cannot make panel
mount timing semantically significant.

Move layer-target state to `DocumentSession.editor`: active layer ID, selected
layer IDs and selection anchor, validated atomically against the session's
layer tree. Keep the global Move tool and auto-select option in
`EditorApplicationSession`. During migration, `ImageDocument.activeLayerId`
can remain a compatibility projection because it has roughly one hundred
callers; selection updates must remain revision-, history- and render-neutral.
`LayerPanel` must render and dispatch selection intent, never repair the
authority in an effect. Transform, snapping, merge/delete, Actions and MCP then
read the same document-keyed selection snapshot.

The parity gate is a two-document journey with different multi-selections:
switch tabs, tools, workspace and floating-panel visibility, then assert the
right active/selected/anchor IDs immediately on rebind, zero content revision
or history change and the correct union gizmo before the first pointer event.

### F-040 - Clipboard route equivalence does not prove an operating-system color roundtrip

**Status: transport semantics and coverage gap proven; current visual color
error is not reproduced in this audit.**

The clipboard implementation has two materially different pixel paths. The
internal fast path copies the canonical `rgba16float` GPU clipboard texture
directly into a raster destination. The interoperable path converts canonical
premultiplied linear pixels to straight 8-bit sRGB PNG, sends that PNG through
Electron/native OS clipboard formats, decodes it as straight sRGB and places it
through a browser canvas before uploading it back to canonical linear storage.
The explicit `sourceIsStraightSrgb` branch in `LAYER_EXPORT_WGSL` is a correct
recent guard against applying the transfer conversion twice.

That path has a legitimate contract—external clipboard images are bounded
straight-alpha 8-bit sRGB—but the contract is implicit in shaders/decoder
descriptors rather than carried by the `LightTableClipboardImage` type. The
type transports only a Blob and optional placement; ICC/profile, transfer,
alpha mode and precision are not explicit. Internal placement is recovered by
hashing the encoded bytes, but an OS/native-image re-encode can change those
bytes and intentionally degrades to an external centered paste.

`smoke-desktop-pixel-clipboard-equivalence` does not test this boundary. It
uses one sRGB solid document and proves UI/Action/MCP command equivalence and
exact resulting previews. The recorded artifact/fast-paste path is not an
external application replacing the OS clipboard, and the test has no ICC,
wide-gamut, alpha-edge or 16-bit cases.

Make the application boundary explicit with a `ClipboardPixelArtifact`
descriptor (dimensions, straight alpha, sRGB transfer/primaries, 8-bit,
placement provenance and optional fast-resource token). A fast token is valid
only for the same renderer/device generation; the PNG remains the portable
fallback. Add Windows and macOS packaged roundtrips through the actual native
clipboard plus simulated external PNG/profile inputs. Compare expected sRGB
pixels and alpha edges, while separately asserting the documented precision
loss for external interoperability. Do not promise arbitrary profile retention
unless the host transports a profile-aware format.

### F-041 - Attached-adjustment bypass is locally tested, not as one presented product invariant

**Status: coverage seam proven; the reported packaged no-op is not reproduced
during this source-only audit.**

The static command and render route is internally consistent. The Layers row
dispatches `setAttachedAdjustmentEnabled`; `useLayerPanelController` forwards
that to `setRasterLayerAttachedAdjustmentEnabled`; the command immutably
replaces the attached-adjustment array and advances both adjustment and layer
revisions. `documentRenderStatesEqual` observes the new array identity,
`WebGpuEngine.setDocument` marks the document composite dirty, and
`LayerProcessingRenderer` evaluates only enabled attached stacks. The
topmost-processing cache also validates its retained base by node identity, so
this audit found no static cache key that obviously explains an enabled and a
disabled result presenting identical pixels.

The current tests prove fragments of that chain. Command/render-state tests
prove invalidation; projection tests prove that authored controls update the
addressed attached stack; compositor tests prove that enabled processing calls
the encoder and disabled processing bypasses it. They do not prove the actual
product invariant across one bound renderer: author a visibly non-neutral
attached adjustment, wait for presentation, toggle bypass, observe the base
pixels, toggle it back, observe byte/pixel-equivalent adjusted output, then
undo/redo and repeat after tab/workspace switching. They also do not prove
that an open adjustment preview transaction cannot race a tree-row bypass
command.

Do not patch the checkbox or compositor speculatively. First add a packaged
journey that records document ID/revision, adjustment ID/revision/enabled,
renderer binding generation, dirty-stage transition, compositor submission
and presented-frame ID. If the canonical enabled flag changes but the frame
does not, the renderer binding/invalidation boundary owns the defect. If the
flag does not change or is overwritten, the adjustment transaction and
properties-target boundary owns it. This diagnostic split should become a
reusable gate for local processing, attached adjustments, Adjustment Layers
and Layer Styles.

### F-042 - Cold OS bitmap open starts useful file work only after the renderer app subscribes

**Status: startup ordering proven; no end-to-end JPEG timing was captured in
this source-only pass.**

Explorer/Open With arguments are validated and queued early in desktop main,
but `DesktopLaunchFileQueue` stores only absolute paths. The bytes are not read
while Electron, optional services or the first window are starting. Main reads
the complete file into a `Uint8Array` only when the mounted renderer invokes
`lighttable:take-launch-files`. That invocation originates in
`host.subscribeOpenFiles`, which `LightTableStandaloneApp` installs from a
React effect. `prepareLightTableRenderingRuntime()` is started immediately
before that IPC and therefore overlaps GPU/Vello preparation with file reading,
but both begin only after window creation, renderer navigation, JavaScript
evaluation, React mount and effect execution. F-037 already shows that optional
desktop service construction precedes first-window creation.

This means a cold double-click can display an initializing shell while neither
the JPEG bytes nor the shared rendering runtime has begun useful work. It also
means a generic “open succeeds” smoke cannot attribute the delay among desktop
startup, app mount, IPC/file read, decode, canonical publication, GPU binding
and presentation.

Create a bounded `LaunchDocumentRequest` in main as soon as the path is known.
Stat and begin reading supported local bitmap bytes concurrently with window
startup; retain strict size/path checks and do not decode or own canonical
document state in main. Let preload expose a ready promise/stream-like handoff
that the renderer can consume on its first bootstrap turn instead of waiting
for a React effect. Start shared GPU preparation at renderer module bootstrap
only when a queued/open request exists, not as unconditional prewarm. Instrument
path accepted, read begin/end, renderer bootstrap, bridge delivery, decode,
canonical publish, renderer bind, first GPU submission and first presented
useful pixel. The performance gate is a warm-application JPEG open and a cold
Explorer launch, both in the packaged release profile.

## 13. Final responsibility map

The target is not a set of perfectly small files. It is a directed ownership
model in which a product fact has one authority, temporary work has a bounded
lifetime, and every durable change crosses one transaction boundary.

| Responsibility | Current authority / pressure | Target owner | Must not own |
| --- | --- | --- | --- |
| Open-document order and active ID | `WorkspaceSession` is already authoritative; React and command ports project it | `WorkspaceSession` | Document pixels, panel layout, renderer resources |
| Source file/payload lifetime | `DocumentWorkspaceController` retains prepared source identity and payload | Document workspace/source repository | Canonical edits or GPU cache policy |
| Canonical document and document-scoped editor state | `DocumentSession`; currently publication/history/dirty/recovery side effects remain separable and layer selection is split across document/Overlay/panel | `DocumentSession` plus one `DocumentCommitCoordinator`; document-local target selection in `DocumentSession.editor` | Workspace layout, global tool selection, concrete GPU objects |
| Global tool and tool-option state | `EditorApplicationSession`; some reset/rebind effects compete in Overlay | `EditorApplicationSession` | Per-document content or renderer cache state |
| Workspace layout/floating panels | Shared Dockview shell; architecture is correct but rebind effects are broad | One application workspace-layout store | Document state, active tool, hidden document runtimes |
| React UI | Overlay and panels currently compose and also implement workflows | React projections/controllers over application ports | Pointer-hot preview, canonical semantics, GPU resource lifetime |
| Gesture lifetime | Transform, paint, selection, vector and text controllers each implement variants | Feature-specific controllers implementing one `InteractionTransaction` protocol | History publication per move, unguarded async results |
| Durable edit commit | Mutation controller, history, dirty, recovery and render invalidation are related but separate calls | `DocumentCommitCoordinator` accepting a typed `DocumentChangeSet` | GPU encoding, host file I/O, UI status formatting |
| Canonical-to-render projection | `documentProjectionController`, render-state equality, `LayerCompositor` and per-feature renderers share decisions | Renderer-neutral `RenderProjectionPlanner` plus explicit preview deltas | Canonical mutation, React state, host concerns |
| Layer evaluation semantics | Compositor is strongest current source; rasterize/export/thumbnail paths can construct variants | One evaluation plan/contract for order, transforms, masks, clips, processing and styles | Operation-specific reinterpretation of layer semantics |
| GPU runtime and scheduling | `WebGpuEngine` is a 3.7k-line facade over many sound internal services | Narrow capability ports over one document-bound renderer runtime | Document mutation policy, menus/capabilities, async results without bind token |
| GPU resources | Shared device plus document-keyed repositories/runtime stores; history retains detached resources | Shared device owner + document resource repository + explicit warm/cold/evicted policy | Canonical-only data with no recovery representation |
| Vector backend | Native and Vello behind paint-scene/island layers, but shared compositor integration is broad | Per-island backend policy below the common projection | Workspace/document lifecycle or generic interaction policy |
| Scopes, histograms and thumbnails | Separate runtimes exist, but visibility/wake/revision coordination is spread | Revision-bound analysis services consuming a presented composite/layer view | Canonical edits or independent layer evaluation rules |
| Destructive evaluation | One `RasterDocumentOperations` GPU evaluator, several command/history protocols | `LayerEvaluationTransaction` around the existing evaluator | Type-specific duplicate rasterizers or UI-only effect collapse |
| Commands and capabilities | Generated command contract, command service, layer capabilities and mounted/unmounted ports overlap | One semantic command/capability registry; route adapters for UI, menu, Actions and MCP | Renderer-specific availability guesses |
| Format import/export | Focused SVG/PSD/PDF/bitmap adapters, with some app-level orchestration | Format adapters producing/consuming canonical interchange transactions | Live editor/session ownership or silent unsupported-data loss |
| Save/recovery/clipboard | Application plans plus browser/desktop host implementations; renderer capture can go stale and clipboard color semantics are implicit | Revision/bind-token application transaction + typed host artifact/color contract | Renderer rebinding, active-document inference after start, implicit profile conversion |
| Desktop OS authority | `main.ts` owns trust policy and all service workflows inline | Thin main composition root + trusted IPC registrars/services | Editor semantics or optional-service gating of first window |
| MCP/Agent routes | MCP largely consumes shared commands; desktop owns trust and tunnel lifecycle | Authenticated adapter over the same command/task/artifact contracts | A parallel document model or feature-specific hidden mutations |
| Verification | Large unit/smoke estate with separate entry points | Named invariant gates with budgets and evidence artifacts | Test-count claims or snapshots as substitute for journeys |

### 13.1 Required core contracts

These names are descriptive; implementation may use different names. Their
semantics are the important part.

#### `DocumentChangeSet`

Every canonical edit reports at least:

- document ID, session generation and before/after canonical revision;
- changed layer IDs and structural parent/order changes;
- geometry, pixels, paint, processing, mask, text, asset and metadata flags;
- conservative dirty bounds in document space, or an explicit `unknown/full`
  reason;
- resources created, retained, replaced or released;
- history label/undo representation and whether the source is user, Action,
  MCP, recovery or import;
- save/recovery significance.

The change set is not a second document. It is the durable commit receipt from
which dirty state, render invalidation, history, recovery and events are
published atomically.

#### `RendererBindingToken`

Every async renderer/readback operation captures:

- document ID;
- document-session generation;
- renderer generation/identity;
- canonical revision and target IDs/revisions where relevant;
- cancellation signal.

Completion validates the token before publication. Rebinding invalidates the
token; a stale result is discarded or restarted, never applied to the new
active document.

#### `InteractionTransaction`

A pointer gesture owns:

- immutable start document/revision and target snapshot;
- pointer ID and input-space conversion;
- transient preview state outside React/canonical data;
- dirty bounds and renderer preview adapter;
- one commit or cancel transition;
- optional async hit/measurement tokens;
- one history result at most.

Painting already approximates this model. Transform should adopt it first.
Tools may have different preview payloads; they should not share one giant
generic state object.

#### `LayerEvaluationRequest` / `LayerEvaluationResult`

Rasterize, merge, flatten, export bake, thumbnail, scopes and isolated preview
must declare target nodes, target space, bounds policy, included semantics,
output format/precision and revision. One planner resolves layer order,
transforms, masks, clipping, opacity, processing and styles. Consumers may use
different output sizes/backends but not different semantic order.

#### `RendererPort` capability families

Replace the leaked full `WebGpuEngine` surface with named ports, for example:

- document bind/present;
- interaction preview;
- layer evaluation/readback;
- selection/mask operations;
- analysis/scopes;
- export/codec;
- diagnostics.

The concrete engine can remain one facade internally during migration. Callers
receive only the capability and binding token they need.

### 13.2 Target data flow

Durable edit:

```text
input / menu / Action / MCP
        |
        v
application command or InteractionTransaction
        |  (preview deltas are transient and renderer-owned)
        v
DocumentCommitCoordinator
        |
        +--> canonical ImageDocument + revision
        +--> one history entry / dirty state / recovery wake
        +--> DocumentChangeSet event
                         |
                         v
              RenderProjectionPlanner
                         |
                         v
          minimal dirty islands/resources
                         |
                         v
              GPU compositor + presentation
```

Active-document or workspace switch:

```text
WorkspaceSession.activeDocumentId changes
        |
        +--> shared UI shell reprojects active session
        +--> one renderer runtime binds with a new token
        +--> global tool state reprojects its overlay

No canonical document commit. No new hidden canvas. No panel-layout reset.
```

Pointer-hot transform:

```text
pointermove -> coalesced transaction update -> transient transform delta
            -> GPU overlay + affected content projection -> present

pointerup   -> one semantic transform command -> one DocumentChangeSet
            -> one history entry -> final retained projection
```

### 13.3 Files with the greatest current architectural influence

| File | Why it influences unrelated features | First safe seam |
| --- | --- | --- |
| `LightTableEditorOverlay.tsx` | 8k lines, 200+ local dependencies, wires UI, tools, document lifecycle, diagnostics and many workflows | Extract already-defined application controllers behind a typed overlay composition context; no behavioral rewrite |
| `WebGpuEngine.ts` | Shared device/document bind, scheduler, viewport, overlays, scopes, operations and export | Expose capability ports and binding tokens while retaining the engine internally |
| `LayerCompositor.ts` | Common semantic and hot render path for every layer kind | Separate retained projection topology from per-frame preview deltas; cache plan/analysis by revisions |
| `LayerDocumentRenderer.ts` | Broad adapter makes every caller depend on almost the full renderer | Split caller-facing interfaces, not implementation, then migrate call sites |
| `createLayerDocumentRendererRuntime.ts` | Correctly assembles many GPU services; high fan-out composition point | Keep as composition root; require dependencies to flow inward through ports |
| `useTransformSessionController.ts` | Mixes hit test, selection, preview, canonical/group paths and history | First implementation of shared interaction protocol; single and multi-target parity gate |
| `documentProjectionController.ts` | Owns one preview/canonical projection while Overlay owns another restoration path | Make it the sole document projection/preview owner and remove Overlay duplicate only after parity |
| `useDocumentMutationController.ts` and `documentSession.ts` | Canonical publication, revision and session services | Add commit receipt/change set without changing document command semantics |
| `useLayerDocumentCommands.ts` | Plans edits, invokes GPU work, records history and status | Move destructive work behind `LayerEvaluationTransaction` one command at a time |
| `RasterDocumentOperations.ts` | Shared destructive evaluator across all node types | Preserve evaluator; add bounds/result/undo/resource transaction contract around it |
| `loadDocumentSource.ts` / `publishPreparedDocument.ts` | Format dispatch, transient preview, renderer binding and session publication cross the claimed preparation boundary | Return decoded/canonical import values separately; perform preview and final bind through guarded presentation transactions |
| `layerCommandCapabilities.ts`, command service and document command ports | Availability and execution differ by mounted route | One registry queried by all routes; retain adapters |
| `LightTableStandaloneApp.tsx` / `StandaloneDocumentRuntimeView.tsx` | Active-session rebind, lazy editor runtime and shell/document boundary | Preserve one runtime view; pin rebind journey and load boundaries |
| `apps/desktop/src/main.ts` | All OS trust/I/O plus optional service startup | Extract trusted IPC registrars and lazy service handles after startup tracing |
| `apps/mcp-server/src/mcp.mjs` | Many convenience tools over shared command contract | Generate schema projections and keep route-equivalence tests; no editor logic |

### 13.4 Boundaries that should remain

- Keep one shared editor shell and one active canvas. Do not mount/prewarm an
  editor per document.
- Keep React for stable UI projection and interaction controls, not raw pointer
  preview or canonical rendering.
- Keep one shared WebGPU device where supported, with document-scoped resources.
- Keep the package spine (`paint-*`, `vector-*`, `text-*`, `pdf-*`) and the
  hybrid native/Vello backend.
- Keep `RasterDocumentOperations` as the common GPU evaluation implementation.
- Keep MCP, menus, keyboard and Actions as adapters over semantic commands.
- Keep local diagnostics; remove or compile out only measured hot overhead.

### 13.5 Package and future-format policy

The current low-level package direction is valuable: paint, vector, text and
PDF packages do not import `@lighttable/app`; the app composes them. Preserve
that direction. Reuse does not require moving the canonical editor document or
PSD UI policy into a generic package now.

Use three explicit levels for SVG, PSD, PDF, future PDF-compatible AI and EPS:

1. a sandboxed parser/normalizer package produces bounded, serializable source
   facts or a normalized display/object list;
2. an application adapter decides which facts become editable `ImageDocument`
   nodes, which are preserved and which are reported unsupported;
3. the normal render-projection path lowers canonical nodes to PaintScene and
   selects native WebGPU or Vello per island.

Vello's PostScript-inspired scene API is useful at level 3 and may simplify
PDF/AI/EPS projection. It must not become an interchange schema or bypass the
canonical document. Create another shared interchange package only after two
real adapters share stable parser-neutral types; creating a broad abstraction
in advance would merely move the current coupling.

## 14. Final migration sequence and parity gates

This is a stabilization program, not a big-bang rewrite. Each phase is a
vertical product slice. The old path remains available as oracle/rollback until
the new path passes its gate. No phase may weaken a test to make the migration
green.

### Phase 0 - Freeze the product invariants in executable journeys

Before moving ownership, create a small release-critical manifest from the
existing smoke scripts plus missing journeys. At minimum:

1. open a bitmap, edit, undo/redo, save/reopen;
2. keep two edited documents intact across tab and workspace switches;
3. transform raster/vector/text/group/multi-selection with visible source,
   attached gradient and correct gizmo bounds;
4. toggle/edit/reorder/remove/rasterize attached adjustments;
5. scopes and thumbnails wake after raster and vector changes;
6. internal and OS clipboard preserve pixels/color/alpha;
7. rasterize/merge each supported node type and undo/save/reopen;
8. execute representative equivalent edits through UI, Actions and MCP;
9. simulate renderer rebind and device loss without canonical data loss;
10. package/start/open through Windows and macOS host routes.

Store canonical hashes/revisions, selected IDs, history state, bounded pixel
evidence, timing and resource counters. Screenshots alone are insufficient;
pure state assertions alone are insufficient. The pair is the gate.

The repository already contains useful packaged proofs. Phase 0 should compose
and tighten them, not replace them with another test framework:

| Product invariant | Existing reusable proof | Missing release assertion |
| --- | --- | --- |
| Edited documents survive tab cycling | `smoke-desktop-document-pixel-retention.mjs`, `smoke-desktop-active-layer-stability.mjs` | Workspace change, tool change and floating-panel layout must be included; assert zero canonical revision change for every non-edit transition |
| Layer target follows its document | Layer-selection model/unit tests and active-layer stability smoke | Two documents with distinct active/multi/anchor selections; assert immediate correct selection and union gizmo on every rebind, with no panel-effect repair and zero revision/history/render invalidation |
| Transform commits visible content | `smoke-desktop-vector-authoring.mjs`, `smoke-desktop-snapping.mjs`, `smoke-desktop-route-equivalence.mjs` | Measure pointer-to-present frames; assert zero React/canonical publications during move; cover raster, vector gradient, text, group, linked mask and multiselect union bounds |
| Gradients remain attached and reversible | `smoke-desktop-gradient-tool.mjs` | Exercise the V-tool layer transform, not only the gradient tool; compare the gradient's object-space relationship before, during and after drag |
| Clipboard is route-equivalent | `smoke-desktop-pixel-clipboard-equivalence.mjs` | Include real OS clipboard ingress/egress, ICC/color/alpha evidence and cross-document paste |
| Rasterize/merge preserves the visible result | `smoke-desktop-tight-merge.mjs`, `smoke-desktop-layer-merge-matrix.mjs` | Cover every admitted node type, attached effects and nested masks/clipping; assert bounds, transform, save/reopen, undo and resource release |
| UI, Actions and MCP have one meaning | `smoke-desktop-route-equivalence.mjs`, `smoke-desktop-document-capability-equivalence.mjs` | Add availability/rejection-reason parity and commands against inactive documents while the shared renderer is rebound |
| Recovery and device recreation preserve truth | `smoke-desktop-recovery.mjs`, `audit-desktop-device-loss.mjs` | Combine unsaved runtime-created raster data, two documents and a renderer rebind; state explicitly which resources are reconstructible |
| Tool/focus changes cannot edit a document | `audit-desktop-tool-switching.mjs`, `smoke-desktop-color-picker.mjs` | Assert revision/history/pixels stay fixed and classify floating-control keyboard scope, including Enter/Escape |
| Bitmap and vector startup meet separate budgets | `measure-warm-vortext-first-pixel.mjs`, `smoke-desktop-os-open.mjs` | Add warm JPG first-useful-pixel and first-editable-frame budgets; run through installed Windows and macOS host routes |

`run-quality-gates.mjs` and `npm run verify` are currently runners, not this
manifest. The new release-critical manifest must name each invariant, its
platforms, budget, artifacts and owner, and fail closed when a required proof
is skipped.

### Phase 1 - Introduce atomic document commit receipts

Add `DocumentChangeSet` and make the existing mutation controller publish it
after the current canonical command succeeds. Initially derive conservative
full-document flags to preserve behavior. Route history, dirty state, recovery
wake and render invalidation through one coordinator without deleting old
calls until double-publication assertions prove equivalence.

**Gate:** exactly one revision/history transition for one edit; zero canonical
changes for tab/workspace/tool/focus events; save and recovery observe the same
revision; UI and MCP return the same changed revision.

In the same phase, migrate layer-target selection into
`DocumentSession.editor` without treating selection as a `DocumentChangeSet`.
This is application state, not content: it publishes a document-session editor
snapshot but never history, dirty state, recovery or compositor invalidation.
Keep `ImageDocument.activeLayerId` temporarily synchronized as a compatibility
projection and remove that projection only after its callers have migrated.

### Phase 2 - Pin document/renderer identity for all async work

Introduce `RendererBindingToken` and migrate save/export/thumbnail/palette,
recovery preview, hit tests, source preparation and destructive evaluations.
Centralize cancellation on session close/rebind. The existing background
removal and selection guards are reference patterns.

**Gate:** delayed results deliberately completed after tab switch/rebind are
discarded; no artifact or pixels cross documents; open/close storms leave no
tasks or resources orphaned.

### Phase 3 - Build the transient interaction projection plane, starting with Move

Keep canonical document and React state fixed during pointer movement. Cache
the layer evaluation/topology at gesture start and apply a transient transform
delta to affected content plus GPU overlay. The compositor must not replan the
whole document unless topology changes. Migrate single raster/vector move,
then multi-selection/group/linked masks, then scale/rotate. Path Selection may
use the same transaction contract with element-level targets.

**Gate:** zero React and canonical publications between pointer-down/up; one
history entry on commit; cancel is pixel/state exact; gradient coordinate
spaces remain attached; topmost auto-select and union bounds are correct. On
the reference packaged build, warm p95 input-to-overlay must fit one 60 Hz
frame and CPU preparation must leave headroom for presentation. Record the
actual target hardware and raw trace rather than reporting only an average.

### Phase 4 - Make one renderer-neutral projection/evaluation contract authoritative

Split stable canonical topology from transient preview deltas. Cache compositor
plans, resolved transforms/bounds and render-island analysis by explicit
subtree revisions. Make vector native/Vello backends consume the same plan.
Move scopes, thumbnails, isolated preview, rasterize and export toward declared
evaluation requests rather than rebuilding layer semantics.

**Gate:** backend pixel parity for blend/isolation/clip/mask/effect cases;
unchanged topology causes no planner/resource rebuild; hidden retained islands
remain warm according to policy; scopes/thumbnails identify the exact presented
revision.

### Phase 5 - Unify destructive layer evaluation and repair bounds

Wrap the existing `RasterDocumentOperations` in `LayerEvaluationTransaction`.
Migrate generic Rasterize first, then attached-effect collapse, Merge Down,
Merge Selected and Flatten. Implement the accepted tight-bounds contract or
formally revise the architecture documents if full-canvas storage is chosen.

**Gate:** all five current node types plus nested groups, masks, clipping,
styles and attached adjustments match pre-bake pixels within declared
tolerance; new bounds/transform are correct; undo/redo/save/reopen and device
loss preserve or explicitly recover the result; resource counts return after
history pruning.

### Phase 6 - Make one capability and command registry serve every route

Express command admission from canonical state and host/renderer capabilities.
Menus, LayerPanel, keyboard, Actions, mounted/unmounted sessions and MCP query
the same registry. Keep route adapters and user-facing labels outside it.

**Gate:** generated matrix proves identical availability/reason and semantic
result across routes; an inactive document command cannot borrow active
renderer state; every edit is revision-guarded and undoable as declared.

### Phase 7 - Thin composition roots without moving semantics accidentally

Once contracts are exercised, extract Overlay feature composition contexts,
renderer capability adapters and desktop IPC registrars. Move code mechanically
first; behavior changes need separate commits and gates. Keep
`createLayerDocumentRendererRuntime` as a named assembly root.

**Gate:** dependency graph has zero runtime cycles and no new upward edges;
composition-root fan-out may remain high but owned workflows fall; packaged
journeys and performance baselines remain unchanged.

### Phase 8 - Resource lifecycle, startup and release hardening

Implement explicit active/warm/cold/evicted states for textures and retained
scenes, reconstructibility rules for runtime raster results, optional-service
startup after the shell, and capability-owned delivery chunks. Make release
gates run package-graph, delivery, critical journeys, startup, memory and
device-loss checks with fixed time budgets.

**Gate:** warm bitmap first-use and vector first-use meet separate budgets;
optional AI/MCP/provider failures do not block the window; repeated
open/edit/close returns CPU/GPU/resource counters to bounded steady state;
packaged device loss restores every reconstructible document or gives an
explicit recovery result without data mutation.

### 14.1 Commit and rollback discipline

- One architecture seam or user journey per commit.
- Record the before trace and after trace in the task artifact.
- Do not combine mechanical moves with semantic changes.
- Keep old and new implementation selectable internally only during a phase;
  remove the switch after parity, not as a permanent product backend switch.
- Revert the slice when a gate fails; do not patch downstream symptoms until
  the violated owner/invariant is identified.
- Update architecture documents and task index in the same commit that changes
  an accepted responsibility.

### 14.2 Explicit non-goals

- No full editor rewrite.
- No per-document hidden React editor/canvas instances.
- No universal node graph rewrite before current layer semantics are stable.
- No migration of every vector path to Vello; backend choice remains per island.
- No binary transport project while JS/WASM transport is below one percent of
  the measured warm vector path.
- No arbitrary file-size targets or generic `types.ts` dumping ground.
- No removal of unsupported format data or silent raster fallback.
- No claim of production readiness based on unit-test count alone.

## 15. Evidence index and audit limits

### 15.1 Method

This was a structural and behavioral source audit, not a claim that every
algorithm body received equal manual scrutiny. The pass:

- inventoried all workspace applications/packages and their manifest edges;
- scanned 1,449 production files with the repository source-structure audit;
- built an AST import graph for the 765 production TS/TSX files in
  `lighttable-app`, separately considering runtime and type-only edges;
- traced the named critical paths through composition, application, renderer,
  host and persistence code;
- compared current contracts, tests, build scripts and the 97-commit history
  since 22 August;
- inspected the current production asset graph and ran the delivery audit;
- ran focused application contract tests (135 files / 879 assertions), the MCP
  suite (24 tests), the complete workspace test command (3,675 reported
  tests/assertions), boundary verification and architecture-document audit.

It did not run the full packaged smoke corpus, visual parity corpora, device-loss
audit, memory soak or owner-driven manual acceptance matrix. Those are Phase 0
and release-gate work, not evidence that may be inferred from reading source.

### 15.2 Finding-to-source map

Symbols are included where a file contains several unrelated responsibilities.
Generated bundle names and line numbers are deliberately not used as stable
architecture identifiers.

| Finding | Primary source evidence |
| --- | --- |
| F-001 | `application/rendering/webGpuDocumentRenderer.ts` (`DocumentRendererPort`); `gpu/WebGpuEngine.ts`; `editor/rendering/LayerDocumentRenderer.ts` |
| F-002 | `application/workspace/workspaceSession.ts`; `application/workspace/documentWorkspaceController.ts`; `application/documents/documentSession.ts`; `application/workspace/editorApplicationSession.ts`; `standalone/StandaloneDocumentRuntimeView.tsx` |
| F-003 | `application/documents/documentProjectionController.ts`; `LightTableEditorOverlay.tsx` (`pendingTextDocumentRef` and preview restore effects) |
| F-004 | `application/rendering/documentRenderState.ts`; `application/rendering/renderDirtyState.ts`; `gpu/WebGpuEngine.ts` (`setDocument`, dirty markers) |
| F-005 | `editor/rendering/createLayerDocumentRendererRuntime.ts`; `editor/rendering/RenderResourceCoordinator.ts` |
| F-006 | `application/tools/transform/useTransformSessionController.ts`; `application/tools/transform/transformController.ts`; `application/tools/snapping/groupLayerTransform.ts` |
| F-007 | `gpu/layerProcessingRenderer.ts`; `processing/adjustmentStack.ts`; `processing/attachedAdjustment.ts`; `application/adjustments/projectAdjustmentSnapshot.ts` |
| F-008 | `application/layers/layerCommandCapabilities.ts`; `editor/ui/LayerPanel.tsx`; `application/commands/lightTableCommandService.ts`; `application/commands/commandCapabilityProjection.ts` |
| F-009 | `application/documents/documentSaveTransaction.ts`; `application/documents/editorArtifactExports.ts`; document file/export controllers; renderer callback guards |
| F-010 | `application/documents/loadDocumentSource.ts`; `prepareDocumentSource.ts`; `prepareAndPublishDocumentSource.ts`; `publishPreparedDocument.ts`; `documentSourceLoadController.ts`; `composition/documents/useEditorDocumentLifecycleController.ts` |
| F-011 | `ScopesPanel.tsx`; `gpu/documentScopeRuntime.ts`; `gpu/WebGpuScopeEngine.ts`; `gpu/WebGpuEngine.scopeActivation.test.ts` |
| F-012 | `editor/rendering/VectorLayerRenderer.ts`; `application/vectors/vectorEditingOverlay.ts`; vector transform paths in `useTransformSessionController.ts` |
| F-013 | `application/documents/RecoveryJournalScheduler.ts`; `application/documents/useDocumentRecoveryJournal.ts`; `application/documents/useEditorRecoveryJournal.ts`; desktop `recoveryStore.ts` |
| F-014 | `application/rendering/renderTelemetry.ts`; `gpu/vectorRendererBackendDiagnostics.ts`; desktop Vite configs; `scripts/run-with-build-profile.mjs` |
| F-015 | desktop `main.ts` (`startPackagedRendererServer`, isolation headers); `rendererNavigation.ts`; desktop Vite isolation config |
| F-016 | `application/commands/documentSessionCommandPorts.ts`; `LightTableEditorOverlay.tsx`; `application/commands/lightTableCommandService.ts` |
| F-017 | repository test inventory; `package.json` scripts; `scripts/run-quality-gates.mjs`; desktop smoke/audit script directories |
| F-018 | `application/documents/useDocumentMutationController.ts`; `application/documents/documentSession.ts`; `application/commands/useDocumentHistoryController.ts`; recovery journal hooks |
| F-019 | `scripts/audit-source-structure.mjs`; `architecture/tests/source-structure-baseline.json`; generated `tmp/code-quality/source-structure.json` |
| F-020 | `editor/rendering/DocumentLayerResourceRepository.ts`; `editor/rendering/DocumentPatternResourceRepository.ts`; `editor/rendering/LayerRuntimeStore.ts`; `gpu/WebGpuEngine.ts` (`bindExistingDocument`); `composition/documents/useEditorDocumentLifecycleController.ts` (existing-document hydration); `application/commands/documentCommandHistory.ts`; `useDocumentHistoryController.ts`; VORTEXT-only device-loss desktop audit |
| F-021 | `application/tools/transform/useTransformSessionController.ts`; `editor/rendering/LayerCompositor.ts` (`encode`, projection reconciliation); `editor/rendering/RenderIslandPlanner.ts` |
| F-022 | `application/tools/transform/transformLayerPicker.ts`; `editor/rendering/LayerPresentationPicker.ts`; their ordering/stale-readback tests |
| F-023 | `application/tools/snapping/layerSnapGeometry.ts`; `application/tools/snapping/snapEngine.ts`; `editor/tools/transform/snapTransformTranslation.ts` |
| F-024 | `standalone/LightTableStandaloneApp.tsx`; `standalone/StandaloneDocumentRuntimeView.tsx`; workspace session/layout code; Task 302 |
| F-025 | global keyboard capture in `LightTableEditorOverlay.tsx`; `application/input/editorKeyboardRouter.ts`; color/gradient picker floating controls |
| F-026 | `editor/rendering/RasterDocumentOperations.ts`; `application/layers/useLayerDocumentCommands.ts`; `editor/document/documentCommands.ts`; runtime store/history pruning |
| F-027 | package manifests; `scripts/verify-boundary.mjs`; workspace/package import graph |
| F-028 | root `package.json`; `scripts/run-quality-gates.mjs`; `architecture/COMPLETE_APP_QUALITY_GATE.md`; build entry points; unit/smoke/audit inventory |
| F-029 | TypeScript AST import graph over `packages/lighttable-app/src`; `editor/tools/vectorToolCatalog.ts`; editor/application vector session contracts |
| F-030 | `scripts/audit-web-delivery.mjs`; `architecture/tests/web-delivery-baseline.json`; current `apps/web/dist`; lazy imports in StandaloneApp |
| F-031 | desktop `main.ts`; focused desktop services under `apps/desktop/src`; `desktopBridge.ts`/preload contract |
| F-032 | `architecture/contracts/SCENE_TRANSFORM_CONTRACT.md`; `DOCUMENT_AND_SCENE_MODEL.md`; `editor/document/documentCommands.ts`; `RasterDocumentOperations.ts` |
| F-033 | `work/todo/*/task.txt`; Task 302 and Task 304 status/acceptance records |
| F-034 | `run_clean.*`, `run_release.*`, `build.*`; desktop Vite configs; `run-with-build-profile.mjs`; `renderTelemetry.ts`; F-021 sources |
| F-035 | `git log --since 2026-08-22` file frequency/churn; Overlay, engine, compositor, renderer facade and transform history |
| F-036 | `apps/mcp-server/src/mcp.mjs`; `lighttableClient.mjs`; latency/auth/security tests; `@lighttable/command-contract` |
| F-037 | desktop `main.ts` `app.whenReady()` ordering, optional provider/agent constructors and final `createWindow()` call |
| F-038 | `architecture/COMPLETE_APP_QUALITY_GATE.md` Phase 4; `scripts/audit-desktop-canvas-interactions.mjs` action/transform/threshold implementation |
| F-039 | `editor/session/editorSession.ts` (`EditorApplicationState`/`DocumentEditorState` split); `application/documents/documentSession.ts`; `LightTableEditorOverlay.tsx` (`selectedLayerIds` state/ref); `editor/ui/LayerPanel.tsx` (selection anchor and repair effect); `editor/document/documentCommands.ts` (`setActiveLayer`) |
| F-040 | `platform/LightTableImageClipboard.ts`; desktop `clipboardEncodedImage.ts`, `main.ts` clipboard handlers and `renderer.tsx` transport; `editor/rendering/SelectionClipboardService.ts`; `LayerTextureCodec.ts`; `layerShaders.ts`; `scripts/pixel-clipboard-route-equivalence.mjs` |
| F-041 | `editor/ui/LayerPanel.tsx`; `composition/workspace/LayersWorkspacePanel.tsx`; `application/layers/useLayerPanelController.ts`; `editor/document/documentCommands.ts`; `application/rendering/documentRenderState.ts`; `gpu/WebGpuEngine.ts`; `editor/rendering/LayerCompositor.ts`; `gpu/layerProcessingRenderer.ts`; attached-adjustment projection/compositor tests |
| F-042 | desktop `desktopLaunchFiles.ts`, `main.ts` launch queue/IPC and `renderer.tsx` host bridge; `platform/LightTableHost.ts`; `standalone/LightTableStandaloneApp.tsx`; `gpu/sharedWebGpuDevice.ts` |

### 15.3 Verification results captured during this audit

| Check | Result |
| --- | --- |
| Focused app contracts | Passed: 135 files, 879 assertions, 6.22 s |
| Attached-adjustment chain focus | Passed: 4 files, 41 tests covering projection, render-state invalidation, document projection and compositor branching; does not replace the packaged presented-pixel journey in F-041 |
| Full `npm test` | Passed: 3,675 reported tests/assertions across root policies and all workspaces; 2,993 in app and 178 in desktop |
| MCP server tests | Passed: 24 tests, about 0.7 s test-runner duration |
| `npm run verify:boundary` | Passed; limited scope described in F-027 |
| `npm run audit:architecture-docs` | Passed: 147 documents, 180 local links |
| `npm run typecheck` | Passed across all workspaces |
| `npm run build:web` | Passed from a fresh build; production bundle and distribution-boundary check completed |
| `node scripts/audit-web-delivery.mjs` | Failed on unowned Vello WASM, SVG-normalizer WASM and renderer-lifecycle assets plus one initial-boundary violation (F-030) |
| `npm run verify:interchange-matrix` | Passed: canonical registry discovery and contextual evidence policy |
| `npm run audit:interchange-evidence` | Passed: 79 rows, 26/32 all-mode blends, 48 color cases, 40 effects and 10 templates |
| Source-structure audit | Review failures for `useLayerDocumentCommands`, `LayerCompositor` and `VectorLayerRenderer` (F-019) |

## 16. Audit verdict

LightTable does not need to be discarded or rewritten. Its canonical document
model, one-editor workspace direction, package spine, shared GPU device,
document-scoped resources, common raster evaluator and hybrid vector backend
are viable foundations. The application is not presently release-stable
because integration authorities are too broad and several important state
transitions are implicit or duplicated.

The most urgent work is not more vector coverage. It is to make durable commit,
renderer binding and transient interaction explicit, then prove the actual
bitmap/vector/adjustment/document-switch journeys in a packaged build. Until
those gates pass, “production ready” would be an unsupported claim. The plan in
Section 14 is the smallest route that addresses the causes without replacing
the working core.
