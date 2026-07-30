# LightTable production modularization plan

Status: proposed architecture and migration plan  
Scope: LightTable core, web host and Electron host  
Primary goal: make continued high-end editor development safer without pausing
feature delivery or rewriting the application in one step.

## 1. Why this refactor is necessary

LightTable has outgrown its original role as a small grading overlay. It now owns
layers, masks, selections, transforms, painting, PSD import, adjustment layers,
layer styles, scopes, effects, document persistence, docking and multiple hosts.
AI-first tools and additional media workflows will add substantially more state
and asynchronous work.

The current code already contains useful domain and feature modules, but the real
orchestration authority remains concentrated in a few files:

- `LightTableEditorOverlay.tsx`: approximately 5,200 lines, 54 React state
  values, 59 refs and direct access to document, tool and GPU internals.
- `LayerDocumentRenderer.ts`: approximately 2,200 lines and responsible for too
  many compositing and document-runtime concerns.
- `WebGpuEngine.ts`: approximately 1,900 lines and responsible for device,
  image, effect, scope and resource lifecycles.
- `gpu/shaders.ts`: a large shared shader source whose failures can affect
  unrelated editor startup paths.

This concentration explains why a local transform, docking or layer-style change
can accidentally affect image loading, shortcuts, sliders or the whole WebGPU
pipeline.

This plan is not a cosmetic React component split. The goal is to move authority
into explicit systems with enforceable dependency rules.

## 2. Hard product invariants

These are release requirements, not future intentions.

1. LightTable supports both web and Electron from the same product code.
2. Core editor, document, command and rendering semantics contain no browser,
   Electron, Node or StoryBuilder dependencies.
3. Only host adapters differ between web and Electron.
4. Every migration phase must pass both web and Electron verification.
5. A document is canonical serializable data. GPU resources and React state are
   never the source of truth for document contents.
6. Every document owns isolated history, selection, active tool, viewport,
   dirty state, async work and derived GPU state.
7. A workspace may contain multiple open documents but has exactly one active
   document at a time.
8. Switching the active document changes the projected session; it must not
   copy, reset or share mutable document state.
9. UI code never mutates a document or GPU runtime directly.
10. Commands are the only route for persistent editor mutations.
11. A gesture such as a slider drag, paint stroke or transform is one
    transaction and one undo entry.
12. Unsupported operations return a typed failure. They never silently change
    target or fall back to a more destructive operation.
13. Coordinate-space changes are explicit and follow `coordinate_contract.md`.
14. Optional effects must have an exact bypass and cannot prevent a plain image
    from opening when disabled.
15. Host integrations exchange capabilities and data, not product internals.

## 3. Target architecture

```text
hosts
  web / electron / storybuilder
             |
             v
ui shell and feature views
             |
             v
application workspace + document sessions
             |
       commands / queries / tasks
             |
             v
core document and operation model
             |
             v
ports ------------------------------------+
  renderer / codecs / storage / clipboard |
  diagnostics / clock / identifiers       |
             |                             |
             +--> WebGPU infrastructure ---+
             +--> image I/O workers
             +--> host implementations
```

Dependencies only point down this diagram. Infrastructure implements ports but
does not become the public editor API.

### 3.1 Core domain

Suggested location:

```text
src/lighttable/core/
  document/
  layers/
  masks/
  selection/
  transforms/
  adjustments/
  styles/
  assets/
  geometry/
  commands/
```

Responsibilities:

- canonical `ImageDocument` and layer graph;
- stable IDs, revisions and value objects;
- affine transforms and coordinate conversions;
- layer/group/clipping/mask invariants;
- pure document command functions;
- validation and typed domain errors;
- serialization-safe adjustment and effect descriptors;
- content and visible-bounds semantics.

Forbidden dependencies:

- React;
- DOM, Canvas or browser globals;
- Electron or Node;
- WebGPU;
- host storage and network APIs;
- mutable GPU resources.

The core may state that an operation is valid and describe its result. It does
not render, upload, save or display anything.

### 3.2 Application layer

Suggested location:

```text
src/lighttable/application/
  workspace/
  documents/
  commands/
  queries/
  history/
  tasks/
  tools/
  ports/
```

Responsibilities:

- open-document workspace;
- active-document switching;
- one `DocumentSession` per open document;
- command dispatch and transaction boundaries;
- undo/redo history;
- active target, selection, tool and viewport state;
- dirty/save state;
- cancellable open, save, import, export and analysis tasks;
- renderer invalidation requests;
- capability checks through ports;
- state subscriptions and selectors for UI.

The application layer coordinates systems but cannot contain React rendering or
WebGPU implementation details.

### 3.3 Feature modules

Suggested location:

```text
src/lighttable/features/
  layers/
  selection/
  transform/
  paint/
  grade/
  lens-fx/
  layer-styles/
  auto-align/
  psd/
  scopes/
```

Each feature is a vertical slice and may contain:

```text
feature/
  commands/
  controller/
  model/
  selectors/
  ui/
  tests/
```

Feature controllers use application ports and commands. They cannot import the
concrete WebGPU engine, another feature's UI, or the application composition
root.

Shared behavior belongs in core/application contracts rather than cross-feature
imports. For example:

- transform owns transform interaction, preview and commit;
- selection owns selection state and selection algebra;
- paint owns stroke sampling and paint transactions;
- both use the shared coordinate and target contracts.

### 3.4 Rendering infrastructure

Suggested location:

```text
src/lighttable/infrastructure/webgpu/
  device/
  documents/
  graph/
  compositor/
  resources/
  effects/
  scopes/
  readback/
  diagnostics/
```

Responsibilities:

- shared WebGPU device and capability negotiation;
- one isolated renderer context per open document;
- render-graph compilation;
- texture/resource allocation, caching and eviction;
- layer compositing and adjustment/effect passes;
- preview surfaces and scope surfaces;
- GPU readback and memory estimates;
- device-loss recovery;
- shader and pipeline diagnostics.

The renderer consumes immutable document snapshots plus revisions. It does not
mutate `ImageDocument`, create history entries or decide which user operation
should occur.

An optional pipeline failure must be contained to its feature. Plain image
decode and first display must not depend on compiling every layer style or lens
effect.

### 3.5 Image I/O infrastructure

Suggested location:

```text
src/lighttable/infrastructure/io/
  codecs/
  workers/
  psd/
  wasm-vips/
  persistence/
  export/
```

Responsibilities:

- decode/encode through capability-selected implementations;
- PSD import into the canonical LightTable model;
- LightTable document persistence;
- web-worker lifecycle;
- precision and color-profile metadata;
- progressive or deferred decoding where appropriate.

PSD is an adapter into the same document model. It is not a second editor
architecture.

### 3.6 UI shell

Suggested location:

```text
src/lighttable/ui/
  shell/
  workspace/
  panels/
  menus/
  dialogs/
  status/
  controls/
  theme/
```

Responsibilities:

- app chrome and composition;
- document tabs;
- dockable panel registry;
- menus and dialogs;
- platform-neutral keyboard/pointer normalization;
- rendering state selected from application sessions;
- dispatching commands and tool intents.

React uses a small external-store adapter based on typed selectors, for example
`useSyncExternalStore`. React state is reserved for ephemeral presentation state
such as a locally open popover, not canonical editor state.

## 4. Composition root

The product root should only construct and connect systems:

```ts
const application = createLightTableApplication({
  host,
  renderer,
  codecs,
  persistence,
  clipboard,
  diagnostics
});

return <LightTableShell application={application} />;
```

Target responsibilities of the root:

- create application lifetime;
- connect host capabilities;
- register panels and commands;
- render the shell;
- dispose the application.

Target size: approximately 100–200 lines. Feature behavior, document loading,
keyboard command logic and GPU calls do not belong in the root.

## 5. Multi-document model

Multi-document support is part of the foundation.

### 5.1 WorkspaceSession

```ts
interface WorkspaceSession {
  readonly documentOrder: readonly DocumentSessionId[];
  readonly activeDocumentId: DocumentSessionId | null;

  open(request: OpenDocumentRequest): Promise<DocumentSessionId>;
  close(id: DocumentSessionId, policy: ClosePolicy): Promise<Result<void>>;
  activate(id: DocumentSessionId): Result<void>;
  getDocument(id: DocumentSessionId): DocumentSession | null;
}
```

Workspace-owned state:

- open document order;
- active document ID;
- panel/dock layout;
- host-wide menus and recent files;
- shared renderer device and shared immutable caches;
- application-level tasks and diagnostics.

Document-owned state:

- canonical `ImageDocument`;
- history and open gesture transaction;
- active layer/channel/selection/tool;
- viewport pan and zoom;
- foreground/background colors and brush settings;
- dirty and save state;
- source/import metadata;
- document task registry and cancellation scope;
- renderer document context and derived resources;
- scope data revisions.

### 5.2 Switching documents

Activating a document:

1. updates `activeDocumentId`;
2. changes UI subscriptions to the selected session;
3. attaches the document surface to that session's renderer context;
4. rebinds scope surfaces;
5. preserves the previous document exactly as it was.

It does not:

- rebuild the document from UI state;
- share undo stacks;
- reuse mutable layer textures between documents;
- cancel unrelated document work unless memory policy requires suspension;
- serialize/reload just to switch tabs.

### 5.3 GPU residency

The WebGPU device may be shared. Document resources are not.

Each renderer context has a state such as:

```text
uninitialized -> loading -> resident -> suspended -> disposed
                       \-> failed
```

Inactive documents may remain resident, release derived caches, or suspend based
on an explicit memory policy. Eviction never changes canonical document data.

## 6. Commands, queries and events

### 6.1 Commands

All persistent mutations use typed commands:

```ts
type DocumentCommand =
  | TransformLayerCommand
  | TransformSelectionCommand
  | PaintStrokeCommand
  | FillTargetCommand
  | AddMaskCommand
  | UpdateAdjustmentCommand
  | ReorderLayersCommand;
```

A command declares:

- target document and target entity;
- preconditions;
- coordinate space;
- payload;
- undo strategy;
- affected revisions and dirty bounds.

Commands return a typed result. A `TransformSelectionCommand` cannot quietly
become `TransformLayerCommand` because a precondition failed.

### 6.2 Transactions

Interactive tools use:

```text
begin -> preview updates -> commit
                       \-> cancel
```

Preview state is runtime state, not repeated document mutations. Commit produces
one command result and one history entry.

### 6.3 Queries/selectors

UI reads through selectors:

- active layer and active channel;
- can execute command;
- selected layer IDs;
- visible bounds;
- document dirty/saving state;
- renderer/task status;
- tool options;
- panel data.

Selectors are pure and testable. UI components do not derive editor semantics
from DOM state.

### 6.4 Events

Events report completed facts:

- document changed;
- render invalidated;
- task progressed;
- active document changed;
- device lost/recovered.

Events do not replace commands and cannot be used as an untyped mutation bus.

## 7. Tool runtime

Tools share a common lifecycle:

```ts
interface EditorTool {
  id: ToolId;
  canActivate(context: ToolContext): ToolAvailability;
  activate(context: ToolContext): void;
  pointer(event: NormalizedPointerEvent): void;
  key(event: NormalizedKeyEvent): void;
  commit(): Promise<Result<void>>;
  cancel(): void;
  deactivate(): void;
}
```

Tool state machines use explicit states such as:

```text
idle -> preparing -> active -> committing -> idle
                   \-> cancelling -> idle
                   \-> failed
```

The input router normalizes pointer, wheel, keyboard and temporary-tool behavior
once. Features no longer register competing global listeners.

Transform must explicitly identify:

- target kind: layer or selected pixels;
- target layer ID;
- source bounds;
- source-to-document matrix;
- selection snapshot and revision;
- preview matrix;
- commit strategy.

No command may infer a different target during execution.

## 8. State ownership rules

| State | Owner | Never owned by |
| --- | --- | --- |
| Layer graph and settings | `ImageDocument` | React component or GPU engine |
| Undo/redo | `DocumentSession` | individual panel |
| Active tool and target | `DocumentSession.toolRuntime` | toolbar DOM |
| Gesture preview | active tool transaction | canonical document |
| Viewport | `DocumentSession.viewport` | renderer resource |
| Dock layout | workspace UI state | image document |
| Open documents | `WorkspaceSession` | standalone app component file state |
| GPU textures | document renderer context | document serialization |
| Decode/save progress | task registry | ad-hoc component refs |
| Host capabilities | injected host ports | feature module |

Duplicated mutable sources of truth are prohibited. A ref may cache a value for
rendering performance, but it cannot independently define editor semantics.

## 9. Host and platform boundaries

### 9.1 Shared hosts contract

Web and Electron implement the same capability-oriented ports:

```ts
interface OpenFilePort {}
interface SaveFilePort {}
interface ClipboardPort {}
interface RecentFilesPort {}
interface WindowPort {}
interface ExternalMediaPort {}
```

Capabilities may differ. Feature availability is queried; platform identity is
not scattered through feature code.

### 9.2 Web host

- browser file picker and download/save APIs;
- web workers;
- browser clipboard with permission-aware fallback;
- COOP/COEP only where the deployment actually supports it;
- no Node or Electron globals.

### 9.3 Electron host

- preload-mediated filesystem and native dialog APIs;
- secure IPC;
- packaged asset resolution;
- native window and recent-file integration;
- optional desktop-only capabilities through explicit ports.

The renderer process must remain able to run as a normal web app. Electron
preload objects cannot become implicit global dependencies in product code.

### 9.4 StoryBuilder host

StoryBuilder is an adapter, not an owner. It may provide source bytes, storage,
media browsing and save callbacks through ports. LightTable does not import
StoryBuilder resources, CSS, icons or state.

All LightTable UI controls, CSS, icons, cursors, workers, shaders and runtime
assets are owned and resolved by LightTable. A host may add a panel through a
public registration API, but it cannot be a hidden resource dependency of the
standard product.

## 10. Renderer decomposition

`WebGpuEngine` should become a facade over smaller services:

- `GpuDeviceService`: adapter, device, capability and loss lifecycle;
- `DocumentRendererFactory`: creates isolated document contexts;
- `RenderScheduler`: coalesces invalidations and controls preview quality;
- `RenderGraphCompiler`: builds passes from canonical descriptors;
- `LayerCompositor`: evaluates layer/group/clipping/mask semantics;
- `ResourceRegistry`: textures, buffers, pipeline caches and memory estimates;
- `EffectRegistry`: optional effect implementations and exact bypass;
- `ScopeService`: compute data and bind/unbind display surfaces;
- `ReadbackService`: bounded readback for export, thumbnails and analysis;
- `ShaderDiagnostics`: labeled compilation and feature-level error reporting.

`LayerDocumentRenderer` should similarly separate:

- document snapshot synchronization;
- layer resource resolution;
- compositing graph construction;
- transform preview;
- selection/mask surfaces;
- thumbnail generation;
- style evaluation;
- cache invalidation.

The initial facade may preserve existing calls while internals move behind it.

## 11. Feature and effect registration

Grade modules, lens effects and layer styles should be registered descriptors,
not switch statements spread across the overlay and renderer.

Each processing module declares:

- stable type ID;
- serializable settings and defaults;
- allowed scopes;
- input/output color domain;
- required resources;
- dirty dependencies;
- exact bypass condition;
- renderer implementation;
- UI registration;
- import/export adapters;
- tests and diagnostics label.

This supports future halation, lens distortion, AI operations and smart filters
without expanding the app root.

## 12. Async work, errors and cancellation

Open, decode, PSD import, save, auto-align, depth analysis and export are typed
tasks.

Every task has:

- document/session ID;
- operation ID;
- abort signal;
- source revision;
- progress;
- terminal result;
- stale-result check.

Closing a document cancels its tasks. Switching documents does not. A result
whose source revision is stale cannot overwrite current state.

Errors are classified:

- domain/precondition;
- import/decode;
- renderer capability;
- shader/pipeline;
- device loss;
- host/storage;
- cancellation.

A feature pipeline error disables or reports that feature. It cannot leave the
entire editor in an indefinite loading state.

## 13. Dependency enforcement

