# LightTable whole-product architecture audit — 2026-08-26 snapshot

Date of audit: 2026-09-08  
Historical state: `a8ca4d931c660d9f1f61e882a556327b10d16447`  
Commit date: 2026-08-26 21:49:11 +02:00  
Commit subject: `Finish Actions and History workflows`

## Executive verdict

The 26 August snapshot was smaller and had less recent integration churn than the 2 September and current versions, but it was not a clean architectural baseline. The same central fault line was already present: `DocumentSession` held canonical document state while renderer-owned GPU state, resource repositories, tool sessions, mounted command ports and history callbacks could also participate in a semantic edit.

The architecture already contained several good ideas: document-scoped state, immutable document snapshots, a mutation controller, bounded document history, shared GPU resource repositories, command contracts used by UI/Actions/MCP, and specialized paint/vector/text/filter packages. The problem was not the absence of architecture. It was that the contracts stopped at subsystem boundaries. A user operation could cross several owners without one object being responsible for atomic commit, rollback, resource lifetime and publication.

This means the later move toward more document-bound state was directionally correct, but it did not introduce the problem and could not solve it by itself. By 26 August the document was already a broad state container. What was missing was a single enforced mutation boundary around the document model and every external side effect needed to present it.

The snapshot is useful as a behavioral oracle and as evidence of the state before the late-August feature/UI expansion. It is not safe to treat it as a known-good codebase or to restore it wholesale without running the same manual workflows.

## Scope and method

The repository was inspected in a clean detached worktree at the exact historical commit. The current checkout, current uncommitted work and current generated outputs were not used as evidence and were not modified.

The audit covers the full product surface:

1. repository and package topology;
2. document, editor and tool state ownership;
3. command routing, Actions and MCP;
4. every left-toolbar tool family;
5. adjustments, filters, effects and compositing;
6. WebGPU rendering, resources, history and finalization;
7. merge, rasterize and flatten operations;
8. formats, persistence, desktop/web hosts, projects and GenAI;
9. tests and observability.

This is a static architecture audit. It can identify ownership conflicts, risky control flow and missing invariants, but it cannot prove that a specific visible workflow did or did not work on 26 August. That requires building this commit and executing the same manual scenario matrix used for later versions.

## Repository scale

| Area | Files | Physical lines | Nonblank lines |
|---|---:|---:|---:|
| Runtime/source | 1,022 | 202,048 | 190,227 |
| Tests inside source trees | 655 | 72,773 | 66,551 |
| Build, audit and tool scripts | 223 | 36,609 | 34,954 |

The largest production coordinators already concentrated substantial policy:

| File | Lines | Architectural role |
|---|---:|---|
| `LightTableEditorOverlay.tsx` | 8,321 | editor UI, tools, pointer routing and orchestration |
| `lighttable.css` | 5,961 | application-wide presentation coupling |
| `WebGpuEngine.ts` | 3,891 | GPU device, pipelines and operations |
| local `ui/primitives.css` | 2,829 | pre-package UI primitives and overrides |
| `layerShaders.ts` | 2,727 | compositor shader breadth |
| `gpu/shaders.ts` | 2,610 | shared GPU shader breadth |
| desktop `main.ts` | 2,524 | host, filesystem, IPC and lifecycle integration |
| `lightTableCommandService.ts` | 2,013 | command transport and dispatch |
| `documentCommands.ts` | 1,839 | document-level mutation commands |
| `LayerPanel.tsx` | 1,751 | layer UI plus semantic operations |
| `LightTableDockWorkspace.tsx` | 1,506 | workspace and panel composition |
| `TextLayerRenderCoordinator.ts` | 1,490 | text rendering and resource lifecycle |
| `layeredDocumentFormat.ts` | 1,453 | native document persistence |
| layer command hook | 1,376 | layer mutations and history bridging |
| vector renderer | 1,324 | vector render integration |
| `SelectionRasterizer.ts` | 1,272 | selection GPU representation and mutation |
| `LayerCompositor.ts` | 1,256 | layer evaluation and compositing |
| viewport controller | 1,250 | pointer, pan and zoom behavior |
| PSD adapter | 1,242 | PSD import adaptation |
| standalone app | 1,208 | shell and lifecycle orchestration |
| tool options bar | 1,136 | cross-tool options and local state |
| menu options | 1,052 | menu command surface |
| grade panel | 1,036 | grading preview and commit behavior |
| selection session controller | 1,021 | marquee/selection session behavior |
| `LayerDocumentRenderer.ts` | 977 | renderer facade plus semantic mutations |

