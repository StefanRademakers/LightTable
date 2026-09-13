# Task 416 progress

## O07g — Tool Options UI composition (accepted)

- Overlay now assembles one typed `ToolOptionsFeatureProjection`. The pure
  18-line `projectToolOptions` helper adds only the toolbar Gradient request and
  the context-menu close/Warp-reset wrapper. Every other state value and command
  retains its original identity and owner; no state, queue, service or domain
  policy was introduced.
- `LightTableEditorShell` receives and forwards one Tool Options contract rather
  than redeclaring the feature family. Its independent active tool, brush colors,
  zoom-actual and visibility inputs remain explicit for the vertical toolbar.
  `EditorOverlayLayer` aliases the actual context component contract rather than
  duplicating it. Boundary guards reject reintroduced Shell/root prop mappings.
- Independent critic: ACCEPT, no P0-P2. Focused run PASS: 502 tests/56 files,
  app typecheck, boundary and diff checks. Overlay4941->4866 (ceiling4867),
  Shell388->152 and overlay host43->34; helper18 lines.
- Fresh instrumented package SHA256
  `96839acf57859ed2d3552606cb922171a83f2810e96b4f61e47018a7ec7af7de`.
  `tmp/tool-options-composition-smoke/report.json` PASS: actual PSD, Shape
  context menu/family switch, Escape, Warp reset/close and zero page errors.
  The older broad context-menu style harness is stale against current launcher
  and paint-field markup; it was not changed or counted as product failure.

## O06j — Grade clipboard binding and single publication (accepted)

- Reproduced the real stale-owner defect first: UI Copy A followed by semantic
  Copy B still made UI Paste consume A, create history and record A's artifact.
  The repair removes the root artifact cache and the unused direct adjustment
  Copy route instead of adding reconciliation or a fallback.
- `GradeClipboardBinding` now captures exact ready document/renderer/target state.
  Copy is side-effect-free until the semantic handler has validated a complete
  Look and registered its artifact; only then is the browser clipboard published.
  Paste reads the current shared capture at invocation and reuses only a live
  artifact owned by the same handler. Replaced-clipboard races release only the
  newly-created unpublished artifact and perform no document mutation.
- Final independent critic: PASS, no P0-P2 findings. Focused regression run:
  1,003 tests/58 files PASS; app typecheck, boundary and diff checks PASS.
  `GradeClipboardBinding.ts` is 103 lines; Overlay4996->4941, ceiling4942.
- Fresh instrumented package SHA256
  `962af9c887214209d34c1aa38215dfb702d6997f084c83e081406c65c832d6ef`.
  `tmp/grade-clipboard-freshness-smoke/run-fqtM2s` PASS: UI Copy A -> semantic
  Copy B -> UI Paste keeps B, adds no revision/history, records B's artifact and
  emits no page errors. Existing Grade Look smoke also PASS for UI, Actions, MCP,
  LUT strength, cross-document paste and artifact rebind. These gates establish
  this clipboard slice, not whole-editor or general performance acceptance.

## O07 UI/host composition (open beyond accepted O07g)

- Remaining O07/O08 host, view, panel, mixed-flow, resource and performance gates
  remain open. WebGpuEngine remains 4,003 lines and is a separate cleanup scope.

## O05a.6 — Editing publication and selection lifetime (accepted)

- Baseline regressions reproduced before repair: committed text observation uses
  successor dependencies; retained canceled selection frame consumes a successor
  with the same pointer ID; selection's prerequisite commit can reenter editing
  and then overwrite the new caret/group. Repair stays in the existing owners.
- Capture admitted command address and frame callbacks, retain exact selection
  gesture/runtime/editing identity, and detach old group bookkeeping before its
  publication. Preserve committed truth while rejecting successor UI writes.
- Review also identified mutation admission completing preceding work before
  returning a transaction: pinned source across that boundary and canceled a
  rejected returned transaction. Final critic PASS;407 tests/37 files, typecheck,
  boundary/diff PASS. Hooks51/68 lines; root5039->4996, ceiling4997.
- Accepted predecessor package52fb1584 baseline: actual Type smoke PASS;
  tmp/text-selection-lifetime-smoke/run-HyC9bB PASS: real mouse subset selection,
  replacement, one history, exact text UndoRedo, pending typing->real tab click,
  original-document Actions and unchanged second document. This is ordinary-flow
  preservation evidence, not a forced scheduling-race or pixel-equality proof.
- Fresh instrumented package SHA256
  1a7f648f91dcc9757d4425a4dd12a35dfa856e62d279c786c323f284f1a7760c:
  selection lifetime run-ZUzZsF PASS, geometry run-l8G57y PASS, text-property
  transition run-F725FH PASS, Type Tool PASS. Selection final screenshot inspected,
  no page errors. Preserved three harness-development failures in baseline outputs;
  exact assertions were corrected for actual label/projection/recorder semantics,
  not relaxed to hide a product failure. Hook lifetime fixtures simulate React;
  actual packaged tests separately cover the user flows. Broad performance open.

## Grade clipboard baseline (resolved by O06j above)

- Existing Grade Look packaged UI/Actions/MCP/LUT rebind/exact history baseline
  PASS on package52fb1584. Freshness defect separately reproduced on that build:
  tmp/grade-clipboard-freshness-smoke/run-yb2xiq. UI Copy A(+0.5), semantic Copy
  B(-1), UI Paste restores A and adds history3->4 rather than no-op. Action points
  at A's artifact. No page errors; no production Grade edits yet.
- Reuse shared clipboard and existing semantic artifact/GradeAsset owners; remove
  root's stale artifact cache. Publish copy only after complete artifact validation;
  scope late paste feedback. Preserve intended contextual/document Grade resolution
  and Copy-result artifact association. New freshness harness is not yet accepted.

## O05a.5 — Text geometry composition and exact lifetime (accepted)

- Removed root construction, realization callbacks and duplicate cancellation for
  move, paragraph-frame and path-handle gestures. useTextGeometryGestures composes
  the existing three controllers; captureTextGeometryRealization pins canonical
  document, editing target and concrete renderer lifetime. Geometry retirement
  does not reset typing or Properties. No shaping/geometry algorithm moved.
- Guards include session, renderer, lifecycle/generation, editing/mutation owner
  identity and editing document ID; ordinary ports rerenders and own preview
  revisions stay valid. Stale unpublished work cancels; committed results remain
  truthful. Critic identity findings repaired; final independent review PASS.
- 91 focused tests/6 files, app typecheck, boundary and diff checks PASS.
  Overlay5101->5039 physical lines; hard ceiling5040. Helper40/hook67 lines.
- Fresh instrumented desktop package PASS, app.asar SHA256
  52fb1584439787c64fabf287f415a8e3a20df2ac372a8f893f7a938c2e0fe7ec.
  Actual UI frame resize, Ctrl-move and Path Text start handle with exact canonical
  history/UndoRedo PASS: tmp/text-geometry-smoke/run-jKWYjh (baseline run-MtAudu).
  Adjacent Properties transition PASS: tmp/text-property-transition-smoke/run-kGQCOe.
  Final geometry screenshot inspected; no page errors. These are bounded flow
  gates, not broad performance or whole-app stability acceptance. Path Text's blank
  Orientation presentation was also present in the baseline and remains O08 debt.
- Next: O05a.6 text editing/selection publication and lifecycle, separately from
  geometry. Remaining root/panel composition and O08 mixed/performance gates open.

## O02c.3b — Captured text prerequisite in the single runner (accepted)

- Replaced per-document Promise tails with one explicit execution queue. A file
  parent may consume only its exact captured text.create once, including a child
  queued behind unrelated same-document work. Parent validation remains before
  mutation; child keeps normal admission/handler/history and original Actions
  context. Per-document execution frames prevent duplicate handler observations.
  Other documents remain independent; waitForIdle/barrier accounting stays exact.
- File intents capture creation before settling other owners. Fonts/drafts yield
  a tracked handle, not a recursive public execution wait. Canceled queued or
  in-flight creation cannot ghost-commit; committed child/history remains truthful
  when parent/presentation retires. Quiet cancellation does not publish old errors.
- Critic repair: actual session/renderer scope, not replaceable registered-port
  object identity, guards semantic text publication after font awaits and inside
  the existing mutation recipe. Ordinary UI re-registration remains supported.
  Existing useTextCreation owns captured command-envelope mapping; mounted text
  binding owns exact-render feedback. Root5102->5101; ceiling5102, engine4003.
  Initial +2 wiring growth failed the audit; moved real envelope responsibility
  into its existing hook, without raising the ceiling or cosmetic line packing.
- Final critic PASS;240 tests/9 files (19 integrated real-owner cases,6 queue
  capability cases,3 hook mapping cases), app tsc/boundary/diff PASS. Controlled
  fonts and artifact encoding are fixtures; semantic text/mutation/history are
  real. Actual host scheduling/races are not claimed from those controlled tests.
- Fresh final package24048: text-export-prerequisite-smoke/run-XleeUf paragraph
  and run-GqOFKy short-drag point PASS, actual held Type pointer -> semantic PNG
  export, exactly text.create then file.exportPng, one history, exact PNG UndoRedo.
  file-intents/run-XEyJQl PASS pending transform/clean Save + immediate Type/Save;
  path-text-actions-smoke PASS creation/binding/Actions replay. No page errors.
  Earlier package4380 also passed all four gates; final package is authoritative.
  Final archive SHA256:0aea6fc799025f97077469a13c30c23bc33630f2f5879537de0720a5e5415b81.
  Export/UI screenshots inspected. No live MCP transport or broad latency claim.
- A final-file gate exposed the adjacent edge-pan failure below, not hidden or
  retried into a green report. Next: separate text geometry realization/lifetime,
  then editing-publication scope; O08 endpoint/mixed performance and O09 stay open.

## Adjacent packaged repair — native marquee frame receiver (accepted)

- file-intents/run-P2nSie failed before Save/gizmo with a pageerror: native RAF
  was stored bare and called as a MarqueeEdgePanController method. Dedicated
  actual edge-drag baseline run-IFn94X reproduces the same Illegal invocation.
  This predates the text runner (historical6b4afda4), not a new fallback route.
- Two default adapters now call globalThis request/cancelAnimationFrame with the
  correct browser receiver. No geometry/timing/selection algorithm change.
  Receiver-sensitive regression failed before repair and covers initial request,
  rescheduling and disposal afterward.10 tests/3files, tsc/boundary/diff and
  independent critic PASS. Nearby input/composition scan found no matching case.
- Final package24048 marquee-edge-pan-smoke/run-7DnIth PASS actual stationary
  corner-side drag pans, preview creates no history, pointer-up commits once and
  UndoRedo succeeds; no page errors. History test's first two post-fix harness
  attempts used a zero-height horizontal rectangle, correctly committing no
  selection; changed to a real two-dimensional rectangle and awaited terminal
  publication. Those failed reports remain, not attributed to the app.
  Final Save and text gates above pass on the same archive. Not full selection
  fidelity/performance acceptance; this fixes the reproduced browser invocation.

## O08 documentation checkpoint — stale onboarding authority removed

- Removed the frozen historical HEAD/current-dirty-worktree directions from
  onboarding; retained failure lessons and real-flow/feature-freeze guardrails.
  The earlier stabilization investigation is explicitly historical, not a second
  active implementation plan. Kernel + Task416 remain the only continuation route.
- Corrected old kernel-only-types wording against actual selection/applied-pixel
  coordinators and dated the old red source-audit result. No whole-app completion
  claim. Independent documentation review and architecture-docs audit PASS.
- This is partial MD reconciliation, not O08 acceptance or deletion of every
  historical report. Any remaining valid findings must be reconciled before
  removing their source. Runner prerequisites were unaccepted WIP at this checkpoint;
  the later O02c.3b acceptance above supersedes that status.

## O07f — Independent GenAI provider binding (accepted)

- Deleted Overlay Create-preference/status-cache/subscription reconciliation and
  connect/disconnect Promise recipes. GenAiProviderController120 + hook14 are
  provider-only; host authentication/transport and existing Setup/Jobs/References/
  RemoveObject remain independent. Root5153->5102, ceiling5103; engine4003.
  Actual Create-preference policy preserved, inaccurate mode-switch comment
  removed. No document/history/GPU dependency, new queue or paid submit route.
- Initial lists cannot overwrite newer event/request state. Exact service epoch
  and per-provider request tokens retire stale responses. Critic repair: observed
  terminal events beat older returned snapshots/errors; connecting is progress.
  Request captures its initiating reporter, later requests use updated callback.
  Service A->B->A and unmount cannot revive old continuations. Event-versus-event
  ordering remains host-owned because events lack operation identity.
- Final independent critic PASS;54 tests/6 files, app tsc/boundary/diff PASS.
  Hook scheduling is simulated around real owner; packaged UI supplies real React
  evidence. Source-structure/docs checks pass. No broad performance verdict.
- Baseline package40691: provider/run-4phEmf normal flow PASS; reject/run-tFlOkk
  reproduces unhandled IPC error with no panel alert. Reference/run-5cIO12 PASS.
  Fresh package57868: provider-binding-smoke/run-Q1uAZL PASS actual panel connect,
  AI menu disconnect/connect, visible rejected connect, explicit retry and clear
  panel after disconnect; exact document query/history unchanged, zero submits
  and no page errors. Reference-handoff-smoke/run-zF4fgk PASS production reference
  export/import/tab association with local provider fixture. Final UI inspected.
  Archive SHA256:90fb06e9fd2d0809cd0ad2a775e4d05344c38a7e316e2a81871ac902abf89b8e.
- This does not prove OAuth, live providers, paid generation or delivery. Failed
  harness menu selector corrected against accessible status label before baseline;
  reports retained. Next O02c.3b runner prerequisite; actual pending Type drag ->
  semantic export rejection reproduced, no prerequisite fix claimed yet. Remaining
  ordered authority map is in OWNERSHIP_INVENTORY; O08/O09 still open.

## O03c.7 — Public open lifecycle and scoped text feedback (accepted)

- Root closed return now follows all hooks; text Properties reveal requires open.
  Existing text command/recovery bindings own open epochs and retire pending
  font/recovery work, deferred defaults and editing reentry. No new document
  owner, GPU work, queue or fallback. Root5158->5153, ceiling5154; engine4003.
- Critic repair closes final error-delivery microtask gap: font/writing-mode UI
  intents report inside their captured owner, not a later unscoped root catch.
  Implicit command reporter disabled only for this owner. Current failures show
  once, own source publication cannot hide a genuine failure, old completions
  cannot revive after reopen. Existing synchronous gesture terminals unchanged.
  Final independent PASS;81 tests/7 files, app typecheck/boundary/diff PASS.
- Public React production host, actual open prop and supported non-image surface:
  baseline a112f79d four-module override run-bLFAuj reproduces React #310 on first
  open; fresh run-GbfkWV passes three cycles with no page/console errors. Remaining
  dependencies unchanged. This is not an old full package or image/GPU test.
  Host screenshot inspected; fixture has minimal styling, not product visual QA.
- Fresh instrumented package40691: text-finalization-intents/run-Lu8MiQ and
  text-to-shape-intent-smoke/run-x6GT9X PASS, actual recovery/rasterize/conversion
  and exact supported undo/redo. Positioned-render rejection and recovered font
  control presentation debt remain as previously recorded, not newly fixed.
  Archive SHA256:3dfec1725b06af09325d9b66557ad412d2ed85c0571dfdfc19f2b631ff0b8c81.
- Harness failures retained: development host canceled before assertions;
  Electron local fixture failed host IPC trust (no bypass); Chrome favicon404
  removed by explicit empty favicon before clean baseline/current runs. No
  retries or error filtering. Test scripts use existing Playwright, no unavailable
  browser skill claim. Next: independent GenAI provider selection/subscription
  and request lifetime. O08 endpoint/mixed performance proof and O09 remain open.

## O06i — Delete target intent and settlement continuity (accepted)

- Removed root vector/pixel/layer priority and async-target policy. Existing
  resolveDeleteTarget, vector owner, MountedDocumentAdmission, Fill transaction
  and semantic layer.delete retain their responsibilities. New intent75/hook12
  physical lines; root5190->5158, ceiling5159; engine4003 unchanged.
- Delete captures canonical invocation layer/channel and runtime. After existing
  settlement, same target/channel and ACTIVE canonical coverage are required.
  A disappeared selection cannot become unrestricted clear. Changed active
  coverage on that same target is intentionally accepted (including own transform
  settlement); this does not distinguish unrelated same-target replacements.
