# Editor Transaction and Rendering Stabilization Plan

Status: active stabilization program
Scope: feature-freeze work for the LightTable image editor  
Audience: maintainers working on tools, selection, layers, history, commands and WebGPU  

## Purpose

LightTable has strong individual subsystems, but ordinary editor workflows can still leave the application in contradictory states. These defects are not adequately described as isolated tool bugs. They occur where a single user action crosses several owners:

- canonical `ImageDocument` state;
- renderer and WebGPU resources;
- selection operations, geometry and GPU mask;
- transient tool state;
- document history;
- command, Action and MCP execution;
- React presentation state.

The stabilization objective is to make one visible user action one coherent, recoverable operation across all of those owners.

This document is the working plan for escaping the current bug-fix loop. It does not authorize new editor features or visual redesign work.

## Executive conclusion

The central defect is shared transaction ownership.

Today an operation can follow a sequence such as:

```text
pointer or command
  -> mutate GPU resource
  -> publish canonical document
  -> update selection runtime
  -> register history entry
  -> report command success
```

If a later step fails, the earlier steps are not necessarily rolled back. Different tools also use different orders. The resulting document can look correct while its selection mask, history, renderer resources or command state already disagree.

The target architecture is:

```text
input
  -> operation transaction
       -> immutable baseline
       -> transient preview
       -> validate complete result
       -> atomic commit
            { document, GPU edit, selection, retained resources, history }
       -> or complete rollback
  -> publish success to UI, Actions and MCP
```

No operation may report success before the atomic commit has completed.

## Implemented stabilization slices

### Atomic fill and history transitions

The initial transaction slice now protects fill commits and history movement. A failed GPU edit, document publication or history transition restores the complete pre-operation state before the command completes.

### Document-owned exact selection state

Selection no longer treats the mounted tool or renderer as the durable owner. The ownership boundary is now:

- `DocumentEditorState` owns the committed selection operations and an immutable, document-sized `r16float` mask snapshot;
- the active selection tool owns only an unfinished pointer, paint, polygon or translation gesture;
- the renderer owns the disposable GPU projection and restores it from document state after bind, load and tab return;
- selection history stores exact before/after masks, while semantic operations remain provenance for Actions, MCP and legacy reconstruction.

Selection mutations are serialized per controller. Each successful mutation captures its exact result, registers history and then publishes document state. Failure restores the exact baseline. Magic Wand requests have generation-based cancellation and preserve separate history entries even when clicks arrive faster than GPU completion.

The canonical mask is read and restored as raw IEEE-754 half-float words. Clipboard mask export now also reads the actual `r16float` texture instead of interpreting its bytes as an `r8unorm` channel.

Verification for this slice currently covers exact snapshot encoding, half-float readback, selection clipboard conversion, semantic selection commands, rapid asynchronous Magic Wand operations, cancel/rollback, selection movement and exact undo/redo. The broader product acceptance matrix still requires manual GPU runs on Windows and macOS.

### Document-owned text gesture commits

Text-layer movement, paragraph-frame resizing and path-text handle editing now keep their pointer-rate state outside the canonical document. Every move projects an immutable preview from the opening document snapshot directly to the renderer. Pointer-up validates that the canonical document still has the opening identity and revision, publishes one final document snapshot and records one history transition. Cancel, document replacement and unmount discard only the renderer preview.

This removes intermediate text geometry from document subscribers, autosave and history, and prevents a stale gesture from overwriting a document that changed while the pointer was active.

### Transactional raster paint preparation

Painting a compact or transformed raster requires a document-sized GPU surface, but that materialization is now staged outside canonical document state. The renderer receives the prepared geometry as a projection while the document session retains the opening snapshot and revision. A successful stroke adopts the surface swap and pixel edit into one history entry and publishes one final document snapshot. Cancel, initialization failure, empty strokes and stale-document completion restore both GPU edits and discard the projected geometry without publishing a compensating document revision.

### Document-leased fill and raster gradient