Large files are not inherently wrong. Here they matter because several combine rendering, policy, transient input state, document publication and failure handling. A local change can therefore alter a distant workflow without a type error.

## Whole-product mental map

The intended architecture was approximately:

```text
desktop host / web host / MCP host
                 |
                 v
        application command layer
                 |
        +--------+---------+
        |                  |
        v                  v
 canonical document     mounted editor
 session + history      tools + renderer
        |                  |
        +--------+---------+
                 v
      paint / vector / text / filters
                 |
                 v
       WebGPU resources + compositor
                 |
                 v
       canvas, previews and exports
```

The actual mutation graph was closer to:

```text
UI / keyboard / Action / MCP
             |
     command-port registry
      /                \
canonical handlers   mounted handlers
      |                  |
DocumentSession     tool/session/controller
      |                  |
history snapshots   LayerDocumentRenderer
      |                  |
      +---- resource repository ----+
                    |
                 WebGPU
```

That second graph is the source of most systemic risk. There were multiple legitimate entry points and multiple mutable participants, but no universal transaction owner.

## Package and subsystem topology

The snapshot contained 23 packages and four application hosts. The package split was meaningful rather than cosmetic:

- paint core, scene and adapters;
- vector core, SVG normalization, SVG/Vello/WebGPU rendering;
- text core, rendering and WebGPU integration;
- filter core and WebGPU filters;
- PDF support;
- command contract;
- GenAI core and several providers;
- the LightTable application integration package;
- desktop, web, MCP and local-AI hosts.

The positive conclusion is that much of the domain work is salvageable. Specialized engines and adapters have narrower responsibilities than the editor integration layer. The negative conclusion is that `lighttable-app` was the place where all packages, hosts and user interactions converged, and its boundaries were not strict enough to prevent cross-owner mutations.

There was no standalone shared `ui` package or UI demo yet. UI primitives were local to the application. This made the 26 August UI less modular, but the later UI extraction was not itself the root cause of document/render instability.

## Document and state ownership

### What was already document-bound

`DocumentSession` already stored a broad document record including:

- source and title;
- lifecycle and dirty state;
- revision counters;
- document history and tasks;
- renderer diagnostics;
- layered document data;
- editor and viewport state;
- processing state;
- loaded source metadata.

This disproves the idea that document-bound state was introduced only during the September stabilization work. The architectural direction existed on 26 August.

`runPublication` batched synchronous multi-field notifications. State changed immediately during the operation; only subscriber emission was deferred. It provided publication coherence, not transactional rollback. If a later GPU or resource operation failed, publication batching alone could not restore every participant.

### Mutation controller

`createDocumentMutationController` already provided a useful transaction-shaped API:

- it locked the document identity;
- a transaction could begin and end;
- repeated previews published immutable document trees;
- ending a transaction created one history command;
- a direct change applied its snapshot immediately;
- history undo/redo applied before/after snapshots.

This was a strong foundation, but the transaction only governed document snapshots and associated callbacks. It did not automatically include GPU textures, detached runtimes, selection masks, renderer-local caches or UI presentation state. Therefore a successful document commit could still coexist with a failed or stale external projection.

### State authorities that remained outside the document

- active pointer/tool sessions;
- transform and selection preview geometry;
- renderer runtime and caches;
- GPU textures and retained resources;
- mounted-canvas lifecycle;
- host clipboard/filesystem state;
- local component state in large orchestration views.

Some of these should remain external for performance. The defect was not merely that they were external; it was that their relationship to the canonical document was not consistently one-way and reconstructible.

## Command layer, Actions and MCP