- Existing Fill.clearSelection now requires explicit target, avoiding stale
  React-projected layer/channel defaults while preserving its single transaction,
  history and observed raster.fill. Layer IDs copied before transform cancellation;
  runtime/document presence checked afterward. No new queue/readback/algorithm.
- Independent critic PASS plus final non-null-document guard review; actual
  session/selection/mutation/history tests with fake GPU protect disappearance,
  replacement, target/channel change, retirement and stale Fill defaults.91 tests/
  8 files, tsc/boundary/diff PASS. These are not physical GPU race reproductions.
- Baseline package55311: delete-target run-ORYxhk and selection-kernel run-nIzs8f.
  Fresh instrumented package48087: delete-target run-VQWGLu and selection-kernel
  run-3E5PCK. Actual shape+Path Selection beats active pixel selection; element
  removed/layer retained/exact undo. Actual panel multiselect deletes exact IDs
  in one history step with exact tree UndoRedo. Pending selected-pixel transform
  -> Delete gives separate prerequisite/clear history and one observed raster.fill;
  layer retained, only selected pixels cleared, whole-chain exact PNG UndoRedo.
  Painted-only coverage Delete and adjacent copy/paint/Actions pass. No page errors;
  final Delete UI inspected. Archive SHA256:
  22752209072b92b93f18d92de88a1ac449e11fa373bb6e31b73a2ec93f3cd4e7.
- Harness setup errors (invented selection.all command and unsupported createRaster
  name field) corrected against schema before baseline; failed reports retained.
  Whole-plan/O08 performance and O09 remain open. Next: closed-presentation hook
  ordering; public open=false currently precedes hooks, hidden by literal-open
  standalone caller. Then independent GenAI provider binding.

## O05f — Tool defaults and digit-input lifetime (accepted)

- Removed duplicated toolbar/F5 settings recipes, keyboard size/hardness/percent
  routing, color swap/reset and digit-buffer lifetime from Overlay. One narrow
  EditorToolSettings60-line owner and 16-line hook reuse existing stepping and
  BrushPercentInput. Settings stay in ApplicationSession through the existing
  combined-session adapter; no document, history, GPU, queue or new store.
- Toolbar color swap now reads both current colors in one functional update,
  matching keyboard semantics. Tab/blur reset digits, not shared defaults;
  ordinary tool changes retain the existing digit pairing behavior. Text and
  vector-content/gradient edits retain their separate domain owners.
- Independent critic PASS; repair rounds not needed. Focused139 tests/9 files,
  app tsc and boundary PASS. Hook tests use real application/document sessions
  but simulated React scheduling; packaged proof supplies the UI gate.
- Baseline package94225: brush run-P9Mm9f, selection-dimensions run-cBnh8w,
  Warp run-9sWq1I. Fresh instrumented package55311: brush run-10oYbq,
  selection-dimensions run-b4juMn, Warp run-j49yIq under their tmp smoke folders.
  Actual keyboard percentages, F5/toolbar shared values, presets/brackets,
  actual strokes and exact final PNG UndoRedo pass; settings alone leave
  canonical revision/history unchanged. Selection strip copy bounds/history and
  Warp live preview/two-stroke exact redo pass. No page errors; brush final UI
  inspected. Archive SHA256:
  43ed2d1f3b2d96f9f5bb0cc723ce92ee360dda5467d8b2697149e93153b27f37.
- Existing brush harness had obsolete label/native-select assumptions, corrected
  against actual controls before baseline acceptance. Bracket assertion now waits
  for actual value publication. Failed runs retained, no product fallback/retry.
  Adjacent harnesses now keep unique output; missing-error checks no longer each
  wait30 seconds. These are harness changes, not editor speed improvements.
- Overlay5405->5190 physical, ceiling5191; engine4003 unchanged. No added hot-path
  copies/readbacks/scheduling. One Warp timing run is not a performance verdict.
  Whole plan/O08 mixed-flow/performance and O09 remain open. Next: Delete-target
  priority/settlement intent, including selection/target continuity after await.

## O06h — Adjustment creation intents and exact committed results (accepted)

- Removed root applyCurves/applyAdjustment duplicate contextual/existing-local
  policy, standalone/attached menu placement, creation dispatch/result inference
  and three forward refs. AdjustmentCreationIntents60 + mounted binding57 + hook12
  physical lines replace those responsibilities; existing lower creation/mutation
  owners keep stacks, algorithms, admission and history.
- Actual DocumentSession/mutation fixture reproduced boolean return rather than
  committed ID after synchronous publication changed active selection. Existing
  creation owner now returns exact ID; local returns real changed boolean, and
  observed wrappers use those results. Adjustment-only semantic dispatcher no
  longer vetoes accepted results through later revision rediscovery.
- Critic repairs: concrete feedback lifetime includes the deferred channel updater.
  Existing Properties owner distinguishes explicit newer intent from automatic
  reconciliation: own create may reveal, newer show/begin/invalidate/retire wins.
  No second document authority or queue. Ordinary Properties tickets retain their
  earlier cancellation semantics. UI revision check uses existing queue ordering
  before its own prerequisites; no self-rejection after transform publication.
- Source critic PASS;303 tests/8 files, app typecheck/boundary pass. Service unit
  test simulates prerequisite publication with rename; actual transform is the
  packaged pointer test, not a claim about that unit fixture.
- Baseline package37304 run-uhO8S2 and fresh instrumented package94225 run-pdsHnH
  pass real Ctrl+M initial local creation; repeated shortcut/Image menu reveal
  without revision/history; explicit attached/standalone one Action each; exact
  node IDs/pixels UndoRedo; standalone Action replay; pending pointer transform
  -> immediate Ctrl+M without Enter, with two history entries and exact UndoRedo.
  Fresh report hashes app.asar SHA256
  08c6473efb49cda78f5d25f069c349c4e7dd7f5add3f11dbbe957157bf5aa856.
  Adjacent processing-rebind run-arGIBl passes same-/cross-parent first Exposure
  and tabs/history; style-entry run-bW9YdT passes real effects/locked inspector/
  Curves history. Root inspected final UI; no page errors.
- Two baseline harness fixes retained as failed reports: Clear is disabled when
  recording is empty; creation reveals Properties, so Actions must be reopened
  before Stop. Product behavior unchanged; no test retries or hidden failures.
- Overlay5,467 ->5,405 (ceiling5,406); engine4,003. No new GPU/readback/scheduler.
  Known existing specific+generic creation error reporting is not globally solved.
  No neutral-Curves precision or whole-app performance certification. Next tool
  settings owner; remaining endpoint/mixed-flow/engine work stays open.

## O05a.4 — Scoped text rasterize and positioned recovery intents (accepted)

- Deleted root rasterize callback, recovery controller retention/query ownership
  and unscoped recovery recipe/notices. LayerFinalizationIntents now handles the
  existing Layer > Rasterize > Rasterize Type entry, including truthful text
  terminal, invocation target, existing creation cancellation and admission.
  Post-preparation canonical revision reaches the existing command queue guard.
- Critic repair: actual command-service queued same-ID text replacement rejects
  before rasterizer/history through expectedDocumentRevision. Recovery offer pins
  exact positioned source and session/renderer/scope; source checked after text
  terminal and inside existing mutation recipe. Its own successful replacement
  does not suppress success feedback. No new renderer, mutation or history route.
- Independent source critic PASS;164 tests/6 files, app typecheck and boundary
  pass. Tests include actual text-property/mutation owners, no-op/failed terminal,
  queued revision rejection, exact positioned snapshot UndoRedo and hook lifetime.
- Baseline package44063 initially exposed explicitly unsupported positioned
  realization: textLayout.worker rejects it before rendering. run-zau4TK retains
  the failed original PNG attempt. Fixture is genuine production layered codec,
  bundled Inter bytes and WASM glyph ID, not a raster-only PDF or state injection.
  This is existing O08 rendering debt; no visual preservation claim or fallback.
  The gate explicitly asserts initial/Undo export rejection, exact source query
  restoration, then visible recovered flow and exact recovered/raster UndoRedo.
- Harness correction: Rasterize Type is under Layer > Rasterize, not top-level
  Type; failed run-h27v3R preserves mistaken selector. Baseline run-xBrnZe passes
  corrected route. Fresh instrumented package37304 passes run-aN2tZo; real Recover
  yields one history item, pending Size80 then Rasterize yields separate property
  and fresh-destination raster commits, editable Undo and pixel-exact Redo pass.
  Adjacent actual text-to-shape/cancel/stale-confirmation/tab proof run-OqnOZ0 passes.
  No page errors; root inspected recovered/final UI. Reports under respective
  tmp/text-finalization-intents and tmp/text-to-shape-intent-smoke run directories.
- Overlay5,487 ->5,467 physical (ceiling5,468); WebGpuEngine4,003 unchanged.
  New intent60 and mounted hook43 physical lines. No added GPU work/readback,
  queue or pointer-frequency observer. Whole endpoint and O09 remain open.
- Additional observed O08 presentation debt: recovered native Inter fixture shows
  empty Family/Face selectors despite visible editable glyphs (run-aN2tZo final
  UI). Recovery preserves a PostScript-name request; presentation falls back to
  that string, while family options use family names. This is not covered by
  the successful size/raster/history assertions and is not marked fixed.

## O06f.3 — Selection mapping and committed terminal delivery (accepted)

- createMountedSelectionCommandBinding owns the former root protocol branches
  through narrow captured controller ports. Exact registered session/renderer/
  scope is checked before settlement and immediately before lower dispatch.
  Existing selection controller, kernel algorithms and history remain owners.
- Actual DocumentSession + SelectionShapeCommandService fixture first reproduced
  three failures: All/Similar/Wand had already published canonical coverage and
  one history entry but reported false after renderer retirement during delayed
  result delivery. Lower controller now preserves its authoritative applied
  result; only stale feedback/observation is suppressed. Unstarted queued work
  remains rejected. Positive live feedback and real UI Wand observation1 versus
  retired0 are tested; no-op clear preserves exact snapshot without kernel work.
- Panel transparency now invokes existing selection.modify instead of a separate
  UI settlement recipe. Correction to initial inventory: the old route already
  recorded one Action; this is routing cleanup, not a new recording capability.
- Critic PASS;214 tests/10 surrounding files and final34/2 focused owner/service
  tests pass (overlapping sets), app typecheck and boundary pass. GPU prepared
  projection is simulated in the actual-session terminal fixture; it is not a
  claim of reproducing that exact delayed-result race through native tab timing.
- Baseline package31617 selection-kernel run-RjYq4X and Wand Actions run-NXNN67
  pass. One earlier transparency-harness assertion omitted required kind:modify;
  corrected to the existing protocol, not a product change. Fresh package44063:
  selection-kernel run-vEdRrB passes exact translated/painted coverage, copy,
  painting all80 selected columns,6228 deleted pixels with layer retained and
  exact Undo, rebind, real marquee Action replay, and Ctrl-thumbnail one-step
  transparency recording plus exact UndoRedo/Actions replay. Wand Actions
  run-rQBc6Y passes real click, explicit sampled recipe and playback on shapes.psd.
  Both final UI screenshots inspected by root; no page errors. Reports now use
  unique run directories, preserving failed and prior baseline evidence.
- Overlay5,555 ->5,487 physical lines (ceiling5,488); binding68 lines.
  WebGpuEngine stays4,003. No new GPU work, queue or per-frame subscriber.
  Remaining text rasterize/recovery intents and whole endpoint cleanup stay open.

## O06g — Mounted adjustment command binding and inspector ownership (accepted)

Final acceptance: source critic PASS after the two exposed interaction repairs.
Package31617 passes three fresh-profile processing-rebind runs: run-vhBxLX,
run-tySrRX and run-ZLghp3. Each checks canonical query clocks, inactive command
rejection without mutation, real tab/global/local history with exact PNG pixels,
and immediate attached Exposure0.01 in UI AND canonical attachment for same-parent
and cross-parent activation. Parent/sibling unchanged; attached bypass/UndoRedo
pixels exact. Final focus traces show ArrowRight on the Exposure INPUT, not BODY.
Root inspected final UI. Canvas-pick run-uVqJQg passes actual Shift add/remove,
transparent-layer skipping, zoom adjacency, zero history delta and exact PNG.

565 wider adjustment/layer/command/projection tests and72 workspace/Properties/
panel tests pass, plus final44 controller tests, app typecheck and boundary.
These overlapping counts are not a unique whole-suite total. The Dockview source
test exercises installed openPanel with a synthetic container; real focus proof
is the packaged test above. No whole-app or performance certification implied.
No additional GPU work/readback or artificial interaction delay was introduced.

Overlay5,658 ->5,555 physical lines (ceiling5,556); WebGpuEngine stays4,003.
Deleted orphan adjustmentTargetIsPresented and its test, obsolete parent-value
materialization and root attached recipe; recoverable in Git. Next: selection
command mapping and truthful post-commit terminal delivery. The whole plan is open.

Implementation and retained failed evidence:

- Basic/Detail/Snapshot/Structure command adapters and two queries moved from
  Overlay into MountedAdjustmentCommandBinding. Canonical document, processing
  and query clock come from one registered DocumentSession snapshot. Existing
  executors, command queue, history allocator and resource pruning are retained.
- Actual busy/reserved history tests exposed processing publication followed by
  compensation before admission. Changed edits now check admission before their
  first publication; genuine no-ops remain valid. Existing downstream failure
  compensation remains; this is not a claim of universal publication atomicity.
- Captured-session history projects only the currently mounted matching session
  through the existing contextual synchronizer, without another canonical write.
  Inactive semantic Undo is deliberately unavailable: the packaged test now
  checks rejection/no mutation and real UndoRedo after activation. Direct inactive
  captured-session replay is unit-test evidence only, not an exposed capability.
- Package3623 passes packaging. Old package55631 run-bpx8CG exposed query clock
  0 versus canonical3. Fresh package passes that query and global/local tab/history
  pixel checks, but attached Grade first-interaction remains a blocking failure.
  run-hCqGDc records parent Exposure -0.5 still presented after attached selection;
  a subsequent delayed run-EEmKvo passed the former pixel-toggle assertion while
  incorrectly editing from parent -0.5 to -0.49. That run is NOT acceptance.
- Strengthened immediate-interaction gate requires attached Exposure 0.01 in both
  UI and canonical attachment, with unchanged parent/sibling and exact UndoRedo.
  Source investigation confirms asynchronous layer selection republishes parent
  settings after attached inspection. Bounded owner repair and critic review are
  completed through admitted parent selection and the existing live-target
  synchronizer; no artificial UI delay, fallback or capability expansion added.
- The scoped attached-inspector repair passed source review and565 broader tests.
  Package11018 first passed the same-parent assertion but repeat run-3Jcfpx lost
  the first key entirely: Exposure focusin -> focusout -> ArrowRight on BODY.
  This is not accepted as a flaky test. Deferred Properties reveal invokes
  workspace.showPanel on an already-active panel; installed Dockview reattaches
  its content DOM on that repeated activation. Workspace-owner idempotency is
  now repaired, including cross-parent packaged proof above. A separate
  harness-only unsupported layer.createRaster name parameter was corrected to
  the existing empty parameters and returned layerId; no capability was added.

## O05a.3 — Text-to-shape intent and concrete source lifetime (accepted)

- TextToShapeIntent owns confirmation token, exact post-text-terminal target and
  current-only status/error delivery. useTextToShape owns concrete session/renderer
  lifetime and composes the existing single-transaction conversion controller.
  Root loses its controller ref/cleanup, live glyph resolver and request/Promise
  recipes. Dialog stays presentation-only; deferred publish/close use request
  identity. UI labels, geometry algorithms and command queue are unchanged.
- Confirm passes the canonical revision into existing queued admission. A target
  changed while the dialog is open is visibly rejected; retired contexts remain
  quiet. History still restores the exact editable text through the existing owner.
- Critic found an existing terminal ambiguity: untouched active flow formatting
  returned changed=false and strict transition incorrectly rejected it. Existing
  FlowTextEditingSession now exposes committed/unchanged/rejected using the exact
  transaction's unchanged predicate before closure. Boolean endFormatting keeps
  its existing changed-only meaning. Failed/stale/canceled edits do not gain an
  admission bypass. Exact layout epochs protect successor cleanup; ordinary
  rerenders do not retire pending glyph work.
