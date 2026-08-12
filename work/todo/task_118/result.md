# Task 118 evidence log

## Current verified milestone

- Face Warp no longer compiles to generic Warp strokes. `FaceWarpEffect`
  consumes the face-agnostic indexed `DeformationSurface` renderer.
- Detector output stays local and lazy; 478 landmarks are separated into the
  official 468-vertex surface plus non-authoritative iris points.
- Immutable source XYZ, canonical topology/UV data, detector identity and pose
  are serialized. Target vertices are derived from semantic parameters and
  explicit displacements.
- The brush uses visible-triangle barycentric hit testing, connected geodesic
  distance, quintic compact falloff, bounded smoothing and incremental
  foldover prevention.
- A pinned collar confines texture deformation; the debug mesh and pixels use
  the same evaluated target mesh.
- Dense mesh presentation renders to one isolated GPU overlay and composites
  once at 50% opacity.

## Automated evidence (2026-08-11)

- 9 Face Warp/deformation test files, 24 tests: passed.
- `@lighttable/app` typecheck: passed.
- Real Electron Face Warp smoke on `D:\pukkels-lighttable.png`: passed.
- The smoke hides the mesh/cursor before pixel comparison, proves one undo
  transaction, verifies the texture changes, checks a bounded local changed
  region and confirms the output hash remains identical after a one-second
  settle period.
- Measured changed texture bounds: 1,410 pixels within a 49 x 93 region on a
  1290 x 815 canvas. No page error, WebGPU validation error or runtime stop.

## Profile visibility increment (2026-08-11)

- Replaced the overlay/hit-test's winding-only visibility decision with a
  bounded spatial depth competition. MediaPipe detector Z follows its
  documented convention: smaller values are nearer the camera.
- Far-side triangles projected behind nearer face geometry are no longer
  offered as brush hits or drawn as equally visible mesh. A face-local spatial
  grid avoids an all-pairs scan during overlay updates.
- Added an overlapping front/back profile fixture. Focused deformer tests
  (8/8) and the application typecheck pass.
- Pose-normal confidence, difficult-profile policy and the full visual corpus
  remain open, so Phase 6 is deliberately not marked complete.
- Extracted the renderer-facing surface packer as a pure shared kernel and
  verified both irregular face triangles and a tessellated rectangular patch,
  including multi-surface index offsets. Future Custom Warp can therefore use
  the indexed renderer without importing facial semantics.
- The repeatable desktop smoke now records timing evidence. On the current
  machine/fixture the detector measured 377.5 ms cold and 104.1 ms warm; the
  scripted six-step gesture reached its deliberately delayed comparison frame
  in 488.2 ms (including a fixed 250 ms settle wait). Detector memory and true
  interactive p50/p95 still need dedicated instrumentation before Phase 8 can
  be checked off.
- The real desktop identity oracle now captures the tool canvas immediately
  before detection and again after cold plus warm detection with presentation
  overlays hidden. Both SHA-256 hashes are
  `36c6d9fbf70af415d6f618835fb70a4fe5e3ba61bb467c6fc7b26184b97c752f`;
  the measured changed-pixel count is exactly zero. Gate 2 identity is therefore
  checked with pixel evidence rather than inferred from mesh coordinates.
- Added an exact renderer/overlay contract fixture with a non-trivial affine
  layer transform. Every visible overlay anchor is derived from and agrees
  with the corresponding indexed renderer target vertex (agreement is exact
  before their shared document-to-screen conversion, therefore below the
  0.5-screen-pixel gate).
- Exact-identity surfaces now bypass pipeline compilation, the copy/mesh render
  passes and the full-resolution color/depth output allocation until the first
  authored displacement. For the 546 x 546 fixture this avoids roughly 3.58 MB
  of deformation output/depth storage per untouched layer. The desktop smoke
  still proves identity, first deformation, one undo entry and stable settle.
