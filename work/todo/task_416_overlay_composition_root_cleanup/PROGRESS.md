# Task 416 progress

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