- Final critic PASS after repair.72 focused tests/7 files, surrounding text and
  transition331/35 and command-service113 pass; app typecheck/boundary pass.
  Hook scheduling tests are simulated scheduling, not native browser timing.
- Old package19600 baseline run-X8VikS passed ordinary Type Cancel/Convert,
  property settlement and exact representation history. Fresh package55631:
  run-JoGqvd passes all of those plus active flow -> untouched Properties focus,
  14 native vector paths, real A/B tabs and semantic text.format while the actual
  confirmation is open. Obsolete Convert reports one visible error, preserves
  changed text/pixels and adds no history. Final UI and PNG inspected by root.
- Same package text-property-transition run-5Q2wfN passes real Size/tab/close,
  no-op focus and exact PNG UndoRedo. Harness-only run-KJ9cyJ failed on thumbnail
  title lookup before flow entry; corrected to the existing thumbnail selector,
  failure retained. No production repair was made for the selector.
- Overlay5,685 ->5,658 physical lines (ceiling5,659); new intent96 and hook72.
  WebGpuEngine stays4,003. No new GPU work, readback or frame subscription.
  This does not resolve O08's broader interactive text-preview readiness debt,
  native OS focus matrix or all text entry points. Remaining text rasterize and
  positioned-recovery UI intents still need ownership review. Next extraction:
  mounted adjustment commands/queries, inventoried in OWNERSHIP_INVENTORY.

## O07e — Scoped Remove Object source and submission (accepted)

- GenAiRemoveObjectIntent owns mounted request/notice lifetime; its thin hook
  binds exact project/service/session/renderer. Existing GenAI command retains
  provider discovery, durable imports and submission. Root pending flag and
  async command policy are deleted; no provider/job code moved into the editor.
- RemoveObjectSourceCapture settles through existing file intents and pins
  canonical document/revision and exact coverage, including paint-only masks.
  Existing mutation admission covers canonical projection/final export readiness
  through queue.submit only. Mapping, immutable CPU mask conversion and PNG
  encoding occur after release; no extra GPU mask read or new queue/cache.
- Shared readback exposes synchronous onReadbackSubmitted (not GPU completion).
  Export captures dimensions before awaiting, preventing successor metadata from
  describing old pixels. Failure cleanup remains visible and releases admission.
- Critic repairs: project/service A-B-A retires requests monotonically at layout;
  imports validate original project; CPU conversion moved outside admission;
  readback metadata pinned before callback. Final independent critic PASS.
- 52 source/intent/hook/command tests across 5 files and 32 GPU/readiness tests
  across 4 files pass; final app typecheck passes. Deferred races are labelled
  focused evidence, not claims about every real host timing.
- Fresh instrumented package19600 passes adjacent text-property-transition
  run-bS8CHb. Remove Object run-4vu8kY passes in 7.9 seconds: real Select menu,
  production asset storage/export, exact base PNG, full 320x240 grayscale mask
  with 5,196 feather pixels, exact delivery provenance, unchanged histories and
  fresh pixels in both documents. Deferred discovery + real tab switch performs
  zero imports/submissions; explicit current retry succeeds. Root viewed final UI.
- Provider catalog/workflow/cost/submit are local IPC fixtures: no paid request,
  provider quality, job persistence/polling or generated-result placement claim.
  Harness failures run-3hDSUL (normal automatic reference assets) and run-D3Ea7W
  (Electron.evaluate signature) remain preserved; production was not changed to
  pass them. Already durable assets are retained, never automatically deleted.
- Overlay 5,703 -> 5,685 physical lines, ceiling5,686. WebGpuEngine3,995 ->4,003
  for the shared readback safety contract; O09 is not complete. Next bounded
  slice: text-to-shape dialog/intent exact-target lifetime. Overall plan remains open.

## O03c.6 — Text presentation and committed opening lifetime (accepted)

- TextRenderPresentation owns shared initial/reset values, latest-only RAF,
  pending delivery and trace signature. The thin two-stage hook subscribes before
  font diagnostics and connects their stable sink afterward. Root owns only
  wiring/consumption; duplicate defaults, three refs and RAF/cleanup are deleted.
- Every pending snapshot retains the existing opening predicate through delivery.
  Critic identified the layout-to-passive-cleanup gap: useDocumentOpenLifecycle
  now creates/retires its exact guard in layout lifetime. Async startup and GPU
  teardown stay in their existing passive controller route. StrictMode receives
  a fresh guard; reset captures epochs on receipt, not before request creation.
- Final independent critic PASS after that repair.36 focused tests/7 files and
  app typecheck pass; root reran23 presentation/bridge/lifecycle tests. Simulated
  hook scheduling is labelled as such, not confused with real browser timing.
- Old package99484 baseline: text-property-transition-smoke/run-wL9HOi passes.
  Fresh instrumented package42722: run-IP3NXX passes real text Size edits,
  A/B tabs, unchanged successor, exact exported Undo/Redo, no-op focus, inactive
  close and active Cancel/Discard. Root viewed final-ui; no page errors.
- Shaping/cache policy, renderer revision values and GPU scheduling are unchanged.
  No new readback or frame queue. Whole text interactive readiness remains O08.
  Combined root after this and the admission wiring below:5,703 physical lines
  (previous5,769); ceiling5,704. WebGpuEngine remains3,995. Boundary and source
  audit pass (2,347 handwritten production files).

## Global adjustment admission — Remove Object prerequisite (accepted repair)

- Inventory found document-wide previews bypassed session admission. Existing
  adjustment owner now requires the same predicate as DocumentMutationController
  at begin, global sample and changed publication. Cancellation/no-op remain
  supported; history replay still uses its existing publisher while history busy.
- Queued current begin rejection now reaches the existing error reporter once,
  as well as rejecting file preparation. Retired/admission-rejected requests do
  not gain duplicate reporting. No new queue or mutation owner.
- Critic PASS;97 focused tests in the initial controller/adjacent run; final
  coordinator/reporting rerun62 tests/3 files passes. Nine new tests use actual
  DocumentSession admission/history. One old test reporter intentionally threw
  on any report and produced an unhandled rejection after visibility was fixed;
  that test now asserts the expected single report, not a swallowed failure.
- Package42722 processing-rebind passes global/local semantic Grade isolation,
  exact PNG history across real tabs, local Exposure projection and attached
  Grade inspector interaction. No page errors. The live UI currently has no
  document-processing inspector entry; this is not global-slider UI proof.
  Controlled barrier races are focused actual-session evidence only.
- At this prerequisite checkpoint Remove Object was not accepted; its later
  source/submission acceptance and precise limitations are recorded in O07e above.
  Provider/jobs stay in GenAI. No paid calls and no new UI entry were introduced.

## O06f.2 / O07d — Layer finalization UI and Properties entry (accepted)

- LayerFinalizationIntents replaces four Boolean(Promise) adapters with exact
  session/renderer admission, truthful text terminal and awaited command result.
  Canonical GPU finalization/history services are unchanged. Only these four
  panel actions lose duplicate text finish calls. Current admission errors are
  already reported by the existing coordinator, not duplicated by the intent.
- Contextual Ctrl+E retains existing post-settlement clicked-row interpretation;
  explicit Merge Selected and Flatten Group retain supplied IDs. Selection has
  no separate click-vs-transform-remap provenance; this is compatibility, not a
  new promise of invocation-time contextual row locking.
- PropertiesInspectorPresentation owns UI target/live ref, intent generation
  and cancellable exact-workspace panel reveal. LayerStyleEntryIntent owns only
  effect-add response -> existing editor -> inspector, not style transactions.
  Locked supported layers retain their informational inspector. Curves no longer
  has a duplicate post-command reveal; successful creation remains the terminal.
- Critic repairs require a live presentation ticket before effect dispatch and
  scope its errors to that ticket. Unmounted/superseded callbacks do not mutate
  or steal Properties. Meaningful reconciliation retires old tickets, unrelated
  document revisions do not. No new queue, GPU work or canonical state owner.
- Source critic PASS;71 focused finalization tests and15 style/inspector tests,
  app typecheck and boundary/source audit pass. Root5,769 physical lines.
- Package23243 finalization UI/default command gates pass exact PNG/history:
  tmp/layer-finalization-commands-1789219211875 and -1789219228346. Style menu
  correctly opens the effect, but run-6aFjz9 fails: PNG omits visible styles.
  This is retained product failure, not a relaxed test or selector issue.
- Bounded diagnosis confirms preexisting export omissions: native bitmap export
  did not synchronize its captured canonical document; GPU export waited text
  and assets but not lazy style pipelines. Unready style encoding intentionally
  returns no style for preview. Export now reuses finalization-source readiness,
  rejects retirement at each handoff, and shares the required canonical sync.
  Initialization invalidation is renderer-owned, not callback-object-owned.
  No added pointer work, GPU copies, queue or retry. Critic PASS and26 focused
  export/projection tests pass. Repair committed separately as7b2c28be.
- Final package99484 finalization UI run-1789219996604 passes exact tree/history/
  PNG UndoRedo. Style run-kMoQgN passes immediate effect PNG, exact effect
  UndoRedo, locked informational inspector and actual Ctrl+M standalone Curves
  target/history. Root visually inspected Curves panel and retained styles.
  No page errors. Unit races use controlled scheduling; packaged tests do not
  claim forced stale-result races or general frame-latency certification.
- Separate precision debt retained: run-cmRq6I exact neutral-Curves assertion
  failed by max1 RGB code,3644 bytes,RGBA RMSE0.108913,alpha unchanged. Existing
  enabled Grade still executes half-float processing/mix despite identity curve
  math. This fixture now verifies canonical neutral curves, max1 RGB/exactalpha
  and exact Undo/Redo to each state's pixels. This explicit assertion revision
  does not certify general neutral-bit-exactness or fix shader precision.

## O05c.2 — Scoped guide interaction and guide/grid presentation (accepted)

- DocumentGuideInteraction owns the exact session/renderer guide gesture, final
  pointer-up sample, Alt/Shift interpretation and terminal intent. Existing
  guideCommands and DocumentMutationController remain canonical/history owners.
  No replacement queue, per-move document mutation or Actions/MCP parity claim.
- Child-only draft subscription removes pointer-rate Overlay renders. Independent
  GuideGridPresentationBinding updates guide frames without rebuilding the grid;
  duplicate samples and unchanged projection inputs do not republish. Ruler tick
  arrays are memoized. Existing geometry/coarsening algorithms are reused.
- Critic repairs: live renderer check across render/layout, error lifetime separate
  from pre-edit guide freshness, and synchronous successor-draft preservation.
  Actual mutation-controller tests cover history rejection/rollback and undo/redo.
  Final critic source PASS; 35 focused owner/binding/hook/child tests pass, app
  typecheck and boundary/source audit pass. Root 5,830 physical lines, ceiling5,831.
- Prior package22846 genuinely failed final-pointer sampling: guides-smoke/run-z7AGFU
  persisted150 instead of180. The corrected harness retains that assertion;
  its terminal-sample supplement is explicitly synthetic, normal drags are real.
  Earlier run-YgcDRc was a harness hit-strip half-pixel offset, not product proof.
- New instrumented package10418 passes build/distribution/telemetry boundaries.
  Final guides-smoke/run-1aZU2b passes exact geometry/history, real ruler/move/
  drag-out deletion, no-op and undo/redo, tab isolation and unchanged PNG pixels.
  Root inspected visible GPU grid and cyan guide in final-ui.png; intermediate
  guide screenshot also inspected by harness agent. Zero page errors. Prior
  run-xFRDxY is preserved: menu ancestor/leaf selector ambiguity, corrected with
  the production show-guides identifier, no product assertion relaxed.
  Grid snapping/locking and whole-editor latency are not certified by this gate.

## O02e — Workspace tab/close and host blur owners (accepted)

- WorkspaceDocumentIntents owns synchronous text terminal admission and exact
  source revalidation for tab activation/current close. Inactive close does not
  finish active text. Missing workspace-close capability can only close the
  active editor; opening/failed documents remain closable. Host retains recovery,
  latest-activation and confirmation policy; dispatch is not terminal success.
- HostPresentationDeactivation owns the existing preserve/viewport/adjustment/
  raster-gradient/auto-align sequence. No general settlement, text finish or new
  queue on blur. The existing activity hook still owns native/browser events.
- Critic source PASS; 18 focused owner/hook tests pass (41 with adjacent text and
  activity tests); app typecheck, boundary/source audit and packaged build pass.
  Extended text run-i2i5kJ passes actual inactive close during property input,
  active close Cancel/Discard and earlier exact PNG/history checks. Native input
  blur legitimately commits the focused field once; no false claim that clicking
  an inactive close leaves a focused input pending.
- Full transform-kernel run-cbeb1a0703f7401fa4c93e84da2f0a81 passes actual auxiliary
  native-window blur, retained canvas/transform/no premature history, refocus to
  Exposure and adjacent transform/pixel/group flows. Zero page errors. Pointer
  down happened after renderer activation; the inactive-pointer race was not
  forced. Script timings include automation gestures and are not frame-latency
  certification. Unique output preserves prior reports. Root 5,864 physical lines.

## O02d — Scoped mounted admission and text terminal truth (accepted)

- MountedDocumentAdmission binds the concrete ready session, renderer/lifecycle
  and matching canonical/projected image identity. It reuses the existing
  InteractionTransitionCoordinator queue; queued requests check scope before
  settlement, between awaited participants and before successor work. No
  canonical-revision freeze: the admitted terminal may legitimately commit.
- Current unavailable UI intents report visibly; retired callbacks do not
  publish errors into successor documents. Strict prerequisites still reject.
- TextPropertyGestureController now uses its exact document transaction's
  onClose reason for transition permission. Genuine no-op commits are accepted;
  blocked/stale/canceled/failed transactions do not admit a tab transition.
  Existing changed boolean still controls Actions observation. Editing-text
  semantics are unchanged; thrown failures remain visible.
- Final interaction/adjustment/text gates pass 99 tests/8 suites; typecheck,
  boundary/source/docs audit and final packaged build pass. Text source critic and packaged
  run-CupUvS under tmp/text-property-transition-smoke PASS: actual Properties
  size32->48 then tab switch gives one history entry, no-op focus/tab allowed,
  successor pixels unchanged, exact full-PNG Undo/Redo. Screenshot inspected.
  Final package also passes text run-oZJH2i and file-intents/run-HauzdA (pending
  transform Save and immediate cold Type/Save with exact saved output).
- Final critic required registration-time identity in addition to request-time
  identity. A retained semantic callback now pins its original session, renderer
  and scope; it cannot adopt a same-ID successor. Grade, UI and semantic
  settlement share the owner. Boundary checks prohibit the old root mutation
  admission bypass. Host blur remains preserve, not an implicit commit.
- Root remains 5,873 physical lines: this slice removes admission policy but
  adds explicit wiring, not a claimed file-size reduction. Strict rejection is
  intentionally thrown; broader caller-owned stale error reporting and unrelated
  command handler lifetimes remain outside this bounded acceptance.

## O07c — GenAI reference handoff (accepted)

- Existing GenAI Setup remains the provider/workflow owner. Reference imports
  now use one captured service/project/workflow lease, including deferred React
  publication checks; durable assets are never deleted on stale attachment.
- GenAiReferenceHandoff and its mounted binding replace root base-image and
  tab-reference policy. They own only document/reference handoff, not providers,
  jobs, rendering or document mutation. One current base snapshot is retained
  across workflow changes; uncheck/recheck captures a fresh image.
- Critic round one found three deferred-state defects: tab completion revoked
  scheduled publication, cached workflow equality hid an expired attachment,
  and a new project's lease could remove an old same-ID reference. All repaired
  and exercised with actual Setup deferred-updater tests. Round two source PASS.
- Generate delivery provenance now reads the ready canonical session at actual
  submission instead of a possibly stale panel projection. This is separate
  from the still-open Remove Object submission-authority audit.
- 84 focused tests/10 suites, typecheck, boundary, source/docs audits and new
  instrumented desktop package pass. Packaged run-UpSHdP under
  tmp/genai-reference-handoff-smoke passes real base export/off/on, local file
  paste with exact encoded bytes and inactive-tab reference with exact source
  pixels. Canonical revision/history unchanged; zero page errors or submissions.
  Final screenshot inspected. Prior failures were harness selectors (Choose
  Unicode ellipsis and workspace radio role), retained separately.