- Added a reproducible numbered-checkerboard face generator and registered
  desktop smoke command. The smoke moves the floating Layers panel away before
  capture, derives its gesture from the fitted document bounds, and preserves
  separate artifacts per source fixture. Both the numbered fixture and the
  original portrait pass: their fitted canvas bounds remain byte-for-byte
  equal before/after, no new black pixels appear in the changed region, the
  foldover stress fixtures remain valid, and the deformed texture remains
  stable after release. This closes the combined holes/folds/black-pixel/canvas
  movement Gate 2 check. Eye/lip separation and extreme-slider corpus cases
  now run against the canonical 468-vertex topology as well: paired upper/lower
  eyelid and inner-lip vertices retain their ordering under combined extreme
  semantic controls and a deliberately excessive local brush displacement.
  Together with the existing extreme collar test, the Phase 8 checkerboard,
  feature-separation, extreme-slider and collar fixture set is now present.
- A compact canonical-topology eyelid gesture measurably moves its seeded eye
  vertices while every sampled opposite-eye vertex remains exactly zero. This
  exercises the connected/geodesic falloff rather than screen-distance
  proximity and closes the Gate 3 cross-feature jump check.
- Face Warp remains a normal serialized adjustment-stack module: source mesh,
  semantic values, direct displacements and pose round-trip without retaining
  detector runtime state, so reopen stays non-modal and editable. A new
  interoperability fixture proves that applying a semantic control preserves
  an existing direct sculpt and that direct sculpting can then continue.
  Detection uses only the lazily loaded bundled model/worker and rendering or
  reopened editing never performs a network request; the local/offline USP
  baseline is therefore checked.
- Reserved the future Custom/Split Warp application-command boundary in the
  architecture: `setGrid`, horizontal/vertical/crosswise split, `moveAnchor`
  and `setHandleMode`. The document explicitly keeps these semantic authoring
  commands out of the generic renderer and separate from facial topology; no
  premature Custom Warp UI or implementation was added.

## Still required before HQ completion

- ARAP/Laplacian exact pointer-up refinement and robust feature-loop constraints.
- Pose/normal-aware profile visibility and difficult-profile confidence gates.
- Direct semantic handles, linked/asymmetric controls and eye/lip ordering.
- Checkerboard GPU parity/identity measurements and hardware performance data.
- Multi-resolution front/three-quarter/profile visual corpus and Photoshop
  comparison. The task remains open until those gates pass.

## Explicit detector review gate (2026-08-12)

- Detection no longer writes an `lt.face-warp` effect or history command
  immediately. The detector result is held as ephemeral editor state and the
  exact GPU mesh is shown over the active layer first.
- The reused tool-options controls expose only **Accept mesh** and **Cancel**
  during review. Sculpt and semantic controls remain unavailable until the
  result is accepted. Cancelling a redetection preserves the previously
  authored effect; accepting is the sole document mutation.
- The repeatable real-Electron smoke now asserts that undo depth is unchanged
  while the mesh awaits approval. Both `D:\pukkels-lighttable.png` and the
  adverse profile `D:\face.jpg` pass this lifecycle contract on the RTX 5090,
  with no page or WebGPU validation errors.
- The smoke also redetects over an existing authored effect, cancels the
  pending replacement through the normal Escape command and proves history
  remains unchanged before performing
  a separate accepted warm redetection. This guards the non-destructive
  redetect/cancel path rather than testing only first detection.
- A pending review is bound to the exact document, layer, pixel revision and
  affine transform that produced it. Switching document/layer or changing the
  source invalidates the preview, so a stale mesh cannot later be accepted
  onto different pixels. A focused identity contract covers each mismatch.
- Visual inspection of the captured adverse preview confirms that MediaPipe
  can still place a technically valid but anatomically wrong near-frontal mesh
  over a profile face. Gate 6's former low-confidence claim was therefore
  reopened instead of being hidden behind the manual review step.
- An isolated OpenSeeFace research spike was run from ignored reference/temp
  files. Its independent confidence separated this adverse image from the
  current small valid corpus, but the margin on a valid three-quarter face is
  too small and four images are not a defensible production threshold. It is
  not shipped, does not become a second render topology, and needs a licensed,
  representative validation corpus before adoption as a detector oracle.
## Detector quality gate

- Detector output is no longer persisted with a fabricated confidence of `1`.
- A pure geometry/coverage policy rejects incomplete, non-finite, degenerate,
  invalid-pose and mostly unobserved meshes before they enter document state.
- Accepted faces retain a deterministic observation confidence; valid
  edge-of-frame faces remain supported and rejected results surface a clear
  reason instead of inventing editable geometry.
- Focused unit coverage includes valid, edge, incomplete, non-finite,
  degenerate, invalid-pose and mostly off-canvas results.
