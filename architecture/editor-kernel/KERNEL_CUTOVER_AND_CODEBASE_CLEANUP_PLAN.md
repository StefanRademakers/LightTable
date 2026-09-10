# Editor-kernel cut-over and codebase cleanup

Status: **active execution authority**. Started 2026-09-10.

This plan closes the editor-kernel transition. It replaces the incremental
rule that kept a complete legacy route beside an accepted kernel route. The
required result is one maintainable production architecture that can be tested
without ambiguity.

Feature work continues after this plan. Completion therefore means future work
has one obvious extension path and cannot accidentally revive an older state,
history or renderer owner.

## Final state

- Production code has exactly one mutation route for every supported editor
  operation: semantic command -> kernel lifecycle -> canonical document/history
  -> renderer/resource projections.
- React owns UI and event adaptation only. It does not own committed document
  meaning, history publication, GPU recovery or terminal mutation policy.
- No migration switch, optional kernel mutation port, controller-owned mutation
  fallback, legacy history publication or renderer-as-document-truth route
  remains.
- Unsupported operations fail closed with a typed capability result. They do
  not fall back to an older implementation.
- Product degradations such as font substitution, format recovery or
  Vello-to-native rendering may remain only when explicitly named, tested and
  incapable of publishing document/history state.
- Large integration roots are composition facades. Extracted modules have one
  owner and one lifetime; cleanup may not create a replacement god object.
- Canonical documentation describes only the resulting system. Superseded
  migration ledgers, stale status claims and obsolete agent rules are removed
  after their still-useful facts have been consolidated.

## Classification

**Migration fallback** is an executable route that can substitute an older
owner for a kernel command, preview, commit, history, rollback, projection or
resource lifecycle. It must be deleted.

**Product degradation** is an intentional lower-capability result inside the
same owner and lifecycle. It may remain only if it cannot become an alternate
mutation authority.

**Route proof** is executable evidence that the expected kernel route ran and
no alternate route was available. Output-only equivalence is insufficient.

## Mandatory loop for every item

Every C01-C13 item uses this exact loop. Check a box only against current
source, never because an earlier migration report claimed it.

### 1. Inventory and delete the second route

- [ ] List every UI, shortcut, Action and MCP entry point.
- [ ] Map command, preview, canonical state, history, projection, resources,
      rollback, cleanup and rebind owners.
- [ ] Classify every fallback, compatibility branch, optional port, feature
      switch and direct mutation as migration, product degradation or dead code.
- [ ] Make kernel mutation ports required and remove alternate callers,
      implementations, tests, comments and types.
- [ ] Convert genuinely unsupported cases to an explicit fail-closed capability.
- [ ] Record allowed product degradations with their non-mutation invariant.

### 2. Reduce ownership concentration

- [ ] Remove at least one named non-composition responsibility from every
      touched hotspot.
- [ ] Keep algorithms in domain packages and lifecycle coordination in small
      kernel/application owners.
- [ ] Do not pass broad bags of mutable refs or expose an unbounded facade.
- [ ] Record before/after line counts and the authority that moved.
- [ ] New production modules target <=350 lines; at 500 lines a decomposition
      decision is mandatory; the kernel ceiling remains 800.

### 3. Focused proof

- [ ] Add a route witness or boundary assertion proving the exclusive kernel
      handler, including UI, shortcut, Action and MCP where supported.
- [ ] Test commit, cancel, undo, redo, failure compensation, stale generation,
      document switch and resource cleanup for the slice.
- [ ] Run touched-package typecheck, boundary checks and focused tests while
      iterating.
- [ ] Measure the relevant pointer/preview hot path and terminal latency; a
      repeatable >10% regression blocks acceptance.
- [ ] Run the slice's packaged debug and instrumented browser scenario.

### 4. Independent critic and repair

- [ ] A separate read-only senior architecture critic examines ownership,
      failure paths, performance and remaining alternate routes.
- [ ] Evaluate findings against code and contracts; never apply mechanically.
- [ ] Repair round 1 closes every accepted P0/P1 and reruns focused proof.
- [ ] The critic reviews the resulting implementation again.
- [ ] Repair round 2 closes every remaining accepted P0/P1 and reruns proof.
- [ ] A P0/P1 remaining after round 2 blocks the item.

### 5. Close the item

- [ ] Search production, tests and active docs again for the removed route.
- [ ] Record code delta, proof, critic verdict and allowed degradations here.
- [ ] Commit one cohesive cut-over milestone without unrelated feature work.

## Ordered checklist

Order follows shared-state dependencies. A later item may be inventoried early
but cannot inherit another item's acceptance.