- Provider catalog is fixture-backed and paid submission blocked. ClipboardEvent
  exercises UI paste, not the OS clipboard. Deferred retirement is proven by
  controlled owner/hook tests, not forced timing races in this packaged smoke.
- Overlay currently 5,873 physical lines (previous acceptance 5,932). Remaining
  host transitions, command/tool families, cross-flow/performance and O09 remain
  open; this entry is not whole-plan completion.

## O07b — Scoped PDF preflight/export (accepted)

- PdfExportPreflightSession owns one frozen preflight source and the four existing
  recipes: flattened, native text, native vector and native mixed. Existing
  planners, font materialization and lazy writers are reused unchanged.
  DocumentFileIntents exposes strict prepareForUi through its existing shared
  prerequisite implementation; no second terminal list or command queue.
- Mounted binding captures exact session/renderer/font registry and file name,
  synchronizes the post-terminal canonical document, and waits for actual text
  sources before planning. Dialog exports reuse file prerequisites and reject
  changed canonical content/fonts across awaits. Retired work cannot deliver;
  genuine current codec/preparation errors remain visible.
- Critic required non-null renderer admission before any prerequisites. The
  root's image/session handoff guard now truly blocks the mixed tuple; focused
  tests cover ready-without-renderer and previous-image/new-session cases.
- Baseline run-akeCQI under tmp/pdf-preflight-smoke passed all four formats but
  FAILED freshness: an old preflight wrote stale-plan-MUST-NOT-EXIST.pdf after
  document Grade changed. Earlier SeRd8E/V5tjXn runs were harness URL/schema
  errors (Windows PDF.js asset slash and exposureEV key), preserved separately.
- New packaged run-9OVUnn passes the unchanged gate. PDF.js independently extracts
  searchable text and native vector paths; pdf-lib verifies one correctly sized
  page; raster underlays retained; exports do not change canonical/history state.
  Old preflight now visibly rejects with no file, fresh preflight succeeds.
  Screenshots inspected. This is not pixel-perfect PDF appearance certification
  or a forced timing proof for every asynchronous retirement.
- Final integrated critic PASS; 59 focused tests/4 suites, app typecheck, boundary,
  source audit and packaged build pass. Root 6,179 -> 5,932 physical lines (audit
  ceiling 5,933); all four recipes and reason-label maps removed from root.
- Next: scoped GenAI reference handoff/Setup import lease. Separate paid Remove
  Object authority and O02 host transitions remain explicitly open in inventory;
  no live provider jobs are authorized/needed for these automated checks.

## O06f / O05f — Canonical selection consumers and scoped canvas picking (accepted)

- Selection menu/shortcut eligibility now reads canonical coverage activity;
  Similar and Add Mask use the strict selection owner. Escape has an explicit
  availability-only predicate. Active fully-clipped coverage is not inactive.
- Ordinary painted-selection Add Mask already passed on the prior package:
  the brush synthesizes provenance. Initial source review overstated that as a
  reproduced user defect. This is contract cleanup, not a demonstrated repair
  of that ordinary paint route. Baseline run-Sz7Nov and new run-8H8S7t under
  tmp/painted-selection-mask pass fresh PNG mask coverage and exact undo/redo.
  Initial run-llKsO0 timed out because the harness had not awaited selection
  history publication after gesture finish; corrected explicitly, failure retained.
- Mask requests capture one exact session/renderer scope and callbacks for
  planning, execution and completion. Stale failures cannot publish to a successor;
  current rejected results remain visible. No reveal-all substitute on unavailable
  canonical coverage and no duplicate global asynchronous error reporting.
- TransformCanvasPickIntent owns hit/terminal/selection/activation sequencing;
  mounted binding rejects mixed document-renderer handoffs and preserves ordinary
  rerenders. Existing picker, transform terminal and layer selection remain owners.
  Old root request counter and async recipe deleted, both invalidators rewired.
- First integrated packaged test FAILED Shift selection (run-0GLrb4): moving rows
  after awaited selection allowed LayerPanel reconciliation to cancel the request.
  Critic recommendation was incomplete until this actual test. Repaired by the
  existing lower selection owner's guarded synchronous accepted callback; rejected
  admission still publishes no rows. Same assertions now PASS run-ouyXCH under
  tmp/transform-canvas-pick-smoke: plain/Shift-add/remove, topmost alpha selection,
  zoom adjacency, no history/geometry change and exact fresh PNG parity.
- Final integrated critic PASS; 76 tests/5 suites, app typecheck, boundary and
  packaged build pass. Screenshots inspected. This proves these user routes, not
  universal external-store atomicity or all delayed browser timing.
- Overlay 6,181 -> 6,179 physical lines (audit ceiling 6,180). Scope checks add
  necessary wiring while complete canvas-pick policy leaves root. PDF prepared
  owner is next; O02/O07/O08 and separate O09 engine work remain open.

## O06e — Scoped automation gestures and parent-space translation (accepted)

- AutomationLayerTranslationGesture owns exact pointer/baseline/scope and uses
  existing DocumentMutationController plus group transform capture/projection.
  No new mutation/history queue. Position-locked and singular-parent targets
  reject; valid zero-delta terminal succeeds without a history entry.
- MountedAutomationGestureBinding routes four kinds to captured existing domain
  controllers. Thin hook is keyed concrete runtime, not command-port callbacks;
  ordinary zoom/rerenders retain the gesture and exact retirement closes it.
  Critic specifically required this stable lifetime; StrictMode rearms a fresh
  binding rather than retaining a permanently retired instance.
- Actual baseline failed document-space translation under a90-degree2x parent:
  local(20,20) became(44,36), expected(28,8). The correction reuses existing matrix
  projection, capturing scene terms only at begin. Failed run preserved under
  tmp/automation-gestures-smoke/; no new per-sample scene build.
- Final integrated critic PASS;51 tests/5 suites, app typecheck/boundary pass.
  Fresh packaged run-xOYJ4p passes exact parent transform across mid-gesture zoom,
  one history entry, fresh PNG undo/redo, no-op/cancel/position-lock, rectangle
  coverage and brush delivery/history. Screenshot inspected. Existing asynchronous
  selection/paint finish semantics and every operator variant are not certified
  globally by this adapter extraction.
- Root6,339 ->6,181 physical lines, audit6,340 ->6,182. Old gesture policy,
  baseline refs and forwarding refs deleted. Next canonical-selection mask/menu
  consumers and remaining layer/file/host intents; overall cleanup remains open.

## O03c.5 — Exact GPU recovery admission (accepted)

- DocumentGpuRecoveryController owns only host-wide retry budget/timers and
  lost-renderer identity. The existing opener still creates/hydrates resources.
  Required canReuseRenderer(candidate) now checks its actual retained renderer,
  not a possibly empty presentation slot or a consumed root replacement flag.
- Exact session/lifecycle/renderer/generation guards and canonical policy recheck
  run before delayed reopen. Attempts count only actual requests; StrictMode
  cleanup can rearm without losing an attempt. Two retries and30s stable-ready
  reset policy preserved. A lost candidate remains excluded even when canonical
  raster recovery is blocked. No graph inspection on normal pointer/frame work.
- Thin hook reads its captured DocumentSession via resolveGpuRecoverySource;
  missing/cleared canonical ownership is unavailable, not an empty startup.
  Root supplies only wiring and the existing reopen signal.6,390 ->6,339 physical
  lines, audit6,391 ->6,340. No new fallback or renderer/resource authority.
- Final integrated critic PASS;32 focused tests, app typecheck/boundary passed.
  Fresh packaged actual device loss: vector rehydrates with exact fresh final PNG,
  unchanged canonical layers/revision and active Vello; raster stays failed with
  unchanged canonical layers/revision rather than showing missing pixels as recovery.
  Reports: tmp/device-loss-o03c5-vector/ and tmp/device-loss-o03c5-raster/.
- Initial pre-change audit failed before loss (force seam returned false); preserved
  in tmp/device-loss-before-o03c5/. Added state diagnostics and explicit mounted
  telemetry prerequisite; loss is invoked once in the same evaluation as its
  prerequisite check, never retried after false. Fresh PNG baseline then passed
  in tmp/device-loss-before-o03c5-final-png/. Exact cause of the original startup/
  registration timing gap remains unproven, not repaired by this test condition.
- Old preview-based pixel comparison replaced with fresh PNGs, not cache
  invalidation. Whole-app readiness/frame-correlation and raster checkpoint
  rehydration remain separate risks; this is not a general device-loss cure.

## O06d — Finalization binding and committed output identity (accepted)

- LayerFinalizationCommandBinding owns host preparation/result adaptation;
  LayerFinalizationReadiness owns source preparation with exact session/renderer/
  generation checks after every await and before resumed mutation. Existing layer
  transaction/history/GPU finalization remains the sole mutation owner. Results
  now return captured destination IDs, never later active-layer selection.
- Deleted unused merge-down wrapper/private helper that rediscovered its active
  target after waiting. Boundary protections follow the extracted source owner.
  Layer command owner1,458 ->1,366 physical lines. Root6,426 ->6,390 physical,
  audit6,427 ->6,391; no new GPU queue, allocation or per-frame work.
- Final independent critic PASS;126 focused tests plus app typecheck/boundary pass.
  Fresh packaged five-finalizer gate verifies exact public result fields, one
  history entry, appearance RMSE0 and exact final PNG undo/redo. Evidence:
  tmp/layer-finalization-commands-1789207866285/. Adjacent rasterize-affordance
  (Gradient, compact paste/Grade, styles/filter, adjustment merge) and mask gates pass.
- Initial preview-only gate FAILED at text rasterize undo (RMSE4.2221), retained
  in tmp/layer-finalization-commands-smoke/; diagnostic-1789207690330 retains PNGs.
  Text creation/rasterize use final outline sources; undo initially uses glyph
  coverage or a pending-text placeholder. Same final-output PNG representation
  restores exact original pixels; no production workaround or relaxed tolerance.
  Interactive text preview readiness/outline parity is NOT fixed and remains O08.
  Latest report retains every interactive preview and its final-output difference.
- Warm small256x192 commands took roughly19-36ms, excluding test artifact exports;
  not a large-document/cold-font or user-input latency guarantee. O06e automation
  translation and other mounted command families remain open.

## O07a — Viewport wheel host binding (accepted)

- ViewportWheelBridge owns native bridge/renderer capture listeners and the
 20-sample diagnostic budget. Thin mounted hook supplies current ports; existing
  viewport controller owns pan/zoom/pending frame behavior. Root listeners/refs
  removed; no document/renderer authority or extra readback/queue introduced.
- Critic caught eager diagnostic formatting after budget exhaustion; lazy detail
  generation now avoids those target/DOM reads.4 focused tests cover current ports,
  modifiers/zoom/outside, retirement and bounded diagnostics across reconnects.
  Final source critic, app typecheck and boundary PASS.
- Fresh packaged gate: real viewport DOM wheel and public Electron bridge events
  each pan exactly once by24px; outside-window-target event does not pan; workspace
  changes retain routing. Canonical revision/history and fresh PNG exports match.
  tmp/viewport-wheel-smoke/run-NySG9v/report.json; screenshot inspected. Harness
  critic corrected outside-event targeting and replaced cached preview with fresh
  output proof. This is not physical hardware wheel or input-latency acceptance.
- Overlay6,505 ->6,426 physical lines (audit6,506 ->6,427), separate from concurrent
  O06d edits. Broader O07 feature/menu composition remains open.

## O03c.3b — Scope canvas/context lifetime (accepted)

- Follow-up proof correction: the initial unchanged-pixel check used a same-revision
  preview, which may be cached. Replaced it with fresh final-output PNG exports;
  packaged rerun passes exact exported bytes plus actual visible scope screenshots.
  This proves final-output preservation, not latest-frame identity. No production
  change or artificial cache invalidation was needed.

- ScopeCanvasBinding owns four canvas/context pairs and theme attachment;
  WebGpuScopeEngine retains GPU analysis resources/options. DocumentScopeRuntime
  applies the latest complete attachment request, including requests arriving
  during creation. Thin composition hook pins exact session/renderer lifetime.
- Actual packaged baseline showed blank GPU scopes: the runtime kept canvases
  created while detached, ignoring later mounted replacements. Failed reports
  remain in tmp/desktop-scopes-smoke/profile-cDW9SX and profile-M3W2Uk.
- Critic repairs cover delayed GPU validation reaching a successor, partial
  configure failure restoring predecessor ownership, and same-DOM theme reclaim.
  Pending creation also checks retirement before acquiring canvas ownership.
  No document writes, extra analysis resource allocation or edit-path readback.
- Final source critic PASS;26 focused tests, app typecheck and boundary pass.
  Fresh packaged scopes gate passes Hue/Parade/Vectorscope visibility, hide/restore
  and workspace remount with exact document pixels, revision and history unchanged.
  Final scopes.png visually inspected. Diagnostics removed; per-run failed reports
  are retained. Physical ColorMixer/theme interaction is not claimed by this gate.
- Overlay6,528 ->6,505 physical lines, audit6,529 ->6,506. O03 remains open for
  device-loss policy and remaining presentation. No whole-app acceptance claim.

## O05e.3 — Smart source/inference owner and freshness (accepted)

- SmartSelectionSourceSession owns readback/preparation joining, source validity,
  backend inference gate, status subscription and disposal. ToolController keeps
  pointer/region/hover, candidate presentation and semantic selection commit.
  Controller604 ->445 physical lines; audit605 ->446. New owner188 physical
  lines; no replacement monster or second state/transaction authority.
- Source key includes canonical processing adjustments/groupVisibility identity
  and global strength, independent from ImageDocument content revision. A
  canonical processing subscriber immediately retires stale candidates; layout
  preparation occurs afterward, never inside synchronous canonical publication.
  Selection/editor-only publications preserve warm embeddings. Ordinary Grade
  previews do not canonically publish processing and add no per-sample readback.
- Independent source critic PASS;62 focused tests and app typecheck/boundary
  passed at frozen integration. Controlled tests cover stale readback/inference,
  processing fields and actual-session candidate retirement/cache reuse.
- Packaged source-processing-command proves global Exposure changes pixels and
  source key from content revision0/processing-1 to revision0/processing-2,
  followed by fresh successful subject commit. Subject Actions/Undo/replay also
  passes; source-owner-lifetime preserves both documents across tool/tab departure;
  source-owner-rectangle passes. Screenshot inspected. Reports under
  tmp/object-selection-smoke/. Earlier source-processing-owner failure is a
  harness method-name mistake, retained and corrected (execute, not executeDocument).
- Visible subject13.56s cold and2.31s rebound, Rectangle6.95s include model costs,
  not editor input latency. No whole-app performance/acceptance claim. Existing
  ImageDocument-based invalidation remains conservative for metadata-only edits;
  this slice does not introduce graph scans or promise minimal cache invalidation.

## O08 — Bounded guidance correction (whole gate remains open)

- Removed obsolete active-contract permission for legacy/kernel feature switches
  and wording that an unprepared operation remains legacy. Only supported owners
  may publish; unavailable operations fail explicitly.
- Distinguished the public request/execution context from internal kernel
  transaction envelopes. Corrected generic pointer-up/blur guidance to respect
  Free Transform checkpoints and named terminal policies. Marked the S02 mask
  ownership table explicitly historical, not current fallback guidance.
- Independent documentation critic PASS after schema wording repair;
  architecture documentation audit passed. No production code changed in this
  correction. This is not the complete MD audit, source enforcement or O08 gate.

## O06c — Mounted layer command adapter (accepted)

- Removed17-kind dispatch/settlement recipes from Overlay; named adapter invokes
  existing panel, pixel, mask and mutation owners. Registered concrete session
  and renderer are pinned; each request captures its interaction generation and
  rechecks after awaited settlement/presentation before resumed work.
- Gradient/group/group-selection now return the actual admitted immutable result
  ID, including inactive canonical commands. Removed later-active-layer inference.
  Rejected creation returns null and does not change paint target. Public queued
  UI methods remain void; they do not invent synchronous IDs for async commands.
- Independent source critic PASS, no additional repair needed.175 tests/8 suites,
  app typecheck and diff checks pass. Root6,603 ->6,529 audit lines, ceiling lowered.