The command-contract architecture was one of the strongest reusable parts of the product. UI commands, Actions and MCP were intended to address the same semantic operations rather than maintaining three unrelated implementations. This was the correct product direction.

The risk lived in command resolution. The 26 August `LightTableCommandPortRegistry` stored both a mounted document port and a canonical resolver. When both existed, `resolve` returned a proxy that preferred a mounted property and fell back to the canonical port per property. In contrast, `supportsCommand` preferred the mounted port's declaration. Capability reporting and actual dispatch could therefore disagree.

Consequences included:

- a command could appear unsupported even though the proxy would find a canonical implementation;
- execution semantics could change when a document became mounted or unmounted;
- one command object could mix methods from two owners;
- Actions/MCP parity depended on presentation state;
- tests of one entry point did not prove equivalence across hosts.

`documentSessionCommandPorts` already distinguished canonical operations from presentation-required operations. That was valuable, but it documented the split rather than eliminating ambiguity.

The command service was already over 2,000 lines. It combined schema, validation, dispatch, transport concerns and product behavior. The same command ID was an important unifying concept, but it did not guarantee one implementation path or one transaction boundary.

## Left-toolbar tools

The snapshot exposed 36 tools across these families:

- move/transform;
- rectangular, elliptical, row, column, lasso, polygonal, object and magic-wand selections;
- pen, anchor add/delete/convert, path selection and direct selection;
- rectangle, ellipse, triangle and line shapes;
- point, paragraph, vertical and path text;
- gradient, fill, brush, healing, clone, erase, dodge, burn and sponge;
- warp and face warp;
- hand/pan and zoom.

The tool registry primarily described tools. Behavior was distributed across the overlay, option bars, tool/session controllers, renderer methods, document commands and package-specific engines. As a result, “all tools use the same lifecycle” was not an enforceable property.

A professional editor needs every mutating tool to obey the same state machine:

```text
idle -> begin -> preview* -> commit | cancel
```

With invariants:

- preview never creates history;
- commit creates exactly one semantic history entry;
- cancel restores document and resources;
- changing tool/document either commits or cancels explicitly;
- undo reverses the complete operation;
- renderer state is derived from the committed/preview model, never a second semantic owner.

The 26 August code had pieces of this pattern, but not one mandatory protocol across all 36 tools. Brush strokes, text editing, selection movement, transforms, warp and vector operations reached final state through different coordinators.

## Selection and clipboard

Selection was not just overlay geometry. It involved:

- visible path/bounds state;
- a raster selection mask;
- selection movement sessions;
- GPU readback/upload paths;
- clipboard extraction;
- copy/paste layer creation;
- history snapshots and retained resources.

`SelectionRasterizer` and the selection session controller already carried substantial semantic behavior. This made selection a small subsystem with its own state graph, not a lightweight tool. A visible marquee could diverge from the mask used by paint/copy if movement updated only one representation or if a clipped mask was reused as canonical state.

The later selection regressions are therefore consistent with a pre-existing structural risk. They cannot be attributed solely to the later refactor. The safe model is one document-coordinate selection mask plus derived overlay geometry, with movement committed atomically and clipping applied only during an operation, never to the stored selection.

## Adjustments, filters and layer effects

The product already contained three distinct processing models:

1. grade and Lens FX controls;
2. filter operations and GPU kernels;
3. layer styles/effects evaluated by the compositor.

They shared visual concepts but not a universal lifecycle. Some controls updated preview state at throttled rates, some used requestAnimationFrame or direct input, and some changed persistent layer structures. This difference is legitimate for performance. What must be shared is semantic finalization: one begin/preview/commit/cancel contract, one capability description and one resource cleanup rule.

Adjustment/filter/effect risks in this snapshot:

- preview ownership spread across panels, renderer and document state;
- capability and rasterization rules were layer-type-specific and distributed;
- compositor caches could become stale after structural edits;
- effect resources needed explicit lifetime handling;
- UI/Actions/MCP could reach the same feature through different mounted contexts.

The filter and shader packages themselves remain high-value assets. The risk is orchestration, not automatically the algorithms.

## Renderer, WebGPU and resources

