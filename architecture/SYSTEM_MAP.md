# System map

## Repository topology

```text
apps/web                 Browser host and bootstrap
apps/desktop             Electron main, preload and renderer host
apps/ui-demo             Interactive catalog for shared UI primitives and composites
apps/local-ai-provider   Managed desktop local-inference process
apps/mcp-server          Remote MCP/OAuth adapter over semantic commands
packages/command-contract Machine-readable semantic command and exposure profiles
packages/lighttable-app  Shared application, editor, UI and WebGPU engine
packages/ui              Themeable shared UI primitives and reusable composites
packages/genai-core      Provider-neutral GenAI models, workflows, jobs and presentation contracts
packages/genai-higgsfield Higgsfield adapter, normalization and provider fixtures
packages/genai-local     Host-neutral local-provider protocol and contracts
packages/genai-openart   OpenArt adapter, schema normalization and provider fixtures
packages/filter-core     Serializable full-frame filter definitions, controls and settings
packages/filter-webgpu   Reusable linear-RGBA16F GPU filter cores and scratch-target ownership
packages/paint-core      Host-neutral paint gesture and dab contracts
packages/paint-scene     Validated renderer-neutral retained scene/fragment contract
packages/paint-scene-adapters Canonical vector/PDF projections with explicit capability loss
packages/pdf-core        Normalized PDF display-list/document contracts
packages/text-core       Serializable text model and layout contracts
packages/text-layout-wasm Rust/Wasm shaping and paragraph runtime
packages/text-rendering  Backend-neutral text realization and caches
packages/text-webgpu     WebGPU glyph/vector text backends
packages/video-core      Host-neutral video documents, playback state and frame artifacts
packages/vector-core     Serializable vector model, geometry and editing
packages/vector-rendering Backend-neutral realization and revision caches
packages/vector-svg      Bounded editable SVG import/export codec over vector-core
packages/vector-svg-normalizer Secure local-only usvg/Wasm normalization boundary
packages/vector-vello    Retained Vello/Wasm scene sync and zero-copy shared-device backend
packages/vector-webgpu   WebGPU vector fill and editing-overlay backends
architecture             Canonical product and engineering contracts
fixtures                 Stable import/render regression material
work/todo                Versioned executable task queue
work/done                Versioned completed-task archive
architecture/reference   Supporting research and implementation records
architecture/obsolete    Superseded historical material
```

## Runtime layers

```text
Web / Electron / StoryBuilder host capabilities
                    |
Application shell, multi-document sessions and one editor/workspace runtime
                    |
Document command authority + active presentation binding, tools and viewport
                    |
Canonical document tree and scene transforms
                    |
Renderer facade and semantic dirty-state scheduler
                    |
Content: compositor plan -> vector render islands -> processing -> composite
                    |
        per-island Vello/native WebGPU on one shared device
                    |
Presentation: viewport sampling -> visible canvas
        |                                      |
Editor overlays                         Scopes/analysis
        |                                      |
Vector realization/WebGPU          Revision-keyed analysis resources
                    |
Explicit WebGPU resource owners
```

Dependencies flow downward. GPU and DOM types must not leak into the canonical
document model, workspace model or reversible command descriptions. Hosts may
provide capabilities, but the editor must not import host state, routes, S3
details or Electron APIs.

## Ownership boundaries

### Hosts

Own native/browser integration: opening, saving, recent files, confirmation,
clipboard and optional media browsing. Hosts do not contain editor logic.

### Workspace

The application workspace owns ordered typed documents and exactly one active
document. The current image `WorkspaceSession` and `DocumentWorkspaceController`
pair image sessions with opaque source payloads; `@lighttable/video-core` owns
the separate read-only video session contract. One application
editor/canvas/Dockview runtime binds to the active typed adapter; inactive
sessions retain canonical or presentation state, not duplicate mounted editor
trees or recurring render work. Video and future model documents must not be
represented by synthetic image sessions.

### Document session

Owns one document's canonical tree, viewport, command history, asynchronous
task state and persistence/revision lifecycle. Application-wide tool and
workspace layout state live in `EditorApplicationSession` and Dockview, while
gesture previews remain controller/runtime state. None of these projections may
silently become document data.

### Command and presentation authority

Every open `DocumentSession` owns narrow document-lifetime command ports for
operations whose canonical result can be produced without a canvas. The single
mounted editor contributes presentation ports for the active session.
`LightTableCommandPortRegistry` overlays the active presentation owner on the
canonical owner and resolves by explicit document ID; React visibility is not
command authority.

This lets UI, Actions and MCP use the same semantic service for inactive text,
vector and admitted layer mutations without changing tabs. GPU readbacks,
selection edits, raster duplication and gestures remain presentation-dependent
and must fail closed when no renderer is bound. A ready, clean, unchanged
single-raster session has one bounded source-artifact preview/copy exception.
It must never stand in for edited or layered document pixels. Do not add hidden
per-document editors or render loops to broaden this exception.

### Document model

Owns serializable semantic state: layer tree, transforms, masks, clipping,
blend/opacity/fill, adjustment stacks, styles, vectors, assets and provenance.
It never owns GPU handles.

### Renderer

Resolves the document into render contracts, GPU resources and output. The
renderer observes revisions and dirty domains; it must not become a second
document model.

Content recomposition, viewport presentation, editor overlays and scope
analysis are distinct products. Pan/zoom must not re-run document compositing
or scopes; overlay animation must not invalidate pixels; scopes follow the
content revision rather than the viewport revision.

`ViewportPresentationController` owns the DOM-measurement-to-GPU-uniform
boundary, canvas pixel sizing, interactive sampling quality and settle-timer
lifecycle. `WebGpuEngine` consumes that retained presentation state; it does
not independently own another viewport model.

For vector content, `RenderIslandPlanner` derives semantic islands without
changing canonical layers. `RetainedRenderIslandRegistry` preserves stable
runtime resource identities across immutable document snapshots and valid
split/merge transitions. Eligible islands use retained Vello scenes; unsupported
islands and specialized overlays use native LightTable WebGPU. Both feed the
same compositor on one shared `GPUDevice`.

### UI

Presents application state and dispatches commands. Panels and tools should
own their bindings/controllers. The root mounts systems; it does not implement
their behavior.

### Multi-file hydration

Hosts may return several files from one Open request. Because presentation is
single-owned, the application serializes initial hydration and publishes each
session's source, canonical document and history snapshot atomically. Creating
all tabs first and letting only the final active renderer hydrate would leave
valid-looking but unusable background sessions and is forbidden.

## Current architectural hotspots

The extraction has already split substantial systems from the original editor
overlay, but `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain large
integration facades. Continue moving cohesive responsibilities behind typed
controllers and resource owners. Do not replace one monolith with a generic
"manager" that owns unrelated systems.
