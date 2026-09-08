# LightTable whole-product architecture audit — 2026-09-02 snapshot

Date of audit: 2026-09-08  
Historical state: `0298946f31cf9b19b6d490e8aa63fb61db96c566`  
Commit date: 2026-09-01 23:50:56 +02:00  
Commit subject: `Consolidate editor UI and selection pixel workflows`

## Executive verdict

The 2 September snapshot is a useful behavioral reference, but it was not a clean architectural baseline. It already contained the central condition that makes LightTable hard to stabilize: canonical document state, renderer-owned GPU state, mounted editor state, history resources and tool-session state could all participate in one user operation without one enforced transaction authority.

The product was broad and technically valuable. Its reusable engines, format adapters, filter kernels, vector/text/paint packages and GPU algorithms were already strong salvage candidates. The unstable part was the editor-facing integration layer: the code that decided which document was authoritative, which renderer was mounted, which resources were mutable, when a preview became a commit and how failure or undo restored every participant.

The decision to place more state on the document was architecturally directionally correct and had already begun before 2 September. It was not sufficient. A document object that references or coordinates several independently mutable stores is not yet a single source of truth. The missing piece was an executable ownership and transaction contract across document, GPU resources, renderer projection, history, commands and tool sessions.

This snapshot should therefore not be treated as “the good architecture before the rework.” It may have had better behavior in some workflows, and that should be measured with a comparative smoke run, but restoring it wholesale would also restore the same structural risks.

## Scope and method

This audit inspected the repository in an isolated, detached git worktree. The current working tree and its uncommitted changes were not used as evidence and were not modified.

The audit covers the whole application rather than only recent selection and transform work:

1. package and runtime topology;
2. state ownership and document authority;
3. command routing, Actions and MCP;
4. all left-toolbar tool families;
5. adjustments, filters, effects and compositing;
6. renderer, WebGPU resources, history and finalization;
7. formats, persistence, desktop/web hosts, projects and GenAI.

This is a static architecture audit. It proves code structure, ownership and risk. It does not prove that every UI workflow was broken or working on 2 September. Claims about user-visible behavior require a build of this exact commit and the same manual workflow matrix used against the current build.

## Repository scale at this snapshot

| Area | Files | Physical lines | Nonblank lines |
|---|---:|---:|---:|
| Runtime/source | 1,127 | 210,345 | 198,428 |
| Tests inside source trees | 658 | 73,811 | 67,501 |
| Build, audit and tool scripts | 226 | 37,598 | 35,919 |
| Config/support outside source trees | 24 | 2,684 | 2,564 |
| Total code-like tracked files | 2,035 | 324,438 | 304,412 |

The integration risk was concentrated in a few very large files:

| File | Lines | Architectural role |
|---|---:|---|
| `LightTableEditorOverlay.tsx` | 8,812 | UI, tool and interaction orchestration |
| `lighttable.css` | 4,567 | application-wide presentation coupling |
| `WebGpuEngine.ts` | 4,037 | device, pipelines and GPU operations |
| `layerShaders.ts` | 2,843 | compositor shader breadth |
| `apps/desktop/src/main.ts` | 2,726 | desktop host integration |
| `gpu/shaders.ts` | 2,610 | shared GPU shader breadth |
| `lightTableCommandService.ts` | 2,026 | command transport and dispatch |
| `LayerPanel.tsx` | 1,878 | layer UI and editor operations |
| `documentCommands.ts` | 1,839 | document mutation commands |
| `SelectionRasterizer.ts` | 1,506 | selection GPU representation and operations |
| `TextLayerRenderCoordinator.ts` | 1,496 | text rendering lifecycle |
| `LightTableDockWorkspace.tsx` | 1,484 | workspace and panel composition |
| `layeredDocumentFormat.ts` | 1,478 | native document persistence |
| `useViewportInteractionController.ts` | 1,409 | pointer/viewport behavior |
| `useLayerDocumentCommands.ts` | 1,406 | layer mutations and history bridging |
| `useSelectionSessionController.ts` | 1,378 | selection session behavior |
| `LightTableStandaloneApp.tsx` | 1,337 | app shell orchestration |
| `LayerCompositor.ts` | 1,268 | layer evaluation and compositing |
| `psdDocumentAdapter.ts` | 1,242 | PSD import adaptation |
| `ToolOptionsBar.tsx` | 1,105 | cross-tool options UI |
| `createEditorMenuOptions.ts` | 1,057 | menu command surface |
| `LayerDocumentRenderer.ts` | 1,039 | renderer facade plus mutations |

