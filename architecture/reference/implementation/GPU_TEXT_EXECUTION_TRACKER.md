# LightTable GPU text execution tracker

Status: active execution and handoff plan

Last reviewed: 2026-08-03

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
- `hb-gpu` is evaluated as a scale-independent glyph realization backend
  before a custom direct-outline renderer is built. It renders into the
  document-space source/export target; viewport zoom never selects a sharper
  text-only presentation path.
- MSDF is not a phase-one dependency. It is reconsidered only with benchmark
  evidence.
- Text caches use the smallest relevant revisions and explicit byte budgets.
- Inactive text is never semantically flattened. Optional rasterization is a
  tight or tiled, evictable GPU source cache.
- Text follows the same document-pixel presentation contract as every other
  layer. At settled zoom >= 4x the viewport keeps nearest-neighbor sampling so
  authored document pixels remain visible. Zoom does not rerasterize text at
  viewport resolution or replace the document composite with smooth vectors.
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

### Photoshop-parity UI/UX exposure gate

Every text capability added for Photoshop parity must record its product
surface in the same implementation slice. The review is required even when the
correct decision is to expose nothing yet. Each review records:

1. the canonical property and whether it is fully rendered, editable,
   persisted and undoable;
2. its frequent editing surface (Tool Options), detailed editing surface
   (contextual Properties), canvas interaction, menu action, import report, or
   an explicit preserved-only decision;
3. the existing LightTable control, command and CSS family being reused;
4. mixed-value, unavailable, missing-font and imported-approximation states;
5. preview cadence and history coalescing for continuous controls;
6. focused interaction coverage plus any physical UI verification still
   required.

No implementation may invent a text-only picker, dropdown, spinner, panel,
overlay renderer or visual language when the app already owns that primitive.
If the established UI cannot express a new semantic cleanly, keep it gated and
discuss the interaction before marking imported text editable or enabling
export.

Current PSD text-property audit:

| PSD/canonical semantic | Current surface | Exposure decision |
|---|---|---|
| Family and face | Tool Options and contextual Text Properties | Existing shared selects |
| Size | Tool Options and contextual Text Properties | Existing mixed number/spinner control |
| Fill | Tool Options and contextual Text Properties | Existing fill-colour widget |
| Stroke colour and width | Tool Options and contextual Text Properties | Existing shape `Line` and `Weight` controls |
| Tracking | Contextual Text Properties | Existing mixed number control |
| Alignment | Tool Options and contextual Text Properties | Existing shared select |
| Leading, indents and paragraph spacing | Contextual Text Properties | Existing mixed number controls |
| Point/paragraph geometry and transform | Canvas plus established tool/session commands | Existing WebGPU overlay and transform interaction |
| Faux styles, baseline shift, character scaling, kerning/ligature overrides, decorations and auto-hyphenation | Import compatibility report only | Preserved/preview-backed until rendering, commands and coherent shared UI are complete |
| Warp, text on path and vertical writing | Import compatibility report only | Preserved/preview-backed; no premature controls |

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

- [x] Implement a measured cost model for direct atlas draw versus tight/tiled
  cached `rgba16float` source.
- [x] Cache only when expected recomposition savings exceed allocation/upload
  cost.
- [x] Reuse cached sources during transform and rebuild at settle when needed.
- [x] Add byte budgets, LRU eviction, visibility priority and device-loss
  recovery.
- [x] Instrument keystroke-to-pixel, shaping, atlas misses, cache hits and GPU
  submission ownership.
- [x] Verify no work for unchanged/background documents.

UI exposure: no user cache switch. Debug telemetry explains chosen mode and
memory. During a rebuild, keep last valid pixels instead of flashing blank.

Exit gate: point text meets the performance gates in section 9.

### Phase 4 — paragraph, rich and international text

#### Slice 14 — paragraph frames and layout controls

- [x] Add drag-created paragraph frames and point/paragraph conversion.
- [x] Implement wrapping, alignment, leading, indents, spacing and overflow.
- [x] Add frame resize as preview plus one committed undo command.
- [x] Keep layer transform distinct from paragraph frame geometry.
- [x] Implement incremental paragraph/run invalidation.

UI exposure: Text family flyout enables Paragraph Text; canvas shows GPU frame
and overflow indicator. Frequent paragraph controls appear in Tool Options;
the complete group appears contextually in the existing Properties inspector.

Exit gate: resizing/reflowing does not mutate text or force unrelated layers
to render.

#### Slice 15 — fallback, bidi, vertical and complex-script editing

- [x] Complete deterministic font fallback and per-run provenance.
- [x] Verify bidi caret/selection ordering and mixed-direction editing.
- [x] Verify Arabic, Hebrew, Indic, Thai, CJK and combining-mark behavior.
- [ ] Add vertical writing only after horizontal complex scripts are stable.
- [x] Expose missing glyphs and substitutions in import/document reports.

UI exposure: direction/language/writing-mode controls appear only when their
layout and editing paths are complete. Missing-font badges open an actionable
resolution surface.

Exit gate: corpus fixtures compare across web/Electron and save/reopen without
cluster corruption.

### Phase 5 — scale-independent outlines and path text

#### Slice 16 — fidelity renderer and text-to-path

- [x] Productionize the selected `hb-gpu` or alternate outline route.
- [x] Cache/reuse repeated glyph blobs or outline geometry.
- [x] Select realization quality from document/output resolution and transform
  needs without making viewport zoom a content invalidation or quality switch.
- [x] Support fill/stroke and export-quality rendering.
- [x] Add irreversible Convert to Shape/Path as one explicit undoable command.
- [x] Preserve the original TextLayer through undo; do not mutate it in place.

UI exposure: Layers/context and Type menus expose Convert to Shape with a clear
editability warning. Renderer switching remains automatic and diagnostic-only.

Exit gate: transformed/exported text meets the agreed reference tolerances;
at extreme viewport zoom text exposes the same nearest-sampled document pixel
grid as raster and vector layers, without text-only smoothing or rerasterizing.

#### Slice 17 — text on path

- [x] Add stable vector path references and missing-path behavior.
- [x] Add a byte-bounded, document-space arc-length cache.
- [x] Apply start/end offset, direction, side and alignment to glyph layout.
- [x] Keep glyphs rigid first; warped outlines are a later explicit mode.
- [x] Invalidate only path realization/layout on path edits.
- [x] Add reference-safe duplication, grouping, deletion and persistence.

