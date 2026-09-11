# Overlay composition-root cleanup

Status: **executing; O02a/O02b accepted, wider O01/O02 open**.
Owner requested 2026-09-11.
Checkpoint: `df000cc5` (`main`), before cleanup. No push requested.

This is the active follow-up ledger for reducing integration ownership. It is
not a new kernel migration or a rewrite of working domain algorithms. The
[previous cut-over ledger](KERNEL_CUTOVER_AND_CODEBASE_CLEANUP_PLAN.md) records
earlier evidence; its checked boxes do not establish this plan's completion.

## Result, scope and non-goals

`LightTableEditorOverlay.tsx` becomes UI composition and explicit system wiring:
construct/bind systems, subscribe to presentation, connect named ports, compose
views, and invoke lifecycle disposal. It may own view-only state such as dialog
visibility. It must not decide edit settlement, author document changes, publish
history, retain pixel resources, or implement domain interactions.

An extracted system owns one responsibility and its state/lifetime. It knows
only declared collaborators through narrow contracts, not the rest of the app.
Necessary coordination is explicit; pretending subsystems have no dependencies
would recreate hidden coupling. The composition root is allowed to know which
systems exist, but not how their edits work.

Primary scope is the whole Overlay, including tool interactions, commands,
grading, text/vector/warp, document lifecycle and UI assembly. WebGpuEngine is a
separate follow-up track: this plan does **not** declare that monster file fixed.
Do not simultaneously rewrite renderer internals during an Overlay extraction.

No new product features, interaction redesign, generic plugin framework, new
global event bus, second command queue, or replacement `EditorManager`.

## Baseline: facts, not acceptance

At the checkpoint the Overlay is 9,090 physical lines and WebGpuEngine 3,963.
Many domain owners already exist. Their presence does not mean that wiring is
the only responsibility left in the Overlay.

The following are initial source anchors, not an exhaustive ownership inventory.
Line numbers refer to the checkpoint and will move; use symbol names afterward.

| Responsibility still in Overlay | Source anchor | Intended ownership boundary |
| --- | --- | --- |
| Cross-domain terminal ordering | `finishOpenHistoryTransactions` (1791), `activatePersistentTool` (7074), host deactivation (6914) | Interaction transition policy and tool activation; individual session owners execute their own terminal work |
| Canonical/projection and transform publication wiring mixed with policy | `applyDocumentSnapshot` (1813), `publishTransformDocumentSelection` (1920) | Document publication binding over existing mutation/publication owners |
| Resize/canvas/crop transactions | `commitImageSize` (2381), `commitDocumentGeometry` (2468), crop (2560) | Document-surface command service over existing geometry planners and pixel/history owners |
| Grade/Lens FX transactions and assets | adjustment setup (2993), LUT loading (3108), grade capture/apply (3320), `publishGlobalGradeStrength` (4414) | Processing interaction and asset services; panels consume presentation and intents |
| Text hit ordering, async activation, creation | `beginExistingFlowTextEditing` (4898), text creation (5023), formatting (7864+) | Text interaction owners with exact session identity and generation |
| Face warp, vector and transform input details | face warp (2126), vector/shape updates (4757), transform/snapping setup (6698+) | Respective existing tool systems, not a shared tools god object |
| Clipboard/layer orchestration and automation mutations | merge/cut/paste (5582+), mounted command ports (6044+), automation gestures (6930+) | Layer/clipboard application services and thin command/automation adapters |
| Document lifecycle, providers and persistence wiring mixed with callbacks | provider integration (720+), `beforeDocumentOpen` (3626), recovery (7228+) | Document-scoped lifecycle, host services and presentation subscriptions |
| Menus, panel props, tool options and viewport assembly | menus (7304), panels (7721), viewport (8181) | Bounded UI composition modules, no mutation policy |

`planPersistentToolActivation` currently covers transform switch decisions only.
`InteractionTransitionCoordinator` currently admits transitions; its mounted
settlement callback settles selection and transform. Neither is already a
complete all-tools lifecycle system. Preserve and extend the appropriate
existing owners; do not add a competing coordinator beside them.

The checkpoint includes targeted transform/grade, paint/recovery and raster
ownership fixes. Evidence and limits are in
[Task 414](../../work/todo/task_414_transform_exposure_atomic_publication/task.txt)
and [Task 415](../../work/todo/task_415_paint_recovery_snapshot_ownership/RASTER_RESOURCE_BOUNDARY_REPORT.md).
They are regression baselines, not whole-app acceptance or a fresh cleanup test.

## Hard contracts

1. **One route.** Cut over one complete responsibility at a time. Delete its old
   body, callers, mutable refs, optional mutation ports and obsolete instructions
   in the same milestone. No runtime switch, shadow execution, silent no-op
   replacement, catch-and-continue, or old-owner retry.
2. **Visible failure.** Missing admission or invalid ownership rejects the edit
   and reports the cause. Never conceal it as Loading or successful completion.
   Preserve exact compensation and resource cleanup; those are transaction
   correctness, not fallbacks. Cancellation is distinct from failure. Failed
   compensation stops that document's editing visibly, not via another owner.
