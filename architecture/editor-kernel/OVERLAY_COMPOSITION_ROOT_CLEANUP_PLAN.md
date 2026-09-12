# Overlay composition-root cleanup

Status: **executing; bounded extractions accepted as recorded below; remaining checklist open**.
Owner requested 2026-09-11.
Checkpoint: `df000cc5` (`main`), before cleanup. No push requested.

This is the active follow-up ledger for reducing integration ownership. It is
not a new kernel migration or a rewrite of working domain algorithms. The
[previous cut-over ledger](KERNEL_CUTOVER_AND_CODEBASE_CLEANUP_PLAN.md) records
earlier evidence; its checked boxes do not establish this plan's completion.

Latest bounded acceptance: O02d scoped mounted admission and truthful text
property terminals, following O07c GenAI reference handoff. Real packaged
checks cover Properties-to-tab/no-op transitions and pending transform/text
Save with exact output/history. Provider reference proof remains recorded.
See Task416 PROGRESS for retained failures and exact coverage. Root is
5,873 physical lines. Remaining host/GenAI/command/guides families, cross-flow
evidence and O09 remain open.

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
      - [x] Temporary override state/subscription; duplicate React booleans
        removed. Critic found no blocker; packaged overlap/blur/tab proof passed.
      - [ ] Native host/target transition policy (after named O03 publication ports).
    - [ ] O02c.3: save/export prerequisite consolidation.
      - [x] O02c.3a: scoped UI file intents, actual text/layer/adjustment terminal
        outcomes and original-owner host delivery. Critic PASS after explicit
        outcome/lifetime repairs. Packaged uncommitted transform/clean Save,
        immediate Type/Save, bitmap formats and source/layered Save pass.
      - [ ] O02c.3b: command-producing prerequisites inside Actions/MCP admission.
        Pending text creation currently rejects explicitly; recursive text.create
        during an already queued export would deadlock. Define a same-runner
        prerequisite contract before claiming automatic completion equivalence.
  - [x] O02d: exact queued mounted admission across UI, Grade and semantic
    settlement; pinned registration identity and truthful text-property terminals.
    Critic PASS; 99 focused tests and packaged Properties/tab/no-op/Undo/Redo and
    pending transform/cold Type Save pass. No new queue or implicit blur commit.
- [ ] O03 — Extract document publication and lifecycle binding. Move semantic
  snapshot application policy, exact session binding, open/rebind/retire
  orchestration and disposal out of Overlay, retaining existing document,
  history, renderer and recovery owners. No second store or ownership change
  disguised as an extraction. Remove obsolete cross-system refs.
  - [x] O03a: document/processing projection binding and contextual source cache.
    Critic PASS, no repair needed. Fresh packaged transform/Exposure, layer
    opacity/history/tab rebind and layer-subtarget flows passed.
  - [x] O03b: exact document/selection publication including distant transform binding.
    Accepted after the owner explicitly authorized one additional repair round.
    Exact cached mask support replaces provenance-derived bounds. Packaged
    feathered AND painted selection resize/rotate/tab/undo/redo preserve preview
    pixels and clipboard bounds/bytes. Critic PASS. See Task 416
    `O03B_PUBLICATION_ACCEPTANCE_REPORT.md`, including the unresolved pre-selection
    preview-read flake; this is not complete lifecycle/whole-app acceptance.
  - [ ] O03c: open/rebind/retire and disposal orchestration.
    - [x] O03c.1: loaded-source publication and document font hydration lifetime.
      Session-owned pending/error survives rebind; embedded runtime reset/disposal
      is separate. Removed root font/source asset mirrors and async generation
      policy. Critic PASS after two repairs; packaged native font-byte/final-PNG
      roundtrip, tab rebind, Type/Path Text and layer/history passed.
    - [x] O03c.2: distinct new-source/published-source/rebind interaction resets.
      Named participant policy preserves ordering without acquiring domain state.
      Critic PASS; packaged layer/history, font/source and pixel-retention passed.
    - [ ] O03c.3: read-only processing restore and remaining presentation setup.
      Processing mirrors/restore move together with O04b, not into another owner.
      - [x] O03c.3a: renderer/resource retirement. Removed duplicate root renderer
        clearing; pending startup detaches presentation immediately, destroys only
        after hydration unwinds. Document resource close registration is session-
        lifetime and idempotent across remounts. Critic PASS after pending-start
        repair; integrated replacement safety and packaged lifecycle proof passed.
      - [x] O03c.3b: complete scopes canvas/context attachment lifetime. Latest
        pending request replaces detached canvases; exact context leases, failure
        compensation and theme reattachment preserve the current renderer owner.
        Critic PASS after three repairs;26 focused tests and packaged visible
        scopes/hide/remount with unchanged document pixels/history pass. Physical
        ColorMixer/theme interaction remains outside this packaged gate.
    - [x] O03c.5: exact GPU recovery admission and retained-renderer health gate.
      Host-wide budget/timers moved into bounded owner; canonical-only source
      classification, no consumed replacement flag. Critic PASS;32 tests and
      packaged actual vector loss/rebuild with fresh PNG equality plus raster
      checkpoint-required hold pass. No automatic raster rehydration is claimed.
    - [x] O03c.4: canonical revision authority discovered through Face Warp preview
    rebind. Session publications/history own invalidation; deleted command,
    observation and task-wrapper bumps. Dirty/save identity remains separate.
    Critic PASS, app4220 tests and packaged Face Warp/transform/selection pass.
    Removed fabricated frame-revision telemetry; true frame identity stays O08.
