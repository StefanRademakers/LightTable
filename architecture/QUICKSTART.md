# LightTable architecture quickstart

This is the shortest durable route into the real LightTable system. It is for
engineers and agents that need to make a change without reconstructing the app
from old tasks or chat history.

For the operational recovery sequence, live worktree/task discovery and
task-based document routing, start with
[AI coding-agent onboarding](AGENT_ONBOARDING.md). This file supplies the
deeper technical mental model; it is not intended to be read front-to-back for
every small change.

## How to read claims

- **Current** means the code and tests implement it now.
- **Partial** means the boundary exists, but important behavior still lives in
  the application package or is not release-qualified everywhere.
- **Target** means product direction, not a promise about today's build.

When this file disagrees with the repository, current code and tests win. Then
follow the authority order in [README.md](README.md).

## Ninety-second reset card

If conversation context disappeared, retain these facts before touching code:

1. LightTable is a commercial, desktop-class creative system and reusable GPU
   engine direction—not a conventional React image-editor page.
2. The canonical document owns semantics; controllers own gestures/history;
   retained WebGPU runtimes own pixel realization; React owns chrome and
   low-frequency projection. Do not create a parallel state model.
3. Pointer-frequency canvas feedback belongs in the custom GPU gizmo/overlay
   system with narrow dirty invalidation. Existing React/DOM hot paths are debt,
   not precedent.
4. Stable semantic commands and IDs are the shared route for UI, automation,
   MCP and a future plugin ABI. Never automate private component state or screen
   coordinates when a canonical operation exists.
5. Exact Photoshop parity is an evidence claim: preserve editable semantics
   where representable, warn or fail closed where not, and compare against real
   Photoshop oracles. Current PSD export is 8-bit RGB, not general PSD/PSB parity.
6. AI providers, local inference, editor-side selection models and MCP editor
   control are separate systems. Providers produce bounded assets/provenance;
   they do not mutate documents directly.
7. The build is a strong technical preview, not a paid-release-ready product.
   Production licensing/activation, installer/update operations, missing model
   disclosures, external beta evidence, broader hardware qualification and
   owner visual acceptance remain commercial stop signs.
8. For normal work, inspect `git status`, the active `work/todo` package and its
   nearest contracts/tests. For “work all todos,” follow `work/README.md`, finish
   and verify each task, move it to `work/done`, commit it and continue without
   repeatedly asking for permission.
9. The Layers tree and one contextual `Properties` dock tab are the editing
   UI model. `Properties` routes one explicit selection target to a separate
   Grade, Lens Fx, Photoshop-style adjustment, Text or Effects editor.
10. Non-destructive processing has two visible ownership forms: a standalone
    adjustment layer affecting the lower composite, or an ordered adjustment
    attached to one raster layer. Stack order affects output; never reorder or
    fuse nodes without a proved semantic equivalence.
11. Shared controls own their internal CSS and geometry under `src/ui`.
    Containers only supply flow, available space, clipping and placement;
    contextual differences use named variants and appear identically in the
    live UI Style Guide.

## The product in one paragraph

LightTable is no longer a simple image editor. It is an AI-first professional
visual authoring system: Photoshop-class layered editing and transforms,
Lightroom/Camera Raw-style grading, GPU-native text and vectors, layered
PSD/PDF interchange, multiple documents and workspaces, local and remote AI,
and semantic external control. The commercial product is the editor, but the
valuable technical asset can become broader: a reusable document model,
semantic command surface and fast GPU compositing stack from which other
creative products can be assembled.

That suite thesis is credible only if the engine boundaries become real
package boundaries. Today they are strongest for text, vectors and provider-
neutral GenAI. The raster compositor, processing graph, PSD realization and
large parts of orchestration still live in `@lighttable/app`; they must not be
marketed internally as a finished generic SDK yet.

### Measured repository snapshot

Measured on 2026-08-14 from tracked active source under `apps/`, `packages/`
and `scripts/`, excluding `tmp/`, generated builds and `.referenceCode`:

- 4 apps and 13 package directories;
- 1,364 tracked TS/TSX/JS/CSS/WGSL/Rust source files, about 199,685 lines;
- `@lighttable/app` contains about 154,911 of those lines and 1,008 files;
- 36 registered editor tools, 12 stable workspace panel IDs and 30 semantic
  command IDs;
- 505 active test files and about 2,396 explicit `it`/`test` cases;
- 40 convention-discovered packaged desktop smoke files and 13 audit scripts;
- 3 actionable tasks, 127 completed task packages, 2 parked and 3 deferred.

These numbers are a scale/orientation snapshot, not fixed architecture. Recount
from the active tree when making a coverage or release claim. The concentration
inside `lighttable-app` is evidence that the suite extraction is incomplete.

## Engineering altitude and non-negotiables

LightTable is a desktop-class creative engine delivered through web technology,
not a conventional React website. Optimize for document correctness, immediate
interaction and reconstructable GPU state before component convenience.

- React owns product chrome and low-frequency projection. Pointer-frequency
  samples, previews, animation and retained interaction state belong in typed
  document controllers, coalesced buffers and renderer resource owners—not a
  chain of React `setState` calls and effects.
