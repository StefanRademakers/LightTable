# System map

## Repository topology

```text
apps/web                 Browser host and bootstrap
apps/desktop             Electron main, preload and renderer host
apps/local-ai-provider   Managed desktop local-inference process
apps/mcp-server          Remote MCP/OAuth adapter over semantic commands
packages/lighttable-app  Shared application, editor, UI and WebGPU engine
packages/genai-core      Provider-neutral GenAI models, workflows, jobs and presentation contracts
packages/genai-local     Host-neutral local-provider protocol and contracts
packages/genai-openart   OpenArt adapter, schema normalization and provider fixtures
packages/paint-core      Host-neutral paint gesture and dab contracts
packages/pdf-core        Normalized PDF display-list/document contracts
packages/text-core       Serializable text model and layout contracts
packages/text-layout-wasm Rust/Wasm shaping and paragraph runtime
packages/text-rendering  Backend-neutral text realization and caches
packages/text-webgpu     WebGPU glyph/vector text backends
packages/vector-core     Serializable vector model, geometry and editing
packages/vector-rendering Backend-neutral realization and revision caches
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
Application shell and multi-document workspace
                    |
Per-document session, commands, tasks, tools and viewport
                    |
Canonical document tree and scene transforms
                    |
Renderer facade and semantic dirty-state scheduler
                    |
Content: compositor plan -> processing runtime -> composited texture
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
source payload. Activation suspends background renderers while retaining their
resources for fast tab switching.

### Document session

Owns one document's canonical tree, editor state, viewport, command history,
asynchronous task registry and renderer lifecycle. Nothing transient for one
document may be stored as singleton root state.

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