Add explicit lint or verification rules:

- `core` imports only `core`;
- `application` imports `core` and application ports;
- `features/*/ui` imports its controller/selectors and shared UI;
- features do not import other feature UIs;
- infrastructure imports ports/core types, never UI;
- hosts import public application/UI entry points only;
- no Electron imports outside the Electron host;
- no browser global access in core/application;
- no direct `WebGpuEngine` use from React components;
- no direct document mutation outside command handlers.

Keep `verify-boundary.mjs` and extend it rather than relying only on convention.
The TypeScript project graph should make illegal dependency directions fail at
build time where practical.

## 14. Migration strategy

This is a strangler migration. The app remains usable after every phase.

### Phase 0 — Stabilize the baseline

Work:

- discard or deliberately reimplement any uncommitted semantic fallback that
  silently changes transform target;
- freeze a known-good web and Electron baseline;
- add characterization tests for open, grade, layer, mask, transform, save and
  reload behavior;
- capture representative visual fixtures and GPU diagnostics;
- add an architecture decision log for cross-boundary changes.

Exit criteria:

- clean or explicitly understood working tree;
- existing behavior represented by tests;
- `npm run verify` green;
- web development/build smoke test green;
- Electron development and packaged smoke test green.

### Phase 1 — Introduce application composition and multi-document sessions

Work:

- [x] create the first application-core boundary;
- [x] create `WorkspaceSession`;
- [x] create one `DocumentSession` per open document;
- [x] move active-document identity out of hard-coded workspace props;
- [x] wrap current editor state behind a temporary session facade;
- [x] expose state through selectors/subscriptions;
- [x] bind opaque host source handles to document lifetime through
      `DocumentWorkspaceController`, instead of parallel React state;
- [x] retain current UI and renderer behavior;
- [x] keep inactive document runtimes mounted so viewport, selection, tool,
      history, layers and GPU state survive tab switches;
- [x] remove active-tab identity from renderer startup dependencies so a tab
      switch no longer destroys and recreates the document engine;
- [x] route tool, selection, brush and viewport updates through the owning
      `DocumentSession`, with a local fallback for embedded hosts;
- [x] project ordered standalone document runtimes through one tested workspace
      selector instead of joining controller state throughout the React root;
- [x] make standalone workspace ownership safe across React development Strict
      Mode cleanup/reconnect cycles;
- [ ] replace the temporary mounted-overlay retention strategy with an explicit
      renderer suspend/resume lifecycle and a configurable GPU-memory budget.

Exit criteria:

- two documents can be open and switched;
- each preserves viewport, active layer, selection, tool, history and dirty
  state;
- closing one document does not dispose or mutate the other;
- web and Electron both pass the same multi-document test.

Implementation note:

The first vertical slice intentionally keeps one existing editor overlay
mounted per open document. This gives correct state isolation before the
renderer has been extracted, without serializing GPU-owned state back through
React. It is not the final memory policy. Phase 6 replaces this temporary
retention mechanism with per-document renderer runtimes that can be suspended,
evicted and reconstructed under a workspace-level GPU budget.

The workspace controller owns the association between an application document
and its opaque host source payload. Application sessions remain independent of
`File`, URLs and Electron paths, while opening, closing and disposal can no
longer leave a source handle orphaned from its document tab.

### Phase 2 — Command bus, transactions and history

Work:

- [x] define a document-targeted reversible command contract;
- [x] introduce serial async undo/redo with bounded resource ownership;
- [x] model a saved-state checkpoint independently from stack depth;
- [x] keep non-document interactions such as selections undoable without
      marking document pixels dirty;
- [x] replace overlay-owned undo/redo stacks with the application service;
- [x] expose command-history state through document snapshots;
- [ ] move document mutation into typed command handlers;
- [ ] centralize all gesture transactions;
- [ ] migrate remaining generic callback receipts toward typed commands or
      bounded snapshots;
- [ ] add command capability selectors.

First migrated vertical slice:

- layer rename/reorder/visibility/opacity;
- adjustment slider transaction;
- add/remove mask.

Exit criteria:

- panels contain no direct document mutation for migrated commands;
- slider drag is one history entry;
- commands target a specific document session;
- undo in one document cannot affect another.

### Phase 3 — Loading, saving and document tasks

Work:

- move open/decode/import/save/export orchestration out of the overlay;
- [x] introduce a document-owned task registry with cancellation and
      stale-result protection;
- [x] route startup open, File-open, save and export through that registry;
- [x] cancel document tasks on close while preserving them across tab switches;
- [ ] move open/decode/import/save/export orchestration fully out of the
      overlay;
- separate canonical document persistence from host storage;
- move PSD import behind the codec/import ports.

Implementation note:

The first Phase 3 slice establishes ownership and terminal task state without
changing codecs or renderer behavior. The overlay still supplies the current
operation bodies, but it no longer owns their cancellation identity. This is
the safe seam for the next extraction: document controllers can move those
bodies behind ports without changing stale-result or close semantics.

Exit criteria:

- startup cannot hang without a terminal task state;
- opening at application launch and opening through File use the same path;
- web and Electron host adapters pass identical document fixtures;
- save/reopen preserves canonical data.

### Phase 4 — Input router and tool runtime

Work:

- [x] create a host-neutral keyboard intent router shared by macOS and Windows
      modifier semantics;
- [x] move shortcut precedence and capability gating into pure tested
      application code;
- [x] centralize tested pointer/document projection, pan and cursor-anchored
      wheel zoom math;
