# LightTable architecture-first stabilization report

Date: 2026-08-22  
Verified package: `apps/desktop/out-architecture-pass-5/LightTable-win32-x64/LightTable.exe`

## Verdict

The document/workspace failure that could make source pixels disappear after tab, tool, or workspace changes is covered by a packaged regression and did not reproduce after five cross-document/workspace cycles. The architecture now keeps one active presentation renderer while document-lifetime model commands remain available for inactive documents. UI, Actions, and MCP produce identical state and pixels for the exercised semantic workflow.

This pass is not fully green. A repeated Type-tool Free Transform interaction remains reproducibly red: the first authored paragraph-text transform commits correctly, but an immediate second `Ctrl+T` does not publish a new transform overlay within 30 seconds. This is retained as a failing packaged probe and must be fixed before calling the interaction layer fully stable.

## Enforced model

- React owns application UI, panels, docking, tool options, and transient interaction state.
- A `DocumentSession` owns canonical document data, history, dirty/saved revisions, recovery identity, and document view state.
- The canvas/renderer is a projection of the active document, not a second document authority.
- Only the active document owns presentation/GPU operations. Inactive documents retain canonical model commands; unavailable renderer commands are reported unavailable instead of mounting hidden editors.
- Tool state is application-global and the persistent overlay resolves the current document at commit time.
- UI, Actions, and MCP enter through the same semantic command boundary where that command exists.
- Save pins an exact revision. Recovery cleanup removes that saved revision and stale in-flight recovery work may not publish afterward.

## Structural fixes

1. Removed active-editor-mount dependence for document-lifetime model commands. Inactive rename/history mutations now remain canonical without activating or rendering that document.
2. Made command capabilities truthful. Inactive documents advertise supported model operations but reject renderer-dependent fill/export/preview operations as unavailable.
3. Preserved document pixels and layer identity across document tabs, workspaces, and global tool changes without prewarming or hidden per-document renderers.
4. Rebound the persistent text editing controller to the current document's publication, history, command service, and document ID. It no longer records or commits through the document captured at initial mount.
5. Routed File > Export PNG and Quick Export PNG through `file.exportPng`, then delivered the resulting registered artifact to the host save boundary. UI, Actions, and MCP no longer use divergent export implementations.
6. Prevented a recovery export that becomes stale during Save from publishing after the saved revision has been committed.
7. Restored an explicit, accessible Discard action for recovery records; Recovery now exposes Preview/Open/Discard as required by the reliability contract.
8. Removed machine-local fixture dependencies and stale Preferences-dialog behavior from the critical packaged probes.

## Verification evidence

### Automated suites

- `@lighttable/app`: 504 test files, 2917 tests passed.
- `@lighttable/desktop`: 38 test files, 177 tests passed.
- Automation driver/contracts: 12 tests passed.
- App and desktop TypeScript checks passed.
- Distribution-boundary verification passed; development work/fixtures are not shipped and required text WASM assets are present.

### Packaged critical paths

- UI / Actions / MCP route equivalence passed for editable rectangle, ellipse, Pen path, text creation, two text-edit transactions, text formatting, rename, transform, PNG export, undo/redo, result binding, publication events, and rejection behavior.
- All three rendered route comparisons were pixel-exact at 640 x 480: RMSE 0, maximum delta 0, changed-pixel ratio 0.
- The PNG delivered by File > Export PNG was pixel-exact to the canonical UI preview.
- Document pixel retention passed for two differently sized images over five document/workspace/tool cycles. Layer IDs and non-empty pixel coverage remained intact; no page errors occurred.
- A model command against the inactive document changed its canonical revision/history without changing the visible document.
- Recovery Open/Discard passed against the packaged app.
- Active/inactive capability equivalence passed.

Evidence artifacts:

- `tmp/route-equivalence-smoke/evidence.json`
- `tmp/document-pixel-retention-smoke/report.json`
- `tmp/recovery-smoke/`
- `tmp/document-capability-equivalence/`

### Short resource/stress sweep

Four iterations each passed for `architecture/ui/1.png` and `icon/logo_emblem.png`, with no recorded failures or suspicious stabilized growth.

- Stabilized JS heap growth: 46,824 bytes and 27,184 bytes.
- Stabilized DOM growth: 0 for both files.
- Stabilized listener growth: 0 for both files.
- Overall measured heap ended about 465-497 KiB below its initial sample.

The current packaged harness reported zero GPU-growth samples. This must be treated as a telemetry blind spot, not as proof of zero VRAM use. The independent document projection did report realistic estimated GPU allocations during the retention test.

Evidence: `tmp/stress/architecture-pass.json`.

## Remaining red and limitations

### P0 interaction race: repeated text Free Transform

`npm run smoke:desktop:type-tool` is deliberately red. With a real paragraph string, the first `Ctrl+T` opens a transform overlay, the pointer edit commits one semantic history entry, and the layer transform changes. Directly opening a second Free Transform then times out waiting for `Transform controls`.

Likely investigation boundary: transform-controller teardown, persistent transform-tool state, and the keyboard context's `transforming` snapshot immediately after commit. Do not remove or loosen this assertion; fix the state transition and keep the probe.

### Telemetry and build debt

- The stress probe cannot currently prove GPU-resource release because its GPU-growth channel remains zero.
- Vite packaging still emits the `inlineDynamicImports` deprecation warning.
- The packaged renderer is served by Electron's internal loopback host. It is bundled and does not depend on an external Vite dev server, but its lifecycle remains an important startup/crash boundary to keep testing.

## Commits in this stabilization chain

- `237d4e2e` preserve document pixels across renderer rebinding
- `6d216f1a` tighten bounded desktop stability tests
- `b76ab682` decouple document commands from active editor mount
- `7d067058` avoid save verifier source lock race
- `7aa57aaf` make sampled brush actions smoke self contained
- `ae4245d6` report document command capabilities honestly
- `b6430b38` prevent stale recovery publication after save
- `35f2f6bc` converge active document text and PNG routes
- `2343775e` restore explicit recovery discard workflow
- `80972532` make packaged stabilization probes self contained

## Release recommendation

The catastrophic document-loss/stale-document path exercised here is materially stronger and currently green. Do not label the editor interaction layer release-ready until the repeated text Free Transform probe is green and GPU release telemetry records non-zero, interpretable samples.