- Selection edges, transform/warp handles, vector paths, text editing markers,
  brush previews and similar canvas affordances belong to LightTable's custom
  GPU gizmo/overlay rendering system. They use document/viewport transforms,
  retained WebGPU resources and narrow dirty invalidation. DOM overlays are not
  the default merely because they are easier to prototype; a DOM hit target may
  capture input, but pointer-frequency visual state must not drive React renders.
- Treat existing pointer-move React draft paths as performance debt, not as
  precedent. Layout-guide dragging currently has such a hybrid path
  (`LayoutGuideInteractionLayer` -> `setGuideDraft`), even though guide frames
  themselves are renderer-owned. Measure it and migrate it behind the retained
  interaction/overlay boundary when that area is touched.
- Dirty-only rendering is both performance and correctness. A semantic change
  names the smallest dirty domain and earliest affected stage. Viewport motion,
  overlay animation and panel state must not accidentally recompose content.
- Hot paths avoid CPU pixel roundtrips, full-resolution temporary allocations,
  eager optional pipelines and per-sample object/React churn. Preview and final
  quality may differ explicitly; pointer-up commits one semantic history entry.
- Measure event-to-submit/GPU completion, frame intervals, long tasks, queue
  submissions and stable-tail memory/GPU residency. Do not call a feature fast
  because a synthetic handler returned quickly or slow because a driver spent
  time producing realistic samples.
- Performance work is not deferred polish. When one coherent task can own the
  canonical operation, controller, GPU realization, invalidation, UI projection,
  tests and evidence, finish that vertical slice together and keep it fast.
- Reuse and extraction must preserve these properties. A generic package that
  adds abstraction, copies state or forces full passes is not progress toward
  the suite architecture.

## Start the product

From the repository root:

```powershell
npm install
npm run dev:web
npm run dev:desktop
```

Both hosts mount the same `LightTableStandaloneApp`. The web entry point is
[`apps/web/src/main.tsx`](../apps/web/src/main.tsx); the desktop renderer entry
point is [`apps/desktop/src/renderer.tsx`](../apps/desktop/src/renderer.tsx).
Text shaping depends on the Rust/Wasm runtime, so the root scripts call
`ensure:text-wasm` before development, tests and builds.

Useful first checks:

```powershell
npm run verify:boundary
npm run typecheck
npm run audit:architecture-docs
npm run smoke:desktop:commands:build
```

Do not begin with the full `npm run verify` loop for a small local change. Run
the narrow unit/smoke test first, then widen verification in proportion to the
affected boundary.

## Runtime: host to pixels

```text
web / Electron / StoryBuilder host
        -> LightTableStandaloneApp
        -> DocumentWorkspaceController + WorkspaceSession
        -> one mounted DocumentSession/runtime per open document
        -> LightTableEditorOverlay composition root
        -> projected panel/tool controllers and semantic commands
        -> canonical ImageDocument + scene transform graph
        -> LayerDocumentRenderer
        -> LayerCompositor + processing/effect runtimes
        -> WebGpuEngine frame coordination
        -> display texture, viewport sampling, overlays and scopes
```

The important ownership rule is that each layer has one job. The host supplies
capabilities; the workspace owns open sessions; a document session owns its
editable state and history; the document model owns serializable semantics;
the renderer owns GPU realization; UI projects state and dispatches commands.

### Host and portability boundary

[`LightTableHost.ts`](../packages/lighttable-app/src/platform/LightTableHost.ts)
is the capability boundary for media/open/save, clipboard, fonts, recovery,
projects, release services, Agent Access, GenAI and local AI. Application code
must not branch on Electron globals or smuggle native paths through the editor.

**Current:** browser and Electron hosts use the shared application and editor.
Electron packaging contains Windows, macOS and Linux makers. The renderer is
sandboxed behind preload.

**Current release truth:** packaged support is not the same as qualified
support. The present release evidence is strongest for Windows with a discrete
GPU. macOS/Apple Silicon, integrated Windows GPUs and browser hardware cells
still require their stated soak gates; Linux is not a qualified current RC.
See [SUPPORTED_HARDWARE_AND_SOAK_GATE.md](SUPPORTED_HARDWARE_AND_SOAK_GATE.md).

**Target:** macOS, Windows, Linux, online and Android-class delivery should be
host variants over the same application core. There is no native Android host
or Android release qualification today. A browser/PWA route is the nearest
architectural path; a native shell would be another `LightTableHost`, not a
fork of the editor.

### Save, autosave and crash recovery

Normal Save and crash recovery are separate persistence lanes. Save publishes
the requested canonical revision to the user-selected document target. A save
that completes while newer edits arrive is valid for that older revision, but
the open session remains dirty; completion must never mark newer work saved.

Recovery stores private complete canonical snapshots, not GPU caches, viewport
layout or entitlement state. Clean/idle documents have no recurring recovery
timer. Electron writes versioned/checksummed recovery envelopes beneath an
app-owned or explicitly selected recovery root through prepare, write, flush,
validate and replace phases; failure preserves the prior valid generation.
Browsers use OPFS with explicit quota/error reporting and must describe it as
best-effort site-data recovery, not guaranteed user-file durability.

