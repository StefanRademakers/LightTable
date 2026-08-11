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