File size alone is not a defect, but these files combine policy, lifecycle and side effects. That makes a local change difficult to reason about without reconstructing the whole operation.

## Whole-product mental map

The intended runtime was:

```text
desktop host / web host / MCP host
        |
        v
application shell + workspaces + document sessions
        |
        v
command service + document command ports
        |
        v
canonical ImageDocument + editor/viewport/processing state
        |
        v
LayerDocumentRenderer + resource repository + compositor
        |
        v
WebGPU / Vello / text / paint / filter engines
        |
        v
canvas presentation + overlays + panels + scopes
```

The implemented runtime was closer to:

```text
UI/tool session -----------> mounted renderer methods ---------> GPU resources
      |                              |                               |
      |                              +------ history resources ------+
      v                                                              |
document command port -----> canonical document ---------------------+
      ^                           |                                   |
      +---- Actions / MCP --------+--------- publication/render ------+
```

There were good boundaries, but no single enforced owner of the complete transition. A successful user action could require several arrows to complete in the correct order. A failed action could require several independent rollback paths.

## Package and subsystem map

The snapshot contained five applications:

- `desktop`: Electron host and native integration;
- `web`: static/browser host;
- `mcp-server`: external command surface;
- `local-ai-provider`: local GenAI runtime host;
- `ui-demo`: component catalog.

It contained 24 packages:

- command/integration: `command-contract`, `lighttable-app`;
- filters: `filter-core`, `filter-webgpu`;
- GenAI: `genai-core`, `genai-higgsfield`, `genai-local`, `genai-openart`;
- paint: `paint-core`, `paint-scene`, `paint-scene-adapters`;
- text: `text-core`, `text-rendering`, `text-webgpu`;
- vector: `vector-core`, `vector-rendering`, `vector-svg`, `vector-svg-normalizer`, `vector-vello`, `vector-webgpu`;
- documents/media: `pdf-core`, `video-core`;
- shared UI: `ui`.

This package decomposition is one of the strongest assets in the repository. Most specialized engines are not the main source of instability. The problem is that `lighttable-app` integrates many of them through lifecycle conventions rather than one mechanically enforced protocol.

## State authority

### What was already document-owned

`documentSession.ts` already stored a broad document snapshot:

- source and title;
- lifecycle and dirty state;
- document and saved revisions;
- history and async tasks;
- renderer diagnostics;
- canonical document tree;
- editor, viewport and processing state;
- loaded source information.

The file explicitly described application-owned state and kept tool choice/options global. The session also owned command history, tasks and font state. This disproves the idea that document-bound state was introduced only after 2 September.

### Why it was not a complete single source of truth

The session publication mechanism batched notifications, but did not make a mutation atomic. The canonical document could change while GPU resources, mounted renderer state, selection textures or history resources were still pending. Revision counters and history dirty state were related but separate.

The document snapshot also exposed renderer diagnostics rather than the renderer's mutable resource state. That was sensible for UI isolation, but it left the GPU truth outside the state that history and commands claimed to mutate.

### State-authority finding

Document ownership was the correct direction. The architectural error was treating “state is reachable from a document session” as equivalent to “the document transaction is authoritative.” Those are not the same. Authority requires that every visible mutation either commits completely or leaves no observable change.

## Commands, Actions and MCP

### Existing strengths

- The command contract offered stable command IDs and typed payloads.
- `lightTableCommandService.ts` provided one broad dispatch surface.
- MCP was an adapter over the same command vocabulary rather than a separate feature implementation.
- Actions could record command-level behavior instead of DOM events.
- Command ports were resolved per document ID.