Fill and raster-gradient commands now acquire the same document-owned mutation lease used by the stabilized gesture controllers. The lease fixes the document identity and revision before the renderer is changed. The resulting GPU edit and immutable document snapshot are then transferred together to the existing reversible pixel-history entry. A rejected, stale or superseded operation rolls the GPU edit back and destroys it instead of leaving pixels outside canonical history.

This adds no pixel copy, readback or render pass. The transaction retains document snapshot references and performs ownership and revision checks; GPU storage and history retention remain in the existing pixel-edit implementation.

### Unified Face Warp publication

Interactive Face Warp drags, option changes and accepted detections already project through a document-owned transaction. The semantic `faceWarp.applyOperation` route now uses that same document mutation controller instead of applying a snapshot and appending history as two independent writes. UI, Actions and command transports can therefore no longer bypass an active document lease or publish Face Warp state outside the canonical undo boundary.

This changes only mutation ownership. Face detection, mesh evaluation and rendering are untouched, and no additional frame work, image allocation or GPU pass is introduced.

### Tool-family ownership status

The migration is deliberately audited by interaction family rather than by toolbar icon. Several icons share one controller, while one visible tool can cross multiple mutation owners.

| Family | Current document boundary | Status |
| --- | --- | --- |
| View and Zoom | Presentation only; must never create document history | Explicitly excluded |
| Transform | Document lease plus compound document/GPU/selection commit | Migrated; broader workflow verification remains |
| Raster paint, erase, heal, clone, dodge, burn and sponge | Shared paint-session document lease and reversible GPU edit | Migrated |
| Fill and raster Gradient | Discrete/gesture document lease plus reversible GPU edit | Migrated |
| Pen, shape, vector selection and vector Gradient | Shared vector-gesture document lease | Migrated |
| Warp | Document lease plus reversible GPU edit | Migrated |
| Face Warp | Document transaction for UI gestures, option changes and semantic commands | Migrated; detector/recovery workflow verification remains |
| Marquee, lasso, Magic Wand, object selection and selection brush | Document-owned exact mask snapshots and serialized selection history | Partial: exact selection ownership is stabilized; cross-owner command/undo integration still needs audit |
| Point, paragraph, vertical and path text | Move, resize and handle gestures use document leases | Partial: typing, conversion and recovery paths still need audit |
| Layer mutations, merge, rasterize and flatten | Mixed direct document/history and compound GPU paths | Migration pending |
| Adjustments, effects and filters | Shared preview controller for the migrated adjustment paths | Partial: every effect/filter commit and resource cleanup still needs an inventory |

This table is the completion ledger. A family is not considered stable merely because its primary pointer gesture uses the transaction controller; semantic commands, Actions/MCP execution, cancel, document switch, undo/redo and renderer recovery must reach the same boundary as well.

## Existing architectural contracts

The intended system is already documented in:

- [DOCUMENT_AND_SCENE_MODEL.md](./DOCUMENT_AND_SCENE_MODEL.md)
- [INPUT_TOOLS_AND_HISTORY.md](./INPUT_TOOLS_AND_HISTORY.md)
- [RENDERING_AND_PROCESSING.md](./RENDERING_AND_PROCESSING.md)
- [SYSTEM_MAP.md](./SYSTEM_MAP.md)
- [PERFORMANCE_CONTRACT.md](./PERFORMANCE_CONTRACT.md)

The important existing rules are:

1. `ImageDocument` is canonical document state.
2. `DocumentSession` owns document-scoped state and history.
3. The renderer is a disposable projection, not a second document model.
4. Pointer preview is transient; pointer completion produces one command.
5. Selection uses document-space coordinates.
6. Rasterize, merge and flatten bake the complete visible result.
7. Actions and MCP use the same semantic commands as the UI.

The repair should enforce these rules, not introduce a competing architecture.

## Non-negotiable invariants

### Operation invariants

1. One user gesture produces at most one history entry.
2. A preview never becomes canonical merely because a component unmounts or a timer expires.
3. Commit either changes every required owner or changes none of them.
4. Cancel restores the operation baseline without overwriting unrelated later state.
5. An operation reports success only after the renderer and canonical state agree.
6. Undo and redo are themselves atomic operations.
7. Failure leaves a document usable and in a known state.