- Fresh instrumented package: mounted-layer-commands-smoke proves creation/group/
  duplicate exact IDs and one-step tree Undo/Redo; real New group menu records a
  result-bound rename and Actions replay targets the newly created replay ID.
  Layer-history-gesture and mask-kernel-smoke also pass. Reports under tmp/ with
  those names. No new wait/queue/readback or pointer-rate work. No latency claim.
- Package also contains in-progress Smart source extraction and temporary scopes
  diagnostics; those are separately reviewed/tested and are not accepted here.
  Scopes baseline found detached canvas references (failure evidence retained in
  tmp/desktop-scopes-smoke/profile-M3W2Uk); it does not invalidate these layer gates.
- Open: existing void panel result ambiguity is unchanged, not certified truthful
  for all rejected/no-op commands. Next O06d addresses finalization destination
  identity/readiness; automation translation remains a separate owner.

## O05e.2 — Smart Selection lifetime (bounded slice accepted)

- Prepared binding removes root backend/controller refs, deferred destruction
  timer and independent invalidation effects. Exact session/renderer lifetime
  is captured before source readback/inference; old requests cannot regain
  authority after rebind. Root6,661 ->6,603 audit lines; ceiling lowered.
- Focused tests/typecheck/source review passed, but actual packaged Select
  Subject FAILED: inference produced a high-confidence opaque candidate, then
  commit was rejected and no committed overlay appeared. Evidence retained in
  tmp/object-selection-smoke/kernel-subject-report.json. This failed run was
  retained and investigated before acceptance.
- Diagnostic rerun proved a mixed-clock check in WebGpuEngine: source and renderer
  ImageDocument revisions were compared against the kernel's DocumentSession
  invalidation stamp. The source now compares with the actual image revision;
  exact renderer and kernel address guards remain. Actual service/engine guard
  regression uses different clocks and preserves stale-content rejection. Final
  packaged Select Subject/Actions/undo/replay, Rectangle and selection-kernel gates
  pass. Correct contours visually inspected. Reports under object-selection-smoke:
  kernel-subject-fixed, kernel-subject-lifetime, kernel-rectangle-control. Original
  failed and diagnostic reports retained separately; no silent retry.
- Lifetime gate starts selection then immediately changes tool/tab. Both documents
  retain their baseline revision/history during the5s observed aftermath; secondary
  still matches after the entire subsequent inference/Actions replay. This is real
  timing, not a forced race; deferred races are covered in source tests. Cold
  Select Subject13.25s and rebound warm2.23s include inference/model costs, not UI
  input latency. Rectangle's old native-select harness was updated to the actual
  shared combobox; no product control change.
- Final source critic PASS, main32 focused controller/binding/actual-engine-guard
  tests, boundary and structure checks pass. GPU regression belongs under GPU
  tests, not an application-layer engine import. Temporary diagnostics removed.
  Typecheck passed at Smart integration; current sole error is the separately
  prepared layer adapter's required boolean return, to be integrated next.
- Critic sizing decision: retain the existing605-line tool controller under an
  explicit no-growth limit for this cutover. It owns one async tool interaction,
  not UI/document/history. Next genuine decomposition is the complete source/
  inference session (readback, prepared embedding, deduplication and disposal),
  coupled to global-processing source freshness—not arbitrary helper splitting.
- Global-processing source-key freshness remains a separate known gap; no
  claim of complete Smart Selection correctness from lifetime guards alone.

## O02c.3a — File intent and terminal ownership (bounded slice accepted)

- DocumentFileIntents owns request-time session/renderer admission and named
  prerequisites. Existing pixel, adjustment, text and layer owners perform their
  own terminal operations. Removed root artifact polling, repeated terminal lists,
  unused quick-export ref and the unused direct PNG UI route. Codecs are unchanged.
- A clean source with an uncommitted transform previously skipped Save; preserved
  failing baseline: tmp/file-intents/run-EB080m/report.json. New real keyboard
  transform -> Save and first Type click -> immediate Save prove exact saved/live
  pixels, single transform history and retained text. Final package includes the
  last mount-admission guard (verified in app.asar). Report:
  tmp/file-intents/run-N9f2jt/report.json. Actual PNG/JPEG/WebP/TIFF menu exports
  and native source-replacement/layered Save gates also pass on that package.
- Critic repairs: text creation now exposes its actual completion; layer/text
  terminals distinguish no-op from canceled/failed edits; Grade exposes explicit
  applied/unchanged/rejected and committed/unchanged/rejected outcomes. File waits
  for relevant existing admissions only. Strict prerequisite failure stops the
  successor; explicit UI terminals report failures visibly. No new queue.
- Lower host delivery pins original callbacks, session task/history identity,
  renderer/generation and mount lifetime. Layout cleanup closes admission;
  already-disposed sessions and retained callbacks cannot deliver or publish
  notices into a successor. Same-session newer edits retain truthful saved-revision
  reporting. Encoding, host cancellation and source replacement policies remain.
- Independent final source critic PASS, including boundary guard updates.
  Main combined terminal run:189 tests/10 suites; additional lower delivery/save
  tests pass. Typecheck currently has exactly one unrelated required captureScope
  port missing in the prepared, not-yet-integrated Smart Selection slice. This is
  not a claim of globally green typecheck. File source adds no pointer-rate wait,
  GPU readback or deep comparison on successful adjustment samples. Final
  boundary/source-structure/diff checks pass. No full-suite or latency claim.
- Explicit open boundary: UI completes command-producing text creation above
  the command queue. In-queue file commands reject pending creation visibly;
  recursively calling text.create there deadlocks behind the current command.
  Automatic MCP/Actions completion needs a separately defined prerequisite-command
  contract. This slice does not certify that behavior or all file/host transitions.
- Root6,683 ->6,661 audit lines (physical6,660). Smart lifetime, host/target policy,
  remaining mounted command recipes and whole-app performance/acceptance stay open.

## O06b — Scoped transactional SVG import (accepted)

- Confirmed old path awaited normalization, read whichever document the live
  getter returned, then published document before separately recording history.
  Both mounted and inactive imports now use the existing mutation.change owner;
  materialization sees current same-session edits inside that transaction. Scope
  is captured before normalization and checked again before publication.
- Removed applyDocument/recordHistory ports. No parser, normalizer, materializer,
  renderer algorithm or additional transaction owner changed. Small mounted
  binding pins the registered session plus exact renderer lifetime; inactive
  canonical import remains independent of renderer visibility. Rejected history
  compensates content through the existing mutation owner.
- Independent critic PASS,28 focused tests, typecheck and boundary pass. Fresh
  packaged active import yields one history entry and exact pixel Undo/Redo;
  inactive import does not activate its tab, rebind shows both imports and exact
  Undo/Redo preserves the earlier content. Report and inspected final image:
  tmp/svg-import-transaction/report.json and inactive-rebound.png.
- Root audit6,682 ->6,683: explicit one-line ceiling exception for the new binding
  import, not authority growth. Critic approved retaining the exact scope checks
  instead of compressing code. Next genuine file-owner extraction must lower it.
- Open: file-intent root integration and remaining command-family recipes;
  canonical command safety is not equivalent to whole editor acceptance.

## O05e.1 — Selection host and observation (accepted)

- Removed publishSelection port, its unused revision-authoring branch and all
  gesture republishing of canonical coverage/provenance. Required publishPointer
  only updates pointer chrome; kernel commit services remain sole selection
  authors. SelectionGestureHostBinding owns snap/presentation adaptation;
  SelectionCommandObservation records the exact admission-time gesture owner.
- Thin React binding captures session/renderer/generation and retires on layout
  cleanup. Critic required an additional disposed-session check before cleanup;
  repaired without denying valid owned in-flight transactions. No new readback,
  queue, mask algorithm or hot-path GPU work. Root6,745 ->6,682 audit lines.
- Adjacent confirmed defect repaired: Delete formerly used provenance.length,
  which could delete a layer for paint-only selection. Canonical active coverage
  now decides eligibility, including fully clipped active masks. Missing scope
  reports visibly and never falls through to layer deletion; no-document is inert.
- Independent source critic PASS;57 focused tests, app typecheck and boundary
  pass. Fresh instrumented desktop selection gate passes edge excursions,
  exact coverage/copy, paint bounds, tab rebind and history. Added actual keyboard
  Delete for pure painted coverage: layer retained, pixels cleared, exact Undo.
  Actual mouse marquee records one Actions shape command; replay reproduces exact
  copied bounds/RGBA. Report: tmp/selection-kernel-smoke/report.json.
- Clipboard package also passed three pasted-paint/recovery/Undo/Redo cycles on
  woman_love_walk_still_shot01.png. An earlier 546px face fixture was invalid for
  that harness's fixed800..1500 selection; failure was fixture mismatch, not hidden.
- Open: remaining smart-selection lifecycle, mounted command recipes, file
  prerequisites and UI composition. Next file terminal owner is prepared, not
  accepted; SVG normalization also exposed a separate split publication/history
  route to repair in both mounted and inactive command bindings.

## O06a — Clipboard host and Cut intent (accepted)

- Removed host clipboard read/decode, target placement, artifact lifetime and
  copy-before-clear sequencing from Overlay. ClipboardHostIntents owns host I/O;
  CutPixelsCommand composes the existing exact-copy and synchronous fill owner.
  createClipboardCommands captures the concrete session/renderer/generation at
  invocation; the React hook only supplies current ports. No new queue/history,
  persistent clipboard cache, pixel readback or per-pointer work introduced.
- Placement uses canonical cached support, including painted/sparse selection;
  active fully clipped coverage rejects visibly instead of acting unselected.
  Late host/decode completion cannot dispatch into another target. Newly owned,
  borrowed and uncertain-dispatch artifacts have explicit distinct lifetimes.
  Live transform reservations still reach the semantic settlement gateway.
- Independent integrated source critic PASS; no additional repair needed after
  prepared-owner review.34 focused tests include real DocumentSession binding;
  app typecheck, boundary and source-structure pass. Fresh instrumented desktop
  passes actual menu Copy/Copy Merged/Paste, Actions replay and MCP with exactly
  equal output pixels. Added menu Cut: selected alpha0, outside alpha255, one
  history entry and exact RGBA restoration on Undo. Report:
  tmp/pixel-clipboard-equivalence/report.json.
- Baseline harness assumption was obsolete after O03c.4: selection publication
  now advances canonical invalidation. Updated only that expectation; Copy's
  unchanged revision/history checks remain. Baseline and new package both pass.
- Overlay6,863 ->6,745 audit-counted lines. Whole-app acceptance/performance is
  still open. Remaining selection host bindings are prepared, not accepted.
  Next: selection pointer/observation ownership, then file-intent preparation;
  Save currently can overtake pending text creation or active transform edits.

## O03c.4 — Canonical revision authority (accepted)

- Discovered by the O05d real rebind test, not a speculative rewrite. Canonical
  document/processing/selection publication and pixel-only history transitions
  now stamp `DocumentSession.documentRevision` in the owning session. Only a
  synchronous owned publication coalesces stamps. No pointer-preview stamps,
  cross-await counter-based deduplication or preview-cache bypass.
- Removed command/gesture-completion and Actions-observation bumps, three
  automation task-wrapper bumps, and raster/auxiliary transform notification
  callbacks including their dead ports and error branches. New boundary guard
  prevents these authorities returning. Initial/rehydrated content stays clean;
  history owns reversible dirty state, explicit nonhistory edits retain their
  separate marker, stale save captures cannot mark newer content saved.
- Independent source critic PASS. Integrated UI transaction -> cached preview
  -> commit -> fresh preview -> undo regression passes. Compensation restores
  content while its invalidation stamp remains monotonic. Full app regression:
  647 suites / 4,220 tests pass. Old test assumptions of revision0 or revision
  equals command-count were replaced by actual admitted revision/ownership
  assertions; rollback and pixel-order checks were retained.
- New package exposed the previously recorded O08 telemetry mismatch: root
  fabricated `presentedDocumentRevision` from a current ImageDocument ref,
  while the test compared it against the unrelated public canonical clock.
  Removed that false telemetry field. Automation readiness helper was
  renamed to `waitForReadyDocument`: initial readiness only, never a guarantee
  of latest-edit presentation. Actual canvas/output assertions remain separate;
  no forced export/readback is introduced in that helper. True frame-correlated
  telemetry remains explicit O08 work.
- Final source critic PASS; current instrumented package (usual profile restored)
  passes full transform and selection gates. Face Warp debug proof below includes
  the revision repair, before the final telemetry-field-only deletion. Driver
  tests26 and syntax checks32 scripts pass. Transform harness correction was
  evidence-driven: paste with Transform already selected opened a cage;
  unconditional Ctrl+T correctly committed it. Fixture now starts on Brush and
  asserts no cage before explicit Ctrl+T. No product toggle/lease checks weakened.

## O05d.1 — Face Warp domain/lifetime extraction (accepted)

- Fresh packaged rebind proof exposed a shared canonical revision defect:
  Face Warp UI edits change document/history/canvas while public
  `DocumentSession.documentRevision` stays at 1. `document.preview` therefore
  legitimately reuses the old revision-keyed artifact. This is NOT an intentional
  Face Warp exclusion: preview and presentation read the final renderer texture.
  Evidence: tmp/face-warp-o05d-preview-diagnostic/failure.json; history11->12,
  visible157290 changed pixels, same cached artifact/revision. Independent
  critic confirmed missing revision accounting on direct UI mutation paths.
  Repaired by O03c.4 above, not a preview-cache bypass.
  Focused Face Warp owners/composition35 tests and packaged rejected-detection
  no-mutation gate pass. Whole-app/owner feel acceptance remains open.

- Gesture recipes, property intents, pure face view and exact mesh presentation
  are separate bounded owners; existing interaction/detection controllers retain
  transactions and inference. Lifecycle reset/disposal is a narrow composition
  binding. Overlay 7,176 -> 6,863 audit-counted lines including removed revision/telemetry glue.
- Independent review required exact property leases (layer/face/semantic side),
  rejection of denied/retired slider samples, scoped detection errors/results and
  retained scope for review acceptance. Repaired in the existing owners; removed
  unscoped property terminal APIs. Current failures remain visible.
- Source review passed, but the debug-package gate found a real initialization
  bug: intent scope captured renderer=null, then never rebound when the renderer
  became ready within the same generation. Explicit concrete renderer dependency
  repairs it. Stateful memo/ref rerender test passes; earlier always-recreating
  hook mocks could not detect it. Final source delta re-reviewed and packaged
  rebind rerun passed. Do not infer app acceptance from source PASS alone.
- Preserved failures: tmp/face-warp-o05d-debug and
  tmp/face-warp-o05d-escape-diagnostic. Earlier normal/instrumented package runs
  could not find the intentionally hidden experimental tool. Desktop config
  exposes Face Warp only in the debug build profile; a VITE environment flag
  alone is overridden. No product feature visibility changed.
- Packaged harness now also tests real tab rebind, mesh restoration, a fresh
  property gesture and document-composite undo parity. Debug native NVIDIA run
  tmp/face-warp-o05d-ready-gate passes detect/review/cancel/accept, identity pixels,
  sculpt/refinement, eight gestures, semantic edit and exact undo, idle, mesh
  rebind and fresh property edit. Screenshots inspected; no black holes. Captured
  rAF feedback samples5.4-6.9ms and pointer-up/refinement25.9ms are diagnostics,
  not controlled end-to-end latency proof. GPU estimate firstedit22458776 ->
  idle22461272 bytes; whole performance acceptance stays O08.
  Clipboard and selection host
  owners are prepared independently in new files only, not yet integrated or
  accepted. Whole plan remains open.

## O05c.1 — Transform cage and shared smart-guide presentation (accepted)

- TransformPresentationBinding owns only renderer-bound presentation, retained
  latest preview, snap matches and current candidate projection. Existing
  transform controller retains all edits, transactions and source geometry.
  An unchanged React checkpoint cannot replace a newer direct pointer preview;
  rejected preview clears the old cage. A single guide arbiter preserves
  selection feedback after transform exit instead of a separate nulling effect.
- Overlay 7,267 -> 7,176 lines. New owner111 + React adapter29 lines. Global
  grid/guides and viewport pan remain separate. Root no longer imports frame
  builders, owns snap matches or writes transform/smart-guide renderer slots;
  boundary guard enforces that deletion. Exact mounted/session/renderer binding;
  StrictMode setup replay supported. No new queue, history or pixel readback.