These are the right foundations for automation parity.

### The canonical/presentation split

`documentSessionCommandPorts.ts` already classified commands and ports into canonical and presentation-dependent sets. Fill, raster gradient, selection, undo and redo required presentation. Document, layer, text, vector, style, warp, face-warp and batch commands had canonical paths.

`lightTableCommandPortRegistry.ts` preferred the mounted document port wholesale. It did not merge capabilities command by command. That prevented accidental mixed fallback inside one resolution, but it also meant behavior depended on whether a document had a mounted editor/renderer at execution time.

Consequences:

- the same command could have different readiness constraints in UI, Actions and MCP;
- presentation-dependent commands could not be treated as ordinary canonical operations;
- command success did not necessarily mean rendered/GPU publication had completed;
- history could describe the logical command while presentation restoration remained a caller responsibility.

### What should have been enforced

Every command needed one result protocol:

```text
validate -> prepare immutable inputs -> stage canonical/resource delta
         -> publish renderer projection -> append history -> commit
```

On any failure:

```text
discard staged resources -> restore canonical revision -> preserve prior projection
-> do not append history -> return a structured failure
```

Actions and MCP should call exactly this transaction boundary. They should not know whether a renderer is mounted; the document runtime should either satisfy the command contract or report a declared unavailable capability.

## Tool system

### Inventory

The left-toolbar registry exposed 37 tool IDs:

- transform and selection: transform; rectangular, elliptical, horizontal-row, vertical-column, free/lasso, polygonal, object, magic-wand and paint-brush selection;
- vector: pen, add anchor, delete anchor, convert anchor, path select and direct select;
- shape: rectangle, ellipse, triangle and line;
- text: point, paragraph, vertical and path text;
- paint/content: gradient, fill, brush, healing brush, clone stamp, erase, dodge, burn and sponge;
- deformation: warp and face warp;
- navigation: view/hand and zoom.

The registry was principally UI metadata. Actual behavior lived across the overlay, viewport controller, selection controller, layer command controller, renderer facade and specialized engines. A tool ID therefore did not identify one self-contained implementation.

### Cross-tool lifecycle risk

The intended lifecycle in the architecture documents was sound:

```text
begin -> preview -> update -> commit or cancel -> one history entry
```

The implementation did not make that lifecycle mandatory. Different families had different preview stores and commit mechanics:

- selection used document-space geometry plus raster/GPU state;
- transform mixed gesture state, geometry and renderer output;
- paint altered GPU surfaces and later committed history;
- vector and text had specialized coordinators and caches;
- warp and face warp maintained expensive previews;
- navigation bypassed document history but shared pointer routing.

This is the reason tool-wide correctness could not be established by inspecting the registry or testing one handler. Each tool family could leave different transient state behind on cancel, document switch, unmount, failure or undo.

### Maturity assessment

| Tool family | Reusable core | Integration risk on 2 Sep |
|---|---|---|
| View/zoom | high | low to medium |
| Basic shape/vector creation | high | medium |
| Text rendering/layout | high | high at editor lifecycle boundary |
| Brush/erase | high | high at GPU/history boundary |
| Healing/clone/dodge/burn/sponge | medium to high | high due source sampling and commit state |
| Selection tools | high algorithms, mixed state | very high |
| Transform | high math, mixed state | very high |
| Warp/face warp | high algorithms | very high preview/finalization risk |

## Adjustments, filters and effects

The snapshot had three overlapping processing models:

1. compound Grade and Lens FX processing;
2. standalone or attached filter nodes supplied by `filter-core`/`filter-webgpu`;
3. Layer Styles/FX with their own editor, preview and compositing behavior.

The adjustment catalog included Grade, Lens FX, brightness/contrast, levels, curves, exposure, color and vibrance, hue/saturation, color balance, black and white, photo filter, channel mixer, color lookup, invert, posterize, threshold, gradient map, selective color, clarity/dehaze and grain. Filter definitions were also imported from the shared filter package; some were hidden from creation UI rather than absent.