## Release visibility

- Face Warp remains fully registered for persisted documents, development and
  focused automation, but is explicitly marked experimental.
- Release toolbars filter experimental definitions, so the unfinished tool is
  not presented as production-ready while the remaining HQ gates are open.
## Local restore interaction

- Alt-drag now restores direct mesh constraints locally toward the immutable
  detected source; it does not rerun detection or remove semantic slider edits.
- Shift-drag remains the separate local smoothing operation, and the existing
  options bar states all three brush modifiers without adding solver controls.
- Unit coverage proves that local restore leaves distant direct constraints and
  active semantic deformation intact.
## Shape-preserving Relax

- Shift-drag Relax now smooths only displacement differences. It no longer
  multiplies the local field toward zero, so repeated smoothing cannot slowly
  erase a deliberate translated or broad face deformation.
- Alt-drag Restore remains the only brush gesture that reduces authored
  displacement magnitude toward the detected source mesh.
- Focused unit coverage proves that a uniform large-scale displacement is
  invariant while an isolated local kink is reduced and distant authored work
  remains byte-for-byte unchanged.
## Linked and asymmetric feature editing

- The canonical face state now stores optional left/right feature overrides;
  absent values remain linked to the compact shared parameters.
- One reused Target control selects Both, Left or Right. Both updates the shared
  value and clears matching overrides; Left/Right updates only that feature
  side. Face and Nose remain intentionally centered/global controls.
- Linked and asymmetric edits pass through the same foldover-safe semantic mesh
  evaluator, persist in the Face Warp node and are removed by Reset face.
- Focused tests prove both-side motion, isolated left-side motion, relinking,
  validation and serialized round-trip.
## Small/large brush desktop evidence

- The desktop smoke accepts an explicit brush size and verifies the value is
  published through the real keyboard/UI interaction path before sculpting.
  This prevents a false pass where only the native range DOM value changed.
- On the 546 px portrait, 32 px and 300 px runs produce distinct hashes and
  footprints (334 versus 33,651 changed pixels), remain face-local, introduce
  zero black pixels, settle without spring-back and publish one undo command.
- Interactive p50 is 14.1/14.4 ms. The 300 px run had one 24.3 ms p95 sample;
  this is recorded rather than hidden, while its remaining frames stay at the
  target rate and the work remains bounded by the fixed 468-vertex surface.
## Coordinate equivalence

- A canonical 468-vertex fixture now applies identical semantic and direct
  brush edits before and after a 1.7x scale plus arbitrary in-plane rotation.
- Inverse-mapped targets and rotated/scaled displacement fields agree within
  floating-point tolerance, covering both semantic and proportional paths.
## Solver weight cache

- Normalized bounded inverse-edge Laplacian weights are now computed once per
  immutable detected topology and reused by sculpt and Relax previews.
- Pointer updates no longer normalize every vertex neighborhood on every
  Jacobi iteration. Deterministic tests verify positive unit-sum weights and
  cache identity; a sparse factorization remains explicitly tied to the future
  exact refinement solver rather than being added without a consumer.
## Interactive timing instrumentation

- The repeatable desktop smoke now dispatches six explicit pointer updates and
  waits for the next animation frame after each one. It persists all samples
  plus p50/p95 next-frame latency alongside cold/warm detector time.
- Gesture settle time remains separate and includes its intentional 250 ms
  visual-oracle delay; it is no longer mistaken for interactive solver time.
- Renderer-local instrumentation (excluding Playwright/CDP roundtrip) measured
  30.3 ms for the first lazy solver update, followed by 14.0–15.5 ms frames
  (warm p50 14.7 ms, p95 15.5 ms). Identity remains exact, the changed region
  stays local and the released hash stays stable.
- A measured prewarm experiment moved topology setup and asynchronous pipeline
  preparation into explicit face detection. It did not reduce the first frame
  (35.0 ms versus 30.3 ms before), proving that those are not the bottleneck;
  the experiment was removed instead of retaining ineffective complexity.
- The remaining cold hit is the first full-resolution deformation-target/pass
  setup. Eager allocation may remove it, but must be benchmarked against the
  identity path's current zero-extra-texture memory win before adoption.

## Shape-preserving pointer-up refinement

## Target-only interactive GPU updates

- The processing runtime retains the existing Face Warp effect instance when
  its serialized node revision changes; unrelated effect nodes are not rebuilt.
