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

## Still required before HQ completion

- ARAP/Laplacian exact pointer-up refinement and robust feature-loop constraints.
- Pose/normal-aware profile visibility and difficult-profile confidence gates.
- Direct semantic handles, linked/asymmetric controls and eye/lip ordering.
- Checkerboard GPU parity/identity measurements and hardware performance data.
- Multi-resolution front/three-quarter/profile visual corpus and Photoshop
  comparison. The task remains open until those gates pass.