- [ ] O04 — Extract geometry and processing commands, in separate sub-slices:
  (a) Image Size/Canvas Size/Crop/Rotate; (b) local/global grade and Lens FX
  interaction/history; (c) LUT/grade asset lifecycle. Retain existing algorithms
  and atomic pixel/document/selection publication. UI passes intent only.
  - [x] O04a: DocumentSurfaceCommandService owns admission, scoped settlement,
    plan/no-op and the existing compound publication. Crop intent reads exact
    canonical support without another GPU readback. Root only adapts commands
    and dialog/viewport presentation. Critic PASS; packaged geometry, Image Size,
    feathered/painted surface history and UI/Actions/MCP equivalence passed.
  - [ ] O04b: processing presentation/state, individual gestures and pickers.
    - [x] O04b.1: canonical processing binding, shared contextual inspector and
      lifecycle-ordered renderer projection. Removed 14 unused layer-panel props
      and their dead root mutation callbacks. Exact fresh PNG/tab/history and
      current Exposure control proof passed; remaining pickers/gestures open.
    - [x] O04b.2: request-scoped canvas color/focus pickers; root conversion and
      late publication removed. Real-controller cancellation/history/no-op and
      packaged Point Color/Lens FX/focus undo/redo pass. Critic PASS after shared
      creative-pipeline layout repair; depth-analysis jobs remain O04b.3.
    - [x] O04b.3: depth-analysis cancellation, initiating failure target and
      cached-depth renderer rebind. Critic PASS after stale-error/progress repair;
      packaged focus/history plus tab rebind restores exact pixels without edits.
    - [x] O04b.4: consistent contextual owner/presentation/visibility. Attached
      Grade master owns its attachment, not base local Grade. Critic PASS and
      packaged parent/sibling isolation, single history and exact PNG undo/redo.
    - [x] O04b.5: mounted adjustment gesture binding and exact renderer-lifetime
      admission; no synchronous bypass. Critic PASS after token-specific failed
      delivery cleanup; packaged transform/Exposure, rebind and adjustment menu pass.
  - [x] O04c: GradeAssetCommandService owns scoped LUT import/paste planning;
    existing asset transaction retains GPU/rollback/history. Plain/same-LUT
    paste completes synchronously through the existing adjustment controller
    after admission. Critic and packaged UI/Actions/MCP, both file routes,
    exact rebind/history and genuine no-op proof passed.