| ID | Kernel item | State | Exclusive route | Focused proof | Critic x2 | Hotspot reduced |
| --- | --- | --- | --- | --- | --- | --- |
| C00 | Governance, route inventory and machine guard | implementation | [ ] | [ ] | [ ] | n/a |
| C01 | Selection/marquee, selection paint, mask projection and consumers | accepted | [x] | [x] | [x] | [x] |
| C02 | Layer finalization: rasterize, merge and flatten | accepted | [x] | [x] | [x] | [x] |
| C03 | Layer masks, mask edits and Remove Background result insertion | accepted | [x] | [x] | [x] | [x] |
| C04 | Raster paint, fill/gradient and clipboard pixel consumers | accepted | [x] | [x] | [x] | [x] |
| C05 | Transform, selected-pixel movement, snapping and edge-pan | accepted | [x] | [x] | [x] | [x] |
| C06 | Vector paths, Pen, live shapes and vector gradients | queued | [ ] | [ ] | [ ] | [ ] |
| C07 | Text, Path Text, layout/editing and semantic text transform | queued | [ ] | [ ] | [ ] | [ ] |
| C08 | Raster Warp, Face Warp and imported Text Warp projection | queued | [ ] | [ ] | [ ] | [ ] |
| C09 | Adjustment layers and attached adjustments | queued | [ ] | [ ] | [ ] | [ ] |
| C10 | Layer styles/effects and filter lifecycle | queued | [ ] | [ ] | [ ] | [ ] |
| C11 | Document geometry, I/O, recovery and view lifecycle | queued | [ ] | [ ] | [ ] | [ ] |
| C12 | Shared history, command routing, Actions and MCP equivalence | queued | [ ] | [ ] | [ ] | [ ] |
| C13 | WebGPU/render projection, device loss and resource lifetime | queued | [ ] | [ ] | [ ] | [ ] |
| C14 | Integration-root decomposition, docs purge and final proof | queued | [ ] | [ ] | [ ] | [ ] |

## C00 -- prevent architectural relapse

- [ ] Create a machine-readable command/route inventory naming each production
      semantic command's sole owner and supported origins.
- [ ] Add a boundary audit rejecting optional kernel mutation ports, production
      migration switches and known direct legacy publishers.
- [ ] Maintain an explicit allowlist for product degradations; every entry names
      its owner, reason, test and proof that it cannot mutate document/history.
- [ ] Make CI fail when a removed legacy module/import or forbidden authority
      returns.
- [ ] Reconcile onboarding, kernel README and change rules with physical cut-over.

## C01 acceptance record -- 2026-09-10

1. **Done** -- rectangle/ellipse/freehand/polygon selection, translation and
   nudge, selection paint, Magic Wand, Object Selection, Select Similar,
   channel/mask/transparency sources and modify/clear/invert operations commit
   through required kernel ports. Exact Snapshot, bounds, provenance and
   revision are one document-session value. Paint preview uses detached GPU
   targets and cannot mutate committed coverage before CAS activation.
2. **Deleted** -- controller-owned renderer/history commit fallbacks and the
   public direct committed selection mutation surface on `WebGpuEngine` and
   `LayerDocumentRenderer`. Semantic hit-test replay and the obsolete direct
   selection-transform test were removed. Boundary verification rejects their
   return.
3. **Ownership** -- `useSelectionSessionController.ts` reduced from 1,636 to
   1,238 lines and now adapts interaction only; `WebGpuEngine.ts` reduced from
   4,395 to 4,078 lines and no longer implements committed selection commands.
   Atomic prepare/CAS/activation/history lives in the editor kernel plus
   `SelectionShapeCommandService`; exact GPU preparation lives in
   `SelectionShapeProjectionService`. The latter is 495 lines after cleanup;
   its single stage-pool responsibility remains intact and will be reassessed
   during C13/C14 facade decomposition rather than split into coupled wrappers.
4. **Proof** -- editor-kernel 13/13; focused selection 49/49; app typecheck;
   boundary and architecture-document audits; instrumented desktop package;
   packaged selection-kernel smoke covering edge excursions and return,
   copy/paint bounds, exact paint-only drag, undo/redo, keyboard nudge and
   multi-document rebind. Every projection derives bounds from its one exact
   R16 snapshot, removing the second GPU readback.
5. **Critic** -- round 1 found provenance capability gates, incomplete gesture
   binding, committed paint preview and duplicate bounds readback. Round 2 found
   preview retirement gaps. Both repair rounds were applied; final independent
   verdict: **ACCEPT**, no C01 P0/P1.
