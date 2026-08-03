# LightTable GPU text execution tracker

Status: active execution and handoff plan

Last reviewed: 2026-08-02

Architecture source: [`../../research/LIGHTTABLE_GPU_TEXT_AND_DOCUMENT_TEXT_ARCHITECTURE.md`](../../research/LIGHTTABLE_GPU_TEXT_AND_DOCUMENT_TEXT_ARCHITECTURE.md)

PDF reference: [`../pdf/PDF_TEXT_RENDERING_REFERENCE.md`](../pdf/PDF_TEXT_RENDERING_REFERENCE.md)

This document is the daily source of truth for implementing editable GPU text
in LightTable. The research document explains the complete target architecture;
this tracker divides it into independently verifiable vertical slices that may
be completed by different agents over multiple days.

The app must remain loadable, testable and buildable after every checked slice.
Unchecked target behavior must never be described as current behavior.

## 1. Product outcome

LightTable will support first-class editable text without visible DOM, CSS,
SVG or Canvas2D rendering. Text shaping and layout run in a lazy Rust/WASM
worker. Visible text, caret, selection, transforms, compositing and effects run
through WebGPU and the existing document renderer.

The implementation has two canonical authoring sources:

- `FlowTextSource`: Unicode text with style and paragraph runs for normal
  authored text and recoverable PSD text;
- `PositionedTextSource`: exact glyph IDs, positions and matrices for PDF and
  fixed-layout interchange.

Both sources realize to one renderer-neutral `RealizedTextLayout`. Runtime
atlas entries, glyph blobs, outline geometry and settled layer textures are
discardable caches. They are never serialized as the editable source of truth.

## 2. Fixed decisions

- Rust targets `wasm32-unknown-unknown`; no native-only text implementation.
- Web and Electron consume the same generated WASM module and worker client.
- Parley + Fontique + HarfRust + Skrifa + ICU4X is the initial layout stack.
- The first production live renderer is a hinted single-channel coverage
  atlas with instanced WebGPU quads.
- `hb-gpu` is evaluated as the scale-independent/high-zoom renderer before a
  custom direct-outline renderer is built.
- MSDF is not a phase-one dependency. It is reconsidered only with benchmark
  evidence.
- Text caches use the smallest relevant revisions and explicit byte budgets.
- Inactive text is never semantically flattened. Optional rasterization is a
  tight or tiled, evictable GPU source cache.
- PDF positioned glyphs are not reshaped by default.
- PDF-compatible Illustrator files may be imported through their PDF
  representation. Native Illustrator round-trip is not claimed.
- The existing `lighttable.inspector` workspace panel ID is retained and
  evolves into a contextual Properties panel. Text does not create separate
  permanent Character and Paragraph windows or invalidate saved layouts.

Any change to these decisions must record evidence and update the architecture
document in the same milestone.

## 3. Status and evidence rules

Use only standard Markdown task states:

- `[ ]` means not verified, including partially implemented work;
- `[x]` means implemented and verified against the listed gate.

Do not check a parent slice until all required child tasks, tests and manual
checks for that slice pass. Experimental branches may exist without changing
checkboxes. Record partial work in the execution log.

Every completed slice records:

- owner or agent;
- commit hash;
- focused test command and result;
- last successful web build;
- desktop dev/package result when required;
- manual UI verification notes or `not applicable`;
- known limitations intentionally left to a later slice.

## 4. Multi-agent ownership protocol

One agent owns one slice at a time. Before editing, place the slice number,
owner and start revision in the claim table. An agent may inspect another
slice, but must not edit files owned by another active slice without direct
coordination.

Parallel work is allowed only when dependencies are green. Useful parallel
lanes are:

| Lane | Owns | May run beside |
|---|---|---|
| A — model | contracts, validation, persistence, commands | renderer spikes after contracts freeze |
| B — WASM/layout | Rust workspace, bindings, layout worker, font parsing | UI shell using typed mocks |
| C — WebGPU | atlas, glyph blobs, render plans, compositor integration | layout work against fixtures |
| D — UI/UX | tool registry, property bar, layers, overlays, accessibility | backend work behind capability gate |
| E — interchange | PSD/PDF/AI adapters and fixtures | only after canonical text contracts freeze |

### Active claims

| Slice | Owner | Started from | Status/notes |
|---|---|---|---|
| 13 | Codex `/root` | `ca4f2f0` | Active: settled source cache and interaction performance |

Handoff requirements:

1. Leave the branch/worktree buildable.
2. Update the slice checklist and execution log.
3. List changed contracts and cache revisions.
4. List exact remaining work; never use “finish integration” as a task.
5. Release the claim or identify the blocking dependency.

## 5. Always-green build contract

### Per cohesive slice

- focused unit and shader tests pass;
- `npm run verify:boundary` passes;
- `npm run typecheck` passes;
- `npm run build:web` passes when shared runtime/UI code changed;
- ordinary raster open, pan/zoom, grading and save paths remain unchanged;
- disabled/unavailable text capability performs no recurring work.

### At every phase boundary

- `npm test` passes;
- `npm run build:web` passes and the distribution boundary passes;
- `npm run package:desktop:verify` passes;
- `run_clean.bat` starts a fresh Electron development session;
- web dev starts through `npm run dev:web`;
- one manual web smoke and one packaged Electron smoke are logged;
- no research, fixtures or Cargo build caches occur in distributions.

### Rust/WASM build contract

- one pinned Rust toolchain and committed `Cargo.lock`;
- `wasm32-unknown-unknown` target checked with an actionable setup error;
- generated bindings are reproducible from one npm command;
- developer/CI setup is explicit; end users never require Rust;
- `run_clean.bat`, `run_dev.bat`, `build.bat` and shell equivalents call one
  shared “ensure text WASM” script;
- Cargo incremental caches survive normal clean-dev runs;
- Vite emits WASM and worker assets for both hosts;
- no text WASM is fetched or initialized until text capability is requested;
- worker cancellation and late-result revision guards are tested.

## 6. Existing UI/UX integration map

Text uses the existing interaction language. It must not add a private control
library or a second overlay/compositor.