The compositor intended a stable evaluation order:

```text
source
-> transform
-> local grade / Lens FX
-> mask
-> layer styles
-> fill opacity
-> clipping
-> layer opacity and blend
-> parent/group composition
```

P0 filters formed another declared stage after Grade and before Lens FX post-processing.

The problem was not lack of algorithms. It was that each processing family had its own model for preview, cached resources, enable/disable, parameter commit, rasterization and history. “Apply adjustment,” “toggle effect,” “rasterize result,” “merge down” and “undo” were therefore not guaranteed to share one lifecycle.

The target should have been one processing-node protocol with declared:

- immutable parameters;
- input/output resource ownership;
- preview generation and invalidation;
- deterministic evaluation position;
- serialization support;
- rasterization/finalization behavior;
- history delta and rollback behavior;
- Actions/MCP schema.

## Renderer and WebGPU resources

### Useful structure already present

- one shared GPU device;
- a canonical `DocumentLayerResourceRepository` per device, independent of canvases;
- `LayerCompositor` as the intended order authority;
- lazy creation of many GPU resources;
- detached layer runtimes retained for undo;
- separate lower-level filter, vector, text and paint engines.

### The ownership problem

`LayerDocumentRenderer` was called a renderer facade but also performed or coordinated mutating work: selection rasterization and clipboard operations, masks, pixel measurements, resource replacement and retained runtimes. The renderer was therefore both projection infrastructure and part of the writable document model.

History commands could retain GPU resource identities. This made undo efficient, but also coupled correctness to resource lifetime. If a resource was released, overwritten, rebound to another renderer generation or only partially published, a logically valid history entry could fail to restore the visible state.

The renderer needed to become a pure consumer of a committed document/resource revision. GPU resources could remain outside serializable document JSON, but their ownership needed to be document-runtime state with explicit generation, leases and disposal—not incidental renderer state.

### Performance implication

A stricter transaction model does not require copying full images on every gesture. Efficient implementation can stage handles and tile/resource deltas, keep previews outside history, and swap committed resource references. The snapshot's retained resources and shared device were compatible with that design; the missing part was enforced lifetime and publication semantics.

## History and transactions

`DocumentCommandHistory` was document-scoped, asynchronous and bounded to 100 entries and approximately 512 MB. It could restore its internal undo/redo stacks if an undo or redo callback failed.

That protected the stack data structure. It did not prove that the document tree, selection raster, GPU texture, renderer caches and UI projection had all rolled back together. A callback could fail after changing one participant, or succeed before asynchronous publication exposed the new state.

Required invariants were not executable across the whole operation:

- one user commit creates exactly one history entry;
- previews never create history entries;
- cancel restores all participants;
- failed commit restores all participants;
- undo/redo are symmetric and generation-safe;
- document switch cannot publish a stale asynchronous result;
- resource disposal cannot invalidate reachable history.

The later architecture work did not invent this problem; it attempted to add missing transaction structure around it.

## Merge, rasterize, flatten and layer finalization

These operations were especially risky because they cross nearly every boundary:

- render the effective source including masks, adjustments and styles;
- decide whether to preserve layer bounds or document bounds;
- allocate a new pixel resource;
- replace one or more canonical nodes;
- preserve or dispose original resources for undo;
- update selection/active-layer state;
- publish thumbnails and the compositor result;
- serialize the new form;
- expose the same behavior to UI, Actions and MCP.

The snapshot had implementations for these behaviors, but no shared finalization primitive proving them atomic. Different layer kinds—pixels, pasted/transformed content, text, vector, gradient/fill, adjustments and styled layers—could reach rasterize or merge through different capability tests and renderer paths.

This explains why “rasterize icon visible,” “Ctrl+E enabled” and actual merge/rasterize success could drift apart. UI capability, command validation and execution were not all derived from one declared layer capability model.

## Persistence, formats and recovery