Startup lists and validates recoveries before the user chooses what to restore.
Successful Save only removes recovery records through the verified saved
revision. Dirty-close, crash, restart and recovery must not depend on a renderer
readback or recomposition. See
[RELIABILITY_AND_VERIFICATION.md](RELIABILITY_AND_VERIFICATION.md).

## Multi-document workspace versus UI workspace

These are deliberately different concepts:

- [`WorkspaceSession`](../packages/lighttable-app/src/lighttable/application/workspace/workspaceSession.ts)
  owns ordered open documents and exactly one active document.
- [`DocumentWorkspaceController`](../packages/lighttable-app/src/lighttable/application/workspace/documentWorkspaceController.ts)
  retains the opaque host source for exactly the session lifetime.
- A `DocumentSession` owns one canonical document, dirty/saved revisions,
  viewport, editor session, command history, tasks and renderer lifecycle.
- Dockview layout and workspace presets own panel placement only. They are not
  document data and must never change image semantics.

All document runtimes remain mounted when tabs change. Inactive sessions keep
their undo/tool/layer state and reconstructable GPU resources, but rendering is
suspended. This is why fast tab switching must be fixed at session activation
and invalidation boundaries, not by remounting the editor.

### Project mode is persistence, but currently also a GenAI gate

Project mode owns the disk-backed asset catalog and durable GenAI jobs, inputs,
outputs and request history. The current implementation hard-gates Image
Create, Image Edit, Remove Object, AI running state/History, asset browsing and
generated-result open/place/recreate behind an active project.

Normal document editing/export, Object Selection, Select Subject, Remove
Background, autosave/recovery and Agent Access/MCP remain available standalone.
Document Save, provider/model discovery, local references, base-image/paste/tab
references, authentication and local-provider processes also work standalone;
projects add persistence or indexing to them.

This is an explicit product decision point, not a natural engine dependency.
The panel currently says a project is needed to retain output history, while
`canGenerate` requires `projectId` and disables Generate completely. Remove
Object is enabled by the selection menu without checking the project and then
fails in its handler. Either make the UI state the hard requirement clearly,
or add a host-owned standalone generation workspace so only durable history is
project-gated. Do not make provider adapters aware of project folders. See
[PROJECT_MODE_FEATURE_GATING.md](features/PROJECT_MODE_FEATURE_GATING.md).

### Current panel identities

[`workspacePanelRegistry.ts`](../packages/lighttable-app/src/lighttable/editor/workspace/workspacePanelRegistry.ts)
defines stable identities for the document host, contextual Properties,
Scopes, Layers, Channels, Debug, Agent, GenAI and Assets/AI History. Grade,
Lens Fx, Photoshop-style adjustments, Text and Layer Effects are no longer
separate workspace tabs: they remain separate editor components routed through
Properties by the selected Layers-tree target. Dockview may float, tab or
rearrange registered panels while their IDs, content and command wiring remain
stable.

The current presets are `photo-edit`, `grading` and `ai-generation`. They only
change the Dockview arrangement. The status bar provides direct switches
between them and must preserve the same invariant.

## UI composition and reuse

[`LightTableEditorShell.tsx`](../packages/lighttable-app/src/lighttable/editor/ui/LightTableEditorShell.tsx)
is platform-neutral chrome and presentation. It renders the menu/header,
property bar, toolbar, workspace surface and dialogs from projected props.
[`LightTableEditorOverlay.tsx`](../packages/lighttable-app/src/lighttable/LightTableEditorOverlay.tsx)
is the current integration root. It should mount controllers and connect
systems; new behavioral authority should not accumulate there.

Workspace panels are assembled in
[`createEditorWorkspacePanels.tsx`](../packages/lighttable-app/src/lighttable/composition/workspace/createEditorWorkspacePanels.tsx).
Feature panels should receive a small model plus named commands. They should
not reach into a renderer, host or unrelated React state.

Shared visual language lives in:

- [`theme.css`](../packages/lighttable-app/src/ui/theme.css): color, type,
  spacing, focus, control and semantic tokens;
- [`primitives.css`](../packages/lighttable-app/src/ui/primitives.css): shared
  control implementations;
- [`src/ui`](../packages/lighttable-app/src/ui): buttons, form fields, color
  and gradient fields, segmented controls, switches, numeric expressions,
  menus, dialogs, sections, search, `AdjustmentSlider` and reusable panel
  compositions;
- [`PanelControls.tsx`](../packages/lighttable-app/src/ui/PanelControls.tsx):
  shared property fields and disclosures;
- [`ToolOptionControls.tsx`](../packages/lighttable-app/src/lighttable/editor/ui/ToolOptionControls.tsx):
  editor-specific property-bar compositions of those primitives;
- View > UI Style Guide: a live catalogue of shared production controls plus
  explicitly labelled prototypes; prototypes are exploration, not canonical
  reusable UI.