| Concern | Existing integration point | Text usage |
|---|---|---|
| Tool identity and shortcuts | `editor/tools/toolRegistry.ts`, `editor/session/editorSession.ts`, `application/input/editorKeymap.ts` | `T` activates the remembered text-family member; `Shift+T` cycles point, paragraph and later path text |
| Grouped toolbar slot | `editor/ui/EditorToolbar.tsx` | Text family behaves like selection/shape families; normal click activates and opens/keeps the subgroup according to existing family behavior |
| Fixed and right-click options | `editor/ui/ToolOptionsBar.tsx`, `ToolOptionsContextMenu.tsx` | Both surfaces bind to the same text tool settings model |
| Pointer routing | `application/input/viewportPointerRouter.ts` and composition controllers | Route click/drag to create point text or paragraph frames without putting raw pointer streams in React state |
| Canvas surface | `editor/ui/DocumentViewportSurface.tsx` | Hosts only focus/input elements; visible selection and caret remain GPU overlays |
| GPU overlays | vector/selection editing overlay builders and `WebGpuEngine` overlay pass | Add renderer-neutral text caret, selection, baseline and frame overlays without document recomposition |
| Layer rows and menus | `editor/ui/LayerPanel.tsx` | Text type icon, thumbnail, missing-font badge, edit/rasterize/convert actions and text-layer-safe style controls |
| Status and diagnostics | `editor/ui/EditorStatusBar.tsx`, `editor/ui/DebugPanel.tsx`, debug log and render telemetry | WASM availability, font substitution, atlas/cache stats and phase-specific errors |
| Shared workspace | `composition/workspace/*` and `editor/workspace/workspacePanelRegistry.ts` | Preserve panel ID `lighttable.inspector`, change its user-facing role to contextual Properties, and switch between Grade, Text, Vector and general layer content without invalidating saved layouts |
| Async progress | `application/tasks/documentTaskRegistry.ts` | Font import, PDF/AI import and export use cancellable document tasks with stale-result guards |

### UI exposure rule

Each phase exposes only behavior that is vertically complete. Backend-only
work is visible through Debug diagnostics, not through disabled production
controls. A production Text tool appears only after create, render, undo,
save/reopen and safe failure behavior work together. Unsupported properties
remain absent or explicitly labeled; they never silently no-op.

Text controls follow one targeting rule:

- without an active text range, controls change document-scoped text authoring
  defaults in `EditorSession`;
- with an active text layer/range, controls create canonical text commands;
- mixed runs show an explicit mixed value and never borrow the first run's
  value silently.

The options bar holds frequent controls only: family, face, size, fill and,
when complete, alignment plus edit commit/cancel. Contextual Properties owns
tracking, leading, baseline, paragraph, OpenType/variation and compatibility
details. Both surfaces dispatch the same commands.

## 7. Dependency sequence

```text
Phase 0 toolchain/contracts
  -> Phase 1 canonical model/fonts
     -> Phase 2 layout + renderer
        -> Phase 3 point-text product slice
           -> Phase 4 paragraph/rich/international text
              -> Phase 5 outlines and path text
                 -> Phase 6 PSD/PDF/AI interchange
                    -> Phase 7 hardening and release gates
```

Phases establish dependency order, not calendar estimates. A slice should fit
one cohesive local commit or a short sequence whose intermediate commits all
build. If it grows beyond that, split it before implementation.

## 8. Execution slices

### Phase 0 — toolchain, contracts and measurable choices

Goal: prove the browser/Electron toolchain and freeze boundaries before adding
canonical text state.

#### Slice 00 — research and execution tracker

- [x] Read the GPU text architecture and PDF text reference completely.
- [x] Inspect the current document, compositor, vector, worker and build paths.
- [x] Review Parley, Fontations, HarfBuzz/`hb-gpu` and msdf-atlas-gen source
  locally at pinned research commits.
- [x] Confirm that web and Electron share the Vite renderer/application source.
- [x] Confirm current machine state: Rust/Cargo installed; WASM target and
  bindgen packaging still require setup.
- [x] Define this staged, multi-agent execution tracker.

UI exposure: none in production. Research results are documentation only.

#### Slice 01 — reproducible Rust/WASM workspace

- [x] Add a root Rust workspace and `crates/text-layout-wasm` skeleton.
- [x] Pin the Rust toolchain, dependency versions and `Cargo.lock`.
- [x] Add `setup:text-wasm`, `build:text-wasm` and `ensure:text-wasm` scripts.
- [x] Integrate the shared ensure script with `.bat`, `.sh`, npm and CI flows.
- [x] Keep committed generated bindings and Cargo incremental caches intact
  across clean-dev; rebuild only when the verified source hash is stale.
- [x] Import a trivial version/capability function from an ES module worker in
  web and Electron.
- [x] Verify lazy loading and emitted worker/WASM assets.
- [x] Add clear missing-toolchain errors that do not prevent ordinary image use.

UI exposure: a development-only Debug diagnostic shows text engine state,
version, load duration and unavailable reason. No Text toolbar button yet.

Exit gate: `run_clean.bat`, `npm run dev:web`, web build and packaged desktop
all load the ordinary app; invoking the diagnostic initializes WASM once.

#### Slice 02 — frozen cross-boundary contracts

- [x] Define serializable `TextLayer`, `FlowTextSource`, `PositionedTextSource`,
  `FontAssetRef`, `RealizedTextLayout` and paint/run types.
- [x] Define typed-array worker request/response envelopes and schema versions.
- [x] Define canonical authored revisions and derived runtime cache keys.
- [x] Define coordinate, bounds, color, alpha and transform contracts.
- [x] Define text capability/error states and exact fallback policy.
- [x] Add contract validation, clone/default and malformed-input tests.
- [x] Record ownership in architecture diagrams and boundary verification.

UI exposure: Debug can inspect fixture counts and last layout error. No document
mutation or production control is exposed.

Exit gate: contracts have no DOM/WebGPU handles and pure tests round-trip both
source types.

### Phase 1 — canonical text and font ownership

Goal: make text safe to create, undo and persist before presenting it as a
usable tool.

#### Slice 03 — canonical TextLayer integration

- [x] Add `TextLayer` to `LayerNode` and tree traversal utilities.
- [x] Add creation, cloning, duplication, grouping, reparenting and deletion.
- [x] Preserve world transforms and stable layer IDs.
- [x] Define masks, opacity, fill opacity, blend and Layer Style applicability.
- [x] Ensure raster/vector-only commands reject or handle text explicitly.
- [x] Add layer capability query coverage.