3. **Separate state kinds.** Canonical document/selection/history remain with
   their existing owners. A gesture owner retains its baseline, preview and
   terminal obligation. React observes presentation; GPU realizations retain
   authored pixels according to [resource lifetime](RESOURCE_LIFETIME.md).
4. **Bound lifecycle.** Every async continuation and release is bound to the
   opening document/session/generation. No late closure mutates whichever
   document happens to be current. Setup, detach and disposal have named owners.
5. **Explicit transitions.** Tool switch, repeat-tool activation, pointer capture
   loss, host blur, document switch, history and close are different events.
   Record preserve/commit/cancel policy for each active session. Do not implement
   “reset everything” or “commit everything” as a universal shortcut.
6. **Keep the hot path short.** Pointer and slider preview do not round-trip
   through React or a general command queue per sample. No new readback, texture
   copy, full-document traversal or GPU wait per sample for this cleanup.
   Admission must not turn a slider into a backlog of obsolete values.
7. **Real modularity.** No ref bag, callback bag exposing the entire editor,
   service locator, circular import, or domain module importing Overlay.
   React hooks may adapt lifecycle, but cannot merely hide the same god object.
8. **Constrain growth.** New production modules target <=350 lines; above 500
   requires a decomposition decision before growth; no new handwritten module
   above 800. Ratchet hotspot ceilings down at accepted milestones. Do not game
   counts by stripping whitespace or moving code into one enormous hook.

## Ordered checklist

Each row is accepted only after the loop below, not when code has moved.
Sub-items must be split into bounded commits if needed; a row is not permission
for a large simultaneous rewrite. Proposed service boundaries are not mandatory
class names: reuse existing owners before creating a new one.

- [x] O00 — Save the pre-cleanup checkpoint (`df000cc5`); preserve local recovery
  artifacts outside Git. Record this plan and route onboarding to it.
- [ ] O01 — Complete the ownership inventory. Classify every Overlay section,
  state/ref, effect and callback as view state, adaptation, wiring or a named
  non-UI authority. Map incoming/outgoing dependencies, lifetime and entry points.
  Record current behavior versus desired contract, including uncertain cases.
  Establish repeatable packaged baseline scenarios and latency/resource traces.
  No mutation extraction until its dependency/behavior map is complete.
- [ ] O02 — Extract tool activation and interaction handoff first. Consolidate
  the existing activation planner, transition admission and scattered terminal
  calls. Domain owners expose narrow terminal/readiness operations; the
  coordinator knows policy, not texture/text/paint implementation. Delete the
  Overlay's switch policy and cross-domain reset lists for the migrated scope.
  Distinguish OS blur, pointer cancellation and actual document retirement.
  - [x] O02a: Escape precedence owner, lazy participant evaluation; packaged
    Type Tool -> transform -> Escape -> text reentry passed. Critic PASS after
    repair 1; repair 2 not needed. Wider asynchronous cancellation unchanged.
  - [x] O02b: persistent activation and preferred shortcut owner, including
    pending transform settlement and workspace/renderer-bound successor admission.
    Critic PASS after repair 1 (queued nudge readiness); repair 2 not needed.
    Packaged 35-tool switching, text/transform/Escape/reentry and transform pixel
    history/Exposure proof passed. Outer pre-activation async callbacks remain
    in O03/O05, not certified by this extraction.
  - [ ] O02c: history/save/export/target-change prerequisites, temporary tools
    and host deactivation; reconcile all scattered terminal policies.
    - [x] O02c.1: history prerequisite ordering and layer-panel gesture owner;
      current lifecycle scope checks. Critic PASS after repair 1; packaged held
      Opacity drags plus keyboard exact pixel undo/redo and transform smoke passed.
    - [ ] O02c.2: temporary overrides and host/target transitions.
    - [ ] O02c.3: save/export prerequisite consolidation.
- [ ] O03 — Extract document publication and lifecycle binding. Move semantic
  snapshot application policy, exact session binding, open/rebind/retire
  orchestration and disposal out of Overlay, retaining existing document,
  history, renderer and recovery owners. No second store or ownership change
  disguised as an extraction. Remove obsolete cross-system refs.
- [ ] O04 — Extract geometry and processing commands, in separate sub-slices:
  (a) Image Size/Canvas Size/Crop/Rotate; (b) local/global grade and Lens FX
  interaction/history; (c) LUT/grade asset lifecycle. Retain existing algorithms
  and atomic pixel/document/selection publication. UI passes intent only.
- [ ] O05 — Complete domain tool boundaries, separately: (a) text hit-testing,
  activation/creation/formatting; (b) vector/path/shape interaction glue;
  (c) transform/snapping; (d) warp/face-warp; (e) remaining selection, paint,
  gradient, mask and background-removal integration. Inspect every toolbar tool
  in O01; already well-owned tools need only thin composition, not rewrites.
  Move session refs and lifecycle decisions with their responsibility.