The open/import surface included PNG, JPEG, WebP, TIFF, SVG, PSD/PSB and PDF. Precision-aware paths existed for PNG, TIFF, JPEG and WebP. The native layered format, PSD adapter, PDF import/export and recovery systems were separate concerns.

Format support was broad, but “can open” did not imply:

- lossless round-trip;
- save-back to the original format;
- preservation of all effects/text/vector constructs;
- atomic save and close;
- bounded preview/recovery memory;
- identical desktop and web behavior.

The correct persistence boundary should serialize one committed document revision while live previews remain excluded. Save completion should be the only point at which `savedRevision` advances. Close should wait for or explicitly cancel in-flight save. Recovery should snapshot a coherent revision rather than assembling data from mutable live participants.

## Desktop, web, projects and GenAI

### Desktop and web

The shared `lighttable-app` package correctly maximized host parity. Electron provided filesystem, dialogs, clipboard and native process integration; web required browser file handles, browser clipboard permissions and static-host constraints.

The risk was hidden capability branching. A UI command could exist in both hosts while only one host could satisfy its native dependency. Host capability needed to be explicit in command availability rather than discovered during execution.

### Projects and GenAI

Projects provided durable asset organization and AI history. GenAI providers were separated into core and provider packages, which is a good boundary. The local provider was a separate application.

The UI, however, could combine project state, active document references, provider authentication/configuration and output import. Those are distinct transactions. GenAI generation should produce an external asset result first; attaching it to a project or opening/placing it in a document should be separate, reversible commands.

## Tests and why they were insufficient

The snapshot already had 658 test files and 73,811 physical test lines. This is substantial. The problem was not simply too few tests.

Most tests proved local contracts with mocks or isolated state. The failures users later observed live at seams:

- canonical document versus mounted renderer;
- tool preview versus committed history;
- GPU resource lifetime versus undo;
- capability UI versus actual command execution;
- asynchronous result versus active document generation;
- imported layer kind versus generic pixel expectations;
- desktop versus web capability.

More unit tests on individual handlers would not eliminate these failures. The necessary tests are invariant-based vertical workflows using the real document runtime and real or faithfully instrumented GPU resource ownership.

## Root causes present on 2 September

1. **No single mutation authority.** Document, renderer, resources, history and tool session could all mutate during one operation.
2. **Renderer was not a pure projection.** It owned or coordinated writable data needed by document semantics.
3. **Transactions were conventions.** Begin/preview/commit/cancel differed by tool and processing family.
4. **Command readiness depended on mounted presentation.** UI, Actions and MCP parity was therefore conditional.
5. **Layer capabilities were inferred in multiple places.** UI affordances and command behavior could diverge.
6. **Resource lifetime was coupled to history without one lease model.** Undo correctness could depend on retained GPU objects.
7. **Large integration coordinators combined policy and side effects.** Local changes had wide hidden consequences.
8. **Feature breadth outpaced vertical workflow proof.** Many strong subsystems were integrated before three representative end-to-end contracts were locked.
9. **Tests emphasized components more than cross-boundary invariants.** Green suites could coexist with unusable workflows.
10. **Earlier stabilization documents described intent, not enforcement.** The repository already contained an August stabilization report and system maps, but critical contracts remained advisory.

## Risk register for this snapshot

| Risk | Likelihood | Impact | Evidence-based assessment |
|---|---|---|---|
| Partial commit across document/GPU/history | high | critical | multiple writable participants, no shared atomic boundary |
| Undo restores stack but not visible state | high | critical | async callbacks and retained GPU identities |
| Tool preview leaks into later action | high | high | family-specific transient stores |
| Mounted/unmounted command divergence | high | high | canonical/presentation port split |
| Rasterize/merge capability mismatch | high | high | layer-kind checks across UI and execution paths |
| Stale async publication after switch | medium-high | high | document tasks and renderer publication not generation-enforced everywhere |
| GPU resource leak or premature disposal | medium-high | high | shared repository plus history-retained resources |
| Web/desktop behavior drift | medium | high | host-specific native capabilities behind shared UI |
| Format round-trip loss | medium | high | broad import surface, differing save/export guarantees |
| Specialized engine loss in rewrite | high | critical | broad mature filter/text/vector/paint code |