UI exposure: fixture-created text layers render as an explicit diagnostic
placeholder and appear in Layers with a text icon. Users cannot create them.

Exit gate: all layer-tree/history tests pass; placeholder rendering cannot
corrupt or hide ordinary layers.

#### Slice 04 — commands, history and native persistence

- [x] Add commands for content, runs, paragraph geometry and text transform.
- [x] Make typing coalescing rules explicit while preserving one undoable edit
  transaction per committed input group.
- [x] Serialize text sources, runs, font refs and editability metadata.
- [x] Save/open both flow and positioned fixture layers.
- [x] Preserve unknown future fields or reject schema versions explicitly.
- [x] Define rasterize/merge/flatten behavior and ensure caches never serialize.

UI exposure: Layers context menu may show fixture-only Rename, Duplicate,
Delete and Rasterize actions after their command tests pass.

Exit gate: save/open, undo/redo, duplicate and rasterize fixture tests pass.

#### Slice 05 — document font asset registry and resolver

- [x] Store font bytes once by fingerprint with source and embedding metadata.
- [x] Resolve bundled, system-provided, imported and PDF subset fonts through
  one browser-safe abstraction.
- [x] Keep system font discovery outside the WASM core and host-optional.
- [x] Implement missing-font and substitution results without silent fallback.
- [x] Add lazy parsing, byte accounting, disposal and malformed-font limits.
- [x] Add licensed open-font fixtures covering TrueType, CFF and variable fonts.

UI exposure: missing/substituted font badge in the Layers row; status message
and copyable Debug detail. Font picker remains read-only until point text ships.

Exit gate: font resolution is deterministic in web and Electron fixtures.

### Phase 2 — layout and WebGPU renderer foundation

Goal: render fixture text quickly and correctly without exposing incomplete
authoring behavior.

#### Slice 06 — Parley WASM layout worker

- [x] Integrate Parley, Fontique, HarfRust, Skrifa and required ICU4X data.
- [x] Shape basic and complex-script fixtures into `RealizedTextLayout`.
- [x] Return clusters, caret stops, baselines, bounds and font provenance.
- [x] Reuse one persistent lazy worker per application runtime.
- [x] Add request IDs, cancellation, session/source revisions and stale-result
  rejection.
- [x] Measure cold load, warm layout, memory and output transfer size.
- [x] Ensure ordinary image startup does not fetch or instantiate text WASM.

UI exposure: Debug diagnostic can run a fixed typography corpus and display
timings/errors; canvas remains unchanged.

Exit gate: deterministic golden layout data for Latin, Arabic, Hebrew,
Devanagari, Thai, CJK, combining marks and emoji samples.

#### Slice 07 — renderer bakeoff and decision record

- [x] Implement a bounded R8 hinted coverage-atlas prototype.
- [x] Integrate a minimal `hb-gpu` WGSL prototype using the same fixture runs.
- [x] Compare quality at small text, normal zoom, extreme zoom and transforms.
- [x] Compare cold preparation, warm frame cost, VRAM, uploads and draw batches.
- [x] Test Intel, AMD, NVIDIA and integrated Mac WebGPU where available.
- [x] Fuzz/limit pathological glyph outlines and record shader failures.
- [x] Decide the production fidelity route and update the architecture record.

UI exposure: Debug-only report selector with side-by-side metrics and reference
capture hashes; never a user preference.

Exit gate: coverage atlas remains the live path unless measurements justify a
different choice; the fidelity route has a recorded GO/CONDITIONAL GO/NO-GO.

#### Slice 08 — production coverage atlas

- [x] Define atlas keys including font fingerprint, glyph, variations, hinting,
  scale bucket and render mode.
- [x] Generate hinted masks off the UI thread.
- [x] Pack, upload and draw instanced quads by atlas page and paint batch.
- [x] Implement eviction, fragmentation handling and atlas generation guards.
- [x] Report atlas bytes, entries, misses, evictions and upload timings.
- [x] Handle solid fill first; preserve contracts for stroke/color glyphs.
- [x] Add shader reflection, alpha, color and transformed-glyph fixtures.

UI exposure: fixture text becomes visible on the real canvas behind a
development capability gate.

Exit gate: pan/zoom never reshapes text; unchanged fixture documents submit no
text work; atlas device-loss rebuild succeeds.

#### Slice 09 — compositor, bounds and cache integration

- [x] Add `TextLayerRenderer` through the existing compositor contract.
- [x] Use tight bounds or tiles instead of a full-document text surface.
- [x] Apply transforms, masks, clipping, opacity, blend and Layer Styles in the
  established order.
- [x] Separate content, layout, font, paint, geometry and viewport revisions.
- [x] Implement disposal and VRAM estimates.
- [x] Ensure disabled/hidden/background text does no recurring work.
- [x] Add merge/rasterize comparison seams and exact zero-submit bypass tests.

UI exposure: Layers thumbnails can display fixture text with aspect-ratio fit;
Debug reports direct/atlas/cached source mode.

Exit gate: fixture text behaves like other layers under transform, grouping,
styles and compositing without changing raster/vector results.

### Phase 3 — usable point text vertical slice

Goal: release the first end-to-end authoring experience only when it is safe to
create, edit, undo and reopen.

#### Slice 10 — Text tool shell and point-text creation

- [x] Add a grouped Text toolbar slot with `T` activation and remembered mode.
- [x] Add point text as the first enabled family member.
- [x] Route canvas click to a disposable creation session.
- [x] Show commit/cancel behavior and create exactly one layer transaction.
- [x] Choose foreground color and deterministic default font/size.
- [x] Prevent creation when WASM/WebGPU capability is unavailable and explain
  why without disabling ordinary editing.
- [x] Add toolbar, shortcut, pointer-router and accessibility tests.

UI exposure: production Text tool appears. Options bar shows font family,
style, size, antialias mode and alignment using shared controls. Right-click
tool options expose the same settings.

Exit gate: click, type placeholder content, commit, undo, redo, save and reopen
work in both hosts.

#### Slice 11 — real editing, IME, caret and selection