### Strong foundations

`DocumentLayerResourceRepository` represented one canonical repository per shared GPU device and was independent of canvases. This was a sound direction: document resources should outlive presentation surfaces and should not be owned by React mounts.

The renderer and compositor already supported sophisticated content and broad GPU processing. This is difficult domain work worth retaining.

### Architectural conflict

`LayerDocumentRenderer` was called a renderer facade but also owned semantic operations involving selection, clipboard, masks and resource replacement. It retained detached runtimes for bounded history. It was therefore both projection infrastructure and part of the editing model.

This creates circular authority:

```text
document tells renderer what exists
renderer mutates resources that define what exists
history holds callbacks/resources from both
document then publishes a new snapshot
```

When an exception, unmount or document switch occurs between these steps, no individual participant can guarantee full rollback.

The correct target is not “put every GPU byte in React/document JSON.” It is:

- document model owns semantic identities and committed structure;
- resource repository owns opaque resources by stable IDs;
- renderer projects a supplied model/resource view;
- one transaction coordinator stages model and resource changes;
- commit publishes both; rollback releases staged resources;
- mounted canvas is presentation only.

## History and transactions

`DocumentCommandHistory` was already document-scoped, asynchronous and bounded to 100 entries and approximately 512 MB. It used generation guards and restored a stack node when a callback failed. It also acknowledged that GPU resources were renderer-owned and allowed commands to retain resource IDs and release callbacks.

This is better than a UI-local undo stack. However, callback-based history can only be atomic if every callback owns the full inverse of the operation. If the before/after document snapshot, GPU resource graph, selection mask and renderer cache are restored by separate mechanisms, a stack rollback does not imply application rollback.

The required invariant is:

> A history entry is committed only after all semantic and resource changes have succeeded, and undo/redo either applies the full state transition or leaves the previous state completely intact.

That invariant was not globally enforced in this snapshot.

## Merge, rasterize and flatten

Merge, rasterize and flatten are especially risky because they cross nearly every boundary:

- layer hierarchy and selection;
- source and destination resources;
- adjustments/effects/masks;
- text/vector/smart-like content finalization;
- thumbnails and caches;
- history retention;
- release of replaced resources.

The 26 August architecture did not have one capability/finalization registry proving how every layer type becomes pixels. Logic was distributed between layer commands, renderer/compositor methods and UI eligibility. That allows three classes of defect:

1. the UI hides an operation that the renderer supports;
2. the UI enables an operation whose finalizer cannot handle the layer;
3. the operation succeeds visually but loses effects, transforms, masks or undo resources.

A stable design needs one layer capability table and one finalization service used by menus, shortcuts, Actions, MCP and tests.

## Persistence, formats and hosts

The product already supported a broad format surface: PNG, JPEG, WebP, TIFF, SVG, PSD/PSB, PDF, the native layered format and recovery data. It also spanned desktop and web hosts, projects/assets, GenAI providers and MCP.

This breadth is commercially valuable but multiplies lifecycle states:

- decode/import creates document resources;
- open/close may be asynchronous;
- save/export needs a stable snapshot;
- recovery needs compact, durable previews and model data;
- desktop can use native clipboard/filesystem APIs;
- web needs permission-gated clipboard and download/file-handle behavior;
- project and non-project GenAI paths have different storage guarantees.

The format adapters are largely salvageable. The integration rule should be that adapters create or consume a canonical document DTO and never mutate the live renderer directly.

## Tests and observability

The snapshot had 655 test files and more than 72,000 physical test lines. That is substantial investment and demonstrates many locally specified behaviors.

It did not prove product coherence because most systemic failures are cross-boundary sequences:

```text
import -> select -> move -> copy -> paste -> transform -> effect
       -> rasterize -> merge -> undo -> redo -> save -> close -> reopen
```

Unit tests can all pass while the sequence fails if each component mocks the others or asserts only its local state. The answer is not indiscriminately more tests. It is a smaller set of architecture-contract tests and high-value scenario tests that assert document model, resource ownership, renderer output and history position together.