- Review repair: projection effect uses explicit relevant dependencies, not
  every React render. No extra geometry/resourceKey cache was introduced.
  Final independent source PASS; further repair not required. Focused27 tests,
  app typecheck, boundary/structure, diff and fresh instrumented package pass.
- Same packaged before/after fixture aligns two native shapes (resolved400px
  translation from a near miss), visible magenta smart guides, one history entry
  and exact undo/redo. Screenshots inspected. New script
  scripts/smoke-desktop-transform-presentation.mjs; reports/screenshots in
  tmp/transform-presentation-before and tmp/transform-presentation. Fixture
  fixes: use semantic bounds, not ink bounds of full-canvas raster; measure fit
  viewport scale, not saved custom scale. No production accommodation.
- Full transform package passes twice afterward (edge pan, selected pixels,
  multi-layer, Exposure), selection kernel passes; three active-transform close/
  reopen cycles pass with GPU estimate delta0 and heap tail growth978272 bytes.
  tmp/transform-kernel-smoke/report.json and
  tmp/quality-audit/transform-presentation-retirement/report.json. No page errors.
- Harness end-to-end ms, baseline / after1 / after2: edge468/483/470;
  selected-pixel362/355/355; Exposure210/238/221; multi-layer236/254/268.
  These include scripted input/waits and vary between runs; not a controlled
  input-to-presented-frame benchmark. O08 performance qualification remains open,
  including investigating repeatable latency regressions, not waived by these passes.
- Additional baseline limitation: imported SVG root group selected + Ctrl+T did
  not show controls. Active-close proof selects an editable vector child; group-
  node activation remains an O05/O08 question, distinct from passing multi-select.
  Next O05d.1 Face Warp policy/mesh ownership; whole plan remains open.

## O05b.2b — Exact vector runtime and Pen presentation (accepted)

- VectorRuntimeBinding compares exact session/renderer/lifecycle scope rather
  than only IDs/generation; normal document previews remain within that scope.
  All terminal entry points synchronize before finishing. Unmount cancels Pen;
  normal same-runtime tool exit still finishes a viable path once. Hook reads
  operational generation live. PenPresentationBinding owns only exact-renderer
  overlay callbacks/terminal presentation; no path, command or history owner.
- Critic repairs: active-layer preparation must synchronize too; presentation
  starts closed and layout setup opens it, including StrictMode replay. Final
  source PASS. Hook tests exercise actual construction but mock React scheduling;
  they are not complete React lifecycle proof. Overlay 7,272 -> 7,267 lines.
- Actual packaged close exposed a separate real invariant failure: workspace
  disposes DocumentSession before React cleanup; ordinary selection.reset then
  published into that disposed session. Preserved failed run:
  tmp/quality-audit/vector-document-lifecycle/report.json. Repair is explicit
  retire(), not disposed guards/catches. Retirement invalidates queued selection
  commands, wand and late paint feedback, releases exact preview leases once,
  and publishes no selection/editor state. Ordinary reset remains unchanged.
  Coordinator retirement receives captured participants instead of resolving a
  mutable latest cancel callback. Effect also follows concrete document session.
  Existing transform reset discards transient preview; no new canonical rollback.
- Focused vector/Pen/coordinator: 62 tests/5 files; selection family38/3 files;
  typecheck, boundary, structure, diff and fresh instrumented package pass.
  Independent retirement review PASS. Packaged Pen/Path Actions, gradient
  properties and shape passed before retirement repair; final package verifies
  three idle, three open-Pen and three active-Transform close/reopen cycles,
  selection kernel and Transform-to-Exposure handoff. All zero page errors.
- Reports tmp/quality-audit/vector-lifecycle-retirement-{idle,pen,transform}/report.json:
  GPU estimate delta0 each; settled heap tail growth842192/1192716/996504 bytes.
  These bounded resource checks are not a global memory/performance guarantee.
  Harness now waits for canonical no-document launcher; active-transform test
  explicitly selects an editable vector child rather than the imported group.
- Next O05c.1 transform/smart-guide presentation binding. Broader tool lifecycle,
  controller composition, property Actions and O08 performance remain open.

## O05b.2a — Current vector reads and committed observations (accepted)

- Existing vector host now reads current application document, session settings
  and selection through required getters. Removed its duplicated operational
  render snapshots, including selection mirror. Rendered renderer generation
  remains operational until O05b.2b; this round does NOT certify exact lifetime.
- Gradient creation/update retains the final transaction snapshot before commit;
  creation takes its target from commitElementCreationWithResult. It no longer
  rediscovers the active layer through a potentially stale post-commit React
  projection. VectorCommitPublisher owns committed result selection/semantic
  observation only; no second edit/history. Root mapping deleted.
- Overlay 7,317 -> 7,272 lines; vector hook 194 -> 127 lines. Focused 11 tests/2
  files pass, including real domain transactions with React rerenders withheld
  and a deliberately stale host read. This proves read/observation freshness,
  not React effect/rebinding lifecycle. Typecheck/boundary/structure and fresh
  instrumented package pass. Independent source PASS; repairs not required.
- Packaged Pen, Path Text Actions, shape/Pixels and gradient property/history
  pass. Gradient harness now also records actual creation and subsequent drag:
  exactly one vector.create with Gradient Fill metadata and one vector.update.
  tmp/vector-properties/report.json, tmp/pen-tools-smoke/pen-tools.json and
  tmp/shape-geometry-smoke/report.json. No page errors. Existing property Actions
  observation gap remains explicitly outside this pointer-commit proof.
- Next O05b.2b exact session/renderer identity, retirement before Pen completion,
  and bound Pen presentation. No whole-app/latency completion claim.

## O05b.1 — Vector/shape/gradient property boundary (accepted)

- VectorPropertyIntents owns synchronous property intent/default partition;
  vectorPropertyProjection owns contextual projection and parametric edits.
  Existing VectorToolSessionController/VectorDocumentController retain target
  admission, lock validation and atomic document/history mutation. No new queue,
  renderer access or canonical mirror. Overlay 7,435 -> 7,317 physical lines.
- Both toolbar and context menu now author selected Gradient Fill through the
  same route, preserving placement. Selected-shape creation options update only
  defaults, not geometry/history. Genuine unchanged style/geometry returns the
  original element; document owner skips it. Comparison is property-only,
  order-insensitive; style no-ops no longer clone full path geometry.
- Critic repairs: retain independent arrow dimensions/concavity; avoid unchanged
  angle reconstruction and fractional endpoint drift. Nine real-transaction
  property tests plus existing vector/style tests: 69/4 files pass. Invalid
  fixtures (gradient field, lock field, missing required null arrows) corrected;
  no production fallback/normalization added to accommodate those fixtures.
- Typecheck, boundary/structure and fresh instrumented package pass. Real UI
  toolbar/context equality, same-value no-op, exact gradient undo/redo, selected
  shape creation preferences, width edit/undo and Pixels-mode shape creation
  pass. Existing vector authoring/native/PSD roundtrip also passes. Reports:
  tmp/vector-properties/report.json, tmp/shape-geometry-smoke/report.json,
  tmp/vector-authoring-smoke/report.json. Screenshot inspected; no page errors.
  Harness fixes: click outside floating Layers; explicitly select rectangle
  before testing authored properties (creation alone keeps creation defaults).
- Final independent source PASS. No per-pointer work added. Existing property
  changes are still discrete transactions, not a newly certified continuous
  style gesture. Property Actions observation and wider vector lifetime remain
  open. Next O05b.2; no whole-app stability/performance/cleanup completion claim.

## O05a.2c2 — Text pointer precedence (accepted)

- TextPointerRouter owns point/paragraph/path hit/handle/create precedence and
  deferred miss replay. Existing six participants retain gesture/terminal state.
  Root now wires participants and passes one viewport port; no second gesture
  owner, per-frame allocation/queue/readback or new canonical authority.
- Delayed miss replay now delivers move/finish to the actual winning frame or
  draft owner; previously it unconditionally addressed paragraph creation.
  Captured deferred path hit radius preserved after critic review. Source PASS.
- Overlay 7,522 -> 7,435 lines; router102/hook7. 47 focused tests/3 files,
  typecheck, boundary/structure and fresh instrumented package pass. Packaged
  Type Tool, Path Text Actions and Paragraph pass with no page errors. Paragraph
  screenshot inspected; typing/selection and existing resize smoke exercised.
  Reports: tmp/type-tool-smoke/type-tool.json and
  tmp/screenshots/desktop-paragraph-smoke.json. This is not exhaustive handle
  geometry or whole-editor latency qualification; O08 mixed-flow proof remains.
- Next: O05b.1 property projection/intents. Read-only inventory finds divergent
  context-menu Gradient route and creation-only shape options manufacturing
  geometry edits. Pointer sessions/raster finalization remain separate work.

## O05a.2c1 — Scoped text/recovery entry (accepted)

- TextEditingEntry owns direct font gating and select/activate/enter for Layers,
  font report and post-replacement editing. Existing missing-font replacement
  keeps all preview/mutation/history ownership. Gate derives current authored
  font runs/assets directly, not possibly stale React diagnostics. Recovery
  request type moves to application boundary with all callers updated.
- Captures document/source/registry/renderer scope before layer selection;
  rechecks at activation callback. Direct hits supersede pending report entry.
  Critic repair adds phase-aware observed tool departure cancellation (including
  away/back) and scoped selection errors, allowing its own Type activation.
  Final source PASS. This observes mounted tool changes, not a new application
  tool-event stream. Shared activation/command error wrappers remain O02/O06.
- Root 7,558 -> 7,522 lines; owner99/hook11/request11. No added per-frame work,
  font loading or document/history owner. Current errors remain visible.
- 20 tests/2 files (entry + existing replacement transactions), app typecheck,
  boundary/structure and fresh instrumented package pass. Missing-font harness
  now requires the actual packaged executable. Real preview/cancel/replacement,
  one-step undo/redo and Type Tool reentry pass; no page errors. Screenshot
  inspected. tmp/missing-font-recovery-smoke/missing-font-recovery.json and
  tmp/type-tool-smoke/type-tool.json. No whole-editor performance claim.
- Next: text pointer hit/handle/draft routing out of Overlay; wider cleanup and
  endpoint source review remain open.

## O05a.2b — Text creation lifetime (accepted)

- TextCreationInteraction owns existing point/paragraph drafts, captured settings,
  foreground/path/target and one font/probe readiness intent. Font configuration
  uses captured renderer/runtime only after scope validation. Late semantic
  completion cannot steal editing focus. Existing text.create retains mutation
  admission/history/geometry; no new command execution route.
- Root 7,751 -> 7,558 physical lines; new owner186/hook10. Removed creation
  generation/path/pending caches and five forward commit/cancel refs. Every
  cancellation uses the owner, including pending point creation before a draft
  exists. Tool activation replaces dead invalidation/commit pair with explicit
  cancellation; point/vertical changes cancel before publication too.
- Critic repair1: invalidated cold preparation retires its matching paragraph
  draft, without canceling a successor. Repair2: validate and retire again at
  post-prepare continuation (microtask cancellation/target-change tests). Final
  read-only source PASS. No third repair needed.
- 60 focused tests/3 files (creation lifetime, existing builders, persistent tool
  activation), app typecheck, boundary/structure and fresh instrumented package
  pass. Explicit packaged Type Tool, Path Text Actions and Paragraph UI runs pass.
  Paragraph proof includes actual typing, reentry, drag/word/keyboard selection;
  screenshot inspected. No page errors. Evidence: tmp/type-tool-smoke/type-tool.json,
  tmp/screenshots/desktop-paragraph-smoke.json. Type sample19.2ms submit/26.6ms GPU
  P95; paragraph22.7/40.6ms. Samples, not matched whole-editor performance proof.
- Finished cold paragraphs wait both font and engine preparation; prepared
  pointer-up dispatches synchronously without a new wait. No new per-frame clone,
  GPU readback or queue. Shared command failure UI still needs O06 scoping;
  explicit failures remain visible even if follow-up activation is retired.
- Next O05a.2c scoped missing-font edit entry and text pointer routing. Wider
  cleanup, text-layout quality/latency qualification and owner acceptance remain open.

## O05a.2a — Existing-text activation (accepted)

- ExistingTextActivationController owns candidate order, immediate selection
  granularity and select-await-rehit. Existing hit/layout, editing and selection
  controllers retain their algorithms. Hook cancels on document/tool/renderer
  replacement and unmount; root getter now reads the current lifecycle generation.
- Deleted root activation revision/ref, ordering/rehit implementation and duplicate
  effect cancellation. Root 7,844 -> 7,751 physical lines; new controller88 and
  composition hook10. No new frame work, readback or command queue.
- Current layout failures release pending intent and report the original error,
  never create text. Critic repair: late selection rejection also checks request
  lifetime before reporting; canceled/retired/newer-click tests included.
- 20 tests/3 files, app typecheck, boundary and structure pass. Fresh instrumented
  package passes Type Tool plus Path Text Actions with explicit packaged executable.
  Type creation/edit/reentry/transform/history and Path Text recording/replay pass;
  no page errors. tmp/type-tool-smoke/type-tool.json; screenshot inspected.
  Recorded Type input-to-submit P95 26.5ms, input-to-GPU P95 34.1ms is a sample,
  not a matched whole-editor latency qualification.
- Next: creation-only generation/pending font/path/draft lifetime, then scoped
  missing-font edit entry. Broader O02/O03/O05-O09 and owner acceptance stay open.

## O05a.1 — Text property intents and presentation (accepted)

- Removed root defaults/format/font/fill/stroke/layout policy; pure contextual
  resolveTextProperties reuses existing style projection. Property-only controller
  owns intents and pending request identity, not typing, hit/creation, font bytes,
  canonical state or history. Existing TextPropertyGestureController retains
  formatting and RAF paint coalescing; semantic commands/conversions unchanged.
- Font loading captures document/layer/source, editing range, tool, registry and
  exact renderer scope before await. Newest request only; no transaction waits for
  font bytes. Unmount retires pending work. Writing-mode completion checks request,
  scope, layer and tool before activating anything.
- Critic repair round: preserve explicitly chosen font face on family change;
  invalidate predecessor writing-mode continuation. Source rereview PASS, no
  additional repair required. Genuine load/command errors remain observable.
- 28 focused tests/3 files, app typecheck, boundary, structure and fresh package
  pass. Packaged UI/Actions/MCP equivalence passes actual Properties Bold and
  semantic text.format recording; system font picker/authoring passes (460 faces),
  and native font-source bytes/PNG roundtrip plus tab rebind passes.
  Evidence: tmp/route-equivalence-smoke/evidence.json,
  tmp/system-font-smoke/system-fonts.json, tmp/font-source-lifecycle/report.json.
  System-font screenshot inspected; text starts near right edge in this fixture,
  so this is authoring/property proof, not full text-layout visual qualification.
- Overlay 8,028 -> 7,844 physical lines; controller155, composition hook9,
  existing presentation helper remains under250. No new per-frame document clone,
  readback, renderer wait or hidden compatibility route.
- Next O05a.2: text hit/activation/creation; wider text engine measurement,
  performance and all remaining O02/O03/O05-O09 work remain open.

## O04b.5 — Mounted adjustment gesture binding (accepted)

- useAdjustmentGestures binds latest ports, exact mounted lifecycle/renderer scope
  and reconciled target; removed first-render lifecycle capture and gesture adapter
  bodies from Overlay. Root 8,055 -> 8,028 physical lines. Existing coordinator
  203 -> 116 lines; tiny composition hook, no replacement edit/history owner.
- Deleted optional admissionless coordinator implementation. All production and
  tests use required admission plus captured owner. Reset epoch retires ended-but-
  unadmitted and discrete continuations; latest pending absolute sample only.
- Critic repair: queued sample/terminal failure cancels its acquired token and
  reports the original error (both errors if cancellation also fails). No silent
  recovery/global reset of a successor. Controller.begin failure cleanup is its
  own responsibility and is not newly certified by these coordinator tests.
- 20 coordinator tests plus transaction/scope focused checks pass; app typecheck,
  boundary, structure and fresh instrumented package PASS. Boundary guard updated
  from old WeakMap spelling to required scope/epoch/handle/admission invariants.