- [x] centralize brush stepping and paint/selection tool capabilities so the
      overlay and keyboard router share one explicit tool contract;
- [x] route viewport pointer ownership through a host-neutral, tested intent
      router while retaining document projection and wheel zoom as pure
      application math;
- [x] create one typed tool registry shared by presentation, capabilities and
      shortcut routing;
- [x] isolate temporary tool overrides from persistent document tool state and
      reset them on blur or active-document changes;
- [x] migrate persistent tool activation and transform-exit precedence through
      one tested application policy;
- [x] migrate brush sizing and tool shortcuts;
- [x] migrate pointer-driven selection draft/commit/cancel lifecycle into an
      isolated controller;
- [x] migrate paint/erase gesture ownership, dab sampling, dirty bounds and
      fixed target transforms into an isolated controller;
- [x] migrate fill target validation, color conversion, renderer transaction
      and document revision into one typed application operation;
- [x] migrate transform measurement, preview, update and commit/cancel lifecycle
      into a renderer-backed application controller;
- [x] remove feature-specific global listeners from the overlay and bind one
      stable, disposable window-input resource to the active document.

Milestone note:

Pointer-down, move and pointer-up ownership is now resolved outside React.
Temporary pan, focus picking, selection, fill, paint/erase and ordinary view
gestures have one tested precedence contract. Gesture execution still lives in
the overlay until the individual tool controllers are extracted; the router
keeps that migration behavior-preserving and prevents future tools from adding
another precedence chain to the application root.

The selection controller now owns its pointer lock, document-space draft
sampling, modifier-derived operation and invalid-gesture clear behavior.

Global keyboard and modifier input now uses one host-neutral binding. React
state changes update handler refs without repeatedly removing and adding
window listeners, while blur teardown releases temporary tools and modifier
state for both web and Electron hosts.
React only mirrors the draft for visualization and forwards the controller's
typed apply/clear result to history and the renderer.

The paint controller now locks layer, pixel/mask channel, erase mode and the
source-to-document matrix for the complete stroke. It also owns dab spacing and
dirty-bound accumulation. Renderer pixel edits and history snapshots remain
outside until their application port is extracted, but switching React state
mid-stroke can no longer redirect paint to another layer or coordinate space.

Tool identity, role, icon and shortcut metadata now have one registry. The
toolbar, keyboard router and capability predicates consume that contract, so a
new tool can no longer silently exist in one input path but not another.

Space-to-pan now uses a small idempotent transient-tool controller. It never
mutates the document's selected tool, repeated key events cannot unbalance it,
and switching documents or losing window focus clears the override.

Fill now resolves pixels versus masks, validates color and target, executes one
cancel-safe renderer transaction, and returns a typed document revision plus
undo snapshot. The composition layer only publishes that result and registers
document-local history.

Transform now owns its async launch revision, layer-versus-selection target,
measured core/support bounds, renderer preview and typed finish result outside
React. Complete layers remain non-destructive affine geometry; selected pixels
return one reversible pixel edit with the matching transformed selection.
Stale measurements and unavailable previews cannot publish half-open sessions.

Exit criteria:

- tool target and coordinate space are explicit;
- transformed layer/mask painting passes rotated, scaled and translated tests;
- transform preview/commit/cancel is one transaction;
- unsupported target returns a typed failure without switching tools or target.

### Phase 5 — Renderer facade and document contexts

Work:

- [x] isolate raster, layered-document and PSD import/hydration behind a
      host-neutral document-source service with a narrow renderer contract;
- [x] introduce renderer port and current-engine adapter;
- [x] create a renderer lifecycle and memory snapshot per `DocumentSession`;
- [x] guard asynchronous renderer startup with document-local generations;
- [x] represent inactive ready renderers as suspended without losing their
      resources;
- [x] move startup timing and GPU-memory presentation out of the editor root
      into a tested telemetry formatter;
- [x] move concrete `WebGpuEngine` ownership behind the renderer adapter;
- [x] move parallel renderer/source startup, stale-start rejection and failure
      cleanup into a tested application service;
- [x] move render scheduling/invalidation out of React effects;
- [x] split shared device acquisition and loss fan-out from document rendering;
- [x] move immutable core shader/pipeline construction into a device-scoped
      pipeline library;
- [x] isolate scopes plus buffer/texture readback and browser PNG encoding;
- [x] split mutable image-resource ownership from the engine;
- [x] isolate optional pipeline compilation;
- [x] add resource lifecycle and device-loss tests.

Exit criteria:

- UI has no concrete `WebGpuEngine` imports;
- switching documents switches renderer contexts;
- an invalid optional effect cannot prevent a plain image from loading;
- inactive-document resource policy is measurable and deterministic.

Implementation note:

The renderer slices now separate application lifecycle and source loading from
the concrete WebGPU engine. Each document reports `idle`, `starting`, `ready`,
`suspended`, `failed` or `disposed`, including its estimated GPU bytes. UI and
application code depend on renderer-neutral types; concrete engine construction
is owned by the infrastructure adapter. Its public method surface is still
deliberately broad and will narrow as tool operations become application
commands. A suspended renderer currently retains resources; deterministic
eviction is the next lifecycle policy to introduce. Renderer construction and
source download still overlap for startup performance, while the application
startup service now guarantees cleanup when either side fails or becomes stale.