Feature CSS belongs with the feature, but must consume shared tokens. A shared
component owns its internal geometry and states; a container may only arrange
it or constrain available space. Use an explicit variant such as
`AdjustmentSlider`'s `tool-bar`, `tool-panel` or `layer-row` rather than an
ancestor selector. `npm run audit:ui-boundary` rejects editor-domain imports
from `src/ui` and feature stylesheets that reach into protected UI roots. Do
not invent a near-duplicate slider, select, swatch or popup because a panel
needs a minor variation. Dockview theme mapping and editor geometry live in
[`lighttable.css`](../packages/lighttable-app/src/lighttable/lighttable.css).

### Contextual Properties and adjustment ownership

[`propertiesInspectorTarget.ts`](../packages/lighttable-app/src/lighttable/application/properties/propertiesInspectorTarget.ts)
is the selection contract. It distinguishes a layer, mask, local processing
owner, attached adjustment, Layer Style stack and individual style effect.
[`PropertiesPanel.tsx`](../packages/lighttable-app/src/lighttable/editor/panels/PropertiesPanel.tsx)
is deliberately a thin router: it mounts exactly one independently owned
editor for the resolved context.

The Layers UI exposes two non-destructive forms:

```text
Grade                            standalone adjustment layer + linked white mask
Background
  Grade                          local/attached adjustment on Background
  Effects
    Drop Shadow                  Layer Style, not processing/Grade
```

The adjustment creation catalog is centralized in
[`adjustmentLayerCatalog.ts`](../packages/lighttable-app/src/lighttable/processing/adjustmentLayerCatalog.ts).
It supplies one grouped menu and icon/name/order vocabulary for Grade, Lens Fx,
Photoshop-family adjustments and LightTable-native composites. A menu row may
create a standalone layer or, where supported, attach the same authored node to
the selected raster layer. Attached processing is not represented with the
Layer Effects `fx` mark.

## Tools, input and history

[`toolRegistry.ts`](../packages/lighttable-app/src/lighttable/editor/tools/toolRegistry.ts)
is the discoverable list of tool IDs, families, shortcuts, toolbar roles and
option-bar projection. It includes navigation, transform/warp, marquee/free/
polygon/magic/object selection, paint/clone/heal/erase, dodge/burn/sponge,
gradient/fill, type and vector/pen/shape families.

The registry is not tool behavior. Document-scoped controllers own pointer
lifecycles, coordinate conversion, previews, commits and cancellation. One
gesture produces one meaningful undo entry. A mutation must go through the
canonical document/history path and then invalidate the smallest render domain;
components must not patch pixels or GPU resources directly.

Read [INPUT_TOOLS_AND_HISTORY.md](INPUT_TOOLS_AND_HISTORY.md) before changing
gesture semantics, keyboard routing or undo ownership.

## Canonical document and transforms

The `ImageDocument` layer tree is the source of truth for raster, group, text,
vector, mask, clipping, blend, opacity/fill, adjustment, style, asset and
provenance semantics. It never owns a `GPUTexture`, DOM node or host path.

Transforms follow one rule:

```text
persisted: localToParent = node.transform
derived:   localToDocument = parent.localToDocument * localToParent
reparent:  newLocal = inverse(newParent.localToDocument) * oldLocalToDocument
viewport:  presentation only; never serialized as layer geometry
```

The implementation is
[`sceneTransformGraph.ts`](../packages/lighttable-app/src/lighttable/editor/document/sceneTransformGraph.ts).
Transforms use CPU double-precision affine math until encoded for GPU work.
Raster sources carry layer-local bounds and a source-pixel-to-document mapping
through [`renderContract.ts`](../packages/lighttable-app/src/lighttable/editor/rendering/renderContract.ts).

This distinction is essential for Photoshop parity: transform, reparent,
merge, rasterize, mask, text/vector editing, picking and export must all agree
on the same geometry. Flatten/rasterize evaluates pixels, measures new bounds
and resets the produced raster transform to identity; it is not merely a flag.

## GPU composition and frame execution

The composition path is not “draw React onto a canvas.” It is a retained,
revision-driven WebGPU system:

```text
canonical layer tree
  -> pure compositor plan
  -> source contracts and revision-keyed GPU realizations
  -> groups, clipping chains, transforms, masks and layer styles
  -> layer-local adjustments
  -> document effects / source geometry
  -> linear-spatial processing
  -> output transform
  -> display-post processing and display resolve
  -> viewport sampler (original/final/mask/channel/difference)
  -> text/vector/selection/editor overlays
  -> histogram/scopes when their own revisions require work
```

[`compositorGraph.ts`](../packages/lighttable-app/src/lighttable/editor/rendering/compositorGraph.ts)
builds the pure plan. [`LayerCompositor.ts`](../packages/lighttable-app/src/lighttable/editor/rendering/LayerCompositor.ts)
is the only service that may encode layer ordering, groups, clipping, masks,
transforms, local adjustments and layer styles. It has a no-op fast path for a
single full-canvas identity raster.