### Selection invariants

1. The marching ants, bounds, Copy/Cut result and paint clipping describe the same mask.
2. Moving a selection updates the mask and its geometry together.
3. No visible selection means paint receives the all-selected identity mask, not a stale previous texture.
4. Undo restores an immutable selection result, not a recipe that may depend on obsolete document pixels.
5. A document revision change does not silently invalidate selection history.

### Transform invariants

1. Every preview in a transform session samples the same immutable source.
2. Pointer-up may checkpoint the session but must not bake and restart it without an explicit reason.
3. Repeated transforms inside one active operation do not progressively resample pixels.
4. Snap targets exclude the transformed content itself.
5. A retained snap target remains active until the release threshold is crossed.

### Rendering invariants

1. `ready` means the correct document has presented at least one frame.
2. The previous valid frame remains visible until its replacement is presentation-ready.
3. A failed preview can always be replaced by the canonical projection.
4. Device-loss recovery cannot reuse stale document or selection resources.
5. GPU memory telemetry includes persistent, history-retained and transient resources.

### Command invariants

1. Command support is explicit and fail-closed.
2. UI, Actions and MCP resolve the same semantic command implementation.
3. A command cannot be advertised merely because a renderer is mounted.
4. Asynchronous commands remain pending until their durable result is committed.

## Audit findings

### History does not provide rollback

`DocumentCommandHistory` serializes undo and redo. When a callback throws, it restores the history node but cannot restore mutations the callback already made.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/commands/documentCommandHistory.ts`

Impact:

- a GPU edit may be undone while the document snapshot is not;
- a document snapshot may be restored while the pixel edit fails;
- selection restore may clear the current selection before replay fails;
- the history UI can still contain a command whose state transition only partly occurred.

Required change:

- history must execute a reversible operation transaction rather than arbitrary multi-step callbacks;
- partial failure must invoke rollback before the history cursor changes;
- rollback failure must quarantine the document and preserve recovery evidence rather than continue silently.

### Selection has multiple authorities

Selection currently spans a canonical operation recipe, selection geometry, renderer state and a GPU mask. History can reconstruct a selection by replaying operations against a document revision. That reconstruction is unsafe after document content changes.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/tools/selection/useSelectionSessionController.ts`
- `packages/lighttable-app/src/lighttable/gpu/WebGpuEngine.ts`

Observed failure class:

- moved marching ants but Copy uses the old region;
- Invert affects only a previous or partial region;
- brush strokes remain clipped when no selection appears active;
- undo reports that the selection could not be restored.

Required change:

- make an immutable selection snapshot the history payload;
- restore mask and geometry through one awaited operation;
- keep the recipe only as optional provenance, never as the sole undo representation;
- publish canonical selection state only after the GPU restore succeeds;
- replace the GPU selection texture with the identity texture immediately on deselect.

### Transform session lifetime is unstable

The transform rasterizer correctly uses an immutable source texture while one session remains alive. Progressive degradation therefore indicates that the session is being committed, discarded or reconstructed between related gestures.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/tools/transform/useTransformSessionController.ts`
- `packages/lighttable-app/src/lighttable/editor/tools/transform/TransformOverlay.tsx`

Required change:

- add development-only lifecycle tracing with document id, layer id, generation and termination reason;
- define the exact events that may finish a session;
- treat pointer-up as a checkpoint when the user remains in Transform on the same target;
- prevent preview publications from looking like an external document replacement;
- retain the original source until explicit commit, tool exit, target exit or cancel.

### Transform snapping does not retain its target

The snap engine supports retained matches and a release tolerance, but Transform translation does not consistently pass that state back into subsequent evaluations.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/tools/snapping/snapEngine.ts`
- `packages/lighttable-app/src/lighttable/editor/tools/transform/TransformOverlay.tsx`

Impact:

- edge, center and corner candidates can alternate on adjacent pointer events;
- pixel rounding can amplify the visible jump;
- the object appears to fight itself or return toward a previous position.

Required change:

- retain one match per axis for the duration of a drag;
- release only outside the larger release threshold;
- calculate every candidate from the immutable drag baseline;
- apply pixel rounding once, after snapping;
- exclude self and selected descendants from the target set;
- remove modifier-key snap bypass from the transform calculation when snapping is controlled elsewhere in the UI.

### Preview ownership is inconsistent

Several controllers use canonical document publication as their live preview mechanism. Examples include filters, warp, linked masks, group transforms and some text/vector gestures.

Impact:

- cancellation restores an old whole-document snapshot and can overwrite unrelated state;
- unmount can accidentally commit a preview;
- document listeners interpret a preview as a durable edit;
- transform sessions can restart because their document dependency changed;
- Actions/history can observe a state transition that was never formally committed.

Required change:

- add a renderer-facing preview projection owned by the operation transaction;
- canonical `ImageDocument` publication happens only during commit;
- cancel republishes the current canonical projection, not an arbitrarily captured stale document;
- target changes cancel unless the user explicitly completed the interaction.

### Adjustment preview discard is incomplete

`discardAdjustmentPreview()` clears its local preview reference but does not republish the canonical document to the renderer.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/documents/documentProjectionController.ts`

Required change:

- discard must actively restore the canonical renderer projection;
- pointer capture loss, Escape, target change and panel unmount must select commit or cancel explicitly;
- no timer may decide whether a preview becomes history.

### Layer effects use elapsed time as a commit boundary

Layer style editing uses throttling and an inactivity checkpoint. A pause during one drag can therefore divide the gesture into several history entries.

Required change:

- propagate slider interaction start, preview and end from the UI package;
- begin the effect transaction on interaction start;
- preview at the requested frame/update rate;
- commit exactly once on interaction end;
- use an inactivity timeout only as crash/lost-capture recovery, not normal history behavior.

### Filters blur product maturity and transaction state

`ACTIVE_FILTER_PACKS` enables stable P0, preview P1 and experimental P2 together. The renderer constructs extension executors as part of the same filter system.

Relevant implementation:

- `packages/filter-core/src/filterCatalog.ts`
- `packages/lighttable-app/src/lighttable/gpu/P0FilterRenderer.ts`

Required change:

- ship P0 by default;
- admit P1/P2 only through an explicit product/developer gate;
- rename the all-filter controller and renderer so their ownership is honest;
- enforce `alphaBehavior` and `coordinateSpace` centrally where possible;
- include executor-specific buffers and transient targets in memory estimates;
- cancel, rather than finish, a transient slider operation during unrelated unmount or target replacement.

### Merge, rasterize and flatten are not transactional

The structural planning is generally correct: sources are validated, a destination runtime is reserved, compositing bakes effects/masks/transforms and the result document is produced. The publication sequence is not protected by one rollback owner.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/layers/useLayerDocumentCommands.ts`
- raster document operations under `packages/lighttable-app/src/lighttable/application/layers/`

Required change:

- reserve destination resources inside the operation transaction;
- publish the new document only after compositing succeeds;
- retain source and destination resources until the history entry is durably registered;
- on rollback restore both document and runtime-resource ownership;
- verify merge with masks, clipping, transforms, adjustments and layer effects;
- make text rasterization use the same transaction ordering as generic rasterization.

### Paint always consumes a selection texture

Paint shaders multiply strokes by a selection texture. The intended no-selection texture is white. If selection UI state and the bound texture diverge, painting remains restricted to an invisible old region.

Required change:

- bind selection by transaction generation, not by an independently mutable renderer field;
- assert that `selection.active === false` implies the identity texture is bound;
- invalidate paint bindings immediately after select, deselect, document switch and selection undo;
- preserve compact-raster promotion and paint in the same history transaction.

### Async selection commands report success too early

The pointer Magic Wand route can start asynchronous GPU work and return success before the mask result is complete. Object selection has a more appropriate awaited lifecycle.

Required change:

- command completion must await the applied selection snapshot;
- stale request generations must resolve as canceled, not successful;
- Actions and MCP must record/reply only after commit.

### Document open settles before presentation

