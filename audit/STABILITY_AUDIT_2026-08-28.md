# LightTable stability audit — 2026-08-28

## Verdict

This pass leaves LightTable with a materially stronger engineering baseline. The critical document, renderer, save/close, recovery, GenAI and binary-resource paths now fail boundedly and the tested workflows remain stable under repeated packaged-app use.

It is not yet a broadly release-qualified product. The largest remaining release gates are physical Apple Silicon/integrated-GPU qualification, streaming large save/export/recovery payloads instead of materializing complete buffers, and explicit GPU-budget/eviction policy for multiple large layered documents.

This verdict is intentionally narrower than “all features work”: it describes the paths and hardware exercised below. No external AI provider was charged or relied on during the stability evidence.

## Architecture understood

The audit followed the existing ownership model instead of adding alternate paths:

- `WorkspaceSession` owns open image sessions and canonical document state.
- The typed standalone workspace projects image and video documents into one tab model.
- `DocumentSession`, `DocumentTaskRegistry`, renderer lifecycle and history own one document's async and mutation boundaries.
- `LightTableCommandService` plus document command ports is the shared command layer for UI, actions and MCP.
- `WebGpuEngine` owns the persistent presentation renderer; document repositories retain canonical GPU layer pixels.
- Desktop main/preload boundaries own filesystem, project, recovery, credential and OS lifecycle operations.
- GenAI workflows are discovered from provider definitions and projected through the existing setup/job controllers.

No schema-version compatibility branches were added. The application remains an alpha with one current contract.

## Material changes

### Document and process lifecycle

- Bound document tasks and late callbacks to their owning document/generation.
- Prevented command ports from briefly publishing the previous tab's renderer under a newly active document.
- Made tab close and application quit wait for active saves and native close handshakes.
- Kept close fail-closed after canceled/failed saves and prompted correctly when edits occurred during a successful save.
- Added graceful two-phase desktop shutdown and bounded terminal task history.
- Preserved inactive image documents while video tabs are active.
- Resuming the same image after a video tab now reuses its retained renderer/resources instead of rebuilding the complete document surface.

### File formats, save/export and recovery

- Corrected native PNG/TIFF 16-bit decode, GPU upload, save and export paths.
- Preserved direct source-save behavior for flat JPEG, PNG, WebP and TIFF documents.
- Rejected animated PNG, animated WebP and multipage TIFF where the editor cannot represent the full source honestly.
- Bounded source probing, layered-document parsing, remote downloads, project assets, binary artifacts and recovery artifacts.
- Made desktop delivery of PDF exports use the same host-owned save route as other exports.
- Added cancellation to PSD export and tightened PDF password/error handling.
- Replaced the recovery preview's full-document empty canvas with a bounded preview strategy and atomic recovery writes.
- Closed temporary bitmaps, workers, object URLs, canvas backing stores and submitted GPU resources on all terminal paths audited.

### Rendering and memory

- Corrected memory telemetry for 16-bit coverage/mask and selection textures.
- Hardened device-loss and rejected GPU promises so teardown does not create unhandled rejections.
- Bounded layer/style/preview/palette and binary-artifact caches.
- Avoided unnecessary image resource recreation on image↔video tab switches.
- Memoized the large adjustment command family rather than rebuilding its closures on every editor render.
- Kept clipboard raster placement GPU-native; the remaining SVG-to-mask rasterization is an explicit format-conversion boundary, not the normal pixel path.

### GenAI, project and agent boundaries

- Corrected model/workflow readiness and base/reference-image state, including project-open cases.
- Kept request parameters within provider/model bounds and made local/remote generation cancelable.
- Prevented late cross-project job results from publishing into the wrong project.
- Bounded remote asset downloads and hardened credential/tunnel persistence and teardown.
- Retained the existing upload path that was already reliable rather than replacing it with the experimental MCP2 path wholesale.

## Verification evidence