## What should have been defined before more feature breadth

Five executable contracts should have preceded the broad editor integration:

1. **Document contract:** one immutable committed revision identifies the canonical tree, editor state and referenced resource set.
2. **Resource contract:** every GPU resource has one owner, generation, lease policy and deterministic disposal path.
3. **Transaction contract:** all user mutations stage, publish and append history atomically; cancel/failure is observationally a no-op.
4. **Projection contract:** renderers consume committed revisions and may cache, but never become independent semantic truth.
5. **Command contract:** UI, Actions and MCP execute the same document transaction and receive the same structured result.

On top of those, every tool and processing node needed a common preview/commit lifecycle and every layer kind needed a declarative capability record.

## Salvage assessment as of 2 September

### Strong salvage candidates

- filter kernels and WebGPU implementations;
- vector parsing, normalization, Vello/WebGPU rendering;
- text model and rendering engines;
- paint engines and brush algorithms;
- PSD/PDF/SVG/image format adapters;
- command IDs and schemas;
- shared UI primitives and visual assets;
- compositor algorithms, subject to a new resource/projection contract;
- GenAI provider packages.

### Replace or substantially restructure

- the editor operation/transaction coordinator;
- renderer-facing mutation facade;
- history/resource coupling;
- mounted versus canonical command routing;
- tool-session finalization;
- layer capability and finalization dispatch;
- asynchronous publication and generation handling.

A provisional salvage ratio for this snapshot is similar to the current audit: approximately 70–85% of specialized code is reusable or adaptable, while 15–30% of editor-facing integration needs replacement or substantial restructuring. This is a planning range, not a measured promise.

## Repair options from this snapshot

### Restore and patch 2 September directly

Likely effort: 10–16 engineer-weeks for a credible integration core and representative migration; more feature-tail work afterward.  
Risk: high.  
Reason: the code is somewhat smaller, but lacks most of the explicit transaction and generation work added later.

### Use 2 September as behavioral oracle while repairing current main

Likely effort: aligned with the current 8–14 engineer-week core estimate, assuming the first vertical slice validates the approach.  
Risk: high but measurable.  
Benefit: preserve later safety primitives while comparing every changed workflow to a known older build.

### Full rewrite from the snapshot

Likely effort: 6–12+ months solo before comparable breadth.  
Risk: extremely high.  
Reason: all specialized engines, format behavior, UI details and host integrations still need reintegration; the same architecture mistakes can recur.

## Recommended use of this snapshot

1. Build the exact commit in isolation.
2. Run one fixed manual matrix against historical and current builds:
   - selection create/move/copy/paste/paint/undo;
   - transform repeated gestures without quality loss;
   - text edit/transform/path text;
   - vector/shape edit and rasterize;
   - paint, healing and clone;
   - adjustment/effect preview, toggle, rasterize and undo;
   - merge down, merge selected and flatten across representative layer kinds;
   - open/save/close/recovery for PNG, JPEG, WebP, TIFF, PSD and native format;
   - the same automatable operations through Actions and MCP.
3. Record behavioral differences without porting code yet.
4. Use the snapshot as a behavioral oracle and source of known-working implementations, not as an assumed architectural reset point.
5. Continue only if one new-runtime vertical slice proves atomic commit, undo, renderer publication and resource cleanup end to end.

## Final assessment

On 2 September LightTable was already a technically ambitious, broad application with valuable engines and an unstable integration core. The architecture had the right vocabulary—documents, commands, history, renderer, repositories and packages—but not a single enforced authority governing their joint state transition.

The snapshot may well feel better in selected workflows than the current application. That is a product fact worth measuring. It does not make the snapshot a safe long-term foundation. The rational recovery path is to preserve its behavior as a reference, preserve the specialized code, and replace the integration core behind a small number of hard, executable contracts.