- Stable deformation `geometryRevision` values now form an explicit immutable
  source/index contract. Interactive semantic and brush edits compare only the
  packed target vertices and upload the smallest changed contiguous float
  range to the existing target GPU buffer.
- Source UV and index buffers are neither recreated nor rewritten for a
  target-only edit. Full target allocation occurs only when the vertex-buffer
  size changes; topology data is defensively compared only after an authoring
  topology publishes a new geometry signature.
- Focused deformation tests are 8/8 green, including unchanged-target,
  bounded-range, resized-buffer and stable-topology upload plans. The
  `@lighttable/app` typecheck passes.

## Multi-face and asymmetric operation isolation

- Semantic UI changes now execute through one canonical, serializable
  `set-semantic` operation instead of duplicating parameter-splitting logic in
  React. The same operation contract is suitable for later MCP command routing.
- Every operation requires an explicit persisted face ID and returns the input
  unchanged for an unknown ID. Multi-face tests prove the second face retains
  the same object and exact evaluated vertices while a left-only eye edit is
  applied to the selected first face.
- The existing linked/both-side path remains available and clears matching
  per-side overrides when relinking. Focused operation/deformer evidence is
  19/19 green and the app typecheck passes.

## Persistent feature protection

- Each persisted face can independently protect Eyes, Lips, Nose and Face
  outline. A compact existing select plus checkbox exposes the state without
  adding custom controls or solver parameters to the property bar.
- Protection is enforced by canonical operations for semantic controls and by
  the shared vertex set for sculpt preview, pointer-up refinement, Relax and
  Restore. Locked vertices retain their exact authored displacement rather
  than merely hiding UI changes.
- Focused operation/deformation/settings tests are 23/23 green. The surrounding
  tool-options suite and app typecheck also pass (434 assertions total in the
  selected Vitest dependency run).

## Local Relax and Restore feedback

- The existing GPU brush-cursor overlay now communicates all three Face Warp
  interaction modes without adding a DOM, CSS or SVG overlay. Sculpt keeps the
  normal cursor, Relax uses a cyan dashed ring and Restore uses an orange dotted
  ring, so modifier state is visible before the next deformation lands.
- Mode changes invalidate only the viewport presentation stage and request a
  frame. They do not dirty the Face Warp effect, layer composite or correction
  pipeline. Releasing or cancelling a gesture clears the mode immediately.
- The app typecheck passes, and the existing render-dirty contract proves a
  viewport-only invalidation emits frame work without requiring a document
  composite.

## Canonical automation command

- `faceWarp.applyOperation` is now a strict, transport-neutral command for the
  same `set-semantic` and `set-protection` operations used by the UI. Values,
  face IDs, targets and feature names are validated before entering document
  mutation code.
- UI controls and the command executor both call one pure
  `applySemanticFaceWarpCommandToDocument` path. The command records exactly
  one regular undo entry, participates in document revision checks, and is
  allowlisted through the authenticated MCP adapter rather than implemented as
  MCP-only rendering logic.
- Five focused suites are green: 42 tests cover parsing, one-history mutation,
  multi-face isolation, command-service routing and authenticated MCP routing.
  The app typecheck passes.

## PSD and native-document export contract

- Native LightTable saves retain the complete Face Warp adjustment stack,
  immutable detection geometry and authored constraints. Reopen therefore
  remains editably deterministic and does not depend on the detector.
- PSD has no native LightTable Face Warp descriptor. Raster PSD layer assets
  now pass through the exact GPU layer-processing callback before their affine
  transform is baked into tight export bounds. Masks and Photoshop-compatible
  Layer Styles remain separate, so Photoshop applies them once rather than
  receiving a double-styled bitmap.
- PSD projection emits an explicit compatibility warning that Face Warp was
  baked into layer pixels and that editable semantics remain in the LightTable
  document. It no longer silently exports the unwarped source texture.
- The two focused export suites are 18/18 green and the app typecheck passes.

## Interactive deformation and memory telemetry

- The generic indexed deformation runtime now records actual target-buffer
  upload count/bytes plus CPU command-encoding time for its copy and indexed
  mesh passes. The telemetry is aggregated through the existing effect runtime
  and exposed over the existing read-only render-telemetry command; it does not
  add polling or invalidate a frame.