6. **Open** -- transform and document-geometry compound publications still use
   temporary direct exact snapshot restore and are explicitly owned by C05 and
   C11. Broader UI enablement checks based on provenance length move with their
   command consumers in C12/C14. Neither is a selection-controller fallback.
7. **Next** -- C02 layer finalization: rasterize, merge and flatten.

## C02 acceptance record -- 2026-09-10

1. **Done** -- panel, menu, Ctrl/Cmd+E, Actions and MCP finalization converge
   through the semantic command service and required `*WhenReady` application
   ports. Rasterize, merge, group flatten, image flatten and Shape Pixels mode
   wait for CPU-side text/style/adjustment sources, revalidate document and
   renderer identity, then create one fresh raster and one durable history
   transition. Document-contextual eligibility rejects pass-through groups
   whose isolated render would depend on an external backdrop.
2. **Deleted** -- the Layers-panel direct rasterize fallback and the public
   pre-readiness `mergeSelectedLayers`, `mergeActiveLayerDown`, `flatten`,
   `rasterizeLayer` and `rasterizeActiveLayer` command surface. Optional text
   readiness and optional flatten processing publishers were made required.
   Boundary verification rejects return of these seams and requires Pixels-mode
   readiness plus the single raster-finalization transaction owner.
3. **Ownership** -- history admission now has an explicit reservation and the
   raster publication/compensation lifecycle moved from
   `useLayerDocumentCommands.ts` (1,726 -> 1,680 lines) into
   `rasterFinalizationTransaction.ts` (116 lines). The remaining controller is
   still above its intended adapter size and remains named C03/C04/C14 work;
   this slice did not hide it behind a replacement broad facade.
4. **Proof** -- 202 focused document, command, vector-session, capability and
   transaction tests; app typecheck; boundary verification; instrumented
   desktop package; packaged tight-raster merge smoke; packaged two-document
   layer merge matrix covering semantic rasterize, flatten-image, repeated
   merge-down and undo with visual RMSE checks. GPU-to-GPU finalization relies
   on submission ordering and adds no `queue.onSubmittedWorkDone()` stall.
5. **Critic** -- round 1 found contextual pass-through rasterization, a
   Shape-Pixels readiness bypass, public raw finalizers and an over-broad GPU
   synchronization barrier. Repair round 1 closed all four; independent final
   verdict: **ACCEPT**, no C02 P0/P1.
6. **Allowed/non-blocking** -- layer readiness currently prepares adjustment
   assets and style pipelines document-wide; target-ID scoping is a measured
   optimization, not an alternate authority. `text.rasterize` remains a public
   compatibility command converging on the same ready kernel and is reviewed
   with text command contracts in C07/C12. Clipboard/import publication remains
   separately owned until C04.
7. **Next** -- C03 layer masks, mask edits and Remove Background result
   insertion.

## C03 acceptance record -- 2026-09-10

1. **Done** -- Layers-panel, semantic command, Action and MCP mask operations
   converge on one required application route. Add from selection, invert,
   delete, apply and Remove Background reserve durable history before their
   first GPU mutation, then publish mask pixels and metadata atomically.
   Enable/link remain document-only commands. Loading a mask as selection uses
   the accepted C01 kernel and validates the monotone session address across
   renderer preparation.
2. **Deleted** -- direct mask mutations from `useLayerPanelController`, its
   optional semantic request ports, and the UI-owned Remove Background fallback.
   Boundary verification rejects their return. Pending inference cannot publish
   after cancel, document switch or unmount; a late task admission is cancelled.
3. **Ownership** -- Layers-panel mask presentation moved into the 99-line
   `createLayerMaskCommandBridge`; `useLayerPanelController.ts` lost 26 more
   production lines and `LightTableEditorOverlay.tsx` lost a net 27 lines.
   Reusable reservation/publication ownership lives in
   `pixelMutationTransaction.ts`; the remaining broad layer-command facade is
   still explicitly scheduled for C04/C14 decomposition rather than hidden
   behind another broad wrapper.
4. **Proof** -- 165 focused selection/mask/history tests and 254-mask iteration
   tests during repair; app typecheck; boundary verification; instrumented
   desktop package; packaged mask-kernel smoke covering add, enable/link,
   invert, undo/redo, load as selection, copy bounds, delete, mask paint and
   apply with visual RMSE 0.037 and no page errors. The smoke exposed and closed
   a session-revision versus internal-document-revision mismatch after undo.
5. **Critic** -- round 1 found non-atomic history admission, pending-task
   cancellation, late active-layer presentation and post-commit cleanup risks.
   Round 2 found deferred byte accounting. All accepted P0/P1 findings were
   repaired; final independent verdict: **ACCEPT**, no C03 P0/P1.
