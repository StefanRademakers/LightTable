# System map

## Repository topology

```text
apps/web                 Browser host and bootstrap
apps/desktop             Electron main, preload and renderer host
apps/local-ai-provider   Managed desktop local-inference process
apps/mcp-server          Remote MCP/OAuth adapter over semantic commands
packages/command-contract Machine-readable semantic command and exposure profiles
packages/lighttable-app  Shared application, editor, UI and WebGPU engine
packages/genai-core      Provider-neutral GenAI models, workflows, jobs and presentation contracts
packages/genai-higgsfield Higgsfield adapter, normalization and provider fixtures
packages/genai-local     Host-neutral local-provider protocol and contracts
packages/genai-openart   OpenArt adapter, schema normalization and provider fixtures
packages/paint-core      Host-neutral paint gesture and dab contracts
packages/paint-scene     Validated renderer-neutral retained scene/fragment contract
packages/paint-scene-adapters Canonical vector/PDF projections with explicit capability loss
packages/pdf-core        Normalized PDF display-list/document contracts
packages/text-core       Serializable text model and layout contracts
packages/text-layout-wasm Rust/Wasm shaping and paragraph runtime
packages/text-rendering  Backend-neutral text realization and caches
packages/text-webgpu     WebGPU glyph/vector text backends
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
Active document binding, commands, tasks, tools and viewport
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

`WorkspaceSession` owns ordered open documents and exactly one active document.
`DocumentWorkspaceController` pairs each host-neutral session with an opaque
source payload. One application editor/canvas/Dockview runtime binds to the
active session; inactive sessions retain canonical data/history/source state,
not duplicate mounted editor trees or recurring render work.

### Document session

Owns one document's canonical tree, viewport, command history, asynchronous
task state and persistence/revision lifecycle. Application-wide tool and
workspace layout state live in `EditorApplicationSession` and Dockview, while
gesture previews remain controller/runtime state. None of these projections may
silently become document data.

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

## Current architectural hotspots

The extraction has already split substantial systems from the original editor
overlay, but `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain large
integration facades. Continue moving cohesive responsibilities behind typed
controllers and resource owners. Do not replace one monolith with a generic
"manager" that owns unrelated systems.