Frame scheduling now has one renderer-owned invalidation coordinator with
coalesced animation-frame work, synchronous export/readback flushing and
terminal cancellation. Dirty-stage decisions remain in the renderer, while
browser callback ownership no longer leaks through React or ad-hoc frame
handles.

Shared WebGPU device ownership is now isolated from the concrete document
engine. Concurrent document startups reuse one acquisition, optional texture
format support is negotiated once, every live renderer receives device-loss
notification through a disposable subscription, and the next startup can
recover with a fresh device.

Immutable core pipelines now live in a dedicated device- and presentation-
format-scoped library. Documents reuse compiled pipelines without sharing
mutable image resources, and the cache boundary is covered by tests. Optional
feature compilation remains a separate follow-up so a broken effect can be
contained without weakening validation of the required image path.

GPU readback now owns row alignment, mapped-buffer copying and padding removal
outside the document engine. Browser PNG encoding is behind a replaceable
function, leaving a clean seam for a desktop-native or 16-bit encoder without
changing renderer orchestration.

Lens effects now compile their complete pipeline bundles asynchronously behind
an atomic optional-feature boundary. Until every pipeline in a feature is
valid, rendering uses the exact input texture; compilation failure is reported
at feature level and never publishes an invalid pipeline into a command buffer.
Disabled effects compile nothing, successful compilation schedules one new
frame, and failed features require an explicit retry rather than repeatedly
poisoning frames.

Loaded-image textures, the histogram buffer and every image-derived bind group
now have one document-scoped resource owner. Reload and disposal perform one
idempotent reset, including alias protection, instead of manually destroying
and nulling a scattered set of engine fields. Static device resources and
effect-owned caches retain their separate lifetimes.

Resource lifecycle coverage now spans shared-device loss/reacquisition,
idempotent document image-resource reset and optional feature compilation.
Phase 5 is complete; eviction policy for suspended documents remains a
multi-document memory-policy concern rather than renderer ownership debt.

### Phase 6 — Layer compositor and processing modules

Progress:

- [x] Group visibility/bypass evaluation is a tested application-domain
      function and no longer lives in the editor root.
- [x] Grade and Lens Fx control metadata is centralized in an editor config
      module instead of being declared inside the overlay.
- [x] Centralize document effect ownership, lifecycle and authoritative stage
      order outside the concrete engine.
- [x] Validate processing-module registration, settings ownership, scope
      support and deterministic evaluator ordering.
- [x] Route document and adjustment-layer grade evaluation through the shared
      processing evaluator while retaining the current combined shader.
- [x] Extract pure compositor sequencing for visible leaves, clipping chains,
      nested style detection and pass-through group envelopes.
- [x] Centralize render-stage invalidation fan-out so viewport, view-mode,
      effect, adjustment, document and source changes have tested boundaries.
- [x] Give per-Adjustment-Layer uniforms, curve LUTs and bind groups one
      document-generation resource owner with deterministic pruning/reset.
- [ ] Replace the remaining concrete grade/effect calls with registered
      processing modules and one authoritative evaluator.

Work:

- extract graph construction from `LayerDocumentRenderer`;
- register grade, lens FX and layer styles through common module contracts;
- refine correction invalidation into module-level revision tracking;
- preserve exact bypass behavior;
- retain PSD mapping into the same descriptors.

Exit criteria:

- effects can be added without changing the app root;
- merge/raster/export use the same authoritative evaluator;
- module-level golden tests cover disabled, enabled and merged output;
- renderer cache invalidation is revision-driven.

### Phase 7 — Panels and dialogs as feature views

Work:

- [x] move selection mask/draft visualization into its owning selection
      feature with an explicit display-space contract;
- move Layers, Grade, Lens Fx, Scopes and Debug into registered panels;
- replace direct root callbacks with commands/selectors;
- move dialogs to owning feature modules;
- keep dock layout workspace-owned;
- add panel surface attach/detach contracts for scopes.

Exit criteria:

- docking/floating a panel does not recreate a document or renderer;
- closing a panel does not remove feature state;
- root only registers panels;
- panels operate on the active `DocumentSession`.

### Phase 8 — Multi-document production hardening

Work:

- dirty-close prompts per document;
- background save/export/task visibility;
- inactive renderer suspension and resource eviction;
- document-specific error/status reporting;
- tab open/close/reorder and restore behavior;
- shared immutable asset cache where safe.

Exit criteria:

- at least three mixed documents can stay open and switch repeatedly;
- memory behavior is visible and bounded;
- active-document changes never route commands to the prior document;
- packaged Electron and deployed web builds pass the same session suite.

### Phase 9 — Remove the monolith

Work:

- reduce `LightTableEditorOverlay` to a compatibility wrapper and then remove it;
- remove temporary session/renderer adapters;
- delete duplicate state and dead refs;
- split remaining oversized renderer/shader modules;
- update architecture and contributor documentation.

Exit criteria:

- app root is approximately 100–200 lines;
- no feature logic remains in the composition root;
- no direct UI-to-GPU or UI-to-document mutations;
- boundary verifier and full dual-host verification are green.

## 15. Dual-host verification gate

Every phase and every feature that crosses a boundary must run:

Shared:

- typecheck;
- unit and command tests;
- document serialization round-trip;
- render golden/metric tests;
- boundary verification.

Web:

- Vite development/HMR smoke test;
- production web build;
- plain image, layered document and PSD open;
- save/download and clipboard paths;
- worker and precision path appropriate to deployed headers.

Electron:

- Electron Forge development/HMR smoke test;
- preload/IPC capability test;
- packaged application verification;
- startup-open and File/Open;
- native save/reopen;
- packaged icons, workers, shaders and WASM assets.

A phase is not complete when only one host works.

## 16. Testing pyramid

### Pure domain tests

- command preconditions and results;
- layer/group/clipping order;
- transform and coordinate math;
- visible/content bounds;
- mask and selection algebra;
- serialization.

### Application tests

- multi-document isolation;
- transactions and history;
- dirty/save lifecycle;
- task cancellation and stale completion;
- command routing to active and explicit documents;
- tool state machines.

### Renderer tests

- compositing fixtures;
- exact bypass;
- transform/mask mapping;
- style/effect goldens;
- cache invalidation;
- resource disposal;
- shader compilation per optional module.

### Host contract tests

Run one shared behavior suite against the web and Electron host implementations.

### End-to-end smoke tests

- open two documents, edit both, switch and undo independently;
- PSD import, edit, save LightTable document and reopen;
- transform then mask-paint across translation/rotation/scale;
- dock/float panels while a document stays resident;
- device or optional-pipeline failure produces a recoverable error.

## 17. Rules for future feature work during migration

New work should follow these rules immediately:

1. Do not add new persistent state to `LightTableEditorOverlay`.
2. Do not add new direct `engineRef.current` calls from UI.
3. New persistent mutations are commands.
4. New async operations are cancellable tasks.
5. New effects implement the processing-module contract.
6. New panels subscribe through selectors and dispatch commands.
7. New host functionality is a capability port.
8. New tools declare target and coordinate space explicitly.
9. No silent fallback to a different target or destructive operation.
10. Add web and Electron verification before declaring the feature complete.

Temporary adapters may call old code, but the new public contract must already
match the target architecture.

## 18. Explicit non-goals

- no one-shot rewrite;
- no premature visual node editor;
- no backward-compatibility burden for unreleased alpha document formats;
- no separate web and desktop editor implementations;
- no Redux-style global bag containing every document and GPU object;
- no speculative microservices inside the browser;
- no forced rasterization as a substitute for correct non-destructive
  semantics.

## 19. AI-first extension boundary

Future AI operations must fit the same document and command architecture rather
than becoming a second editing path.

An AI operation should be able to declare:

- input document, layer or selected-pixel snapshot and its revision;
- source quality and provenance;
- mask and transform relationship to the source;
- cancellable remote/local task state;
- one or more returned assets;
- alignment or registration result;
- non-destructive insertion command;
- optional bake/cache policy;
- enough metadata to reproduce or revise the operation.

The result enters the canonical document as a normal typed node or asset. Auto
Align, masks, transforms and compositing then work through their existing
systems. AI panels may be web-hosted, desktop-hosted or StoryBuilder-provided,
but communicate through application ports and commands.

This boundary keeps current “old-school” tools a reliable foundation instead of
letting AI features bypass document integrity, undo or coordinate semantics.

## 20. Definition of success

The refactor is successful when:

- web and Electron ship from the same platform-free editor systems;
- multiple document sessions are isolated and switchable;
- the root is a small composition layer;
- feature modules own their commands, controller and UI;
- renderer/document/UI state have one clear owner each;
- tools share a tested coordinate and transaction model;
- optional effects cannot brick basic image loading;
- adding a panel, effect, tool or AI operation does not require editing a
  multi-thousand-line root;
- architecture boundaries fail in CI when violated;
- existing output and workflow quality remain intact throughout migration.

## 21. Completed migration slices

- [x] Give Adjustment Layer uniforms, curve LUTs and bind groups one
      document-generation owner with deterministic pruning and teardown.
- [x] Move Adjustment Layer evaluation and GPU pass encoding behind a focused
      renderer while preserving compositor order and exact neutral bypass.
- [x] Make visible Adjustment Layer detection part of the tested compositor
      graph instead of an engine-local recursive predicate.
- [x] Extract the document canvas and its visual overlays into a host-agnostic
      viewport surface; pointer interpretation remains in tool controllers.
- [x] Extract the status/footer presentation from the editor root while
      preserving PSD report access and startup/GPU diagnostics.
- [x] Move status metadata and PSD parity diagnostics into a pure, tested
      telemetry model shared by any future web or desktop shell.
- [x] Give Auto Align one document-aware controller for analysis cancellation,
      compositor preview, atomic commit/cancel and a single history command.
- [x] Give Layer Style preview/editing one document-safe transaction controller
      that restores on cancel, commits one history step and always releases
      renderer interaction.
- [x] Move transform launch, preview, commit/cancel, selection publication and
      pixel-history ownership into a document-scoped session controller.
- [x] Move flat-versus-layered save policy, native asset collection and recipe
      construction into a host-neutral document export service.
- [x] Make the canonical immutable `ImageDocument` tree owned by its
      `DocumentSession`, with a synchronous React adapter for GPU/tool callbacks.
- [x] Move loaded-document grade materialization, renderer hydration and PSD
      reconstruction comparison behind one host-neutral application transaction.
- [x] Give each document a host-neutral open controller that owns renderer
      startup, stale-result rejection, cancellation, lifecycle and teardown.
- [x] Move duplicate, selection clipboard/paste, Layer via Copy, merge, flatten
      and channel-invert operations behind one document-safe layer command
      controller with atomic GPU undo ownership.
- [x] Move paint/erase gesture execution behind one document-safe session
      controller that snapshots brush and coordinate state, owns GPU rollback
      and publishes exactly one document revision and undo entry per stroke.