- The repeatable desktop Face Warp smoke now samples renderer heap and the
  LightTable-owned GPU texture estimate before detection, after detection,
  after one edit, after eight further edits and after a two-second idle period.
  It also requires one undo entry per repeated gesture and identical pixels
  through the idle interval.
- The frontal 546 px fixture passed with preview p50 13.3 ms / p95 15.5 ms.
  Twenty-one target updates uploaded 115,772 bytes in total; 23 mesh passes
  encoded in 1.09 ms total with a 0.075 ms maximum. GPU texture ownership was
  stable at 20,672,576 bytes after repeated edits and idle. Renderer heap fell
  from its transient 145,325,453-byte edit peak to 62,834,799 bytes after idle.
- Chromium did not expose `measureUserAgentSpecificMemory` in this Electron
  run, so independent worker/detector memory remains explicitly unproven and
  its task checkbox stays open.

- The interactive path remains a bounded two-step Laplacian preview. Pointer-up
  now runs a converged feature-aware refinement over only the connected brush
  footprint; the pointer core and all vertices outside the footprint remain
  exact authored constraints.
- Eye and lip vertices only regularize against their own protected feature
  loop. The outer face boundary is damped and the final target is passed through
  the same face/collar foldover guard as the live preview.
- Refinement is latest-only and scheduled for the next animation frame. A new
  gesture can supersede it without waiting; undo/save/document actions flush it
  inside the existing transaction, preventing the one-frame history race that
  otherwise leaves an unrecorded preview.
- Focused unit evidence is 15/15 green, including a numerically changing
  transition band, exact core/outside constraints and an untouched opposite
  eye on the canonical 468-vertex mesh.
- The desktop fixture remains exact at identity, creates one undo entry, changes
  726 local pixels, creates zero black pixels, preserves canvas bounds and has
  identical released/one-second-settled hashes. Preview measured p50 14.0 ms and
  p95 16.1 ms; pointer-up refinement reached the next rendered frame in 26.8 ms
  including the frame boundary, with no visible preview-to-refined pixel jump.
- No sparse factorization was added: the measured bounded 468-vertex solve does
  not justify that cache or lifecycle complexity yet. That checkbox remains
  open until profiling demonstrates an actual need.

## Exact detection coordinates and pose-aware profiles

- Layer thumbnail export now returns the exact affine matrix used by the GPU
  encode. Face Warp inverts that matrix directly instead of reconstructing a
  second scale from rounded thumbnail dimensions. Deterministic fixtures cover
  front, rotated, scaled and depth-varying detections without a first-frame
  offset.
- Visibility now combines canonical 3D triangle normals transformed by
  MediaPipe's canonical-to-runtime face pose, projected winding and the
  existing local depth test. Back-facing triangles are omitted from overlay
  and hit-testing, while remaining part of the complete deformation surface
  and continuity solve.
- Detector thresholds were calibrated from 0.50 to 0.35. This makes a strong
  near-profile fixture detectable while the existing finite geometry,
  coverage, pose and observation gates still reject unsafe output.
- The desktop smoke now derives its pointer seed from the actually rendered
  cyan mesh instead of assuming a frontal cheek coordinate. Both the frontal
  fixture and a strong profile fixture pass identity, local edit, one-undo,
  zero-hole, fixed-canvas and one-second settle assertions. The profile run
  changed 591 local pixels, introduced zero black pixels and measured 13.9 ms
  warm p50 / 14.9 ms p95 preview frames.
- `D:\face.jpg` remains a documented adverse input: MediaPipe can return an
  anatomically over-wide face fit on that image. It is not counted as HQ
  evidence. A broader front/three-quarter/profile corpus and confidence
  calibration remain open before Gate 6 and the task can complete.

## Pose/resolution matrix and high-zoom evidence

- The desktop smoke now captures the complete tool surface, switches through
  the typed `view.setZoom` command to 300%, validates that a cyan mesh remains
  present, captures it, and returns to Fit before the texture oracle runs.
  Visual inspection of the 300% capture shows the GPU overlay vertices and
  rendered face remain aligned; there is no CSS/SVG duplicate overlay.
- A genuine 200 px three-quarter portrait passes identity, local sculpt,
  repeated edit, one-undo-per-gesture, zero-hole and settle checks. Its preview
  measured 14.3 ms p50 / 15.8 ms p95; pointer-up refinement measured 24.8 ms.
  This case changed 1,115 local pixels and introduced zero black pixels.