Adjustment order is part of the document meaning. A standalone adjustment
consumes the accumulated lower composite at its exact layer position; an
attached adjustment evaluates in authored order inside its owning raster
layer. Grade is currently a convenient composite editor over registered
processing modules, not a privileged second pixel pipeline. A future optimizer
may collapse compatible adjacent operations, but only as a runtime plan rewrite
with identical masks, clipping, color-domain behavior and outputâ€”never by
rewriting canonical authored order.

Document color intermediates and compositor targets use linear-light
`rgba16float`. That higher-precision working path is independent from file
representability: the current PSD writer still emits its verified 8-bit RGB
subset, and a 16-bit working document must not be advertised as 16-bit PSD
export support.

[`LayerDocumentRenderer.ts`](../packages/lighttable-app/src/lighttable/editor/rendering/LayerDocumentRenderer.ts)
owns the document-facing renderer runtime: synchronization, source resources,
composition, picking, thumbnails, merge/flatten/rasterize, paint, selection,
transform previews and exports. It is a façade, not permission to add every new
engine responsibility to one class.

[`WebGpuEngine.ts`](../packages/lighttable-app/src/lighttable/gpu/WebGpuEngine.ts)
coordinates the device, retained frame state, processing stages, viewport,
overlays, scopes and submission. `RenderDirtyState` records semantic dirty
domains and the earliest correction stage. `RenderInvalidationScheduler`
coalesces work, pauses inactive documents and flushes on export.

Performance invariants:

- pan/zoom changes viewport presentation, not document composition or scopes;
- overlay animation does not invalidate content pixels;
- a disabled or semantically unchanged setting may encode zero GPU work;
- no dirty/scope work means no command encoder or submit;
- export uses the canonical renderer and explicitly flushes pending work;
- GPU state is reconstructable runtime state, never a second document model;
- internal compositing is linear-light, premultiplied unless a named parity
  boundary explicitly converts to the document encoded/profile domain.

Read [RENDERING_AND_PROCESSING.md](RENDERING_AND_PROCESSING.md) and
[PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md) before changing a render
stage or invalidation rule.

## Which packages are reusable today?

| Package | Current responsibility | Reuse maturity |
| --- | --- | --- |
| `text-core` | serializable text/layout contracts | strong host-neutral boundary |
| `text-layout-wasm` | Rust/Wasm shaping and paragraphs | real independent runtime |
| `text-rendering` / `text-webgpu` | realization/cache contracts and WebGPU backends | reusable with integration work |
| `vector-core` | geometry, editing and serializable vector model | strong host-neutral boundary |
| `vector-rendering` / `vector-webgpu` | backend-neutral realization and WebGPU fills/overlays | reusable with integration work |
| `paint-core` | gesture and dab contracts | narrow; raster brush engine remains app-heavy |
| `pdf-core` | normalized PDF/display-list contracts and probing | contract layer; app owns adapters/workflow |
| `genai-core` | provider-neutral requests, jobs and presentation contracts | strong provider boundary |
| `genai-openart` | OpenArt schema/provider adapter | independent adapter |
| `genai-local` | local provider protocol | independent protocol, platform qualification incomplete |
| `lighttable-app` | product shell, canonical editor model, raster processing/compositor and UI | product package, not yet a generic engine SDK |

Boundary tests in [`verify-boundary.mjs`](../scripts/verify-boundary.mjs) prevent
React/DOM/WebGPU/application dependencies from leaking into core packages.

### Suite direction, critically

**Target:** the same foundations could support a photo editor, layout/social
design tool, AI canvas, asset compositor, document renderer, batch/automation
product, embedded editor or headless creative service.

Do not create these by copying `lighttable-app`. The next reusable seam should
be proven by at least two consumers and likely separates:

1. canonical scene/document contracts;
2. backend-neutral compositor planning and invalidation;
3. WebGPU composition/processing runtime;
4. import/export adapters (PSD, PDF, raster, native);
5. semantic commands and capability schemas;
6. product-specific UI, workspaces, host services and commercial policy.

The current large `LightTableEditorOverlay`, `LayerDocumentRenderer` and
`WebGpuEngine` façades are the main warning signs. Extract cohesive owners;
do not replace them with a vague universal manager or a premature public SDK.
The ownership-aware source audit distinguishes mixed-authority hotspots such
as `LightTableEditorOverlay.tsx`, `WebGpuEngine.ts`, desktop `main.ts` and
`LayerPanel.tsx` from cohesive-heavy shader, persistence and format owners.
Size triggers review and material growth reopens it; a lower line count is not
proof of better architecture.

## Semantic commands, stable IDs and external control

[`lightTableCommandContract.ts`](../packages/lighttable-app/src/lighttable/application/commands/lightTableCommandContract.ts)
defines protocol v1 and stable semantic command IDs. Current families cover
documents, viewport, raster placement, layer properties, editable text,
editable vectors, Layer Styles, Face Warp operations, atomic batches, tasks,
native/PNG/PSD export and history.

Commands address an explicit stable document ID and, where needed, stable layer,
vector-element or effect IDs. Queries return the canonical revision and current
capabilities. Mutations may include `expectedDocumentRevision` and
`expectedWorkspaceRevision`; stale automation is rejected instead of silently
editing the wrong state.