UI exposure: Text family enables Path Text when a compatible path is selected;
canvas overlays expose start/end handles and direction. Options bind to the
same text settings plus path-specific offsets.

Exit gate: editing path geometry updates text without altering canonical text
or unrelated vector content.

### Phase 6 — Photoshop, PDF and Illustrator interchange

#### Slice 18 — PSD semantic text

- [x] Map supported PSD text descriptors into flow text, runs and transforms.
- [x] Preserve unsupported engine data and report it.
- [x] Classify visual, semantic, structural and round-trip parity separately.
- [x] Add missing-font/substitution and raster-fallback policy.
- [x] Audit every newly supported PSD text property against the existing Text
  property UI; reuse shared controls or record and discuss the missing
  interaction before enabling editable import/export.
- [x] Compare editable result against Photoshop composite fixtures. Exact
  `D:\\TextTest.psd` Electron screenshots and embedded-composite diagnostics
  now cover point, paragraph and path text; remaining percentage differences
  stay explicit and do not imply Photoshop visual parity.
- [ ] Export supported text semantics back to PSD only when verified.

UI exposure: import report links to affected Layers rows. Badges distinguish
editable, substituted, preserved-only and rasterized text.
New PSD semantics must reuse the established Text property bar, shared spinners,
fill/stroke widgets and panel system. A capability with no coherent UI/UX
surface remains preserved or gated until that interaction is designed.

Exit gate: no PSD text becomes silently “editable” when its appearance cannot
be reproduced.

#### Slice 19 — PDF and PDF-compatible AI import spike

- [x] Freeze a normalized page display-list contract independent of PDF engine.
- [x] Evaluate exact glyph IDs, matrices, font bytes and text render modes via
  PDFium and at least one reference path.
- [x] Import one page with paths, images, clips and positioned text.
- [x] Preserve embedded subset fonts and semantic mappings separately.
- [x] Bound Type 3 glyph programs and malformed document resource use.
- [x] Detect PDF-compatible Illustrator input; preserve original source bytes.
- [x] Record native `.ai` data as preserved/unsupported, not round-trippable.

Contract evidence: `@lighttable/pdf-core` owns a versioned, JSON-transportable
page display list for paths, clips, images, exact positioned glyphs, all PDF text
render modes, color spaces, transparency groups and soft masks. Its validator
enforces finite geometry, balanced stacks, resource integrity and parser-output
limits without browser, renderer or PDF-engine dependencies.

Page-import evidence: the pure `importPdfPageScene()` replay owns the PDF
graphics-state stack and emits immutable path, image and positioned-text items.
Each draw item snapshots active clip paths, transform, fill/stroke state, alpha,
blend mode, soft mask and transparency-group membership. Its mixed one-page
fixture proves save/restore isolation, transform composition and unsupported
operator preservation without leaking renderer or engine state.

Font/semantics evidence: positioned glyph runs now contain only visual source
codes, CIDs, glyph IDs, positions and matrices. Embedded or substituted font
programs live in separately fingerprinted asset resources, while ToUnicode,
ActualText and heuristic mappings live in range-based semantic resources with
explicit provenance and confidence. Validation rejects cross-kind references,
detached mappings, out-of-range spans and embedded fonts without program bytes.

Type 3/security evidence: Type 3 glyph programs are separately owned resources
with bounded operations, paths, glyphs and nesting depth. Validation follows
only the exact referenced Type 3 glyph program, rejects recursive programs and
unbalanced nested graphics state, and applies document-wide operation, glyph,
path-command, image-pixel and font-byte budgets before semantic conversion.

AI/source evidence: a bounded raw-byte probe distinguishes ordinary PDF,
PDF-compatible Illustrator and non-PDF/native `.ai` without parsing arbitrary
private payloads. Illustrator metadata and private-data evidence remain
explicit; native `.ai` is preserved/unsupported and never enters semantic PDF
import. The normalized descriptor references a fingerprinted immutable source
asset, and LightTable's layered persistence round-trips Photoshop, PDF and
Illustrator source blobs byte-exact instead of embedding them in render state.

Slice 20 tiling evidence: `planPdfPageTiles()` partitions an unrotated PDF
crop-box raster into renderer-neutral, non-overlapping content tiles with
bounded guard pixels for seam-safe filters and antialiasing. UserUnit, scale
and page rotation produce exact output dimensions; tile-count and duplicated
render-pixel budgets are checked before large arrays or GPU resources exist.

Slice 20 text-clip evidence: positioned runs using PDF text rendering modes
4-7 become an immutable glyph clip only after their text object is emitted.
Following scene items inherit that clip through the graphics-state snapshot;
save/restore removes it exactly like a path clip, without reshaping glyphs.

Slice 20 form evidence: Form XObjects are reusable bounded resources with an
exact matrix, bounds, optional transparency-group identity and their own
validated display list. Page scenes reference them without parser-time
duplication. A unified resource graph rejects direct and mixed Form/Type 3
cycles and enforces separate nesting/operation limits before replay.

Slice 20 flow-recovery evidence: `analyzePositionedTextRecovery()` is a pure,
deterministic query that scores Unicode coverage, logical order, fonts and
recoverable matrix geometry without mutating or reshaping the exact source.
Text clipping, incomplete semantics, singular/skewed matrices, inconsistent
run orientation, vertical advances and per-glyph transforms block conversion;
uniform rotation/reflection, no-fill/stroke paints and exact preferred document
font assets survive in the preview. The typed recovery command recomputes that
analysis against the current snapshot, crosses the source-kind boundary only
explicitly and records one document-history entry whose undo restores the
untouched positioned glyphs. The existing Text panel components show confidence,
preview text/style count and concrete warnings before enabling recovery; no new
panel, color, select or number-control system was introduced.

Real PDF fixture evidence: `D:\FormulierPersoneel.pdf` (SHA-256
`a192caef67408512ad35c503adb6f64f741f029d04bc5096bbfe3616cde1e823`) is one
unrotated 589.68 x 835.92 point page. Independent object inspection finds no
fonts, text objects, annotations or AcroForm fields: the page is exactly one
2457 x 3484, 8-bit DeviceRGB JPEG XObject placed by `q cm Do Q`. An independent
PyMuPDF render was visually inspected. The bounded tile planner now carries
that real crop-box as a 600-dpi regression (4914 x 6966 pixels, four tiles).
This fixture covers image-resource placement, high-resolution page rendering
and source preservation; it deliberately does not count as text-recovery or
interactive-form evidence.