Needed observability includes operation IDs, document IDs, before/after revisions, staged/committed resource IDs, history entry IDs and explicit failure phases. Generic “undo did not complete” messages are insufficient for diagnosing ownership failures.

## Root causes of instability already present

1. **Split semantic authority.** Document, renderer, resources, tools and mounted command ports could all decide part of an edit.
2. **Transactions were partial.** Document publication and history grouping did not automatically cover GPU/resource side effects.
3. **Renderer was not a pure projection.** It performed editing operations and retained history resources.
4. **Command resolution was context-sensitive.** Mounted and canonical ports could be mixed per property while capability checks used a different rule.
5. **Tool lifecycles were conventions.** The full tool inventory did not implement one enforced session protocol.
6. **Layer finalization was distributed.** Merge/rasterize/flatten support was not described by one capability service.
7. **Large coordinators mixed concerns.** Several files combined UI state, policy, mutation and renderer control.
8. **Test volume exceeded architectural certainty.** Local behavior was well tested relative to end-to-end invariants.

## Risk assessment

| Area | Risk on 26 Aug | Reason |
|---|---|---|
| Document/model ownership | High | broad document state plus external semantic owners |
| Commands / Actions / MCP | High | mounted/canonical resolution ambiguity |
| Selection and clipboard | High | overlay, mask, GPU and history representations |
| Transform and warp | High | preview/finalization spread across controllers/renderers |
| Merge/rasterize/flatten | Critical | destructive cross-layer/resource transitions |
| Adjustments/effects/filters | Medium-high | good engines, inconsistent lifecycle integration |
| WebGPU resource lifetime | High | retained resources and detached runtimes cross history |
| File adapters | Medium | broad but comparatively bounded and salvageable |
| UI styling | Medium | local, duplicated primitives; not core state risk |
| GenAI/projects | Medium-high | host/storage/provider lifecycle breadth |

## What should be retained

- paint, vector, text, filter and PDF domain packages where their APIs are bounded;
- WebGPU kernels and compositor algorithms after resource-contract review;
- import/export adapters and native format schemas;
- the command ID/schema concept shared by UI, Actions and MCP;
- document-scoped history as a product concept;
- `DocumentSession` as the owner of canonical semantic state;
- stable resource IDs and a document-level resource repository;
- existing manual workflow knowledge and historical snapshots as behavioral oracles.

## What should be replaced or constrained

- property-level mixing of mounted and canonical command ports;
- renderer methods that both project and define semantic document state;
- history callbacks that rely on several independent rollback mechanisms;
- per-tool finalization conventions;
- distributed layer capability/rasterization checks;
- direct UI-to-renderer semantic mutations;
- mutation policy embedded in the largest React coordinators.

## Recommended recovery path from this snapshot

Do not restart the entire product and do not resume broad feature development. Build one bounded vertical-slice core around a representative workflow:

```text
open raster document
-> select pixels
-> move/copy/paste
-> transform
-> add effect
-> rasterize
-> merge
-> undo/redo every step
-> save/close/reopen
```

Before implementation, make these contracts executable:

1. one canonical document model and revision;
2. one operation transaction with stage/preview/commit/cancel;
3. one resource transaction tied to the operation;
4. a renderer that consumes an explicit projection snapshot;
5. history entries created only from committed transactions;
6. one command handler per semantic command, independent of host;
7. one layer capability/finalization registry;
8. failure injection at every commit phase.

Port only the vertical slice first. Compare its behavior against the 26 August, 2 September and current builds. If the slice is measurably stable and the migration cost is acceptable, migrate remaining tools by family. If it cannot be stabilized within a strict time box, stop before spending on a full rewrite.

## Final assessment

LightTable on 26 August was not a failed collection of code. It was an ambitious editor with valuable engines and a partially correct architecture whose integration contract was incomplete. The same incompleteness that later produced regressions was already visible here.

The snapshot is smaller and may feel better in selected workflows, but it does not justify a blind rollback. Its best use is to recover intended behavior and identify which later complexity was necessary. The economically rational path remains a bounded replacement of the transaction/render integration core while preserving the specialized engines, formats and product surface that already work.