Document open marks the renderer ready after hydration. `onSettled` hides loading independently of `onFirstFrame`.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/documents/documentOpenController.ts`
- `packages/lighttable-app/src/lighttable/editor/documents/createDocumentRendererLifecycleBridge.ts`

Impact:

- black or empty document until resize;
- stale document frame during tab/workspace transition;
- empty recent-file or document previews;
- loading UI disappears before useful pixels exist.

Required change:

- distinguish `hydrated`, `renderer-ready` and `presented` states;
- keep loading active until the current generation presents its first frame;
- retain the previous valid surface until then;
- never let a stale renderer generation complete the new generation;
- start deferred scopes only after presentation without blocking it.

### Command capability resolution is fail-open

When mounted ports do not implement `supportsCommand`, the registry currently treats every command as supported.

Relevant implementation:

- `packages/lighttable-app/src/lighttable/application/commands/lightTableCommandPortRegistry.ts`

Impact:

- menus can enable commands that later do nothing or throw;
- Actions can record commands unavailable in playback context;
- MCP can advertise operations that need mounted presentation state;
- property-level fallback can mix mounted and canonical owners.

Required change:

- default unsupported, never supported;
- publish an explicit capability set per document and owner;
- resolve a complete command handler from one owner;
- reject mixed-owner command construction;
- use the same capability snapshot for menus, Actions and MCP.

### Pointer routing is a high-coupling seam

`useViewportInteractionController.ts` coordinates selection, paint, text, transform, vector tools, temporary eyedropper behavior, viewport navigation and modifier interpretation.

This is not automatically wrong, but it makes global input regressions likely because unrelated tool branches share capture, cancel and modifier handling.

Required change after P0 stabilization:

- keep one input coordinator;
- move each tool family behind a small gesture adapter with the same lifecycle;
- let the coordinator own capture and routing only;
- let the operation transaction own preview/commit/cancel;
- avoid another large rewrite until the invariants above have executable coverage.

## Stabilization phases

### Phase 0 — Freeze and observability

Objective: make failures diagnosable without changing behavior.

Work:

- retain the feature freeze;
- add development-only operation ids and generations;
- trace begin, preview, checkpoint, commit, cancel, rollback and disposal;
- record owner changes for document, selection texture and transform source;
- attach a termination reason to every transform and paint session;
- expose first-frame generation and renderer generation in diagnostics;
- never include this telemetry in normal release bundles.

Exit criteria:

- every reproduced selection, transform, merge and open failure identifies the transition where owners diverged.

### Phase 1 — Operation transaction primitive

Objective: introduce one reusable lifecycle without migrating every tool at once.

The primitive must own:

- immutable baseline references;
- transient renderer preview;
- reserved GPU resources;
- optional reversible pixel edit;
- optional selection snapshot;
- next canonical document;
- history metadata and retained resource ids;
- commit and rollback state machine.

State model:

```text
idle
  -> previewing
       -> committing -> committed
       -> canceling  -> canceled
       -> failing    -> rolling-back -> failed-safe