Production preview evidence: the normal web/Electron open route now recognizes
`%PDF-` bytes and lazy-loads pinned PDF.js 5.4.624 only for PDF input. Page one
is rasterized at a target 300 ppi with a 64-Mpx/16,384-edge allocation bound,
then enters the existing GPU raster document pipeline; the source bytes are
attached as an immutable `pdf-document` asset for native-save preservation.
The packaged-desktop Playwright run opened `D:\FormulierPersoneel.pdf` as a
2457 x 3483 raster layer in 723 ms first-frame time (71 ms decode/upload), with
zero page errors. The screenshot was visually inspected. This is explicitly a
preview milestone, not evidence of semantic PDF parsing, multipage UX or
editable forms/text.

UI exposure: Open/import progress and report show page count, font status and
editability classification. Positioned text is selectable as a text layer but
flow editing is disabled until explicitly recovered.

Exit gate: PDF glyphs render without reshaping; page pan/zoom changes only
presentation and reference comparison is logged.

#### Slice 20 — PDF production and export

- [x] Support forms, transparency groups, soft masks, text clipping and page
  tiling required by the fixture corpus.
- [x] Add optional, confidence-scored positioned-to-flow recovery.
- [ ] Export true PDF text objects when font embedding and semantics allow.
- [ ] Subset/embed fonts or use an explicit outline fallback.
- [ ] Preserve groups, clips, transforms, blend and supported transparency.
- [ ] Produce Illustrator-openable PDF without claiming native AI editability.

UI exposure: Export dialog reports fonts as embedded, subset, outlined or
blocked before writing. Recovery is an explicit command with preview/undo.

Text-export planning evidence: `@lighttable/pdf-core` now owns a bounded,
writer-neutral preflight over exact realized glyph runs, logical Unicode spans,
font embedding rights and actual font bytes. It assigns each font instance to
HarfBuzz subset, preserved imported subset, full embed, outline, raster or
blocked; each run receives a local encoding/CMap plan plus `ActualText` where
one-to-one Unicode mapping is insufficient. Restricted/unknown embedding,
bitmap/SVG fonts, missing semantics, synthetic styles, unsupported paint,
projective/vertical geometry and layer/group effects have explicit fallback or
block reasons. No font writer is claimed by this planner.

Open-source evidence: the locally pinned HarfBuzz reference at commit
`c31bd6797a0e55c2b176a7be3a181f36814ec6aa` exposes the required
`hb_subset_or_fail` path, retain-GID policy, CFF/CFF2 support and variation-axis
pinning. The production adapter now calls pinned `harfbuzzjs` 1.5.0's standalone
subset WASM through that ABI with the source-face/input order verified against
a real Anton SFNT. It retains glyph IDs and `.notdef`, pins requested variation
axes, bounds input/output/glyph counts and reuses one WASM heap per export
transaction. The 613-kB module remains an emitted lazy asset and is neither
fetched nor instantiated during ordinary editing.

Web-font materialization evidence: pinned `woff-lib` 0.0.3 lazily decodes WOFF
and WOFF2 sources to SFNT through CSP-safe tree-shaken entrypoints before
HarfBuzz. Real bundled Inter WOFF and WOFF2 fixtures both decode successfully.
Materialization deduplicates source reads, respects the planner's embedding
decision and face index, returns immutable resources, and caps each font and
total output. General `unsafe-eval` remains forbidden; packaged Electron grants
only CSP `wasm-unsafe-eval` for the bounded lazy WebAssembly instantiation.

Preflight UI evidence: File > PDF Export Preflight uses the existing menu,
compatibility-report dialog, status badges and ActionButton components. It
shows font/layer decisions and explicitly distinguishes flattened page export
from native text-object writing.
The packaged desktop automation opened the dialog on `D:\TextTest.psd` and
reported five searchable text layers, three planned subsets and zero blocked
resources with no page errors. Its explicit **Validate font resources** action
then materialized three real Inter retain-GID subsets (20 KiB total) in the
packaged application. It reuses the same compatibility report, badges and
ActionButton; no new dropdown, color, spinner or CSS control system was added.

First writer evidence: pinned MIT `pdf-lib` 1.17.1 is dynamically imported only
after **Export flattened PDF...** is invoked. The bounded writer accepts the
existing GPU-rendered PNG, derives physical page dimensions at 300 ppi, embeds
one full-page image and emits a one-page PDF with LightTable producer metadata.
The packaged desktop run opened `D:\FormulierPersoneel.pdf`, exported a
5,093,470-byte flattened PDF, then reopened that output through the normal PDF
route at the same 2457 x 3483 raster dimensions with zero page errors. This is
round-trip evidence for the first writer boundary, not a claim of native text,
vector, group, form or multipage export.

Native-text writer-input evidence: `PdfNativeTextPage` now snapshots each
preflight-approved glyph without reshaping. Every glyph carries its retained
glyph ID, run-local character code, Unicode mapping, origin, advance and exact
text-space-to-page-space matrix. The builder composes nested layer transforms,
flow or preserved positioned-text matrices, per-glyph affine transforms, the
document-pixel to PDF-point scale and the opposing Y-axis conventions exactly
once. It preserves PDF rendering modes, solid DeviceRGB paint/alpha, stroke
parameters and `ActualText`, and fails closed when current glyph IDs no longer
match the preflight encoding. Direct-text eligibility now also rejects
Display-P3 paint and compositing state not yet represented by the writer
(masks, clipping, non-normal blend, opacity/fill-opacity and isolated groups),
so the existing preflight UI reports an explicit outline/raster fallback
instead of promising a visually incorrect native-text export.

PDF font-metrics evidence: a bounded, dependency-free SFNT reader now extracts
the exact writer-required `head`, `hhea`, `maxp`, `hmtx` and optional `OS/2`/
`post` fields from the already materialized font. It normalizes descriptor
metrics and retained-glyph advances to PDF's 1000-unit convention, identifies
TrueType versus CFF outlines, rejects malformed table ranges and out-of-range
glyph IDs, and caps bytes/tables/glyphs. A real Anton font and the real
retain-GID HarfBuzz subset both pass the parser, avoiding a second multi-MiB
fontkit runtime in web and Electron.

