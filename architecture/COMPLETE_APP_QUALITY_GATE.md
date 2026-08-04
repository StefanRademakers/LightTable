# Repeatable complete-app quality gate

## Purpose

This is the canonical instruction for a broad LightTable quality run. Use it
when the owner asks for a complete app test, performance pass, crash/leak hunt,
tool audit, Photoshop-class responsiveness review, or equivalent work.

The protocol is intentionally inventory-driven. It must test the application
that exists at the time of the run, not the fixed list of features that existed
when this document was written.

## Persistent execution instruction

When this gate is requested:

1. Run every phase below autonomously.
2. Build and test the production Electron application, not only React units or
   a development server.
3. Repair reproducible in-scope defects, add the narrowest regression, verify,
   and commit each cohesive fix separately.
4. Re-run affected phases after every fix and the complete gate at the end.
5. Do not classify one-time lazy initialization, undo-owned resources or test
   driver delays as leaks without a stable-tail measurement.
6. Do not classify a stable but excessive allocation as healthy. Report
   bounded residency and unbounded growth separately.
7. Continue until the gate is green or a genuine external blocker has been
   exhausted and recorded with evidence.

Never overwrite source fixtures. PSD, PDF, image and LightTable corpus files
are read-only inputs. Save/export tests write to a unique temporary directory.
Preserve unrelated worktree changes and stage only files owned by the fix.

## Phase 1 — build the current capability inventory

Rebuild this inventory at the start of every run:

- tools and families from `editor/tools/toolRegistry.ts`;
- keyboard commands from `application/input/editorKeymap.ts`;
- public commands from `lightTableCommandService.ts`;
- menus, flyouts and context menus;
- inspector tabs and persistent panels;
- layer types, masks, effects and adjustment owners;
- supported open/save/export formats;
- host-specific desktop capabilities;
- every `scripts/smoke-desktop-*.mjs` scenario;
- current `work/todo/` packages;
- features changed since the previous quality-audit commit.

Create a coverage matrix in the run report. Every current tool or feature must
map to at least one of:

- a pure/command test;
- a real WebGPU fixture;
- a packaged desktop interaction scenario;
- a format round-trip/corpus scenario;
- an explicit `unavailable` result with a reason and follow-up.

`Untested` is a gate failure. When a new tool is added, the inventory grows and
the gate therefore fails until its interaction scenario exists. A new non-tool
feature follows the same rule through its command, panel, layer type or format
surface.

## Phase 2 — deterministic verification baseline

Record the commit, worktree state, OS, Electron/Chromium version, GPU adapter,
display scale, fixture identity and build mode. Then run:

```powershell
npm run verify
```

This must pass boundaries, all TypeScript projects, Wasm runtime verification,
all workspace tests, the production web build and the packaged desktop build.
Existing third-party bundler warnings are recorded separately; new warnings
are not silently accepted.

## Phase 3 — discover and run packaged desktop scenarios

Build once, then discover current desktop smokes by convention rather than
maintaining a second hard-coded list:

```powershell
npm run package:desktop:verify

$smokes = Get-ChildItem scripts -Filter 'smoke-desktop-*.mjs' |
  Sort-Object Name

foreach ($smoke in $smokes) {
  & node $smoke.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop smoke failed: $($smoke.Name)"
  }
}
```

New feature scenarios use the `smoke-desktop-<feature>.mjs` naming convention
so this phase discovers them automatically. A scenario drives the public UI or
typed automation/command boundary; it may not introduce a private mutation
implementation just for testing.

For each tool, verify where applicable:

- toolbar and flyout discovery;
- normal click, mouse-down flyout and shortcut activation;
- correct options/property bar and existing design-system controls;
- click, drag, pressure/modifier and cancel behavior;
- preview versus pointer-up result;
- exactly one semantic history entry per gesture;
- undo, redo and repeat behavior;
- mask/pixel channel behavior;
- transforms and off-canvas coordinates;
- merge/rasterize/save/reopen behavior;
- no document recomposition for overlay-only changes.

Tool-family members are individual coverage items even when they share one
toolbar button.

## Phase 4 — canvas responsiveness and retention

Run the generic packaged-canvas audit:

```powershell
npm run audit:desktop:canvas
```

The audit must cover current hot-path classes: viewport pan/zoom, selection,
paint, erase, warp, transform, masks and a representative vector/text path.
When a new hot-path class is introduced, extend the declarative action section
of the audit in the same feature commit.

Measure cold and warm behavior separately:

- input event to preview submission;
- input event to GPU completion when available;
- pointer-up to final-quality completion;
- command encoding and queue submissions;
- React commits/renders caused by the gesture;
- document, correction, viewport, overlay and scope invalidations;
- Chromium long tasks;
- heap, live DOM, total DOM, listeners and estimated GPU bytes.

Do not call the wall time of a deliberately simulated 32-step drag “lag.” The
driver intentionally spends time producing input samples. Use event-to-submit,
event-to-GPU, frame intervals and long tasks for responsiveness conclusions.

Repeat warm, non-destructive interactions at least five times. Force GC before
samples where Chromium permits it. Assess the stable tail, not sample zero:

- page errors, runtime stops and WebGPU validation errors: exactly zero;
- stable-tail live DOM growth: zero is expected;
- stable-tail listener growth: zero is expected;
- stable-tail heap growth: no monotonic unbounded trend;
- unchanged/viewport-only GPU growth: zero is expected;
- overlay-only work: no document composite submissions;
- one gesture: one undo entry unless the gesture is explicitly non-mutating.

The engineering target for direct manipulation is a 16.7 ms 60 Hz frame
budget. Results above the target are reported as parity gaps even when they do
not regress the current baseline. A regression is both:

- any correctness/lifecycle failure; or
- a statistically repeatable deterioration against the last valid baseline.

## Phase 5 — document and format matrix

Test at minimum:

- ordinary PNG/JPEG/WebP fast path;
- a layered native LightTable document;
- `D:\TextTest.psd` when available;
- `D:\shapes.psd` when available;
- `D:\FormulierPersoneel.pdf` when available;
- the current PDF corpus;
- the Save-the-Date PSD corpus requested by the owner;
- large, off-canvas, masked, styled, text, vector and adjustment-layer cases.

For external corpora, first inventory dimensions, layers and feature clusters.
Then run each file in its own desktop document runtime. Exercise layer
selection, visibility, panel switching, pan and zoom. Use at least six rounds
when a two-round run flags retained growth; this distinguishes one-time lazy
mounts from a continuing leak.

Record separately:

- first useful frame and phase timings;
- reconstruction/reference difference;
- page/runtime/console/GPU errors;
- heap, DOM, listeners and GPU stable-tail growth;
- baseline GPU residency per document;
- missing editable semantics and missing UI properties.

## Phase 6 — quality-of-life and code review pass

Use measured evidence plus `risks/current_risks.md`, `PERFORMANCE_CONTRACT.md`,
`RELIABILITY_AND_VERIFICATION.md` and `CHANGE_RULES.md`.

Review changed and implicated code for:

- React state or effects in pointer-frequency paths;
- broad invalidation where viewport/overlay invalidation is sufficient;
- eager optional pipelines, textures, fonts or panels;
- unowned subscriptions, timers, observers and GPU resources;
- duplicate layer/transform/compositor semantics;
- transactions opened by passive UI mounting;
- history entries retaining resources beyond the configured budget;
- missing error isolation, cancellation or revision guards;
- custom UI where an existing LightTable component already exists.

Do not perform a blind repository-wide rewrite. Make focused improvements tied
to evidence and preserve the architectural authorities already working well.

## Phase 7 — evidence and completion

Store transient machine-readable reports and screenshots beneath:

```text
tmp/quality-audit/<timestamp-or-run-id>/
```

Each report includes validity metadata and distinguishes `pass`, `fail` and
`unavailable`. Missing samples are never converted to zero. Parse GPU units as
KB, MB and GB.

Update a durable summary under `architecture/risks/` when findings change the
known product risk. Include:

- capability/coverage matrix;
- exact commands and fixtures;
- cold and warm measurements;
- fixes and commits;
- remaining bounded residency and parity gaps;
- follow-up priority with the responsible subsystem.

The gate is complete only when:

1. the current inventory has no unexplained coverage holes;
2. full verification passes on the final commit;
3. packaged desktop smokes pass;
4. canvas and corpus stable tails do not leak;
5. crashes and validation errors are zero;
6. every reproduced defect has a regression test;
7. remaining performance/parity gaps are quantified rather than called done;
8. `work/todo/` has been reconciled according to its queue contract;
9. all cohesive changes are locally committed;
10. unrelated user files remain untouched.

## Current baseline

The first run following this protocol is summarized in
`risks/quality_audit_2026-08-04.md`. It is a comparison baseline, not a promise
that its remaining GPU residency or text latency is acceptable.