```

Illegal transitions must fail in development builds.

Exit criteria:

- a synthetic failure can be injected after each commit step;
- every injection restores the complete baseline;
- history cursor changes only after successful commit/undo/redo.

### Phase 2 — Selection unification

Objective: make visible selection and effective selection identical.

Migration order:

1. Deselect and selection restore.
2. Marquee/lasso movement and keyboard nudging.
3. Copy, Cut, Paste and Invert selection-dependent paths.
4. Paint selection binding.
5. Magic Wand and Selection Brush.
6. Object Selection and alpha-mask loading.

Exit criteria:

- all selection acceptance workflows pass after document edits and undo/redo;
- no restore depends exclusively on replaying obsolete source pixels.

### Phase 3 — Transform and snapping

Objective: preserve source quality and stable interaction.

Work:

- eliminate unintended session restarts;
- separate checkpoint from commit;
- use retained snap matches per axis;
- remove self targets;
- settle selection transforms and regular layer transforms through the same transaction contract;
- preserve compact raster data until an explicit materialization is needed.

Exit criteria:

- repeated resize/move/rotate within one tool session matches a single equivalent transform;
- corner dragging never changes size because of translation snapping;
- no target oscillation within the release threshold.

### Phase 4 — Merge, rasterize, flatten and pixel tools

Objective: migrate destructive GPU operations to atomic history.

Migration order:

1. Generic rasterize.
2. Text/vector/adjustment rasterize.
3. Merge down and merge selected.
4. Flatten.
5. Fill and raster gradient.
6. Brush, Erase, Clone, Heal, Dodge, Burn and Sponge.

Exit criteria:

- failure injection at every stage leaves no partial document;
- undo/redo repeats reliably through at least twenty cycles;
- GPU resource counts return to baseline after history eviction and document close.

### Phase 5 — Adjustments, effects and filters

Objective: one preview contract for all parameter-driven processing.

Work:

- use start/preview/end interaction events;
- remove wall-clock commit boundaries;
- restore canonical projection on cancel;
- product-gate filter maturity packs;
- complete alpha, coordinate-space and memory contracts.

Exit criteria:

- Escape, lost capture, panel switch and layer switch have deterministic outcomes;
- one slider gesture equals one history entry;
- cancel never changes the saved document revision.

### Phase 6 — Presentation and WebGPU lifecycle

Objective: eliminate black, stale and premature-ready states.

Work:

- split hydration readiness from presentation readiness;
- wait for current-generation first frame;
- keep the last valid frame during replacement;
- audit pipeline creation on the first-image path;
- keep specialized pipelines lazy and device-cached;
- verify device-loss recovery against canonical snapshots;
- include all filter and retained history resources in telemetry.

Exit criteria:

- PNG, JPEG, WebP, TIFF and PSD show the correct first frame without resize;
- rapid tab/workspace changes never present another document;
- device recovery either restores the correct document or fails closed with recovery guidance.

### Phase 7 — Command, Actions and MCP parity

Objective: expose only commands that are genuinely executable through one semantic route.

Work:

- replace fail-open capability detection;
- require one owner per command execution;
- await asynchronous command completion;
- compare UI, Action and MCP result snapshots;
- keep presentation-only tools explicitly excluded.

Exit criteria:

- command listings match the active document context;
- unavailable operations are disabled with a reason;
- route-equivalence checks compare final document, selection and history state.

### Phase 8 — Decompose the input coordinator

Objective: reduce future regression surface after behavior is stable.

This phase is deliberately last. Splitting the pointer router before transaction behavior is fixed would distribute the same ambiguity over more files.

## Acceptance workflow matrix

These are product workflows, not isolated implementation-unit tests.

### Selection and clipboard

1. Draw marquee, nudge it, Shift-nudge it, Copy, Paste and Invert.
2. Move selected pixels, then continue nudging without holding the primary modifier.
3. Deselect and paint anywhere on the active raster layer.
4. Undo and redo the complete sequence repeatedly.
5. Load selection from raster alpha, text alpha and mask alpha.
6. Repeat after switching documents and returning.

Expected invariant: overlay, copied pixels, paint clipping and restored selection remain identical.

### Transform

1. Paste a selection as a compact raster layer.
2. Move, scale, rotate and move again without leaving Transform.
3. Compare against one equivalent final transform.
4. Drag through edge, center and corner snap targets slowly.
5. Repeat with mask, linked mask, group and layer effects.

Expected invariant: no progressive quality loss, snap oscillation or unexpected rasterization.

### Layer stack

1. Merge a transformed layer with a masked/effected layer below.
2. Undo and redo repeatedly.
3. Rasterize text, vector, adjustment and placed raster layers.
4. Flatten documents containing groups, clipping, masks and global adjustments.
5. Close and reopen the saved result.

Expected invariant: render before/after the structural operation matches, and every undo state remains usable.

### Adjustments and effects

1. Drag a parameter continuously, pause during the drag, then release.
2. Cancel with Escape.
3. Lose pointer capture.
4. Switch layer or document mid-preview.
5. Undo and redo.

Expected invariant: one explicit commit or a complete cancel; never a timer-defined partial commit.

### Rendering and open

1. Cold-open PNG, JPEG, WebP, TIFF and PSD.
2. Open via File, drag/drop, OS Open With and recent files.
3. Switch workspace during loading.
4. Rapidly switch document tabs.
5. Trigger controlled device-loss recovery in an instrumented build.

Expected invariant: no black frame, stale document, resize dependency or false-ready status.

### UI, Actions and MCP equivalence

For each admitted semantic command:

1. Execute through UI.
2. Execute from an Action.
3. Execute through MCP.
4. Compare canonical document, selection, history metadata and rendered output.

Expected invariant: all admitted routes have the same final state or the same explicit rejection.

## Testing strategy

The current targeted unit suites are useful but insufficient. During the audit, the existing suites for history, selection, layer commands, open lifecycle, renderer lifecycle and snapping all passed: 122 tests total. The known failures live between those owners.

Testing should therefore emphasize invariants and controlled failure points rather than simply adding more local coverage.

Required layers:

1. Pure state-machine tests for legal operation transitions.
2. Failure-injection tests after each transaction step.
3. Cross-owner integration tests using a deterministic fake renderer.
4. Real WebGPU acceptance runs for a small set of representative workflows.
5. Visual comparisons only where pixel output is the contract.
6. Bounded resource accounting after close, history eviction and device replacement.

Avoid:

- large volumes of tests that repeat implementation details;
- mocks that automatically succeed and therefore conceal ordering defects;
- accepting a command because it did not throw;
- treating a rendered screenshot as proof that canonical state and undo are correct.

## Memory and resource verification

For every migrated operation, record:

- persistent texture and buffer count before begin;
- transient peak during preview;
- retained history resources after commit;
- counts after undo and redo;
- counts after history eviction;
- counts after document close;
- counts after renderer/device replacement.

The expected endpoint after history eviction and document close is the renderer baseline. Deviations must identify the owning operation id and resource id.

Memory telemetry must include:

- filter extension buffers;
- pooled targets;
- selection snapshots;
- transform source/preview textures;
- merge/raster destinations;
- history-retained resources;
- deferred submission resources.

## Implementation guardrails

During this program:

- do not add editor features;
- do not redesign unrelated UI;
- do not create alternate command routes;
- do not repair a workflow by special-casing one tool in the central pointer router;
- do not publish canonical state merely to update a preview;
- do not use inactivity timers as ordinary commit semantics;
- do not report asynchronous work as successful before commit;
- do not make capability checks default to true;
- do not change pixel formats or memory budgets as an incidental fix;
- do not rewrite functioning subsystems without a failing invariant that requires it;
- do not commit generated artifacts or development telemetry into release builds.

Every change must state:

1. Which invariant was violated.
2. Which owner previously changed out of order.
3. What the new atomic boundary is.
4. How cancellation behaves.
5. How undo and redo behave.
6. Which acceptance workflow proves it.
7. What resource lifetime changed.

## Recommended first implementation slice

The first slice should be deliberately narrow:

1. Add operation lifecycle diagnostics.
2. Implement the transaction state machine behind an internal interface.
3. Migrate selection deselect/restore.
4. Migrate one simple GPU operation such as Fill.
5. Add failure injection between GPU edit, document publication and history registration.
6. Confirm complete rollback.

Do not start with Transform, Merge or all tools simultaneously. The primitive should first prove itself on one selection operation and one pixel operation. Once the ownership model survives those two different cases, migrate the complex systems.

## Definition of stabilized

The editor stabilization phase is complete only when:

- all invariants in this document are enforced or explicitly gated;
- no known tool can leave renderer, document, selection and history disagreeing;
- repeated Transform operations do not progressively degrade content;
- selection-dependent Copy, Paint and Invert always use the visible selection;
- merge, rasterize and flatten survive repeated undo/redo;
- document open cannot become ready before the correct first frame;
- command capabilities are explicit and route-equivalent;
- resource accounting returns to baseline after eviction and close;
- the acceptance matrix passes on Windows and macOS for desktop and applicable web workflows;
- unresolved user-choice issues are documented separately rather than hidden by fallback behavior.

Only after this point should the feature freeze be reconsidered.