Native Type0 writer evidence: the lazy `pdf-lib` boundary now writes retained-
GID TrueType subsets as embedded `FontFile2` streams behind Type0/CIDFontType2
objects. Each run receives its own encoding CMap, binary CID-to-GID map, exact
1000-unit widths and ToUnicode map; multi-glyph semantic clusters retain
`ActualText` plus a reader-compatible Unicode fallback. Glyphs are emitted from
their frozen matrices without reshaping, and compatible adjacent glyphs use a
positioned `TJ` array so exact placement does not introduce false extraction
spaces. PDF.js reopens the real Anton subset fixtures as searchable Unicode.
CFF and stroked text still fail closed to the preflight fallback path, and the
product export remains flattened until native text can be composed with the
page's raster/vector/group content without duplication.

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
- [x] Large paragraphs invalidate only affected paragraphs/runs.
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

### 2026-08-03 - PSD scale boundary and semantic no-fill

- Real-file regression: `D:\TextTest.psd` was decoded locally and all three
  ordinary Photoshop text descriptors were verified through the production
  text adapter. `ag-psd` exposes Photoshop's normal 100% character scale as
  `1` for this file; the previous percent-only check misclassified every layer
  as unsupported scaling and therefore kept all three raster-preview backed.
  The PSD boundary now accepts both unit (`1`) and percent (`100`) encodings.
- Paint contract: flow-text fill is now optional, matching the existing
  positioned-text paint contract. No-fill therefore stays semantic through
  validation, worker realization and current-paint projection; stroke-only and
  invisible editable text select the correct rendering mode without reshaping.
- Shared UI: the established Fill/Line color control now exposes paint on/off.
  Native vector paths/live shapes bind it to their existing nullable fill and
  stroke model; text binds it to semantic no-fill. PSD `fillFlag=false` maps to
  no-fill instead of transparent black. No second color-picker family exists.

### 2026-08-03 - Slice 17 production Path Text authoring

- Tooling: Path Text is the third member of the existing Text toolbar family;
  repeated `T`/`Shift+T` traversal uses the established tool-group behavior and
  the shared Text property controls rather than a new panel or widget family.
- Targeting: creation requires exactly one explicitly selected native vector
  path and one unambiguous contour. Live shapes require Convert to Path, and
  missing, multiple or stale targets produce an explicit error instead of a
  guessed reference or silent raster fallback.
- Document semantics: authored layers are editable canonical flow text with
  exact layer/element/subpath identities, default forward/left/upright
  traversal, the selected font asset and normal one-command undo history.
- Remaining UI/UX: the existing GPU path handles expose offsets and direction
  on canvas. Numeric offset, side and upright controls still need binding in
  the shared options bar; missing-path Layers feedback remains open.

### 2026-08-03 - Slice 17 path-reference command safety

- Duplication: duplicating path text deliberately keeps its exact original
  vector layer/element/subpath reference. Duplicating the vector creates fresh
  layer, element, contour and anchor identities, so it cannot steal or collide
  with the existing text dependency; semantic vector duplication requests no
  raster-preview pixels.
- Structure/deletion: reparenting paths through transformed groups preserves
  stable IDs and world-space resolution. Deleting the referenced vector/group
  leaves canonical text intact and produces the explicit `missing-layer`
  dependency state instead of selecting a sibling or flattening silently.
- Persistence: exact layer/element/subpath references survive native
  save/reopen and resolve to the same canonical contour. These behaviors are
  now command, application-port and layered-format regressions.
- UI/UX: ordinary Duplicate/Group/Delete commands retain their established
  placement and history behavior. Missing-path feedback still needs its
  existing Layers badge/import-report exposure when Path Text is enabled.

### 2026-08-03 - Slice 17 undoable path-text handles

- Interaction: the existing GPU start/end/direction markers now share one
  geometry authority with their pointer hit targets. Start/end drags project
  through the retained arc-length spatial index, including reverse traversal;
  the direction marker toggles traversal as one explicit command.
- History/performance: raw pointer moves remain in a non-React controller.
  Any number of previews derive from the immutable opening document, pointer-up
  records one history entry and cancellation restores that exact snapshot.
- Routing: point and paragraph text now share the same captured text-gesture
  port. This also fixes point-text selection drags losing pointer capture while
  keeping caret/selection updates out of document compositing.
- UI/UX: existing path text can expose and manipulate the GPU handles through
  the established Text canvas interaction. Production Path Text creation and
  path-specific properties remain gated on reference-safe document commands;
  no new controls, CSS, SVG or DOM overlay were added.

### 2026-08-03 - Slice 18 PSD semantic text takes editing priority

- Import policy: a valid supported Photoshop text descriptor now always creates
  a native editable flow `TextLayer`, even when Photoshop also supplies its
  usual layer-local raster preview. Previously that preview caused virtually
  all otherwise-supported PSD text to import as a raster layer.
- Rich text: point text, paragraph frames, affine transforms and character
  style runs (including different fills) retain their canonical ranges and
  immediately use the existing canvas editor, Tool Options and contextual Text
  Properties surface.
- Fidelity/UI: the retained Photoshop composite remains the visual comparison
  reference when source fonts differ; the import report marks visual parity as
  approximate and semantics as editable. Unsupported warp, vertical and path
  descriptors remain honestly preview-backed until their complete layout and
  editing routes exist—no misleading disabled text controls are shown.

### 2026-08-03 - Slice 17 path-aware editing hit testing

- Interaction: existing text selection/caret gestures now resolve the nearest
  rotated caret along the realized contour, including reverse traversal and
  transformed text layers. Path text no longer falls back to rectangular
  logical-bounds hit testing.
- Performance: path segments use a retained spatial index and immutable path
  projections receive a traversal-sorted caret index. Pointer movement performs
  a bounded spatial query plus binary search instead of rescanning flattened
  paths or caret arrays; no raw pointer state enters React.
- UI/UX: this enables direct canvas entry and selection on existing path text
  through the established Text interaction. The Path Text creation member and
  property controls remain hidden until start/end/direction handles, safe
  references and undoable commands are complete. No new UI component or DOM,
  CSS or SVG overlay was introduced.

### 2026-08-03 - Slice 17 end-to-end path realization