- [ ] O05 — Complete domain tool boundaries, separately: (a) text hit-testing,
  activation/creation/formatting; (b) vector/path/shape interaction glue;
  (c) transform/snapping; (d) warp/face-warp; (e) remaining selection, paint,
  gradient, mask and background-removal integration. Inspect every toolbar tool
  in O01; already well-owned tools need only thin composition, not rewrites.
  Move session refs and lifecycle decisions with their responsibility.
  - [x] O05a.1: text-property intents and pure contextual projection; reuse
    existing gestures/semantic commands. Font target/range/request lifetime and
    writing-mode continuation repaired. Critic PASS after two findings; packaged
    font picker, font source roundtrip and UI/Actions/MCP text-format proof pass.
  - [ ] O05a.2: existing-text hit/activation and point/paragraph/path creation
    lifetimes, separately from property formatting.
    - [x] O05a.2a: exact hit-to-edit activation owner and scoped failure reporting.
      Critic repair suppresses obsolete selection failure UI; current failures stay
      visible. Packaged Type Tool and Path Text/Actions pass. Creation stays next.
    - [x] O05a.2b: point/paragraph/path creation intent, readiness and cancellation.
      Exact renderer/font/tool/target scope; stale draft and post-prepare race
      repaired. Critic PASS after two rounds; packaged Type/Path/Paragraph pass.
    - [x] O05a.2c1: scoped missing-font/layer edit entry; current authored-font
      gate, observed tool departure cancellation and recovery request contract.
      Critic PASS after repair; packaged recovery preview/cancel/replace/history
      and Type reentry pass. Shared activation-error reporting remains O02/O06.
    - [x] O05a.2c2: text pointer precedence and deferred miss routing. Existing
      gesture owners retain their own state; delayed replay reaches the actual
      handle/draft owner. Critic PASS; packaged Type/Paragraph/Path Actions pass.
  - [x] O05b.1: vector/shape/gradient property projection and intents; one
    toolbar/context gradient route, creation options separate from geometry.
    Critic PASS after arrow/fractional endpoint/no-op repairs. Packaged property
    parity, shape geometry/history and vector authoring/roundtrip pass.
  - [x] O05b.2: vector commit observation, Pen terminals and mounted lifetimes.
    - [x] O05b.2a: current document/settings/selection getters and committed
      payload observer; no post-commit active-layer rediscovery. Critic PASS;
      packaged Gradient create/update Actions, Pen/Path Text and shape pass.
    - [x] O05b.2b: exact session/renderer retirement and Pen presentation.
      Critic repairs accepted; packaged idle/Pen/Transform close-reopen exposed
      and verified selection-retirement repair. Selection and Exposure pass.
  - [x] O05c.1: transform frame/snap presentation and exact renderer binding.
    Critic PASS; packaged visible snapping/exact undo-redo, full transform,
    selection and active-transform close/reopen pass. Wider performance O08 open.
  - [x] O05d.1: Face Warp domain intents, mesh presentation and exact binding.
    Critic repairs include exact property/review leases and null-to-ready renderer
    rebinding. Packaged gestures, identity, rebind/property/exact undo pass.
    Shared revision defect repaired in O03c.4; whole owner/performance gate open.
  - [x] O05e.1: selection host pointer/snap presentation and admitted Actions
    observation. Deleted duplicate canonical publication port. Exact canonical
    activity fixes painted-selection Delete routing. Critic PASS after disposal
    guard;57 tests and packaged selection/Delete/real-marquee Actions replay pass.
  - [x] O05e.2: Smart Selection exact runtime/request lifetime and thin root
    binding. Critic PASS; actual Select Subject exposed a mixed revision-domain
    WebGPU guard, repaired with distinct-clock regression. Packaged subject,
    Actions/undo/replay, tool/tab retirement, Rectangle and selection-kernel pass.
  - [x] O05e.3: complete Smart source/inference owner and global-processing
    cache freshness. Tool controller605 ->446 audit lines; retired size exception.
    Critic PASS;62 tests and packaged global Exposure -> fresh source/inference,
    subject/Actions, tool/tab retirement and Rectangle pass. No per-sample readback.