- [x] Add a hidden focused input bridge for beforeinput, composition/IME,
  clipboard and accessibility only.
- [x] Implement grapheme-safe insert/delete, word movement and selection.
- [x] Draw caret, selection, baseline and insertion indicators in the GPU
  overlay pass.
- [x] Keep caret blink and selection changes out of document compositing.
- [x] Route Enter/Escape, arrows, Home/End, modifiers and focus restoration.
- [x] Coalesce typing history without losing composition boundaries.
- [x] Cancel and ignore late layouts on tool/layer/document changes.

UI exposure: double-click a text layer or select Text and click it to edit;
Layers row identifies the actively edited layer. Context menus and text fields
retain expected keyboard ownership.

Exit gate: Latin and at least one IME composition flow pass automated and
manual tests; one editing session has predictable undo groups.

#### Slice 12 — character properties and mixed style runs

- [x] Wire family, face, size, fill, faux bold/italic policy, tracking, leading,
  baseline shift, OpenType features and variable axes.
- [x] Apply properties to selection, insertion style or complete layer using
  explicit targeting rules.
- [x] Preserve mixed-value states in controls.
- [x] Avoid shaping/layout invalidation for paint-only changes.
- [x] Add numeric validation, keyboard increments and undo coalescing.

UI exposure: compact frequent controls stay in Tool Options; advanced
Character controls appear in the existing contextual Properties inspector only
when that property group is complete. Both surfaces bind the same
commands/settings.

Exit gate: mixed runs persist and undo correctly; unsupported font features
are disabled with a reason rather than ignored.

#### Slice 13 — settled source cache and interaction performance

- [ ] Implement a measured cost model for direct atlas draw versus tight/tiled
  cached `rgba16float` source.
- [ ] Cache only when expected recomposition savings exceed allocation/upload
  cost.
- [ ] Reuse cached sources during transform and rebuild at settle when needed.
- [ ] Add byte budgets, LRU eviction, visibility priority and device-loss
  recovery.
- [ ] Instrument keystroke-to-pixel, shaping, atlas misses, cache hits and GPU
  submission ownership.
- [ ] Verify no work for unchanged/background documents.

UI exposure: no user cache switch. Debug telemetry explains chosen mode and
memory. During a rebuild, keep last valid pixels instead of flashing blank.

Exit gate: point text meets the performance gates in section 10.

### Phase 4 — paragraph, rich and international text

#### Slice 14 — paragraph frames and layout controls

- [ ] Add drag-created paragraph frames and point/paragraph conversion.
- [ ] Implement wrapping, alignment, leading, indents, spacing and overflow.
- [ ] Add frame resize as preview plus one committed undo command.
- [ ] Keep layer transform distinct from paragraph frame geometry.
- [ ] Implement incremental paragraph/run invalidation.

UI exposure: Text family flyout enables Paragraph Text; canvas shows GPU frame
and overflow indicator. Frequent paragraph controls appear in Tool Options;
the complete group appears contextually in the existing Properties inspector.

Exit gate: resizing/reflowing does not mutate text or force unrelated layers
to render.

#### Slice 15 — fallback, bidi, vertical and complex-script editing

- [ ] Complete deterministic font fallback and per-run provenance.
- [ ] Verify bidi caret/selection ordering and mixed-direction editing.
- [ ] Verify Arabic, Hebrew, Indic, Thai, CJK and combining-mark behavior.
- [ ] Add vertical writing only after horizontal complex scripts are stable.
- [ ] Expose missing glyphs and substitutions in import/document reports.

UI exposure: direction/language/writing-mode controls appear only when their
layout and editing paths are complete. Missing-font badges open an actionable
resolution surface.

Exit gate: corpus fixtures compare across web/Electron and save/reopen without
cluster corruption.

### Phase 5 — scale-independent outlines and path text

#### Slice 16 — fidelity renderer and text-to-path

- [ ] Productionize the selected `hb-gpu` or alternate outline route.
- [ ] Cache/reuse repeated glyph blobs or outline geometry.
- [ ] Switch quality by measured scale/transform needs without visible jumps.
- [ ] Support fill/stroke and export-quality rendering.
- [ ] Add irreversible Convert to Shape/Path as one explicit undoable command.
- [ ] Preserve the original TextLayer through undo; do not mutate it in place.

UI exposure: Layers/context and Type menus expose Convert to Shape with a clear
editability warning. Renderer switching remains automatic and diagnostic-only.

Exit gate: extreme zoom and transformed text remain crisp; atlas/fidelity
comparison stays within agreed reference tolerances.

#### Slice 17 — text on path

- [ ] Add stable vector path references and missing-path behavior.
- [ ] Add arc-length cache, start/end offset, direction, side and alignment.
- [ ] Keep glyphs rigid first; warped outlines are a later explicit mode.
- [ ] Invalidate only path realization/layout on path edits.
- [ ] Add reference-safe duplication, grouping, deletion and persistence.

UI exposure: Text family enables Path Text when a compatible path is selected;
canvas overlays expose start/end handles and direction. Options bind to the
same text settings plus path-specific offsets.

Exit gate: editing path geometry updates text without altering canonical text
or unrelated vector content.

### Phase 6 — Photoshop, PDF and Illustrator interchange

#### Slice 18 — PSD semantic text

- [ ] Map supported PSD text descriptors into flow text, runs and transforms.
- [ ] Preserve unsupported engine data and report it.
- [ ] Classify visual, semantic, structural and round-trip parity separately.
- [ ] Add missing-font/substitution and raster-fallback policy.
- [ ] Compare editable result against Photoshop composite fixtures.
- [ ] Export supported text semantics back to PSD only when verified.

UI exposure: import report links to affected Layers rows. Badges distinguish
editable, substituted, preserved-only and rasterized text.

Exit gate: no PSD text becomes silently “editable” when its appearance cannot
be reproduced.

#### Slice 19 — PDF and PDF-compatible AI import spike

- [ ] Freeze a normalized page display-list contract independent of PDF engine.
- [ ] Evaluate exact glyph IDs, matrices, font bytes and text render modes via
  PDFium and at least one reference path.
- [ ] Import one page with paths, images, clips and positioned text.
- [ ] Preserve embedded subset fonts and semantic mappings separately.
- [ ] Bound Type 3 glyph programs and malformed document resource use.
- [ ] Detect PDF-compatible Illustrator input; preserve original source bytes.
- [ ] Record native `.ai` data as preserved/unsupported, not round-trippable.