- Pipeline: the coordinator shapes path text as a neutral horizontal flow in
  the existing worker, resolves the exact vector contour in the scene graph,
  realizes its byte-bounded metric in text-layer-local space, and projects the
  shaped glyphs before publishing artwork and editing layout.
- GPU: per-glyph transforms select the existing scale-independent outline
  WebGPU route automatically. Fill/stroke, tight caching, compositing,
  conversion and final-output export continue through the shared text/vector
  render stack; no path-specific canvas renderer exists.
- Invalidation: external path geometry/ancestor-transform changes rebuild only
  the arc metric, projection and GPU source. The worker shaping cache key is
  path-independent, verified by an edit/reprojection test with one shaping
  request across two path realizations.
- Failure: missing, ambiguous and singular path dependencies fail before
  shaping and never publish a misleading linear text fallback.
- UI/UX: the editing runtime selects the retained path overlay when path
  presentation metadata is available. Creation, hit-testing and handle drag
  commands remain gated; the production Path Text tool is still hidden.

### 2026-08-03 - Slice 17 retained GPU path-editing overlay

- Overlay: rigid path text now has a pure builder for curved per-cluster
  selection quads, rotated carets, composition/insertion indicators, the
  realized path baseline and semantic start/end/direction handles. It reuses
  the existing text WebGPU quad/line/marker shaders and overlay pass.
- Performance: immutable layouts receive a retained caret index; selection and
  caret lookup are binary/map based. Static path guides and handles own
  category-specific GPU resource keys and buffers, so caret/IME updates stream
  only dynamic geometry instead of re-uploading a potentially large path.
- UX: handle markers retain a fixed viewport-pixel size while positions remain
  in document space. No DOM, SVG, CSS overlay or new visual component family
  was introduced. Hit-testing/drag commands remain gated for the next slice.

### 2026-08-03 - Slice 17 rigid glyph projection foundation

- Layout: already-shaped horizontal glyph origins can now be projected onto a
  path metric with start/end range, shared text alignment, forward/reverse
  traversal, side and upright behavior. Each glyph receives an affine rotation
  and translation; its outline is never warped.
- Rendering boundary: the projection emits the existing per-glyph transform
  contract used by the scale-independent outline renderer. It owns no React,
  GPU resource or document state and is not wired into production yet.
- Editing/UI gap surfaced: path text needs rotated carets, curved selection
  geometry and start/end/direction handles in the existing WebGPU overlay pass.
  The existing GPU primitives can represent them, but the realized editing
  geometry and builder were rectangle-oriented. The Path Text tool stays hidden
  until artwork and editing consume one path projection end to end.

### 2026-08-03 - Slice 17 hierarchical path dependency

- Correctness: resolved path dependencies now include the vector layer's full
  scene-graph transform, not only its local transform. Path text can therefore
  follow contours inside arbitrarily nested transformed groups.
- Invalidation: moving, scaling or rotating any ancestor changes only the
  dependent path-layout revision; canonical text and unrelated vector content
  remain untouched.
- UI/UX: no new surface. This closes a hidden correctness prerequisite for
  eventual path handles and prevents those overlays from disagreeing with the
  rendered contour in grouped documents.

### 2026-08-03 - Slice 17 traversal contract

- Contract: path layouts can now persist an optional end handle and explicit
  forward/reverse traversal. Legacy documents retain full-path, forward
  defaults; malformed directions and non-finite offsets fail shared validation.
- Ownership: alignment remains the existing paragraph/text alignment property,
  rather than adding a second path-only alignment value. Existing `side` and
  `upright` properties remain the single canonical orientation controls.
- Persistence: the native layered-format and text-command fixtures retain the
  new values. No PSD/PDF export semantics are claimed before reference parity.
- UI/UX: still hidden in production. Later start/end handles bind these same
  canonical offsets; the property surfaces must reuse the established numeric
  and alignment controls instead of introducing path-text-specific widgets.

### 2026-08-03 - Slice 17 path metrics foundation

- Geometry: exact referenced subpaths now realize into document-space
  cumulative arc-length tables. Path and containing-layer transforms affect the
  measured advance, while viewport pan/zoom never enter the cache identity.
- Performance: derived metrics use quantized curve tolerances, binary-search
  sampling and an explicit weighted LRU byte budget. Repeated text layers on the
  same path can share the table without flattening curves per caret or glyph.
- Semantics: the pure metric layer covers open/closed paths, forward/reverse
  traversal, start/end ranges, alignment, overflow and degenerate contours.
  These semantics are not yet applied to shaped glyph runs, so the integrated
  layout bullet and Path Text tool remain open.
- UI/UX: no production control was added. Once rigid glyph placement and GPU
  handles work end to end, offsets use the existing numeric controls, alignment
  uses the existing text alignment control family, and direction/side must be
  reviewed against established toggle/select patterns before exposure.

### 2026-08-03 - Slice 17 stable path-text dependency

- Contract: path text can identify its vector layer, stable vector element and
  stable subpath/contour. The IDs are additive/backward-compatible; legacy
  layer-only data resolves only when that layer contains exactly one canonical
  path with exactly one subpath.
- Safety: dependency resolution reports missing layer, incompatible layer,
  missing element/subpath and ambiguous legacy references separately. It never
  chooses the first sibling path or contour silently and does not treat an
  unrealized live shape as a canonical path.
- Invalidation: the text preparation/cache key now includes a bounded revision
  derived from the referenced layer transform and path geometry/transform.
  Editing that path invalidates dependent text without invalidating unrelated
  text layers.
- Persistence: stable references round-trip through the native layered format;
  empty element identities are rejected by the shared text contract.
- UI/UX: Path Text remains hidden. The Text-family member, path handles and
  offset controls stay gated until arc-length layout, editing and overlay
  interaction are vertically complete. Missing-reference states are ready for
  the established Layers badge/import-report surfaces at that point.

### 2026-08-03 - Export waits for canonical text sources

- Correctness: PNG export now waits for all currently visible TextLayers to
  finish their current-generation source preparation before the compositor is
  flushed and read back. Final output selects the existing scale-independent
  WebGPU outline route for fill and stroke; repeated exports reuse the settled
  outline source instead of rebuilding it.
- Stale-state guard: document replacement during the wait fails the export
  explicitly instead of exporting an incomplete or previous text source.
- Architecture: export enters through the existing document renderer and text
  coordinator; no export-only canvas, DOM renderer or second compositor was
  added.