[`LightTableCommandService`](../packages/lighttable-app/src/lighttable/application/commands/lightTableCommandService.ts)
is the shared application service. Each mounted document registers narrow
`DocumentLightTableCommandPorts`; the service does not reach into React or
construct another document model.

The command service decides whether a validated execution is recordable, while
[`SemanticActionWorkflowController`](../packages/lighttable-app/src/lighttable/application/actions/semanticActionWorkflowController.ts)
owns Actions recording state, durable set selection and playback lifecycle.
Playback calls the same command service again with recording disabled; it does
not own a second mutation route. Stopped Actions may define bounded typed
variables with defaults and explicitly bind any compatible parameter to a
variable or prior step result. Binding edits and playback overrides run the
complete command-schema preflight before the first command executes. Literal
recorded parameters are edited by the same generated schema controls as the
Commands browser; applying a form preserves its stored bindings and publishes
the whole validated step atomically.

Atomic batches are capped at 64 operations, 256 KiB and 10 seconds. They build
against a private document value, can reference earlier operation results, and
publish once as one named undo entry. Failure or cancellation publishes
nothing. Long work returns task IDs and reconnect-safe event cursors.
Agents can query a cursor page directly or use the bounded publication wait to
sleep until new document/history/render activity arrives; waits are capped at
10 seconds and never run on pointer or renderer hot paths.

Binary input/output uses bounded opaque artifact IDs through
[`lightTableArtifactRegistry.ts`](../packages/lighttable-app/src/lighttable/application/commands/lightTableArtifactRegistry.ts).
Blob/File ownership stays at the host boundary rather than leaking into JSON,
IPC or command results. Gestures are bounded document-space sessions for brush,
selection rectangle and layer translation and commit as one undo operation.

### MCP and a future plugin ABI

The canonical product destination is
[`goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md`](goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md).
It defines the future editable-first observe/act/preview/correct workflow;
everything below describes the current or partial implementation boundary.

[`lightTableMcpAdapter.ts`](../packages/lighttable-app/src/lighttable/application/commands/lightTableMcpAdapter.ts)
defines and tests an authenticated, transport-neutral adapter over the same
command driver. It opens no socket. Electron main authenticates/bounds requests
and invokes the renderer driver through narrow IPC, while
[`apps/mcp-server`](../apps/mcp-server) maps remote MCP tools onto that
bridge/outbound tunnel.

[`packages/command-contract/catalog.json`](../packages/command-contract/catalog.json)
owns the complete command IDs plus explicit Agent Access and external MCP
profiles. Generated validators/enums prevent string-list drift. The profiles
are deliberately unequal: document creation and artifact-open are used only by
dedicated validated MCP tools; PSD export is part of the proven remote design
workflow; resize, document duplication/geometry and Face Warp are not exposed
yet. These are incremental rollout states, not permanent exclusions: the
product target is semantic agent access to all user-facing functionality.
The actual Electron renderer bridge enforces this Agent Access profile and
filters capability discovery before requests reach the full automation driver.

Desktop Agent Access uses user-visible pairing, read/edit scopes, revocation,
bounded artifacts and an outbound TLS/WSS connection; it does not expose an
unrestricted public desktop port. This is a strong technical boundary, not a
completed external security certification. Production still needs deployment
hardening, operational key/token policy and independent security review.

This is the intended dependency direction:

```text
UI / keyboard / script / future plugin / MCP-ChatGPT
                    |
      typed query + command capability surface
                    |
       one document/session/history model
                    |
        one renderer and export pipeline
```

There is **no general third-party plugin loader, sandbox, permission manifest,
version negotiation or marketplace today**. The semantic command/query layer
is the candidate shared ABI. A plugin system should consume a versioned subset
with per-command capabilities and permissions; it must not receive a renderer,
GPU device or mutable document object.

Stable IDs are necessary but not sufficient for a public ABI. Before external
plugins depend on one, define ID lifetime across save/reopen/import, schema
compatibility, capability negotiation, transaction and event semantics,
resource quotas, cancellation, permissions and deprecation policy.

## Reference image to editable reconstruction

The requested ChatGPT workflow is architecturally plausible and partly wired:
MCP can already accept a public reference/generated image, register it as a
bounded artifact, open/place it, build editable text/vector/style layers,
execute atomic batches and ask the real GPU/export path for a PNG preview.

The full target loop should be:

```text
reference image(s) + user intent
  -> bounded artifact registration
  -> visual analysis and editable scene plan
  -> capability query
  -> create/open explicit document
  -> atomic semantic commands using stable IDs
  -> GPU preview export
  -> visual comparison + structural inspection
  -> revision-checked corrective batches
  -> user review
  -> native layered document and optional PSD/PNG/PDF outputs
```

The model should recreate intent as editable structure—text, shapes, gradients,
styles, masks and placed images—not merely call image generation and paste a
flat bitmap. Pixel similarity is only one objective; editability, font/resource
availability, layer naming, transform stability and export parity are separate
acceptance criteria.