- Packaged transform/Exposure, processing-rebind including attached Grade master,
  and adjustment-menu live Levels/Curves/Color Grading + Actions/history PASS.
  Reports: tmp/transform-kernel-smoke/report.json, tmp/processing-rebind/report.json,
  tmp/adjustment-menu-smoke/report.json. Transform-to-Exposure harness duration
  207.94ms is NOT input-to-presented latency; no general performance pass inferred.
- Critic repaired-source PASS. The discrete boolean remains UI acceptance, not
  semantic command completion; Grade asset commands use their accepted awaited
  route. Observed-command adaptation remains for O06; broad O05 tools still open.

## O04b.4 — Contextual Grade inspector (accepted)

- resolveAdjustmentContext supplies reconciled identity, destination and lazy
  settings from the same canonical owner. Removed raw-target/reconciled-value
  disagreement when an attachment or active layer changes.
- GradeInspectorController owns master/section routing and presentation policy;
  exact attached enabled state no longer reads or changes base raster Grade.
  Existing semantic layer commands remain the only layer/history mutation path.
  Document visibility retains its existing processing projection semantics; this
  slice does not certify document visibility as a new undoable operation.
- Removed replaced Overlay policy and dead command-factory visibility API/ports.
  Overlay 8,152 -> 8,055 physical lines; new production modules below 65 lines.
  No readback, GPU allocation or settings cloning for lightweight identity reads.
- 42 focused tests/4 files, typecheck, boundary, structure and fresh instrumented
  package PASS. Independent critic final PASS, no repair requested.
- Packaged processing-rebind PASS: global/local tab and history retention;
  actual attached Grade master click leaves parent stack and sibling unchanged,
  creates one undo entry and restores byte-exact fresh PNG pixels on undo/redo.
  Report: tmp/processing-rebind/report.json. Initial harness Tab hid panels;
  removed that mistaken test input, not a product fallback or forced click.
- Open/next: O04b.5 mounted adjustment gesture binding. Existing memoized
  coordinator captures the first renderer lifecycle; fix exact live scope and
  remove remaining gesture adapters from root. Whole Overlay remains open.

## O04b.3 — Depth subscription and realization (accepted)

- LensBlurDepthRequest captures one source/scope/renderer and the originating
  Lens Blur target. Reset cancels synchronously, independent of React value changes.
  The hook owns only layout lifetime, reset epoch and low-frequency presentation;
  existing DepthAnalysisClient remains the shared model/in-flight/cache owner.
  Root no longer imports inference or contains failure-disable recipes.
- Failure settles through the existing transition route, revalidates origin and
  uses the existing synchronous adjustment controller. Critic repairs prevent
  retired settlement errors appearing on a new document, and ready/loading status
  without a result. Genuine same-source inference failures remain visible.
- DocumentEffectRuntime now invalidates depth realization identity when destroying
  image resources. Reapplying the identical cached result reuploads texture data;
  no copied arrays, cache invalidation workaround or second inference model.
- 34 focused request/progress/effect/inference tests pass, typecheck and fresh
  instrumented package pass. Packaged six-effect Lens FX run passes again, including
  focus pick one-entry exact undo/redo and tab-away/back exact PNG equality with
  unchanged document revision/history. Report: tmp/lens-fx-ui-smoke/report.json.
  Request/helper tests are not a standalone React scheduler test; real rebind covers
  the mounted hook. No input-latency/whole-app qualification inferred.
- Critic source PASS after two reported edge repairs; no unresolved blocker in
  this bounded slice. Overlay 8,154 -> 8,152 physical lines; important change here is
  lifetime correctness, not substantial root reduction. Next O04b.4 owner context.


## O04b.2 — Canvas pickers (accepted)

- Ownership/deletion: CanvasPickerController (102 lines) owns click request,
  readback/admission lifetime and terminal picker state; tiny React subscriber
  owns no edit policy. Root 8,184 -> 8,154 lines; deleted conversion/depth-sampling
  bodies and unused addPointColorSample factory/panel prop. Point Color algorithm
  stays in its existing domain helper; adjustment controller owns publication.
- Same request is checked after readback and after existing interaction settlement.
  New request, scope/renderer retirement, changed target/tool and unmount invalidate
  old callbacks. Normal focus cursor disarm preserves its already accepted click.
  No new slider queue, pointer-frequency React work, GPU copy/readback or cache.
- Critic: added real-controller tests for maximum-sample no-op, exact history,
  undo/redo, rejected history rollback, stale focus/brush/ports and visible errors.
  31 focused tests pass; typecheck, boundary/structure and fresh package pass.
- Real baseline revealed Point Color Visualize Range crashed the renderer because
  creativeBindGroup was used with another pipeline's exclusive auto layout. One
  shared explicit layout now owns both entry points. First repair incorrectly
  required filtering for float32 LUTs; critic and GPU validation caught it. Corrected
  binding types to actual shader access; descriptor tests prevent recurrence.
- Packaged Point Color full control/range/overlap/remove-all and clean-export smoke
  now passes (baseline PNG SHA 7398e196a58186a5c1926f901fe01ce189ee8989d15d8c4dfc9814b853962a23).
  Lens FX six effects exact bypass, continuous distortion preview and actual focus
  pick pass: 0.805 -> 0.005, one entry, exact final-PNG undo/redo. Final panel inspected.
  These are output and continuity proofs, not input-latency qualification.
- Final critic PASS after GPU repair. Depth-analysis reset/failure ownership and
  cached-resource rebind remain separate; no whole-O04 or whole-app claim.


## O04c — LUT/Grade asset commands (accepted)

- Done/deleted: two root import transactions and Grade paste branching now live
  in one 150-line GradeAssetCommandService. Overlay 8,375 -> 8,184 physical lines.
  Root only supplies narrow ports, calls load/paste and presents status. Import
  uses existing commitColorLookupAssetTransaction for upload/rollback/resources.
- Scope: session/renderer/generation/target captured before settlement; baseline
  captured after adjustment/transform settlement. Strict parse/upload ownership
  differs from replay, which permits new same-session renderer/inspector only.
  Same-document asset reuse and text-only missing-reference semantics retained.
- Critic repair: normal paste's old deferred callback returned true before actual
  commit. Real app recording exposed a fourth adjustment.setSnapshot after the
  expected copy/setBasic/paste commands. Removed the now-unused factory paste API;
  after already-awaited admission, the service calls the existing controller
  synchronously and returns its real result. No new admission queue/fallback.
- Proof: 47 focused real service/controller/transaction/command tests, typecheck,
  boundary/structure, fresh instrumented package; processing rebind smoke passes.
  Full Grade Look UI/Actions/MCP routes reproduce exactly three commands and two
  logical edits with exact output equivalence. Both foreign Grade LUT paste and
  Color Lookup file import survive real tabs/undo/redo with fresh PNG pixel equality.
  Same-owner copied Grade paste leaves revision/history/pixels unchanged.
  tmp/grade-look/asset-rebind-report.json and asset-rebind-final.png (inspected).
- Harness corrections: old CSS/native-select assumptions updated to current shared
  controls; opening a document correctly preserves Actions panel, so test explicitly
  selects Properties. Hidden-window screenshot timed out; final run uses the normal
  visible packaged host. No pixel/history tolerances were relaxed. The isolated MCP
  fixture emits its existing TLS-verification warning; no production setting changed.
- No new pointer-frequency work, GPU copy/readback or asset cache. Export-based
  equality is final-output proof, not an input-latency benchmark. True editor unmount
  replay and other deferred adjustment callers remain outside this accepted slice.
- Next: O04b canvas picker ownership and depth-job cancellation, then O05 domains.

## O04b.1 — Processing ownership and lifecycle projection (accepted)

- Removed canonical adjustment/visibility/strength mirrors and contextual root ref.
  DocumentProcessingBinding reads DocumentSession; AdjustmentPresentationRuntime
  owns only the one mounted inspector's staged/published projection. Partial
  processing publication clones supplied fields only; unchanged identities survive.
  Overlay 8,572 -> 8,375 physical lines; ceiling 8,376. No new GPU readback, queue
  or per-sample canonical publication. Full processing cleanup remains open.
- Removed 14 dead props through LayerPanel, LayersWorkspacePanel and Overlay,
  including unreachable global-strength gesture/reset callbacks. No visible controls
  removed. Live persistence/GPU/finalization strength and menu Grade clipboard remain.
- Critic rounds: corrected stale document-binding dependencies and inspector-runtime
  sharing; code search proved the proposed strength gesture was dead plumbing, so
  it was deleted instead of rebuilt. Packaged second-create then exposed a stale
  React-ready effect trying to project before renderer binding. Moved projection
  into the existing lifecycle, after resources/selection and before ready; exact
  current renderer required. Final source PASS; no swallowed exception/fallback.
- Proof: eight binding tests plus related processing/publication/layer-command
  runs (347/819 tests overlap; not additive), app typecheck, boundary/structure,
  fresh instrumented package. Final transform/immediate Exposure, layer subtarget,
  layer/history and font/native reopen smokes pass. Document pixel retention
  passed before final dead-prop-only removal. Reports in their tmp smoke folders.
- New tmp/processing-rebind/report.json: real global and local Grade, five tab
  changes, uncached final PNG exact equality, both undo/redo levels, current local
  Exposure control restoring -0.5/0/-0.5; no page errors, screenshot inspected.
  Automated tab click-to-ready 132–151ms includes driver overhead, not input latency.
- Proof corrections: initial wait compared session revision with ImageDocument
  revision; these diverge for global Grade. Shared driver remains unchanged and
  its diagnostics defect is tracked at O08. Preview caching could also mask rebind,
  so every comparison now uses a fresh PNG export. Export flushes rendering: this
  proves processing/resource retention, not autonomous first-frame latency.
  Shared inspector lifetime covers tab rebind, not a true Overlay unmount/remount.
- Next: O04c live LUT/Grade asset command lifetime, then remaining pickers/domain
  boundaries. No whole-plan, whole-app stability or monster-file completion claim.

## O04a — Document surface commands and crop intent (accepted)

- Done/deleted: removed duplicate resize/geometry transaction implementations
  and unused reportError mode. DocumentSurfaceCommandService owns scoped
  prerequisite settlement, planning, no-op and compound-publisher invocation.
  Root now wires ports and presents dialog closure/viewport fit. Crop intent uses
  exact committed active coverage/support, not provenance.length or a second
  asynchronous GPU measurement. Overlay 8,733 -> 8,572 physical lines.
- Boundaries: scope captures workspace/lifecycle/renderer/generation before
  settlement; document and selection baselines are read afterward because an
  active transform may legitimately commit. Existing geometry algorithms,
  commitDocumentSurfaceMutation and current-renderer surface history remain
  sole owners. No new state cache, command queue, GPU wait or runtime fallback.
- Critic: source PASS; crop/boundary re-review PASS. Corrected test fixture's
  half-float coverage to 0x3c00; no production repair requested. Other repair
  rounds not needed. Admission/history renderer are mocked in service tests;
  actual compound transaction runs there, and packaged tests supply real GPU proof.
- Proof: 41 focused tests; typecheck, boundary and fresh instrumented package.
  Packaged Image Size 1584x935->792x468, Canvas Size, rotation, interactive and
  selection Crop, geometry undo, feathered and painted selection resize/rotate/
  tab/undo/redo, and document UI/Actions/MCP capability equivalence all passed.
  Reports: tmp/image-size-smoke/1/image-size.json,
  tmp/document-geometry-smoke/report.json, tmp/layer-history-gesture/report.json,
  tmp/layer-history-gesture-painted/report.json, tmp/document-capability-equivalence.
- Performance: commands retain existing discrete GPU preparation; crop removes
  one readback. No new pointer/slider path. This is not a large-document latency
  benchmark or whole-app acceptance. Prior known performance observations remain.
- Next: O04b processing binding, including O03c read-only rebind restoration.

## O03c.2 / O03c.3a — Interaction resets and resource retirement (accepted)

- Ownership: DocumentInteractionResetPolicy names the distinct source-open,
  source-publication and rebind participant order. Participants still own their
  own sessions; rebind never clears committed selection, processing or history.
  Document GPU close binding registers once per concrete session across remounts.
  DocumentOpenController alone retires its presentation renderer.
- Deleted: root reset lists, component-local resource binding WeakSet and the
  unconditional root engine-slot clear. Overlay 8,748 -> 8,733 physical lines.
  This small line reduction is not monster-file completion. No new GPU work,
  readback, pointer scheduling or global manager introduced.
- Critic: reset policy PASS; removed a vacuous disconnected-state assertion.
  Retirement review exposed pending first-start publication before controller
  ownership. Repaired immediate presentation detach while retaining startup's
  physical cleanup until hydration unwinds; successful startup hands ownership
  over before task-completion yield. Integrated real request/controller test
  proves close clears the slot, does not destroy during hydration, and late
  cleanup neither clears nor destroys a newly opened replacement. Final PASS.
- Proof: 144 focused/related reset/resource tests and 252 controller/startup
  tests (overlapping related shards, not additive coverage); app typecheck;
  instrumented packaged layer/history gesture, font/source lifecycle and document
  pixel-retention all pass. Reports in tmp/layer-history-gesture/report.json,
  tmp/font-source-lifecycle/report.json, tmp/document-pixel-retention-smoke/report.json.
- Scope limits: arbitrary throwing observer/discard callbacks are not certified.
  Existing performance and preview parity observations above remain open; these
  lifecycle runs are not whole-app or owner-feel acceptance.
- Next: O04a surface commands. O03c processing restore stays with O04b's complete
  processing owner to avoid splitting its mirrored state across new services.

## O03c.1 — Loaded sources and document font hydration (accepted)

- Ownership: DocumentLoadedSourceBinding writes loaded source data only inside
  the existing prepared-source batch; existing-session restoration is read-only.
  DocumentSession.fontHydration owns pending/error and exact load operation;
  the mounted binding subscribes. useEditorDocumentFonts owns only embedded-host
  resources and connects to session fonts without destroying them on tab change.
- Deleted: Overlay's write-only fontAssetsRef, redundant preserved-source mirror
  for session documents, font generation/promise callbacks, registry construction,
  availability subscription and StrictMode disposal policy. 8,843 -> 8,748 lines.
  No shader, hot-pointer work, new readback/wait or general command queue added.
- Critic repair 1: retain pending/error across unmount; reject late registry
  writes after both fingerprint awaits. Embedded reset keeps stable runtime ports.
  Repair 2: re-project retained font errors after the generic rebind diagnostic
  clear. Final independent source PASS. Controlled delayed Blob/digest tests and
  runtime-factory StrictMode sequencing pass; the latter is not a mounted React test.
- Proof: 309 focused/related tests across 56 files; app typecheck, boundary,
  source-structure and fresh instrumented desktop package. Type Tool, Path Text
  Actions, layer-history gesture and two font-source-lifecycle runs passed.
  Native manifest font payloads match declared SHA-256/byte length; text, styles,
  layout and transform survive reopen; final-output PNG pixels match exactly
  before/after native reopen and across five real tab transitions. History and
  canonical revision remain unchanged on rebind. Screenshots inspected.
- Reports: tmp/font-source-lifecycle/report.json (+before/after/final.png),
  tmp/type-tool-smoke/type-tool.json, tmp/layer-history-gesture/report.json.
  Path Text harness prints completion and checks page errors; no JSON claim.
  Latest font run: export253ms, reopen290ms, automated tab click-to-ready92–158ms.
  These include driver/startup overhead, not input-latency or baseline-delta proof.
- Known limits: initial ordinary preview comparison differed at glyph edges;
  diagnostics show outline/cached versus atlas purposes. We did NOT raise a pixel
  tolerance: the critic required existing final-output PNG export on both sides,
  which passes exact equality. Cross-preview rendering parity remains separate.
  Initial Inter family resolved a system font (intentionally not embedded);
  the fixture now names the existing bundled asset explicitly to exercise real
  native binary hydration. Harness schema/default-fixture mistakes were corrected.
  Broad command-driver run stopped on text.replaceRange1217ms (>1000ms gate),
  before native roundtrip; it remains a failed performance observation, not a pass.
- Next: O03c.2 distinct interaction reset participants, then O03c.3. Whole
  lifecycle/Overlay cleanup and WebGpuEngine decomposition remain unfinished.

## O02a — Escape precedence

- Done: one application policy selects exactly one Escape participant in the
  existing order. Overlay now supplies named participant bindings only.
- Deleted: inline priority/return chain from keyboard composition. No fallback,
  new transaction/history owner, GPU operation or pointer-frequency work added.