- Scope: the current PNG export is document-sized and therefore realizes at
  document/output scale 1. Future arbitrary-resolution PDF/PSD export must pass
  its explicit output scale and reference fixtures; no such parity is claimed.
- UI/UX: no new property is introduced. The existing export task reports the
  actionable failure if text preparation cannot settle.

### 2026-08-03 - Slice 16/21 outline lifecycle hardening

- Lifecycle: clearing the scale-independent glyph-outline repository now
  aborts its owned worker requests and removes their sharing entries. A late
  worker result cannot repopulate a cache after document replacement, device
  reset or coordinator disposal.
- Sharing: cancelling one consumer still leaves useful shared work alive;
  only the repository ownership boundary cancels the underlying request.
- Tracker audit: the production WebGPU outline route, byte-bounded repeated
  outline cache and atomic Convert to Shape command were already delivered in
  `6853e3d`, `e55b1ce` and `0e34a35`. Output-scale/export integration remains
  unchecked until the final-output render path selects it end to end.
- UI/UX: no new surface. Fidelity selection and cache lifecycle are automatic;
  the existing Type/Layers conversion command remains the only destructive
  user action and retains the original TextLayer through undo.

### 2026-08-03 - Slice 18 shared text-stroke UI

- UI: editable flow text exposes imported/renderable stroke through `Line` and
  `Weight` in both the existing Tool Options row and contextual Text panel.
  These reuse the same shared colour and number controls as vector shapes; no
  panel type, picker, dropdown or CSS family was introduced.
- Editing: colour and width apply to the active layer, insertion point or text
  selection through the existing formatting transaction. A zero-pixel weight
  removes the canonical stroke.
- Performance: fill and stroke colour previews share one animation-frame
  coalescer, retaining the final value without creating an input/render queue.
- Verification: property projection/patch and both established UI surfaces are
  covered; complete tests, typechecks, web build and packaged Electron pass.

### 2026-08-03 - Slice 18 editable-semantics gate audit

- Runtime truthfulness: the PSD adapter no longer marks faux styles, baseline
  shift, character scaling, disabled kerning, ligature overrides, text
  decorations or paragraph hyphenation editable while the production layout
  path rejects or cannot faithfully render those semantics.
- Preservation: affected descriptors remain preview-backed with a specific
  compatibility reason; no unsupported setting is silently normalized away.
- PSD default: a serialized zero manual kerning value retains metrics kerning
  when Photoshop automatic kerning is enabled.
- UI audit: font/face, size, fill, tracking, alignment, leading, indents and
  paragraph spacing already use shared controls. Text stroke is renderable and
  imported but lacks an editing surface; it is the next shared-control UI step.

### 2026-08-03 - Slice 18 serialized PSD text fixture

- Interoperability: a test now writes a real PSD binary through `ag-psd`, reads
  its text descriptor back through the production parser and validates the
  resulting point text, affine transform, font request, size, paragraph
  alignment and canonical LightTable text contract.
- Scope: this is structural parser/serializer evidence, not Photoshop visual
  parity. The editable-result comparison remains open until an Adobe-generated
  composite fixture is available; PSD export remains gated behind that proof.
- UI/UX: Slice 18 now explicitly audits every newly supported PSD property
  against the established Text property bar and panel controls. Unsupported
  interactions stay preserved/gated and are discussed before new UI is added.

### 2026-08-03 - Slice 18 PSD semantic text foundation

- Owner: Codex `/root`; sourced from task 039 and the Phase 6 tracker.
- Import: validated horizontal Photoshop point and box descriptors map to
  canonical editable flow text, character/paragraph runs and affine layer
  transforms. PSD carriage-return offsets remain stable as line feeds.
- Fidelity policy: a real Photoshop layer-local preview remains authoritative
  until its requested fonts can be resolved. Only a missing/transparent preview
  is replaced by native editable text, explicitly reported as approximate.
- Preservation: the complete ag-psd text descriptor remains in Photoshop layer
  metadata. Warp, text-on-path, vertical text, invalid run coverage and unsafe
  contract values stay preview-backed/preserved with explicit reasons.
- Fonts: requested Photoshop family/PostScript names enter the existing lazy
  resolver and missing/substituted font diagnostics; importing does not load or
  retain any font bytes by itself.
- Reporting: text compatibility entries persist independent visual, semantic,
  structural and round-trip parity axes plus their layer target. The existing
  compatibility report displays those axes and reuses its established layer/font
  recovery action instead of introducing another panel or control family.
- Verification: adapter, integration, persistence and compatibility tests plus
  app typecheck pass. Photoshop composite fixtures and PSD export remain open.

### 2026-08-03 - Slice 15 horizontal implementation complete; manual smoke pending

- Owner: Codex `/root`; tracked in task 037.
- Contract/runtime: worker protocol v5 carries one validated font selection per
  flow style run. The selection names the exact registered face and family and
  retains the original request plus exact/substituted provenance; point and
  incremental paragraph results publish the same provenance and explicit
  `font-substituted` warnings.
- Policy: resolution remains deterministic by preferred fingerprint/face,
  PostScript name, family/style score and an ordered explicit Noto Sans/Inter
  substitution list. Faces outside that policy are never silently selected.
- Laziness: bundled Inter fallback bytes are fetched only when visible flow
  text remains unresolved after document-font hydration. Raster-only, hidden
  text and already-resolved documents allocate and fetch nothing.
- Registration: a session registers only faces selected by visible text runs;
  substitution does not load the complete catalog.
- Editing: left/right follows realized visual caret order while canonical text,
  selection anchors and grapheme boundaries remain logical. Home/End and mixed
  LTR/RTL selection collapse/extension use the same realized layout.
- Corpus and persistence: Arabic, Hebrew, Devanagari, Thai, CJK, emoji and
  combining text pass the real generated-WASM corpus and layered save/reopen
  fixtures without cluster corruption.
- Interaction performance: continuous fill previews are frame-coalesced, the
  final value always flushes, and superseded preparation generations are
  dropped before worker/GPU work so colour dragging cannot serialize a backlog.
- UI: existing Layers badges and the existing compatibility report expose
  missing fonts, explicit substitutions and realized missing-glyph warnings;
  editable entries select the layer and open the established Text properties.
- Verification: focused unit/worker/real-WASM regressions, the complete
  workspace test suite, all typechecks, production web build and packaged
  Electron distribution boundary pass. Existing third-party build warnings
  are unchanged.
