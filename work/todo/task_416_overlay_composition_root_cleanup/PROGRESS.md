# Task 416 progress

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
