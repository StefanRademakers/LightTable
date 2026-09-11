# Task 416 progress

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