Important gaps are scene-understanding/planning contracts, richer command
coverage for transforms/masks/adjustments/selections, reference-to-preview
comparison, asset/font matching, deterministic repair strategies and explicit
human approval for ambiguous or destructive steps. Do not solve those by
teaching the agent screen coordinates or private component state.

## AI systems are separate from MCP

MCP/Agent Access controls the editor; it is not an inference provider.

- `genai-core` defines provider-neutral image create/edit/inpaint requests,
  references, selection masks, jobs, cancellation and presentation contracts.
- `genai-openart` adapts OpenArt discovery and execution; desktop owns OAuth,
  durable output placement and project history.
- `genai-local` defines the managed loopback protocol used by the desktop local
  provider process. Current local workflows include create/edit/inpaint with
  base/reference images and selection masks.
- Selection intelligence is a separate editor facility: SAM, ViTMatte and
  background-removal models feed canonical selections/masks and edit commands.

Generated outputs are assets with provenance and history before they become
document layers. Providers must not mutate an `ImageDocument` directly.

Local AI is currently Windows-first and hardware/model qualification remains
incomplete across macOS and other providers. Keep provider discovery, download,
auth and process ownership outside the canonical editor.

### Model distribution and cache ownership

There are three distinct model lifecycles; do not describe them as one bundled
AI model store.

| Function | Model | Distribution |
| --- | --- | --- |
| Lens Blur depth | `onnx-community/depth-anything-v2-small-ONNX` | lazy Transformers.js download |
| Object Selection / Select Subject | pinned FP16 `onnx-community/sam2.1-hiera-small-ONNX` | lazy Transformers.js download |
| Object Selection fallback | `Xenova/slimsam-77-uniform` | lazy Transformers.js download |
| Matte Refine Standard/High | pinned `Xenova/vitmatte-small-distinctions-646` | lazy Transformers.js download |
| Matte Refine Fast | no model; local mask postprocessing | application code/GPU/CPU |
| Remove Background | pinned FP16 `onnx-community/BEN2-ONNX` | lazy Transformers.js download |
| Remove Background comparison | `onnx-community/BiRefNet_lite-ONNX` | benchmark only, not production |
| Face Warp | MediaPipe Face Landmarker plus BlazeFace | bundled worker assets, currently CPU |
| local create/edit/inpaint | FLUX.2 Klein 4B, FLUX VAE and Qwen3 4B | separately installed local provider |

The lazy ONNX models are not installer payloads. Chromium stores them in the
LightTable origin/user-data Cache Storage and the web build uses its website
origin cache. Cache deletion causes a later first-use download. Product UX must
make download size/state and cache management understandable.

Only the Face Warp model files are bundled in `lighttable-app` (about 3.8 MB).
The local provider manifest installs roughly 7.1 GB of recognizable model files
under its configurable model directory; see
[`model-manifest.json`](../apps/local-ai-provider/model-manifest.json).

Current compliance gap: the third-party disclosures include Depth Anything,
SlimSAM, BEN2 and MediaPipe, but not SAM 2.1 or ViTMatte. Add and verify both
before commercial distribution.

## Commercial licensing and compliance

The commercial boundary is designed but paid activation is not implemented.
The current policy targets a one-time perpetual desktop major-version purchase;
local open/edit/save/export/recovery does not require a subscription or running
server. Entitlement belongs to a host service and must never enter document,
persistence, renderer or GPU state.

There is no production checkout/account flow, signed activation-receipt
verification, secure receipt store, device activation/deactivation, restore
purchase, trial enforcement or license-status UI yet. Pricing, tax, refunds,
support, device limits and paid-major-upgrade policy also require owner/legal
decisions. Therefore technical rehearsals intentionally report
`commercialReady: false`. See
[COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md](COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md).

Third-party compliance is further along: generated dependency inventory,
notices/SBOM, unknown-license checks and Help > Third-party Licenses exist.
That must not be confused with product entitlement infrastructure.

## Photoshop parity and interchange

“Looks close in our canvas” is not parity. LightTable maintains separate
contracts for document semantics, color/blend math, editable import, export
representability and Photoshop-side visual oracles.

Current PSD export supports an 8-bit RGB merged composite plus a substantial
editable subset: raster layers with baked arbitrary affine bounds, groups,
visibility, opacity/fill, blend, clipping, locks, raster masks with density/
feather, editable point/paragraph text and runs, vectors/fills/strokes/gradients,
and mapped Layer Styles. Supported authored Photoshop-family adjustment layers
are projected to native editable descriptors, including Curves, Gradient Map,
Vibrance and the registered classic adjustment kinds. A supported adjustment
attached to a raster layer is exported as a clipped adjustment layer above its
owner; this preserves the local visual relationship but is not a Photoshop
Smart Filter claim. Known lossy cases fail closed or require explicit handling
rather than silently flattening.

Color Lookup accepts supported 3D `.cube` tables. The exact source bytes are a
document-scoped LightTable asset, realized lazily as a GPU LUT and embedded in
the LightTable file and supported Photoshop Color Lookup descriptor. Basic
`LUT_3D_SIZE` with optional `DOMAIN_MIN`/`DOMAIN_MAX` is current; 1D and combined
shaper/3D formats remain unsupported.