| Evidence | Result |
| --- | --- |
| Full workspace verification | Passed: workspace checks, typechecks, unit/integration suites and production builds; roughly 3,970 tests across the workspace. |
| Focused app regression after memory/save changes | Passed: 108 test files, 383 tests. |
| Production-packaged soak | Passed for 60.96 minutes, 29 complete cycles, five fixtures per cycle, no crashes and no orphan processes. |
| Soak workflows | PNG, text PSD, vector PSD, PDF and large layered EHS PSD; canvas/transform, text edit, layer styles, save/export, PSD roundtrip and diagnostics. |
| Idle renderer | No submitted frames or scope analysis during measured stable idle tails. |
| Image↔video lifecycle stress | Passed 600 round trips; median 74 ms, maximum 111 ms, correct final pixels, zero net DOM-node growth and zero net listener growth. |
| Image↔video memory comparison | Post-settle growth for 300 switches fell from about 23.6 MiB to 7.9 MiB after retained-renderer resume. Longer runs show bounded V8 warm-up/compaction sawteeth rather than DOM/listener or GPU-rebind accumulation. |
| Native bitmap save/reopen | Passed for JPEG, PNG, WebP and TIFF, including PNG/TIFF 16-bit cases. |
| Recovery | Passed create, crash/restart discovery, reopen, cleanup and failure behavior with isolated user data. |
| PSD | Passed current roundtrip smoke and cancellation/error paths. |
| PDF corpus | 99/100 opened; the remaining fixture is password protected and is reported honestly rather than partially decoded. |
| Device loss | Vector document recovered automatically with exact content; raster path failed closed and requested checkpoint recovery. |
| Hardware probed | Windows 11, Core Ultra 9 285K, RTX 5090, WebGPU `candidate-recommended`. |
| Installed user build | Deliberately not attached to, inspected, restarted or terminated during final verification. |

The hour soak report is at `tmp/quality-audit/release-soak/final-hour/report.json`; the final multi-document report is at `tmp/multi-document-smoke/report.json`. These are generated evidence and are not part of the source commit.

## Performance observations

- Warm image↔video presentation is comfortably interactive on the tested machine (74 ms median full round trip in the deliberately browser-driven stress loop).
- Cold first-use timing is still dominated by WebGPU initialization. Ordinary fixtures were typically around 1.6–2.8 seconds in cold packaged launches on this machine; the largest tested PSD was slower. This misses the provisional one-second discrete-GPU target.
- The large EHS PSD reached roughly 1.3 GiB of estimated GPU allocation before the corrected 16-bit mask accounting; corrected telemetry adds the missing coverage bytes. Large layered documents therefore require an explicit budget, not just accurate reporting.
- Text input in the representative hardware probe measured about 36 ms input-to-submit p95 and 64 ms input-to-GPU p95. This is usable but should be qualified on slower devices.

## Remaining release risks and recommended order

### P0 — before broad external testing

1. Run the complete qualification and transform-with-effects workloads on physical M1/M2-class Apple Silicon and one Windows integrated GPU. The RTX 5090 result cannot predict unified-memory behavior.
2. Stream large save/export/recovery payloads across the renderer/IPC/main boundaries. Some paths still materialize a complete `File`/`ArrayBuffer` before atomic disk delivery; current hard bounds prevent runaway allocation but do not remove the peak.
3. Add an application-level GPU budget and inactive-document eviction/reconstruction policy. Accurate accounting now exposes the problem; it does not solve a multi-document 1+ GiB workload.
4. Re-run a long release soak on the exact clean release commit on each qualified hardware class.

### P1 — format and startup depth

1. Improve cold startup/WebGPU initialization toward the provisional one-second discrete target.
2. Complete real PSD 16-bit export/PSB support and broaden complex PSD parity coverage.
3. Decide and expose PDF page-selection, multipage and protected-document UX.
4. Make web-host open limits as explicit as the desktop boundary.
5. Finish the genuine `remove-object` command capability gap; the command catalog currently lists the unsupported operation honestly.

### P2 — maintainability and UX

1. Split the largest composition files by existing ownership boundaries, without redesigning the architecture: `LightTableEditorOverlay`, `WebGpuEngine`, desktop `main`, `LayerPanel` and the standalone root are the main concentration points.
2. Continue Actions/History UX refinement and broader real-user flows; the command/history plumbing is working, but feature-level polish is not equivalent to Photoshop parity.
3. Investigate Dockview detached text-property overhead (a bounded but noticeable one-time DOM/listener/GPU increase).
4. Evaluate lazy loading for wasm-vips and other large format chunks after measuring startup tradeoffs.

## Validity limits

- Verification used a dirty engineering worktree during development; the final clean commit still needs its own release-candidate signature.
- No physical Apple Silicon or low-memory integrated-GPU run was available.
- No live paid OpenArt/OpenAI/Higgsfield generation was submitted; local readiness, schema, cancellation, project and asset flows were exercised.
- The one-hour soak restarts isolated packaged processes per cycle. It complements, but does not replace, a single-process multi-hour creative session.
- One protected PDF in the corpus could not be decoded without its password.

## Bottom line

The codebase does not need a rewrite. Its central architecture—canonical document sessions, one command layer and GPU-owned rendering—is sound. The next gains come from completing resource budgeting/streaming, qualifying weaker hardware, and reducing concentration in a handful of composition roots while preserving those ownership boundaries.