6. **Allowed/non-blocking** -- mask-to-selection performs a GPU coverage
   measurement/readback at terminal command time; it is not a pointer-rate hot
   path or alternate mutation authority. Remove Background model inference
   remains asynchronous but only its generation-bound result enters the shared
   mask command.
7. **Next** -- C04 raster paint, fill/gradient and clipboard pixel consumers.

## C04 acceptance record -- 2026-09-10

1. **Done** -- fill and raster-gradient separate pure preparation from GPU
   execution and reserve history before their first pixel write. Paint holds a
   document history-admission barrier for the complete gesture, transfers it to
   one terminal pixel publication and reports failure accurately to UI,
   Actions and MCP. Copy, Copy Merged, fast Paste, bounded Paste, Place and
   Layer Via Copy consume the committed C01 selection lease and remain bound to
   the exact document and renderer generation across asynchronous work.
2. **Deleted** -- post-mutation history publication from fill, gradient and
   paint; the overlay's direct copy/paste/cut fallbacks; semantic-operation
   bounds as clipboard truth; inline clipboard capture in the layer facade; and
   Layer Via Copy's React-selection argument. Boundary verification rejects
   their return. Layer Via Copy invalidates shared renderer scratch ownership
   and can no longer leave a valid fast-paste token pointing at different
   pixels.
3. **Ownership** -- system-clipboard capture, serialization, committed lease
   validation and fast-token ownership live in the bounded 212-line
   `pixelClipboardController.ts`. Semantic paint recording moved to the
   64-line `PaintStrokeRecorder.ts`. `useLayerDocumentCommands.ts` reduced from
   1,693 to 1,543 lines. The 578-line paint controller remains one cohesive
   gesture-lifecycle owner; splitting admission, sampled-source cleanup and
   terminal publication across wrappers would weaken this slice's invariant.
4. **Proof** -- 282 focused paint/fill/gradient/clipboard/layer/history/command
   tests; app typecheck; boundary verification; instrumented desktop package;
   packaged raster-paint smoke covering fill, gradient, brush, erase, dodge,
   burn, sponge, clone and healing with no page errors; packaged clipboard
   equivalence with pixel-exact UI versus Actions and UI versus MCP output
   (RMSE 0). Terminal smoke timings were 9.1-17.8 ms on the 256x192 fixture;
   pointer-rate sampling remains outside React and history.
5. **Critic** -- round 1 found five P1 lifecycle faults: paint cleanup could
   leak admission, loaded rasters finalized before history, clipboard lease was
   optional, concurrent copies raced publication, and failed paint could be
   reported as completed. Repair round 1 closed all five. Round 2 found Layer
   Via Copy as a second scratch owner capable of stale-token paste. That route
   was moved behind the same history/clipboard ownership and regression-guarded;
   final independent verdict: **ACCEPT**, no C04 P0/P1.
6. **Allowed/non-blocking** -- sampled-tool cleanup after durable paint commit
   is best-effort and reports cleanup failure without rolling back accepted
   history. Loaded image decode remains asynchronous, but publication is exact
   document/renderer-bound and all temporary GPU resources are compensated on
   rejection. No legacy execution fallback remains in this slice.
7. **Next** -- C05 transform, selected-pixel movement, snapping and edge-pan.

## C05 acceptance record -- 2026-09-10

1. **Done** -- semantic, whole-raster and selected-pixel transforms enter one
   terminal publication owner. The opening document, exact selection lease and
   renderer generation remain bound across asynchronous capture. Selected
   pixels publish document, coverage and editor projection as one CAS-owned
   transition. Snap candidates exclude the moving dependency chain, retain a
   deterministic per-axis latch and share bounded edge-pan with marquee.
2. **Deleted** -- controller-owned terminal renderer commits, selection-active
   inference from provenance length, whole-layer fallback for an empty active
   selection and split revision/mask reads. Boundary verification rejects the
   old terminal commit and non-canonical selection gates. An active selection
   that cannot produce selected pixels now fails closed instead of silently
   transforming the layer.
3. **Ownership** -- `TransformPublicationOwner` reserves history before the
   first terminal GPU write and owns compensation. The 979-line
   `useTransformSessionController.ts` is an interaction/session adapter rather
   than a second publisher. `publishTransformDocumentSelection.ts` owns the
   document/selection CAS and projection rollback. Indeterminate recovery is
   scoped to document session plus renderer identity/generation; retirement or
   unmount destroys its retained GPU edit instead of poisoning later documents.