- Ownership: `cancelActiveEditorOperation` owns precedence; text/transform/etc.
  retain their own terminal implementations. Overlay 9,090 -> 9,072 physical
  lines (audit counts trailing empty line: 9,073). This is a small extraction,
  not a meaningful resolution of the monster file by itself.
- Proof: 16 focused policy tests; keyboard/keymap adjacent tests; app typecheck;
  boundary and source-structure checks; fresh instrumented desktop package;
  `scripts/smoke-desktop-type-tool.mjs` passes text creation/edit, transform,
  Escape and text reentry. Evidence `tmp/type-tool-smoke/type-tool.json`, no
  page errors. Exact Escape input latency was not separately benchmarked; this
  discrete synchronous policy does not touch preview scheduling or GPU work.
- Critic: initial P2 recommended retaining short-circuit predicate evaluation.
  Accepted and repaired with lazy `isActive()` and ordering tests. Re-review
  PASS. Repair round 2 not needed.
- Enforcement: introduced optional per-hotspot hard `maxLines` in structure
  audit and set Overlay ceiling to current 9,073. Existing baseline not raised.
- Open: participant-owned asynchronous failure handling is unchanged. No claim
  that all tool switching/retirement is extracted or all editor flows are stable.
- Next: O02b persistent activation and preferred shortcut state, with pending
  transform settlement and document-bound successor admission.

## O02b — Persistent tool activation

- Done: PersistentToolActivationOwner owns request revision, shortcut preference,
  domain terminal ordering and accepted successor publication. Ordinary tool
  switches stay synchronous. A transform launch, queued nudge or terminal must
  settle through existing interaction admission before successor preparation.
  Repeat while pending does not duplicate launch. Stale/superseded requests
  cannot activate their tool or run an activation-dependent text callback.
- Deleted: old inline activation policy and preferred shortcut ref from Overlay;
  brush-tip normalization moved with tool preference policy. No second command
  queue, canonical tool store, renderer owner or fallback added.
- Ownership: fresh tool reads come from the existing editor-session adapter,
  including same-turn updates; no React-render-lag mirror used for activation.
  Opening binding is workspace-session ID plus renderer object/generation;
  retirement also invalidates request revision. Overlay 9,072 -> 9,051 physical
  lines; hard ceiling ratcheted to audit count 9,052. New owner is 104 lines,
  not a replacement integration root. Remaining tool algorithms stay put.
- Critic: repair 1 included queued nudge readiness in the existing pending-work
  probe. Final PASS; repair 2 not needed. Mocked readiness tests do not claim
  to independently exercise the React hook's scheduler.
- Checks: 4 focused files / 29 tests, app typecheck, boundary/structure audit,
  fresh instrumented desktop package. Packaged full transform kernel scenario,
  Type Tool -> transform -> Escape -> text reentry, and two 35-tool/3-round
  traversals passed. The final traversal waits for each requested active tool;
  zero settled DOM/listener growth, zero page or unexpected console errors.
- Harness correction: first tool traversal failed before switching because it
  queried removed lighttable-toolbox selectors. It now addresses the current
  shared toolbar and tests active publication, not clicks alone. No app control
  or behavior was changed to satisfy that test.
- Evidence: tmp/task416-tool-switching-verified/report.json;
  tmp/type-tool-smoke/type-tool.json; tmp/transform-kernel-smoke/report.json;
  tmp/transform-kernel-smoke/task416-o02b-handoff.json.
- Performance sample: same rectangle/translate/Exposure fixture and instrumented
  mode: browser-local slider feedback 16.07 -> 17.04 ms; transform settlement
  49.12 -> 48.12 ms. Exact undo/redo true, no page errors. This single before/after
  sample is a regression signal, not a statistical performance qualification.
  End-to-end harness time is not the input-to-preview metric.
- Open: outer async text/layer work that runs before requesting activation is
  still O03/O05 identity-binding work. Existing participant nudge failure policy
  was not redesigned. Temporary tools, history/save/layer-change and host-blur
  terminal policies still require O02c. Wider baseline matrix remains O01 work.
- Next: O02c history prerequisites, preserving exact opening scope across await.

## O02c.1 — History prerequisites and layer document gestures

- Done/deleted: history prerequisite ordering and the retained layer-panel
  transaction handle leave Overlay. Existing document mutation/history owners
  still perform every edit. Scope capture checks current workspace, renderer,
  lifecycle identity and generation across awaits, not canonical revision.
- Ownership: stable LayerDocumentInteractionOwner survives ordinary rerenders
  and binding updates. No fallback, second queue or canonical state introduced.
  Overlay 9,051 -> 9,035 physical lines; hard audit ceiling 9,036. These initial
  extractions remove authority, but have not yet materially reduced root size.
- Critic: repair 1 fixed owner recreation on host-binding change and a stale
  lifecycle getter. Re-review PASS; repair 2 not needed. Provider-rebind unit
  tests are not a claim of React lifecycle simulation.
- Proof: 14 focused tests, app typecheck, boundary/structure checks, fresh
  instrumented desktop package. New packaged layer-history-gesture smoke holds
  three Opacity drags across preview rerenders, observes zero interim history
  entries and exactly one terminal entry each, then keyboard undo/redo restores
  byte-identical document previews. Full transform kernel smoke also passed.
  Reports: tmp/layer-history-gesture/report.json and
  tmp/transform-kernel-smoke/report.json. No page errors. No per-sample GPU work
  or scheduling added; no new latency benchmark claimed for this slice.
- Open: existing text-creation terminal return handling is unchanged, not
  universal text durability proof. Save/export, temporary tools, host and target
  transitions remain O02c work; broader document lifecycle remains O03.
- Next: temporary override ownership and its focus/retirement wiring.

## O02c.2a — Temporary override state

- Done/deleted: four independent React booleans, the separate controller ref
  and repeated start/release/reset lists leave Overlay. TemporaryToolController
  owns one immutable tool/direction snapshot; useTemporaryTool adapts subscription
  and zoom-overlay release. Input and presentation use the same owner.
- Behavior: preserves one override (not a stack), repeat-key idempotence and
  mismatched release. Removes contradictory pan/zoom presentation on overlap.
  Overlay 9,035 -> 8,999 physical lines, audit ceiling 9,000.
- Critic: no blocking finding; repair rounds 1/2 not needed. Updated inaccurate
  persistent-tool ownership comment. Existing viewport render-captured input
  values and renderer-retirement binding remain later work, not certified here.
- Proof: focused temporary controller/router/executor tests, app typecheck,
  boundary/structure, fresh instrumented package; layer-history smoke extended
  with pan -> modifier/Space -> zoom, zoom-out -> pan, browser blur and held
  override across document-tab rebind. Exact pixels/history remain unchanged.
  Evidence tmp/layer-history-gesture/report.json and final.png.
- Harness findings: temporary erase has no current default keyboard binding;
  its controller behavior is unit-tested, not packaged-keyboard certified.
  New-document initialization resets persistent tool to Hand; the rebind test
  explicitly establishes Brush afterward instead of assuming it survives create.
  Synthetic browser blur is not native host suspension proof.
- Open/next: host/target/file terminal policy remains O02c. Projection binding
  (O03a) is the next substantive extraction, as it gives those lifecycle routes
  named publication/discard ports without changing terminal policy. Critic
  reviewed this dependency ordering; neither O02 nor O03 is marked complete.

## O03a — Document/processing projection binding

- Done/deleted: contextual presentation source-cache ref, invalidating publisher,
  active-preview retirement and canonical LUT/inspector reconciliation move out
  of Overlay. AdjustmentPresentationSynchronizer owns only derived panel caching;
  documentProjectionBinding composes the existing documentProjectionController,
  which retains its single previewDocument. Canonical owners are unchanged.
- Root remains explicit wiring. Controller identity remains scoped by the
  document adapter's setImageDocument callback, not each canonical revision.
  Overlay 8,999 -> 8,952 physical lines; hard audit ceiling 8,953. No new waits,
  queues, copies/readbacks or pointer-frequency subscriptions introduced.
- Critic PASS, repair rounds 1/2 not needed. Boundary protection moved to the
  actual policy owner while still enforcing root's active-preview-only binding.
- Proof: 22 projection/source tests, app typecheck, boundary/structure, fresh
  instrumented package. Full transform-kernel smoke includes first immediate
  Exposure after paste/transform with exact history/pixel restoration. Packaged
  layer-history-gesture and layer-subtargets passed (grade/style targeting,
  repeated opacity, exact undo/redo and two-document rebind). No page errors.
  Reports: tmp/transform-kernel-smoke/report.json,
  tmp/layer-history-gesture/report.json, tmp/layer-subtarget-smoke/report.json.
- Open: this is not full lifecycle or native host suspension proof. Optional
  embedded document handling, exact selection publication and broader command
  settlement remain named work. No whole-app stability or performance verdict.
- Next: O03b complete surface/transform selection-publication binding, including
  the distant transform adapter; then remaining lifecycle/terminal policies.

## O03b — Initial blocked gate: publication extraction and surface-history repair

- Dirty extraction removes root's generic optional-session publication branch
  and distant transform adapter. New binding captures one concrete session;
  current surface callers already require that session. Overlay is now 8,843
  physical lines (was 8,952 at accepted HEAD); ceiling is NOT ratcheted yet.
- Extra packaged resize -> other tab -> return -> undo found old GPU selection
  stores and renderer closures retained by surface history. First exception:
  Selection targets are unavailable; compensation addressed a retired renderer.
- Repair rounds 1/2 replace durable selection-texture dependence with exact
  snapshots and current same-session/device projection. Compound inverse orders
  pixels -> surface/selection -> canonical state. Replay admission is explicit.
  Corrected rebound metadata dimensions and resize shortcut. No fallback.
- Critic final source PASS is conditional on packaged exact-selection proof.
  No-selection resize/tab/undo/redo passed. Full transform/Exposure and document
  UI/Actions/MCP equivalence passed. App typecheck/boundary/structure and 27
  focused publication/history/renderer tests passed. No full-suite claim.
- Acceptance FAIL: feathered ellipse copy bounds after resize/tab/undo change
  from (74,54,292,202) to (67,47,306,216). publishSurface still uses inherited
  provenance-based support approximation instead of the exact cached mask
  support. Critic confirms the cause; the bounded follow-up is documented.
- Stop rule applied: no third silent repair loop, no accepted checkbox/commit.
  Current package contains unaccepted dirty code. Test report explicitly records
  failure instead of leaving the earlier passing report in place.
- Full evidence, scope limits and remaining tasks:
  O03B_PUBLICATION_ACCEPTANCE_REPORT.md.

## O03b — Accepted after explicitly authorized additional round

- Owner requested: "doe dan nog maar een ronde en maak het af" / "probeer het op te lossen".
- publishSurface now uses cached exact coverage.measureSupportBounds(), matching
  transform publication and the kernel contract. No readback/scan, fallback or
  new owner. Sparse-mask/provenance disagreement and active/clipped-null bounds
  are tested against actual canonical/editor projection state.
- Critic PASS. Fresh packaged feathered ellipse and three painted-selection
  runs pass resize + rotate -> other tab -> return -> undo/redo with exact
  document preview and clipboard bounds/RGBA equality.
- One painted-run attempt failed before any selection setup, while obtaining
  the preview after Opacity gestures. Original assertion omitted request detail;
  enhanced diagnostics preserve exact request/artifact failure on recurrence.
  No in-test retry added. Root cause remains unproven and is an O08 risk.
- Focused final history/session/publication/selection/renderer run: 205 tests
  across 32 files (history/session filename filters include sharded tests).
  App typecheck/boundary passed. Overlay 8,843 physical lines, ceiling 8,844.
- Final package: selection-kernel, transform/Exposure and UI/Actions/MCP document
  capability equivalence passed. Final painted screenshot visually inspected.
- This completes O03b only. Next O03c and remaining O02c; WebGpuEngine is still
  3,979 lines and neither monster-file cleanup nor the overall plan is complete.

## O07h — Document scopes presentation ownership

- Done/deleted: `DocumentScopesPresentation` now owns the mounted document's
  scope settings, visibility, histogram and error projection. Overlay's duplicate
  React state, mutable latest-value refs and private histogram scheduler are gone.
- Ownership/performance: GPU scope resources and sampling remain renderer-owned.
  Histogram publication still coalesces to one animation frame; document-open
  reads the same synchronous snapshot that React subscribes to.
- Review: focused self-review found and repaired a permanent-dispose defect that
  would have broken React Strict Mode effect replay. Disconnect now cancels only
  pending host work and the owner remains reusable. Per the owner's cost cap, no
  additional critic agent was run for this view-only slice.
- Proof: 31 focused tests/28 discovered shards, app typecheck, boundary and
  source-structure audits pass. Fresh instrumented package and packaged scopes
  signal/visibility/workspace-wake smoke pass. Executable SHA256
  `1515b88b2839b0806c22d46f4b238b60ba5c1f47bae07eebd718b9dea39581e7`.
- Hotspot: Overlay 4,866 -> 4,843 physical lines; ceiling 4,867 -> 4,844.
  New owner is 91 lines. WebGpuEngine remains 4,003 and is not claimed fixed.
- Next: bounded O08 endpoint authority scan; no WebGpuEngine decomposition under
  the current usage cap.

## O07i / O08 gate — typed document lifecycle repair

- PASS: fresh packaged transform -> immediate Exposure, exact history/pixels.
- Initial FAIL: fresh packaged multi-document soak grew 15,020 DOM nodes and
  2,034 tail listeners over 20 image/video cycles after forced GC.
- Rejected experiment: retaining/hiding the lazily created Video Controls panel
  did not alter the growth and was fully reverted. No fallback remains.
- Root cause: Dockview unmounted the visible image accessory renderers while the
  workspace projection simultaneously replaced Scopes and Properties children.
  Detached-root evidence identified one Scopes and one Grade tree per cycle.
- Repair: image children remain mounted behind typed placeholders; the automatic
  video transition retains only previously visible Dockview renderers; Properties
  pins its last image editor projection while hidden. No stale panel is exposed.
- Final PASS: the unchanged 20-cycle gate reports zero node growth, zero listener
  tail/overall growth, 66 ms median and 79 ms maximum roundtrip. Separate Scopes
  signal/visibility/workspace-wake proof also passes. Final instrumented executable
  SHA256 `2eef1682de7aa01bc4a6ca26006ab9c3b9e1e17ab67b378e11ad3cad817b2276`.
  Task 417 is complete.
- Consequence: this closes the typed-switch part of O08, not every remaining O08
  endpoint gate or O09 WebGpuEngine decomposition.

## O08 — accepted composition-root endpoint (2026-09-13)

- Done/deleted: remaining inline document-open ordering, history prerequisites,
  active-layer settlement, fixed-transform completion inference, adjustment
  observation/settlement recipes, layer-panel/selection menu policy, command
  family bodies, viewport command closures and text/rendering lifecycle effects.
- Ownership: these routes now live in small named application/composition owners;
  Overlay constructs and connects them. No alternate route, catch-and-continue,
  optional mutation port or silent fallback was added.
- Size: Overlay 4,841 -> 4,456 physical lines. The audit ceiling is ratcheted to
  4,456. New production modules remain below the plan's 350-line target.
- Focused proof: app typecheck; 95 tests/8 files; boundary, source-structure and
  diff checks pass. Source audit reports 2,399 handwritten files and zero
  accountable generated artifacts.
- Packaged proof: instrumented build/distribution/telemetry gates pass. Selection,
  transform, processing-rebind, scopes focus/workspace wake, Type, tight merge,
  rasterize affordance/local-grade/effects and pasted transform -> Exposure ->
  paint -> exact undo/redo pass. The combined paint test now captures its expected
  pre-paint state after Exposure instead of incorrectly comparing undo with the
  pre-adjustment pixels.
- Performance/resources: 20 typed image/video switches pass at 67 ms median and
  75 ms maximum with zero DOM-node growth and zero listener tail/overall growth.
- Critic: final independent review ACCEPT after fixing exact fixed-transform,
  adjustment/layer, mounted-interaction, stable viewport and renderer-fixture
  lifetimes. A packaged run then exposed and removed an unowned development-only
  renderer retirement; the owner now retires only a fixture it actually enabled.
- Open: O09 WebGpuEngine decomposition is separate. O08 does not claim the whole
  application bug-free or replace the owner's manual visual/feel acceptance.