- Commits: `6efaf57`, `d0a81f0`, `2a995e4`, `b0bc7d9`.
- Remaining exit evidence: physical Web/Electron corpus and save/reopen smoke.
  Vertical writing stays deferred and its controls remain absent until that
  separate layout/editing path is complete.

### 2026-08-03 — Slice 14 complete

- Owner: Codex `/root`; paragraph input/overlay and incremental-shaping audits
  were delegated before implementation.
- Authoring/UI: point and paragraph text share the existing text family;
  click/drag creation, conversion, transformed eight-handle frame resizing,
  alignment, leading, indents and paragraph spacing use existing Tool Options,
  contextual Properties and shared controls.
- GPU presentation: frame edges, fixed-pixel handles and truthful overflow
  indicators stay in the existing WebGPU editing overlay. Paragraph clip and
  hidden-line suppression occur in the text coverage path without CSS/SVG.
- Invalidation: unrelated layers perform zero work; paragraph reflow reuses
  resident R8 glyph masks. A worker-local 16 MiB byte-bounded LRU now shapes
  only cache-missing UTF-16 paragraphs and reassembles fresh transferable
  whole-flow tables with current style/paint provenance and Y placement.
- Compatibility: LF, CR, CRLF, U+2028/U+2029, combining/astral clusters and a
  trailing empty paragraph are gated against monolithic generated Parley/WASM
  output. Glyphs, clusters, lines, carets, selection, geometry and bounds match.
- Telemetry: each paragraph response reports request hits/shapes, retained
  entries/bytes and lifetime evictions; the existing Debug trace prints these
  values after shaping.
- Verification: 283 workspace test files / 1,404 tests, all workspace
  typechecks, generated WASM runtime/structural goldens, production web build,
  packaged Electron and both distribution boundaries passed. Existing
  wasm-vips eval, chunk-size and Electron inlineDynamicImports warnings are
  unchanged.
- Commits: `7d89332`, `4674262`, `0139235`, `fd7b6a4`, `3fa0e74`, `8aed295`,
  `1b34ae1`, `52f106c`, `c803fb4`, `46a1a94`, `66e74d9`, `412631a`, `b65e05d`,
  `9e00cc0`.
- Electron smoke: the packaged app now drag-creates a paragraph frame, enters
  three paragraphs through the native input bridge, edits one fragment,
  observes `paragraphHits=2 paragraphShapes=1`, resizes the frame without text
  mutation and retains one ready editable Flow layer with no page errors.
- Input compatibility: Electron's legacy React `beforeinput` payload may expose
  character data without `InputEvent.inputType`; the bridge now handles that
  path without crashing or bypassing active IME composition.
- Task 033 has satisfied its exit evidence and moved to `work/done`.

### 2026-08-03 — Slice 13 complete

- Owner: Codex `/root`; implementation followed renderer, input and GPU-cache
  audits recorded in task 032.
- Policy: a document-local rolling cost model chooses direct atlas composition
  or a tight `rgba16float` source from measured atlas, cache-build and cached
  composite work. Cache allocation is rejected when it cannot repay its build
  cost or fit the remaining byte budget; semantic compositor requirements
  always force the compatible cached route.
- Interaction: active text edits use retained atlas plans where compatible.
  Common transforms reuse the current source resolution while the compositor
  applies the live matrix; settle performs at most one final scale-bucket
  rebuild. Exact consumers remain strict while presentation retains the last
  valid pixels.
- Cache/lifecycle: layout and settled-source caches have byte-bounded LRU,
  visibility-prioritized eviction and complete close/device-loss disposal.
  Atlas plans retain pages through source and submission lifetimes. Atlas-only
  layers materialize a tight source only when a thumbnail consumer requests it.
- Telemetry/UI: Debug reports mode decisions, measured coefficients, atlas,
  layout and source-cache hits/misses, bytes/evictions, shaping/raster work,
  cache submits and authored-revision-correlated input-to-submit/GPU p95/max.
  Superseded, removed and stale revisions are excluded from latency samples.
- Performance evidence: a warm 10,000-glyph atlas frame remains one draw batch,
  adds no upload or miss, retires every transient buffer and releases all pins.
  Unchanged and suspended/background documents perform no text worker or GPU
  submissions. Named-hardware p95 sign-off remains the explicit Slice 22 gate;
  no browser/WebGPU surface was attached for a physical measurement here.
- Verification: 274 workspace test files / 1,339 tests, WASM runtime and
  structural goldens, all workspace typechecks, architecture/distribution
  boundaries, web production build and packaged Electron passed. Existing
  wasm-vips eval, chunk-size and Electron inlineDynamicImports warnings are
  unchanged.
- Commits: `3d94ee2`, `aa1dde0`, `ef40be0`, `0bc8f4d`, `1cb12b6`, `10448c1`,
  `6ada1b8`, `5caf8c3`, `1aab373`, `9d06267`, `683a664`, `25a96c0`, `ad09346`,
  `e9a7b4f`.
- Next safe slice: Slice 14, paragraph frames and layout controls.

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

### 2026-08-03 â€” Exact PSD text desktop smoke automated

- Import: canonical ag-psd unit character scales and default discretionary-
  ligature flags no longer create unsupported layout overrides. PostScript
  face names determine the requested weight/style, including Inter Medium and
  SemiBold.
- Fonts: Inter Medium joined the metadata-only product catalog and is fetched,
  decoded and registered only when an opened document requests that exact
  face.
- Visual verification: `npm run screenshot:desktop:build -- --file
  D:\\TextTest.psd` builds the Electron app, opens the real PSD in an isolated
  test profile, waits for document/render readiness and writes a screenshot
  plus JSON diagnostics under `tmp/screenshots/`.
- Failure contract: the smoke fails on missing editable Flow layers, font
  substitution/unavailability or text-renderer bypass, while still retaining
  the screenshot and Debug-panel diagnostics. Its Electron process tree is
  closed after success or failure.
- Evidence: the exact file produced 3 editable Flow layers, 3 lazily loaded
  exact faces, 3 ready cached text sources, no page errors and visible GPU text.

### 2026-08-03 — PSD path text and exact shape interaction smoke