UI exposure: Open/import progress and report show page count, font status and
editability classification. Positioned text is selectable as a text layer but
flow editing is disabled until explicitly recovered.

Exit gate: PDF glyphs render without reshaping; page pan/zoom changes only
presentation and reference comparison is logged.

#### Slice 20 — PDF production and export

- [ ] Support forms, transparency groups, soft masks, text clipping and page
  tiling required by the fixture corpus.
- [ ] Add optional, confidence-scored positioned-to-flow recovery.
- [ ] Export true PDF text objects when font embedding and semantics allow.
- [ ] Subset/embed fonts or use an explicit outline fallback.
- [ ] Preserve groups, clips, transforms, blend and supported transparency.
- [ ] Produce Illustrator-openable PDF without claiming native AI editability.

UI exposure: Export dialog reports fonts as embedded, subset, outlined or
blocked before writing. Recovery is an explicit command with preview/undo.

Exit gate: exported fixtures reopen in LightTable and Illustrator-compatible
PDF consumers with recorded visual/editability results.

### Phase 7 — hardening and release

#### Slice 21 — lifecycle, security and stress

- [ ] Test malformed fonts, extreme glyphs, huge runs, huge pages and cache
  pressure with explicit limits.
- [ ] Test worker crash, cancellation, document close, source replacement,
  React Strict Mode and GPU device loss.
- [ ] Verify all cache disposal and byte accounting.
- [ ] Verify CSP, COOP/COEP/CORP and hosted immutable WASM assets.
- [ ] Verify accessibility and keyboard focus in web and Electron.

UI exposure: failures identify subsystem and phase in status/debug systems;
optional text failure does not take down ordinary image editing.

#### Slice 22 — compatibility and performance sign-off

- [ ] Run the complete typography, PSD, PDF and AI-compatible fixture matrix.
- [ ] Run cross-device WebGPU profiling including an integrated Mac GPU.
- [ ] Record cold/warm WASM, keystroke, frame, atlas and VRAM measurements.
- [ ] Verify no text initialization on ordinary image startup.
- [ ] Verify web deployment and packaged desktop smoke matrices.
- [ ] Update current-state, rendering, document, interchange and UX contracts.
- [ ] Publish the supported/approximated/preserved/rasterized capability report.

UI exposure: remove development gates only for capabilities that pass their
release matrix. Incomplete later modes remain hidden or explicitly labeled.

## 9. Performance acceptance gates

These are engineering gates to measure on named baseline hardware, not general
claims about every device.

- [ ] Point-text keystroke-to-pixel p95 fits one display frame after warm-up.
- [ ] No main-thread text task exceeds the agreed interaction budget during
  steady typing; raw input remains responsive under heavy layout.
- [ ] Caret blink and selection-only changes do not rebuild the document
  composite.
- [ ] Pan/zoom does not reshape, reflow or invalidate source caches.
- [ ] Layer movement does not re-layout text.
- [ ] Ten thousand visible warm glyphs render in bounded batches at target
  interaction cadence on baseline hardware.
- [ ] Large paragraphs invalidate only affected paragraphs/runs.
- [ ] Unchanged and background documents perform no recurring text CPU/GPU work.
- [ ] Atlas/cache memory stays within configured budgets and fully releases on
  document close/device loss.
- [ ] Ordinary non-text document first-use performance stays within the agreed
  baseline tolerance.

Record exact devices, browser/Electron versions, document fixtures and warm/cold
state with every performance result.

## 10. UI/UX acceptance matrix

- [ ] Toolbar grouping, normal click, flyout and `T`/`Shift+T` behavior match
  existing tool-family conventions.
- [ ] Fixed Tool Options and right-click Tool Options expose identical values
  and commands where appropriate.
- [ ] Panel ID `lighttable.inspector` and saved Dockview layouts remain stable
  while its visible title/content evolve into contextual Properties.
- [ ] Character/Paragraph controls use the contextual Properties inspector and
  shared controls; no redundant permanent panels are introduced.
- [ ] Mixed values, disabled values and missing fonts are visually explicit.
- [ ] Text fields own text shortcuts only while intentionally focused; Escape
  and commit return focus predictably.
- [ ] GPU caret, selection, paragraph frame and path handles remain legible at
  supported zoom and device-pixel ratios.
- [ ] Layer rows provide text icon, fitted thumbnail and stable badge slots.
- [ ] Rename, duplicate, rasterize, convert and import-recovery actions appear
  consistently in Layers More and applicable context menus.
- [ ] Continuous property edits preview responsively and create one history
  entry per gesture.
- [ ] Unsupported functionality is absent or explained, never a silent no-op.
- [ ] Keyboard navigation and accessible labels are tested in browser and
  Electron.

## 11. Execution log

Append newest entries at the top. Keep entries factual and link the slice.

### 2026-08-03 — Slice 12 complete

- Owner: Codex `/root`; renderer and input lifecycle audits were delegated
  before final verification.
- Targeting/history: shared Tool Options and contextual Properties commands
  explicitly target the active selection, insertion point or complete flow
  layer. Gesture ownership is locked to one document/layer, previews coalesce
  to one undo command and cancellation restores the exact prior snapshot.
- Character model: family, exact face asset, size, solid sRGB fill and tracking
  preserve truthful per-property mixed states. Empty flows retain insertion
  defaults; run splitting is grapheme-safe and canonical run equality ignores
  object-key insertion order.
- Compatibility: positioned imported text remains immutable, and baseline,
  leading, faux styles, OpenType and variable-axis controls are visibly gated
  until both layout and rasterization honor them. Unsupported/P3/gradient fill
  can be deliberately replaced with a solid sRGB fill instead of being hidden.
- Rendering: paint revisions redraw cached glyph geometry without shaping.
  Current source ranges split cached glyph views by cluster while sharing typed
  array buffers; missing mappings fail closed. Tracking is 1/1000 em in UI,
  contracts and regenerated Rust/WASM output.