- [x] Move pointer- and command-driven selection publication behind one
      document-scoped controller with stale async rejection and selection-only
      undo/redo transactions.
- [x] Move Grade and Lens Fx preview quality, target locking, mutation and
      coalesced undo behind one document-scoped adjustment transaction
      controller.
- [x] Move immutable document mutation, resource retention and coalesced
      document undo behind one identity-guarded transaction controller.
- [x] Move document-grade versus Adjustment Layer projection into a pure,
      tested application service that rejects stale layer targets explicitly.
- [x] Move command adaptation, resource retention, transaction finalization and
      undo/redo error handling into one document-scoped history controller.
- [x] Move the complete Lens Fx presentation into a feature-owned panel with an
      explicit model/command boundary; local disclosure state no longer leaks
      into the editor root and document/GPU mutation remains application-owned.
- [x] Move the complete Grade presentation into a feature-owned panel with an
      explicit model/command boundary; disclosure, mixer range, grading mode and
      curve-channel UI state are document-instance local while mutations remain
      application-owned.
- [x] Move Grade and Lens Fx command construction out of the editor root into a
      host-neutral adjustment command service; scalar, mixer, grading, curve and
      effect edits now share explicit transaction and publication ports with
      focused mutation-contract tests.
- [x] Move File, Edit, Select, Layer and View menu policy into a pure editor
      menu model; capability/disabled-state decisions are tested independently
      while document mutations remain explicit commands supplied by the active
      document composition root.
- [x] Move wheel zoom, pan capture, brush-cursor projection and viewport pointer
      routing into one document-instance interaction controller; selection,
      paint, fill and lens-focus remain explicit feature ports and retain their
      own transaction/undo ownership.
- [x] Move Grade Adjustment Layer creation and document-grade migration into
      the layer command controller; creation, first-grade migration and
      undo/redo now form one tested document transaction instead of a panel
      callback mutating several root refs.
- [x] Give foreground/background fill one document-scoped command controller
      that owns renderer mutation, snapshot publication, status/error handling
      and exactly one disposable GPU history entry.
- [x] Centralize viewport/scope ResizeObservers and dock-resize arbitration in
      one document-instance resize controller; observers pause during sash
      gestures and publish one post-layout measurement instead of competing
      with Dockview's proportional layout.
- [x] Give layer and mask thumbnails one document-scoped controller with
      revision-keyed GPU readback caching and deterministic object-URL cleanup;
      accessory preview failures cannot fail the editor or renderer lifecycle.
- [x] Move bounded debug logging, host ready/error notification and PSD
      compatibility/comparison reporting into one document diagnostics
      controller shared by web and desktop composition.
- [x] Give optional Lens Blur depth analysis one source-identity-scoped
      controller with stale-result cancellation, reusable per-document results
      and a failure path that bypasses only Lens Blur instead of the base image.
- [x] Combine external source import, canonical layer upload, grade-stack
      hydration and optional PSD comparison into one cancellable application
      transaction; presentation receives only fully prepared documents.
- [x] Bind renderer startup, async callback validity and teardown to one
      explicit document-open generation; ordinary React callback churn cannot
      restart or cross-wire a document renderer.
- [x] Move save, download and local-file command orchestration behind one
      document-instance controller; task cancellation, save de-duplication,
      host picking and export policy no longer live in the editor root.
- [x] Split keyboard handling into a pure platform-event resolver and a tested
      command-port executor; every shortcut now targets only the active
      document composition instead of embedding mutations in the editor root.
- [x] Publish a prepared source through one synchronous editor transaction
      after the final cancellation check; document, assets, source identity,
      grade and metadata can no longer become partially visible.
- [x] Unify document history, task registry and renderer lifecycle ownership
      behind one runtime-services hook; embedded and workspace hosts now use
      the same document identity, activation and deterministic disposal rules.
- [x] Isolate original/difference view state and scope-option synchronization
      behind one presentation-only renderer adapter; UI state no longer
      performs document mutations while keeping active renderer views current.
- [x] Guard every renderer callback at the document-generation boundary;
      stale histogram, scope, feature, device-loss, frame and memory events can
      no longer publish into another active document.
- [x] Move inline-versus-host source resolution behind a host-neutral,
      cancellation-aware application service with explicit missing-source and
      missing-capability failures.
- [x] Give each document-open generation one isolated startup telemetry
      accumulator; React renders and inactive document projection cannot reset
      or double-complete first-frame and deferred-scope measurements.
- [x] Move renderer callback, device-loss, memory, optional-feature and
      deferred-scope startup policy into one React-free document-generation
      bridge shared by web and desktop hosts.
- [x] Make standalone workspace disposal safe under React development Strict
      Mode reconnects while preserving deterministic terminal unmount cleanup.
- [x] Give every document-open generation fresh adjustment, editor, scope and
      group-visibility baselines; replacement opens and inactive documents
      cannot share mutable defaults through the composition root.
- [x] Centralize renderer publication, source resolution, hydration and
      retirement wiring in one editor document-open request factory; stale
      renderer disposal cannot clear a replacement generation's renderer slot.
- [x] Contain unexpected React runtime failures to the owning document tab
      with retry and close recovery; one failed document can no longer brick
      sibling documents or the host-neutral workspace shell.
- [x] Move standalone web/Electron workspace ownership, immutable subscription,
      source-handle lifetime and Strict Mode disposal into one host-shell hook;
      the app root now composes documents instead of owning session mechanics.