- Path import: a bounded tolerant parser recovers Photoshop `Txt2`
  `TextFrameSet` cubic geometry when an otherwise valid byte string omits the
  UTF-16 BOM expected by `ag-psd`. The recovered curve becomes a hidden native
  vector companion referenced by the existing editable Path Text layout.
- GPU/cache: a large curved line first falls back from a retained four-sample
  outline surface to a bounded single-sample 2x document cache instead of
  disabling the whole text renderer. The exact fixture settles with three
  cached ready text layers and no renderer error.
- Shape import: normalized Photoshop stroke opacity remains normalized, and
  every imported element, subpath and anchor identity is scoped to its source
  layer. This removes cross-layer selection/cache collisions.
- Visual evidence: the Electron smoke opens `D:\\TextTest.psd` as three Flow
  layers plus one native path layer and visibly follows the curved path. It
  opens `D:\\shapes.psd` as four native vector layers; an automated Path
  Selection drag moves Star alone while triangle, ellipse and line remain
  unchanged and no duplicate geometry remains.

### 2026-08-03 — Photoshop path-text orientation and authored range

- Root cause: recovered Photoshop cubic control points and traversal were
  correct (`reversed=false` in `D:\TextTest.psd`). The import adapter forced
  `upright=true`, causing a per-glyph 180-degree tangent and baseline-normal
  flip whenever the contour crossed plus or minus 90 degrees.
- Semantics: imported Photoshop path text now retains continuous glyph
  orientation (`upright=false`) and keeps the authored left-side baseline.
  Native LightTable path text can still opt into upright normalization.
- Range: Photoshop's segment-index plus cubic-parameter `textRange` is mapped
  once at import to LightTable's arc-length start/end handles. The exact
  fixture's `[0.84742, 4]` range no longer starts at the path origin.
- Evidence: focused PSD/path projection tests pass, the app typechecks, and a
  packaged Electron screenshot of `D:\TextTest.psd` shows one continuous
  character orientation around the curve with zero page errors.

### 2026-08-03 — Point/paragraph conversion preserves the first baseline

- Layout contract: realized point and paragraph layouts expose the derived
  `firstBaselineOffset`; it is validated but never serialized into the
  authored document or a format adapter.
- Commands: Point → Paragraph subtracts that offset from the baseline to obtain
  the frame top; Paragraph → Point adds it back. The common layer affine stays
  untouched, so rotated and nested text does not acquire a conversion jump.
- UI: the mode switch reads the current realized metric before ending the edit
  session and passes it explicitly to the command. Missing/stale layout keeps
  the backward-compatible zero-offset fallback instead of guessing font
  ascent or baking a font-specific constant into the model.
- Evidence: command tests cover a 47 px baseline delta under a translated layer,
  paragraph-fragment tests cover the real derived metric, and core validation
  rejects non-finite offsets.

### 2026-08-03 — Text input hot path is frame-coalesced

- Root cause: every character synchronously published a full immutable
  document to React and WebGPU, while `beginTextInput` also pushed a React
  telemetry/debug snapshot. Removing the GPU delay exposed React error #185;
  the renderer had accidentally acted as an input throttle.
- Runtime: the edit transaction's canonical document ref changes immediately,
  while renderer/document-shell publication, editing UI subscriptions and
  telemetry presentation publish only the newest state once per animation
  frame. Undo/redo still uses the explicit typing transaction boundary.
- Packaged evidence: with Text Size set to 48 before paragraph creation, 157
  characters went from 15,887.6 ms to 408.7 ms (about 39x faster), retained the
  full source, produced a real mouse selection and reported zero page errors.
  The smoke now fails above a deliberately loose 10,000 ms regression ceiling.

### 2026-08-03 — Point-text transforms now pivot on the authored baseline

- Contract: point-text `origin` is the first-baseline insertion point, matching
  Photoshop TySh and PDF text matrices. Parley's top-origin line result is
  normalized once in the layout worker across glyph, line, caret, selection
  and bounds tables before any layer affine is applied.
- PSD evidence: the red minus-90-degree layer in `D:\TextTest.psd` moved from
  screen x=1216 to the measured x=1174..1215 range. That matches the retained
  Photoshop composite projection; its angle and imported affine were already
  correct, while the old line-top offset had been rotated into screen X.
- Regression evidence: packed-table unit tests cover the common baseline delta
  and no-op cases. The exact-file packaged smoke still reports five editable
  Flow layers, one native path companion and zero page errors; path text keeps
  its projected outline source.
- Persistence: the layered document serializer stores the semantic flow source
  and layer affine verbatim and excludes realized geometry, so the baseline
  contract is not baked into a cache. A native round-trip fixture now preserves
  a fractional baseline origin and a minus-90-degree affine verbatim with no
  raster asset. Future PSD and PDF/AI exporters must have equivalent explicit
  baseline-origin fixtures before they can claim editable text parity.
- Follow-up: point-to-paragraph conversion currently maps the baseline origin
  directly to a frame top-left. Visual-preserving conversion needs realized
  first-baseline metrics; do not hide that difference in the serialized model.

### 2026-08-03 — Direct mouse selection and rotated PSD text evidence

- Editing: the existing pointer gesture controller is now covered end to end
  in packaged Electron. Dragging across paragraph characters produced a
  non-empty contiguous range (latest run: `Par`, logical offsets 0..3);
  pointer previews remain requestAnimationFrame-
  coalesced and feed the WebGPU selection overlay without document mutation.
- PSD fixture: the current `D:\TextTest.psd` contains five editable text
  layers, including minus-45-degree and minus-90-degree point text plus path
  text. The standard exact-file smoke expects all five Flow layers and one
  native path companion; the packaged render preserves the affine rotations
  without raster fallback or double-applying path rotation.
- Follow-up surfaced: changing the Text tool size programmatically immediately
  before paragraph creation exposed a `Maximum update depth` error in one
  automation route. It is not classified as a selection failure and remains a
  dedicated UI state-synchronization regression to isolate.

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
| PDF semantic engine | 19 | decided: pinned PDFium plus a bulk exact-glyph adapter; MuPDF is a non-shipping AGPL/commercial fixture oracle |
| Flow recovery from positioned text | 20 | explicit, confidence-scored, reversible command |
| Automation command API and MCP adapter | cross-cutting | keep domain commands/queries typed and UI-independent; later expose capability discovery, validated transactions, undo boundaries and read-only inspection through host/API/MCP adapters instead of automating DOM state |