- Verification: 271 workspace test files / 1,314 tests, 11 Rust tests, WASM
  runtime and structural goldens, all typechecks, Rust check/format, architecture
  boundary, web production build and packaged Electron boundary passed.
  Existing wasm-vips eval, chunk-size and Electron inlineDynamicImports warnings
  are unchanged.
- Manual UI: no attached browser/WebGPU surface was available; event lifecycle,
  presentation, GPU contracts and both production hosts are covered automatically.
- Next safe slice: Slice 13, settled source cache and interaction performance.

### 2026-08-03 — Slice 11 complete

- Owner: Codex `/root`; renderer/input mapping and an independent lifecycle
  blocker audit were delegated before final verification.
- Editing: a hidden native textarea owns beforeinput, clipboard and IME while
  canonical UTF-16 edits snap to grapheme boundaries. Arrow, word, logical and
  realized-line navigation preserve bidi affinity and explicit selection.
- GPU/UI: caret, selection, baseline, insertion and composition feedback use a
  bounded renderer-neutral overlay and the existing WebGPU overlay pass. Blink
  changes only viewport presentation and never dirties document compositing.
- Lifecycle/history: typing, deletion, paste and composition have explicit undo
  boundaries. Blur, open, save, export, tool/layer changes and document
  replacement finalize safely; abort signals prevent late layout/raster work
  from publishing into a stale session.
- Contract: optional validated insertion style/paragraph metadata preserves
  authoring intent while an empty flow has no coverable run range. Persisted
  text schema remains version 1 because the fields are additive and optional.
- Verification: generated WASM runtime and structural goldens; complete
  266-file / 1,286-test workspace suite; all typechecks and architecture
  boundary passed. Web production and packaged Electron builds passed.
  Existing wasm-vips eval, chunk-size and Electron inlineDynamicImports
  warnings are unchanged.
- Manual UI: no attached browser/WebGPU surface was available for physical IME
  interaction; native-event mapping, IME ordering, focus lifecycle, shader
  reflection, GPU contracts and production host builds are automated.
- Next safe slice: Slice 12, character properties and mixed style runs.

### 2026-08-03 — Slice 08 complete

- Owner: Codex `/root`; app-side fixture seam by `/root/text_ui_map` and an
  independent read-only blocker audit by `/root/slice01_audit`.
- Contracts: realized-layout schema 2 carries authored run size; worker
  protocol 4 carries the complete raster identity (variations, synthesis,
  hinting and render mode) without changing persisted document schema 1.
- Cache: deterministic f32-normalized keys, exact-integer ppem buckets through
  64, bounded zero-area entries, fixed append-only R8 pages, whole-page LRU,
  page/atlas generations and stale reservation/upload/draw rejection.
- GPU: incremental row-aligned R8 uploads, premultiplied linear solid color,
  painter-ordered contiguous page batches, a 64-batch guard and production
  `rgba16float` output. Failed allocations/uploads and evicted textures release
  safely; device loss requires a fresh backend on the replacement device.
- Runtime/UI: Debug can opt into one fixed development fixture on the real
  document canvas. Default-off loads no fixture, worker/WASM or atlas backend;
  async preparation publishes one immutable ready plan. The seam is excluded
  from merge, flatten, export and production distribution.
- Verification: 10 Rust tests; WASM runtime/structural goldens; complete
  254-file / 1,216-test workspace suite; boundary and all typechecks passed.
  Web and packaged Electron builds passed; the development Anton fixture is
  absent from both distributions. Existing wasm-vips eval/chunk warnings are
  unchanged.
- Limitation: no automated browser WebGPU surface was available, so the Debug
  checkbox was not manually clicked on physical hardware; shader reflection,
  GPU-contract mocks, lifecycle tests and both production builds are green.
- Next safe slice: Slice 09, compositor, bounds and cache integration.

### 2026-08-03 — Slice 07 complete

- Owner: Codex `/root`; independent read-only blocker audit by
  `/root/slice07_bakeoff_map`.
- Runtime: protocol 3 adds exact hinted R8 glyph rasterization with owned
  transfers, exact response identity and deterministic WASM disposal.
- Prototypes: bounded R8 atlas upload/instanced draw and pinned HarfBuzz hb-gpu
  widened-storage draw run offscreen without touching the document compositor.
- Safety: dimensions, bytes, glyph counts, blob bands, offsets, curve loops,
  mutable storage, shader compilation, pipeline layout and WebGPU validation
  errors are gated before/around submission.
- UI/metrics: a development-only Debug action covers small, normal, extreme
  zoom and transformed cases and emits timing, upload, VRAM, batch, alpha-error
  and capture-hash JSON. No user preference or product renderer changed.
- Decision: coverage atlas GO/default; hb-gpu CONDITIONAL GO for future
  extreme-zoom fidelity; hb-gpu-only and MSDF NO-GO for now. See
  `GPU_TEXT_RENDERER_BAKEOFF.md`.
- Hardware: NVIDIA and Intel devices were physically present, but no automated
  browser WebGPU surface was available; AMD/Mac were unavailable. The report
  therefore records no cross-vendor runtime passes.
- Next safe slice: Slice 08, production coverage atlas.

### 2026-08-03 — Slice 06 complete

- Owner: Codex `/root`; independent blocker audits by `/root/slice01_audit`
  and `/root/text_ui_map`.
- Layout: pinned Parley/Fontique/HarfRust/Skrifa/ICU4X in Rust/WASM shapes the
  fixed Latin, Arabic, Hebrew, Devanagari, Thai, CJK, combining, emoji and
  mixed-bidi corpus into packed typed tables without layout JSON.
- Correctness: UTF-16/UTF-8 boundaries, ICU grapheme caret stops, logical
  cluster ordering, visual bidi geometry, per-cluster exact blob/face
  provenance and conservative Skrifa outline ink bounds are enforced.
  Unreported variation/synthesis is rejected instead of misrepresented.
- Runtime: one lazy persistent worker, maximum 16 sessions, exact generation
  and revision identity, stale-response rejection, abort/late-result discard,
  session release, per-request glyph limits and validated collection faces.
- Interchange: positioned text remains persistable but realization is explicitly
  `unsupported-feature` until exact outline/paint bounds prevent cache clipping.
- UI/metrics: the development-only Debug corpus reports partial failures, cold
  initialization, font registration, first/warm timings, transfer bytes and
  5,636,096 bytes reserved WASM memory. Production artifacts exclude corpus
  fonts and ordinary rendering constructs no text worker.