Still gated include 16-bit PSD/PSB writing, Smart Object and Smart Filter
semantics, unsupported native adjustment descriptors, patterns, some path-text
resources and simultaneous user/vector mask combinations. Read
[PHOTOSHOP_INTERCHANGE.md](PHOTOSHOP_INTERCHANGE.md),
[PSD_PSB_EXPORT_SCOPE.md](PSD_PSB_EXPORT_SCOPE.md) and
[PHOTOSHOP_COLOR_AND_BLEND_PARITY.md](PHOTOSHOP_COLOR_AND_BLEND_PARITY.md)
before changing representation or blend math.

## Where a change belongs

| Change | First owner to inspect |
| --- | --- |
| native/browser capability | `LightTableHost` and host adapter |
| open documents, activation, tab lifetime | workspace/session controllers |
| panel placement or preset | workspace panel registry/Dockview layer |
| panel behavior | feature model/controller, then projected panel |
| reusable control/style | `src/ui`, tokens and UI Style Guide |
| tool discovery/shortcut | tool registry and input router |
| pointer gesture semantics | document-scoped tool controller |
| editable state or transform | canonical document/scene operation + history |
| external automation | semantic contract, validation, command ports, adapter |
| render order or clipping | compositor graph/`LayerCompositor` |
| processing effect | typed node/runtime/resource owner + dirty domain |
| pan/zoom/display | viewport presentation boundary |
| text/vector engine | corresponding core/rendering/WebGPU packages |
| PSD/PDF/raster I/O | format adapter/worker and representability preflight |
| AI provider | provider package/host service; never document model |

If a change seems to require touching shell, document model, renderer and CSS
at once, first define the semantic operation and ownership boundary. Cross-
cutting wiring is sometimes real, but duplicated behavior is not.

## Verification map

The repository's quality system is layered; the package unit suite is only the
first layer. The active tree currently contains hundreds of test files across
the app, hosts and extracted engines, while root scripts orchestrate packaged
smokes, audits, corpora, stress/soak and signed release evidence. Exclude
release-candidate checkouts under `tmp/` when counting tests.

- Model/command change: unit tests for validation, stale revisions, undo/redo
  and failure atomicity.
- Transform/scene change: nested-group, reparent, picking, mask, merge and
  export geometry tests.
- Render change: shader/unit tests, dirty-only telemetry and desktop render-
  engine audit; verify no CPU pixel roundtrip or unnecessary full pass.
- UI change: component test, live UI Style Guide and relevant desktop smoke;
  check keyboard/focus and floating/docked states.
- Format change: fixture import/export, representability preflight, roundtrip
  corpus and visual oracle where parity is claimed. Photoshop references are
  produced through COM/JSX/PowerShell automation; the packaged LightTable app
  captures the corresponding output through real UI/semantic commands. Strict
  gates compare import and export/reopen results using dimensions, structure,
  RMSE/difference images and declared profile/bit-depth metadata. A missing
  oracle is a failure, never a silent skip.
- Host change: web and desktop behavior plus recovery/open/save checks.
- Agent change: command-driver smoke, MCP design smoke, auth/scope/security and
  reconnect/cancellation tests.
- Lifetime/performance change: packaged stress, effect/style/tool lifecycle and
  supported-hardware soak. Restore interactions to a reference state, force GC
  where supported, and inspect stable-tail heap, DOM/listeners, renderer-owned
  GPU bytes, background submissions, page/runtime errors, crashes and orphan
  processes. Bounded lazy GPU realization is not automatically a leak; a
  continuing warm-tail trend is.
- Release claim: evidence must identify the exact clean commit, production
  package and hardware cell. The recorded 70-cycle/two-hour run is strong
  evidence for that candidate only; a dirty or later build does not inherit it.
- Product acceptance: automation can prove declared workflows, but visual
  polish, perceived latency, discoverability and interaction feel still require
  explicit owner sign-off.
- Package-boundary change: `npm run verify:boundary`.
- Architecture change: update this context in the same milestone and run
  `npm run audit:architecture-docs`.

## Autonomous task-queue collaboration

[`work/README.md`](../work/README.md) is the execution contract. When the owner
says **“werk alle openstaande tasks uit”**, “werk alle todo's uit” or equivalent,
continue autonomously until `work/todo/` is empty, the owner explicitly stops
the run, or a genuine blocker prevents safe progress.

For that instruction:

1. enumerate `work/todo/` in deterministic task order;
2. read each complete task package, including images and fixtures;
3. implement one cohesive task at a time while preserving unrelated changes;
4. run its focused tests plus boundary/web/desktop checks appropriate to the
   changed ownership boundary;
5. update durable architecture when the system contract changed;
6. commit the verified milestone locally with a focused message;
7. move the complete task directory to `work/done/` in that same commit;
8. continue with the next task without asking for confirmation.

A status question does not cancel the queue. If one task is genuinely blocked,
record evidence in that package and continue with independent tasks. Never move
partially implemented, unverified or merely documented work to `done`.