- [ ] O06 — Extract remaining layer/clipboard/finalization and mounted command
  adapters. UI, shortcuts, Actions and MCP invoke the same semantic operations.
  Move automation translate baseline/history into an application owner, not
  another adapter-local mutation implementation. Remove duplicate preparation
  or settlement in menus, keyboard handlers and automation registration.
- [ ] O07 — Finish UI/host composition: provider/job integration, menus, panels,
  tool options, dialogs, workspace and viewport bindings. Preserve layout,
  shortcuts and control behavior. Partition composition by feature, exposing
  named view models/intents rather than hundreds of mutable ports. Verify
  stable owner identity and subscriptions across React renders and rebinds.
- [ ] O08 — Enforce and prove the endpoint. Scan all remaining Overlay logic,
  not just file size; zero edit policy/history/resource ownership remains.
  Add enforceable import/ownership rules and update existing boundary guards
  that currently require implementation text inside Overlay. Move each guard
  to the actual new owner; never delete protection just to get green checks.
  Reconcile active MD guidance and remove superseded guidance after preserving
  still-valid contracts. Run final mixed-flow, performance and resource proof.
- [ ] O09 — Separately inventory and plan WebGpuEngine decomposition against
  its actual remaining responsibilities and measured hot paths. Do not mark the
  engine resolved because the Overlay is smaller. Implementation is separately
  scoped after the Overlay result is reviewed.

### First implementation slice: O02 acceptance details

After O01, O02 must enumerate toolbar, keyboard, menu and supported automation
tool changes; current and pending selection/transform, point/paragraph/path
text, paint/gradient, vector and warp sessions; repeat-tool activation; temporary
pan/zoom; rapid consecutive switches; blur and tab/close during settlement.

Its policy table must identify opening owner, transition reason, terminal action,
successor admission, failure visibility and history result. Record uncertainty
as an open acceptance question, never silently change user behavior. Tool
publication follows successful required settlement; an old async completion
cannot activate a tool in a newer document. Individual owners still execute
their own commit/cancel. A generic coordinator must not grow tool algorithms.

## Mandatory loop per bounded extraction

1. Map the exact before/after authority and ports; define one user workflow and
   adjacent handoffs. Keep a baseline trace before changing code.
2. Implement the single route and delete the replaced authority. Keep fixes for
   newly exposed invariant failures within the owning system; no concealment.
   If a wider redesign is needed, mark the slice blocked and explain why.
3. Run focused tests/typecheck, boundary and structure checks. Exercise the real
   packaged UI using available browser automation, observing pixels and history,
   not only command acknowledgements. Never claim an unavailable browser skill
   was used. Failed baseline behavior stays explicitly known, not accepted.
4. Have a separate **read-only architecture critic** review ownership, lifetime,
   semantic equivalence, performance, deletion completeness and dependency size.
   Evaluate findings against evidence; do not apply suggestions mechanically.
5. Repair round 1 if needed, rerun relevant proof, request re-review. Repeat once
   for round 2 if needed. Record “not needed” honestly; do not manufacture edits.
   Accepted P0/P1 still open after two rounds blocks the slice, not a third
   unbounded repair loop or optimistic checkbox.
6. Record deleted responsibility, before/after line counts, dependency edges,
   test/build identity, real-flow evidence, timings, critic result and remaining
   risks. Commit the cohesive accepted extraction and ratchet its size ceiling.

Do not run the full suite after every tiny edit. Run focused proof per repair;
cross-domain regression at O02/O03 and after O04–O06; full workspace verification
and a fresh packaged run at O08. A change crossing another domain includes that
domain's focused proof immediately rather than waiting for the scheduled gate.

## Product acceptance and performance gates

Minimum mixed workflow: open -> marquee -> copy/paste -> transform -> immediate
Exposure -> blur/refocus -> paint with selection -> undo/redo through the chain
-> save/reopen. Include compact pasted pixels, transparency, local effects,
text/path editing, merge/rasterize and two open documents. Repeated runs and
controlled delayed completion must preserve the same outcome and exact
pixel/selection/history checks where the operation promises exact restoration.

Measure input-to-control feedback, input-to-presented preview, terminal commit,
main-thread stalls, GPU allocation high-water and settled resource/listener
counts separately. rAF percentiles alone do not establish slider responsiveness.
Use the same build mode, hardware, fixture and visible-window conditions for
baseline and after measurements. A repeatable >10% regression blocks acceptance;
an already unacceptable baseline is a known performance defect, not a pass.
Do not add unconditional synchronization to improve correctness statistics.

An invariant error is useful evidence, **not a finished workflow**. Exposing a
break lets us repair the correct owner; it does not permit calling the cleanup
working until normal supported flows work without that error. Keep the user's
recovery files and unsaved work safe throughout.

## Progress and completion

After each item report: **done / deleted / ownership / proof / critic / open /
next**. O00 is checkpoint administration, not product progress. Do not convert
checked-row counts into a percentage of stability or work remaining.

Overlay cleanup completes at O08 only with a composition-only source review,
no replacement monster, single-route proof, packaged mixed-flow evidence and
no accepted blocking finding. Owner visual/feel acceptance is reported separately.
O09 remains a clearly separate engine follow-up. No “whole app fixed” claim.