- `scripts/create-face-warp-resolution-fixtures.mjs` reproducibly derives 256,
  512, 1024 and 2048 px local fixtures from caller-supplied portraits. Source
  portraits remain outside Git, avoiding a hidden redistribution obligation.
- A 2048 px frontal fixture also passes the full desktop smoke: identity changed
  zero pixels, sculpt changed 1,449 local pixels, introduced zero black pixels,
  measured 13.5 ms p50 / 14.1 ms p95 and refined in 30.4 ms. Together with the
  prior 546 px frontal and strong-yaw/profile runs, this covers front,
  three-quarter, strong yaw and near-profile behaviour across resolutions.
- Detection-quality diagnostics now report pose yaw, visible-point ratio and
  nose/eye observation asymmetry. They are evidence, not a fabricated model
  confidence and not an arbitrary rejection heuristic. The known adverse
  `D:\face.jpg` fit remains documented rather than being hidden by a threshold
  that would also reject valid three-quarter faces.

## Geometry limit and optional synthesis decision

- Full eye closure, newly exposed mouth interiors and other missing texture
  cannot be solved truthfully by moving the detected mesh. If this is added,
  it must be a separate opt-in generated patch stage after Face Warp, with an
  explicit feature mask, cached output and provenance. It may not mutate the
  canonical source/target mesh or masquerade as local/offline geometry.
- The current task therefore keeps the deterministic mesh path complete and
  does not add an implicit inpainting dependency, network call or hidden model
  cost to ordinary Face Warp edits.

## Remaining detector boundary

- A repeat run on `D:\face.jpg` confirms the outstanding failure is upstream
  observation quality, not mesh/render drift: MediaPipe reports only 18.7° yaw
  and returns an internally coherent near-frontal mesh over a profile image.
  The overlay therefore exposes the detector's wrong geometry faithfully.
- Valid three-quarter and strong-yaw inputs overlap the simple coverage and
  asymmetry signals of that adverse input. Rejecting it with an image-specific
  threshold would also reject legitimate faces, so no such heuristic was
  added. The tool remains experimental until a stronger detector/confidence
  oracle or a user-assisted alignment flow addresses this class safely.
- An independent local image-gradient fit diagnostic was prototyped against
  the face oval, eyes and lips on the frontal, three-quarter, adverse profile
  and low-contrast expressive fixtures. It separated the first three but also
  rated a valid low-contrast face poorly. The prototype and its detection-time
  pixel readback were removed rather than shipping an unproven reject rule or
  permanent runtime cost.

## Photoshop parity oracle

- Adobe's current documentation confirms the comparable Face-Aware controls
  and that the workflow is optimized for front-facing faces. It does not expose
  the underlying morph equations. The generic UXP `batchPlay` API can replay a
  captured action descriptor, but Adobe does not publish a stable typed
  Face-Aware Liquify descriptor suitable for inventing an unattended oracle.
- `architecture/validation/FACE_WARP_PHOTOSHOP_PARITY_PROTOCOL.md` therefore
  fixes the source corpus, isolated ±50 Face Width / Eye Size / Nose Width /
  Smile edits, lossless captures, feature-local metrics, high-zoom review and
  offline reopen requirement. It explicitly forbids substituting ordinary
  Liquify or approving by full-image RMSE alone.
- The Photoshop comparison checkbox remains open until those actual reference
  PNGs exist. This is deliberate: the protocol is now repeatable, but a written
  protocol is not evidence of parity.
- `scripts/capture-lighttable-face-warp-parity.mjs` now captures identity plus
  Face Width, Eye Size, Nose Width and Smile at -50 and +50 through the
  canonical `faceWarp.applyOperation` command. Every case is exported, saved
  as a native LightTable artifact, reopened and exported again; unequal hashes
  fail the run.
- The frontal `D:\pukkels-lighttable.png` corpus passed all eight operations
  and all eight pixel-exact native roundtrips. The real 200 px three-quarter
  `Tom_Hanks_54745.png` fixture passed the same matrix. Visual review of the
  frontal contact sheet found local, correctly directed edits without holes,
  folds, boundary seams or background drag.