- [ ] O06 — Extract remaining layer/clipboard/finalization and mounted command
  adapters. UI, shortcuts, Actions and MCP invoke the same semantic operations.
  Move automation translate baseline/history into an application owner, not
  another adapter-local mutation implementation. Remove duplicate preparation
  or settlement in menus, keyboard handlers and automation registration.
  - [x] O06a: clipboard host intents, exact request-time binding and mounted Cut.
    Deleted root decode/placement/artifact/Cut policy. Canonical coverage and
    existing pixel/history owners retained. Critic PASS;34 focused tests,
    packaged menu/Actions/MCP exact pixels and menu Cut/exact Undo pass.
  - [x] O06b: SVG import uses one scoped canonical mutation/history transaction
    in mounted and inactive bindings. Removed split apply/history publication.
    Critic PASS;28 tests and packaged import/rebind/exact Undo/Redo pass.
  - [x] O06c: mounted layer command dispatch and admitted creation result IDs.
    Existing model/pixel/mask owners retained; exact registered session/renderer
    guards cover awaited handoffs. Critic PASS;175 focused tests, packaged
    creation/group/duplicate IDs, UI/Actions replay, layer history and masks pass.
  - [x] O06d: finalization command binding and exact committed destination IDs.
    Scoped readiness guards and unused active-target route deletion; critic PASS.
    Packaged five-command IDs, one-entry history and exact final PNG undo/redo,
    rasterize affordance and masks pass. Interactive text preview readiness remains
    explicitly open under O08; final-output proof does not certify that preview.
  - [x] O06e: scoped automation gesture binding and parent-space translation.
    Stable runtime binding survives command-port/zoom rerenders; captured domain
    controllers retain gestures/history. Critic PASS;51 focused tests and packaged
    parent transform, zoom handoff, exact PNG undo/redo, no-op/cancel/lock and
    rectangle/brush routing pass. Other command families remain open.
  - [ ] O06f: remaining canonical-selection consumers and layer intent lifetime.
    - [x] Canonical mask/menu eligibility and scoped canvas layer picking;
      real painted-mask/Shift-pick flows and exact output/history verified.
- [ ] O07 — Finish UI/host composition: provider/job integration, menus, panels,
  tool options, dialogs, workspace and viewport bindings. Preserve layout,
  shortcuts and control behavior. Partition composition by feature, exposing
  named view models/intents rather than hundreds of mutable ports. Verify
  stable owner identity and subscriptions across React renders and rebinds.
  - [x] O07a: viewport wheel host listeners and diagnostic budget in one bounded
    owner; existing viewport remains pan/zoom authority. Critic PASS after hot-path
    repair;4 tests, app typecheck/boundary and packaged renderer/native-bridge
    events, outside targeting, workspace rebind and fresh PNG/history parity pass.
  - [x] O07b: scoped frozen PDF preflight/export. Four packaged variants and
    rejection of stale preflight verified; exact limits recorded in PROGRESS.
  - [x] O07c: scoped GenAI reference handoff and Setup import lease. Two critic
    rounds, deferred-state tests and packaged base/file/tab reference proof pass.
    Providers/jobs remain independent; Remove Object authority remains open.
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
5. Repair findings against evidence and rerun relevant proof/review; use two or
   three rounds as needed. Owner continuation authorization (2026-09-11) replaces
   the former two-round stop rule: resolve further bounded findings independently
   and proceed to the next item. Do not stop solely at a round count or mark an
   unresolved P0/P1 accepted. Escalate only a genuine missing choice/authority or
   an impasse after safe alternatives; record “not needed” without invented edits.
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