4. **Proof** -- 234 focused transform/snapping/edge-pan/selection files and 958
   tests; workspace typecheck; boundary verification; instrumented and debug
   desktop packages; packaged transform-kernel smoke covering geometry drag
   with edge-pan, selected-pixel drag and multi-layer drag, with no page errors.
   Final timings were 465 ms including the intentional 280 ms edge hold, 390 ms
   and 212 ms respectively, equivalent to the prior debug baseline.
5. **Critic** -- repair round 1 closed rollback-phase, active-selection target
   and post-commit observer faults. Repair round 2 removed two post-CAS
   self-rejections and made failed compensation explicitly indeterminate and
   scope-bound. The final independent verdict is **ACCEPT**, no C05 P0/P1.
6. **Allowed/non-blocking** -- the 9,477-line integration overlay remains a
   physical decomposition target for C14. It no longer owns terminal transform
   pixel/history publication. Splitting its UI wiring during this transactional
   cut-over would have mixed
   bulk relocation with correctness proof.
7. **Next** -- C06 vector paths, Pen, live shapes and vector gradients.

## Slice-specific acceptance

- **C01:** one committed selection value owns mask, bounds, provenance and
  revision; shape/move/nudge/paint/smart selection, copy and paint consume the
  same revision lease.
- **C02:** finalization creates one fresh raster destination and one atomic
  document/history transition; unsupported contextual composites fail closed.
- **C03:** mask pixels and metadata publish atomically; background inference
  cannot publish after cancellation, rebind or close.
- **C04:** pointer frames stay outside React/history; one admitted selection,
  target transform and renderer generation survive terminal cleanup.
- **C05:** immutable source pixels survive repeated gestures; snapping has one
  deterministic per-axis latch and never compares a target with itself.
- **C06:** vector data remains semantic; render islands/previews are disposable
  and Pixels mode crosses C02 exactly once.
- **C07:** document text is canonical; layout is generation-bound and pending
  layout is never treated as empty content.
- **C08:** accepted warp rebuilds from the immutable opening source, never a
  previously rasterized preview.
- **C09:** document/local adjustment owners stay distinct and one gesture commits
  one complete validated snapshot.
- **C10:** styles and filters retain separate canonical stacks while sharing
  preview/commit/cancel and finalization rules.
- **C11:** host I/O has exact terminal results; layout/view/foreground cannot
  mutate or reopen a document.
- **C12:** UI, shortcuts, Actions and MCP share validation and one semantic
  handler; mixed-domain undo/redo restores exact state and resources.
- **C13:** GPU resources are projections owned by explicit repositories/leases;
  failure, device loss, detach and close have one cleanup authority.

## C14 -- make the result obvious

- [ ] Reduce `LightTableEditorOverlay.tsx` to composition/wiring by extracting
      document geometry, clipboard, text, warp, layer composition, command
      panels, adjustments, transform presentation and publication by owner.
- [ ] Reduce `WebGpuEngine.ts` to render/submission facade authority by extracting
      selection projection, editing overlays, diagnostics, export/readback and
      image-resource allocation without hot-path regressions.
- [ ] Reduce the selection, transform, viewport and layer-command controllers,
      `LightTableStandaloneApp.tsx` and `LayerStyleEditor.tsx` to their named
      adapter/presentation roles.
- [ ] Replace no-growth baselines with reduced ownership ceilings; never raise a
      ceiling to silence the audit.
- [ ] Consolidate still-current kernel contracts and slice acceptance facts.
- [ ] Delete superseded migration status/ledger/final-assessment documents,
      obsolete handoffs and comments that describe removed routes.
- [ ] Route a new agent only to the final architecture and current product work.
- [ ] Run architecture/link audits after documentation purge.

## Final gate before owner testing

- [ ] Repository-wide fallback classification has zero unreviewed matches.
- [ ] Route inventory and source-boundary guard are green.
- [ ] C01-C13 have exclusive-route evidence and accepted critic verdicts.
- [ ] Source-structure audit is green against reduced ceilings.
- [ ] Full boundary, typecheck, test, web build and desktop package verification
      pass on one commit.
- [ ] Packaged cross-domain workflow, multi-document/device-loss soak and
      performance comparison pass on that same commit.
- [ ] Worktree contains no temporary harness output or superseded migration docs.
- [ ] Only then ask the owner to begin manual product acceptance.

## Progress report after every item

1. **Done** -- exclusive artist-visible routes proved.
2. **Deleted** -- fallback code, types, tests and stale documentation removed.
3. **Ownership** -- moved responsibilities and before/after hotspot sizes.
4. **Proof** -- checks, route witness, packaged scenario and performance.
5. **Critic** -- findings and both repair-round outcomes.
6. **Open** -- unchecked work without optimistic wording.
7. **Next** -- exactly one next cut-over item.