- Verification: 9 Rust tests; fixed WASM structural goldens; complete 245-file /
  1,181-test workspace suite; boundary and all typechecks passed. Web and
  packaged Electron builds passed; worker 33.41 kB and WASM 5,788.69 kB
  (3,082.78 kB gzip). Existing wasm-vips eval/chunk warnings remain unchanged.
- Limitation: the in-app browser service exposed no browser instance, so the
  manual Debug-button click could not run; lazy integration and distribution
  boundaries are automated.
- Next safe slice: Slice 07, renderer bakeoff and decision record.

### 2026-08-03 — Slice 05 complete

- Owner: Codex `/root`; two-pass read-only blocker audit by
  `/root/slice01_audit` and diagnostics seam review by `/root/text_ui_map`.
- Registry: immutable SHA-256-deduplicated bytes, deterministic face resolution,
  browser-safe limits, lazy parse/disposal and optional host system provider.
  System bytes are materialized for portable save only when embedding permits.
- Fontations: the persistent Rust/WASM worker validates real TrueType, CFF and
  variable fixtures, face indexes, outline kind and complete OS/2 embedding
  policy without DOM, CSS font loading or Node-only APIs.
- Persistence: native manifest v3 retains multiple collection faces over one
  verified binary, migrates v1/v2 documents, rejects corrupt hashes and applies
  64 MiB/256 MiB resource budgets before hashing untrusted blobs.
- UI: Layers, persistent status and the bounded copyable Debug log use actual
  runtime byte availability for explicit missing/substituted results. No Text
  tool or editable font picker was exposed.
- Tests: 4 Rust tests; 6 focused files / 34 tests; complete 243-file / 1,169-test
  workspace suite. Rust formatting, text-WASM runtime, boundary and every
  workspace typecheck passed.
- Distribution: web and packaged Electron builds passed; the lazy worker is
  3.22 kB and the text WASM is 52.37 kB in the web output.
- Next safe slice: Slice 06, Parley WASM layout worker.

### 2026-08-02 — Slice 03 complete

- Owner: Codex `/root`; read-only blocker audit by `/root/slice01_audit`.
- Canonical model: `TextLayer` composes frozen `TextLayerData` with common layer
  state, masks and styles; creation remains fixture/import-only.
- Tree/history: deep duplicate, group, reparent, ungroup and delete use the
  canonical immutable paths. Valid moves preserve document-space transforms
  and source IDs; invalid group-to-descendant moves are exact no-ops.
- Safety: raster/vector-only pixel, merge and flatten operations reject text;
  Slice 03 save fails explicitly instead of corrupting text before Slice 04
  persistence lands. Render invalidation observes text payload identity.
- GPU/UI: a bounded diagnostic shape uses the existing WebGPU vector/compositor
  path. Layers shows `T` plus Flow/Positioned status; no Text tool or visible
  DOM/SVG canvas text was added.
- Tests: focused model/controller/capability/persistence/compositor tests and
  the complete 236-file / 1,122-test workspace suite passed. Boundary and all
  workspace typechecks passed.
- Distribution: web build and packaged Electron verification passed with text
  worker/WASM assets present and `work/` excluded.
- Next safe slice: Slice 04, commands, history and native persistence.

### 2026-08-02 — Slice 02 complete

- Owner: Codex `/root`; two-pass read-only contract audit by
  `/root/slice01_audit`.
- Contract: pure `@lighttable/text-core` package with generic
  `TextLayer<TBase>` composition and versioned `TextLayerData`; no duplicate
  app `CommonLayer`, DOM, React or WebGPU ownership.
- Interchange: flow and exact positioned sources; all eight PDF text modes;
  separate fill/stroke; encoded character width; font format, embedding and
  typed requested/resolved/substitution provenance.
- Runtime ABI: session/generation/revision/path/font/options cache identity;
  register-once dedicated font transfer; validated dedicated typed-array
  response ownership; actual structured-clone transfer/detachment coverage.
- Validation: schema, finite coordinate/color/alpha/matrix, Unicode run,
  metadata, allocation and cross-array range limits; explicit error fallback.
- UI: Debug reports two contract fixtures and the last layout error slot. No
  Text tool, document mutation or renderer path is exposed.
- Tests: 12 focused contract tests; complete workspace result 238 files /
  1,111 tests; all workspace typechecks and boundary verification passed.
- Distribution: web and packaged Electron builds passed with separate text
  worker/WASM assets; `npm run dev:web` served the app shell over HTTP 200.
  Slice 01's clean Electron smoke remains the desktop Phase 0 smoke evidence.
- Limitation: the in-app browser service still exposes no browser instance, so
  the manual clickable Debug probe remains deferred; worker laziness is covered
  by tests and split output artifacts.
- Phase 0 task complete. Next safe slice: Slice 03, canonical TextLayer
  integration.

### 2026-08-02 — Slice 01 complete

- Owner: Codex `/root`; read-only build audit by `/root/slice01_audit`.
- Toolchain: Rust 1.93.0, `wasm32-unknown-unknown`, wasm-bindgen crate/CLI
  0.2.126, locked and reproducible through `scripts/text-wasm.mjs`.
- Runtime: one lazy ES-module worker; construction/import creates no worker,
  concurrent probes deduplicate and success is cached. Debug is the only UI.
- Rebuild: two ensures were no-ops; forced rebuild produced identical SHA-256
  values for bindings, declarations, manifest and 20,248-byte WASM.
- Tests: Rust unit test; WASM ABI runtime; 9 focused client/UI tests; complete
  workspace result 237 files / 1,099 tests; boundary and typecheck passed.
- Distribution: web build and packaged Electron both contain a separate text
  worker and hashed WASM asset; the distribution verifier enforces this.
- Desktop smoke: `run_clean.bat` rebuilt and started Electron at the isolated
  renderer origin; `crossOriginIsolated` and `SharedArrayBuffer` were true.
- Limitation: the in-app browser service exposed no browser instance, so the
  manual Debug-button network smoke could not run. Laziness is covered by
  worker-factory tests and separate Vite chunks; repeat the manual click at the
  Phase 0 boundary when a browser surface is available.