- The corpus runner now targets the active raster source explicitly and rejects
  a case when its exported pixels equal the identity render. A fresh frontal
  run passed this stricter contract: all eight operation hashes differ from
  identity and every reopened artifact remains pixel exact.
- `scripts/compare-face-warp-parity.mjs` validates dimensions and produces
  absolute-difference PNGs, RMSE/maximum channel differences and a three-column
  LightTable/Photoshop/difference sheet. Its eight-case identical-reference
  self-test reports 8 compared, 0 waiting and RMSE 0; the real corpus without
  Adobe captures reports 0 compared and 8 explicitly awaiting Photoshop.
- Adobe's official batchPlay guidance requires recording an accepted command.
  Face-Aware Liquify records opaque source-specific `faceMeshData`; the local
  `Liquify Last Mesh.psp` is only Photoshop's unrelated last mesh. Replaying it
  would not be a valid isolated semantic oracle, so no fabricated automation
  descriptor was added.
- Focused verification after adding the corpus path: app typecheck passed; the
  Face Warp quality/operation and shared command-service dependency run passed
  29 files / 711 tests.
- The desktop oracle now also drives the production `Adjust` UI: one real
  pointer drag on Feature `Face width` / Amount changes visible pixels, creates
  exactly one undo entry and undo restores the exact pre-edit canvas hash. This
  proves the compact UI reaches the same canonical history/render path as
  sculpting; it is not merely a presentational control.
- Adobe documents reopening Face-Aware Liquify by first converting the layer
  to a Smart Object, entering the separate Liquify window and committing it.
  LightTable keeps Face Warp as an ordinary persistent layer effect: the mesh,
  semantic values, constraints and protection survive native save/reopen and
  remain directly editable alongside the document. That is a concrete
  non-modal workflow advantage, independent of whether the final deformation
  pixels have reached Photoshop parity.

## Focused tool UX and detector-memory truthfulness

- The previously overlong one-row toolbar is split with the existing canonical
  `SegmentedControl` into `Sculpt` and `Adjust`. Face selection, mesh visibility
  and Reset remain stable; Sculpt contains only Brush, Strength and the gesture
  hint. Adjust contains side targeting and protection plus a compact Feature
  selector driving one Amount slider, so all semantic controls fit without
  hiding the final controls behind horizontal overflow.
  Both modes still write the same canonical Face Warp state and reuse existing
  buttons, selects, checkbox and `AdjustmentSlider` components.
- A real 1600 px desktop capture confirms the complete Sculpt surface fits
  without hiding its primary controls behind horizontal overflow. The same
  fixture captures and asserts both Sculpt and Adjust, then still passes
  identity, edit, history and settle assertions after returning to Sculpt. The
  focused ToolOptions dependency run is 415/415 green.
- Worker-local heap sampling is now emitted independently from renderer heap
  telemetry. Current Electron/Chromium workers return `null` for this optional
  API, so the report records `{beforeBytes:null, afterBytes:null,
  deltaBytes:null}` rather than attributing renderer memory to MediaPipe. This
  closes the instrumentation requirement while preserving the platform limit
  as explicit evidence.
- A forced Chromium SwiftShader launch was also attempted as a conservative
  fallback stress path. This Electron build exposes no compatible WebGPU
  adapter in that mode, so it cannot substitute for the still-required test on
  actual integrated/Apple-class hardware. Fallback reports use a separate
  output directory and can no longer overwrite native-GPU evidence.

## Integrated GPU qualification

- The repeatable desktop smoke accepts an explicit `low-power` GPU mode using
  Chromium's low-power adapter selection. The report records the adapter
  identity, so a passing run cannot be mistaken for integrated-GPU evidence
  without proving which device actually rendered it.
- This Windows machine exposes both an RTX 5090 and Intel integrated graphics.
  The low-power Face Warp smoke selected `intel / xe-lpg` and passed detection,
  identity, local sculpt, repeated edits, one-command undo, exact settle,
  semantic edit/undo and renderer validation without page or GPU errors.
- On Intel Xe-LPG, ordinary preview frames measured 14.1 ms p50 / 16.8 ms p95
  and pointer-up exact refinement measured 18.7 ms. Together with the existing
  discrete NVIDIA runs this closes the Windows discrete plus integrated-GPU
  gate and supports the non-flagship interaction gate. Apple hardware remains
  untested and must not be claimed by release material.
