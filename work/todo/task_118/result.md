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