- Next safe slice: Slice 02, frozen cross-boundary contracts.

### 2026-08-02 — planning baseline

- Owner: Codex `/root` with read-only UI inventory delegated to
  `/root/text_ui_map`.
- Completed: architecture/PDF review, local open-source source review,
  current compositor/build audit, delegated UI/UX integration inventory and
  execution tracker.
- UI decision: retain `lighttable.inspector` and evolve it into contextual
  Properties; reuse the existing tool-family, options, layer-capability,
  pointer-ownership, task and WebGPU overlay seams.
- Repository change: `.referenceCode/` is ignored; local research checkouts do
  not enter product builds.
- Implementation status: no text runtime or product UI implemented.
- Next safe slice: Slice 01, reproducible Rust/WASM workspace.

### 2026-08-03 — Slice 04 complete

- Owner: Codex `/root`; read-only implementation audit by
  `/root/slice01_audit`.
- Commands/history: validated immutable flow, positioned, paragraph-layout and
  transform commands with domain-specific revisions; explicit typing,
  composition, deletion, formatting and layout transaction boundaries reject
  external document publication and retain no raster cache for semantic edits.
- Persistence: layered manifest v2 round-trips flow and positioned text,
  font/interchange metadata, masks, grouping and compatible unknown payload
  fields; v1 remains readable and future manifest/text schemas fail clearly.
- Rasterize Type: fixture-only GPU bake preserves the same layer ID and common
  layer semantics, owns one combined GPU/document undo step, and rolls back
  failed allocation, rendering, snapshot or history publication. Live text
  remains explicitly blocked from merge/flatten until rasterized.
- UI: Layers and app Layer menus expose tested Rename, Duplicate, Delete and
  fixture-only Rasterize Type actions through shared capabilities. Delete
  availability follows the canonical final-raster invariant.
- Verification: 9 focused files / 63 tests; complete workspace 238 files /
  1,151 tests; boundary and all workspace typechecks passed. Web build and
  packaged Electron verification both passed with text worker/WASM assets.
- Next safe slice: Slice 05, document font asset registry and resolver.

### 2026-08-03 — Slice 09 complete

- Owner: Codex `/root`; atlas lifetime and revision-domain work ran in
  parallel, followed by an independent read-only blocker audit.
- Runtime: document-scoped coordination lazily registers exact font bytes,
  reuses layout across paint and presentation changes, drops stale async work
  and publishes only complete sources for visible canonical text layers.
- GPU: coverage pages are pinned across immutable plans and submissions;
  evicted page textures retire only after submitted work. Text is rasterized
  once into bounded, AA-fringed tight `rgba16float` sources, never a
  full-document private surface.
- Compositor: ready text follows the existing mask/fill-opacity, Layer Style,
  layer opacity/blend, clipping and group-transform order. Missing, stale,
  unsupported or empty sources retain the diagnostic placeholder.
- Cache/lifecycle: content, font, layout, paint, path, local geometry, common
  geometry and viewport have separate invalidation effects. Translation,
  rotation and viewport changes do not reshape or reraster; scale rebuilds only
  when its bounded source bucket changes. Tight sources and atlas pages are
  included in VRAM estimates and disposed on close/device loss.
- Commands/UI: text thumbnails fit their tight source aspect ratio; Debug
  reports source-mode availability. Rasterize and text-aware merge/flatten
  require an exact ready source and otherwise perform a zero-submit rollback.
- Verification: focused coordinator, bounds, compositor, style, thumbnail,
  revision, atlas-pressure and destructive-operation tests plus the complete
  workspace suite passed. Physical WebGPU inspection remains a manual smoke
  because no browser surface is attached; deterministic GPU contracts and
  submission-lifetime tests cover the automated boundary.
- Next safe slice: Slice 10, Text tool shell and point-text creation.

### 2026-08-03 — Slice 10 complete

- Owner: Codex `/root`; UI/runtime seam research and an independent read-only
  blocker audit were delegated before final verification.
- Tool/UI: the grouped Text slot activates with `T`; point text is its first
  mode. The options bar and cursor-local tool menu share family, style, size,
  truthful Smooth antialias and Left alignment controls. The disposable entry
  dialog owns Enter/Escape, trapped Tab navigation and focus restoration.
- Creation: an in-document click is projected through the existing pointer
  router, rebased into a transformed parent group and committed as one native
  text layer/history command. Foreground sRGB, exact preferred font asset,
  16 px default and local-zero layout origin remain canonical across undo,
  redo and layered save/reopen.
- Capability/fonts: creation requires the existing ready WebGPU renderer,
  the lazy Rust/WASM probe and a parsed exact face. OFL Inter is registered
  lazily as a document font; standalone registries reset per document and late
  hydration cannot cross document generations. WOFF2 is decoded at the shared
  bounded Rust boundary, so web and Electron use the same source bytes.
- Verification: production Inter WOFF2 passed generated-WASM inspection,
  Parley shaping and Skrifa rasterization. The complete workspace passed 259
  test files / 1,256 tests, all typechecks, Rust formatting/checks, architecture
  boundary verification, web production build and packaged Electron boundary.
- Current backend limit: Smooth antialias and Left alignment remain the only
  enabled choices until their later implementation slices.
- Next safe slice: Slice 11, real editing, IME, caret and selection.

## 12. Open decision register

Decisions stay open until their named slice supplies evidence.

| Decision | Owner slice | Current default |
|---|---:|---|
| Exact WASM packaging command/tool | 01 | decided: direct Cargo build plus repo-local wasm-bindgen-cli 0.2.126; committed generated artifacts validated by source hash |
| Final typed-array ABI | 02/06 | v1 boundary frozen: dedicated typed arrays; Rust packing details remain in Slice 06 |
| `hb-gpu` production role | 07 | candidate fidelity route, not sole small-text renderer |
| Coverage atlas bucket policy | 08 | hinted scale buckets with measured eviction |
| Direct versus settled cache threshold | 13 | runtime cost model, not a user setting |
| Contextual Properties text sections | 12/14 | preserve `lighttable.inspector`; expose only functionally complete groups |
| PDF semantic engine | 19 | normalized adapter boundary; PDFium must prove exact extraction |
| Flow recovery from positioned text | 20 | explicit, confidence-scored, reversible command |
