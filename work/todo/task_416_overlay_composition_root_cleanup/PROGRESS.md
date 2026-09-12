# Task 416 progress

## O03c.3b — Scope canvas/context lifetime (accepted)

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
