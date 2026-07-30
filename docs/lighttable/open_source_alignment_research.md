# Open-source image alignment research

Date: 2026-07-28

Scope: find proven open-source registration and panorama implementations that
can guide or support replacement of LightTable's current Auto Align estimator.

Read together with:

- `docs/lighttable/photoshop_auto_align_research.md`
- `docs/lighttable/AUTO_ALIGN_FOLLOWUP_HANDOFF.md`

## Main conclusion

There is no reason to invent the estimator from scratch. Mature open-source
projects consistently use:

```text
multi-scale features
  -> descriptor matching
  -> robust geometric estimation
  -> inlier and coverage checks
  -> geometric refinement
  -> optional direct photometric refinement
```

For LightTable, the best production direction is a small, lazy-loaded OpenCV
WASM alignment worker using only the required primitives. Do not initially port
the complete OpenCV Stitcher or Hugin panorama pipeline.

The first LightTable model should be a four-degree-of-freedom similarity
transform: translation, rotation and uniform scale. It exactly matches
OpenCV's `estimateAffinePartial2D`.

## OpenCV

Repository and license:

- https://github.com/opencv/opencv
- Apache-2.0 for current releases.

### Complete stitching pipeline

OpenCV exposes separate stages for:

- feature detection;
- pairwise feature matching;
- homography or affine estimation;
- bundle adjustment;
- projection/warping;
- exposure compensation;
- seam estimation;
- blending.

Its documented panorama model uses homographies. Its scan model uses affine
estimation, including a partial affine/four-DOF variant.

Sources:

- https://docs.opencv.org/4.9.0/d1/d46/group__stitching.html
- https://docs.opencv.org/4.10.0/d2/d8d/classcv_1_1Stitcher.html
- https://github.com/opencv/opencv/blob/4.x/samples/cpp/stitching_detailed.cpp

The current high-level Stitcher defaults to ORB features, performs registration
at a reduced resolution, filters images using a match-confidence graph, then
estimates camera parameters. Warping, exposure compensation, seam finding and
blending happen later.

The stages are deliberately configurable. That is important: LightTable needs
registration but not panorama projection, automatic cropping, exposure
compensation, seam creation or flattened blending.

### `estimateAffinePartial2D`

This is the closest established primitive to the current LightTable contract.
It estimates:

- x/y translation;
- rotation;
- uniform scale.

It supports RANSAC or least-median estimation, returns the inlier mask and can
refine the robust result with Levenberg-Marquardt iterations.

https://docs.opencv.org/3.4.14/d9/d0c/group__calib3d.html

Use the inlier mask for diagnostics and validation. Do not treat the returned
matrix alone as proof that alignment succeeded.

### ECC direct refinement

`findTransformECC` optimizes a transform by maximizing enhanced correlation
coefficient. It supports translation, Euclidean, affine and homography models,
plus an input mask.

https://docs.opencv.org/4.5.2/dc/d6b/group__video__track.html

ECC is a local optimizer. Use it after feature-based initialization, preferably
over a pyramid and masked valid overlap. Do not use it as the global solver for
large unknown translation or scale.

### Browser/WASM feasibility

OpenCV officially documents Emscripten/WebAssembly builds, separate `.wasm`
output, SIMD builds and custom module selection.

- https://docs.opencv.org/4.10.0/d4/da1/tutorial_js_setup.html
- https://docs.opencv.org/doc/doxygen/html/db/d05/tutorial_config_reference.html

Do not add the full prebuilt `opencv.js` bundle to the application shell.
Produce a dedicated worker artifact with a small C/C++ interface. Candidate
module set:

```text
core
imgproc
features2d
calib3d
video
```

The implementation spike must verify which functions are generated in the
standard JavaScript bindings. A small explicit Emscripten wrapper is preferable
if bindings for `estimateAffinePartial2D` or `findTransformECC` are incomplete.

## Hugin and libpano

Hugin is a mature panorama and image-stack tool. Its `cpfind` implementation is
especially valuable as an algorithm reference.

Sources:

- https://hugin.sourceforge.io/docs/manual/Cpfind.html
- https://hugin.sourceforge.io/docs/manual/Hugin.html
- https://hugin.sourceforge.io/docs/html/

Hugin/cpfind is GPL-licensed. Its source may be studied, but do not copy its
implementation into LightTable unless the product's licensing strategy changes.

### Useful Hugin design choices

`cpfind`:

- detects distinctive keypoints;
- uses a gradient-based descriptor;
- matches descriptors into control points;
- normally analyzes reduced-size images;
- uses a KD-tree and a second-best-distance check;
- uses RANSAC;
- rejects image pairs with too few matches;
- distributes detected and retained points over spatial buckets;
- caches keypoints;
- can mask moving clouds before selecting keypoints;
- remaps wide/fisheye inputs before matching.

The spatial buckets are directly relevant. Hugin attempts to distribute
features over the image rather than letting one textured object provide every
match. Its final sieve also keeps control points across a grid. This reduces
degenerate fits and supplies a natural coverage metric.

Hugin explicitly warns that a homography is more flexible than necessary and
can generate false matches, particularly when matches lie mostly on one line.
That is the same failure class LightTable must prevent.

### `align_image_stack`

Hugin also ships `align_image_stack` for brackets and focus stacks. It divides
images into a grid, finds control points across the image and optimizes camera
orientation/lens parameters.

https://manpages.debian.org/testing/hugin-tools/align_image_stack.1.en.html

This is conceptually close to LightTable's bracket/focus-stack use cases, but
the camera/lens optimizer is not the right first implementation for AI-edited
layers.

## OpenPano

OpenPano is a compact C++ panorama stitcher written without a vision library.
It follows the Brown/Lowe pipeline and documents:

- SIFT features;
- feature matching;
- RANSAC;
- affine or homography estimation;
- camera estimation;
- cylindrical/panorama output.

Repository:

- https://github.com/ppwwyyxx/OpenPano
- MIT license.

It is useful as readable implementation reference and has a permissive license.
It is not a production browser dependency: it is an older native C++ panorama
application, and its default homography/camera pipeline is broader than the
LightTable requirement.

## OpenStitching

OpenStitching's `stitching` package is an Apache-2.0 Python wrapper around
OpenCV's detailed stitching components.

https://github.com/OpenStitching/stitching

It is useful for quickly experimenting with feature detectors, match
confidence, affine versus homography models and stitching diagnostics. It is
not directly deployable in the browser.

Use it, if useful, as an offline corpus oracle: run the fixed LightTable
fixtures through several OpenCV configurations before deciding which detector
to compile to WASM.

## Browser-native educational implementations

There are pure JavaScript ORB/HOG, RANSAC and browser panorama experiments,
including:

https://josundin.github.io/stitch/

They demonstrate that the complete pipeline can run in a browser and worker.
They are useful for understanding data flow, not suitable as the production
foundation. They are old, lightly maintained and lack the validation,
performance work and test surface of OpenCV.

## What panorama systems solve that LightTable does not need yet

360-degree panorama software additionally handles:

- unordered sets of many images;
- camera focal length and lens distortion;
- cylindrical, spherical or other projections;
- global camera pose and bundle adjustment;
- exposure compensation;
- seam optimization;
- multiband blending;
- output canvas and crop selection.

LightTable currently has a narrower problem:

- two known layers;
- one locked reference;
- substantial shared content;
- target already has an approximate document transform;
- expected translation, uniform scale and perhaps small rotation;
- changed AI regions should be treated as outliers;
- output remains a non-destructive layer transform.

Using a full homography or panorama camera model would add freedom that can
produce the exact false rotations and distortions already observed.

## Recommended LightTable pipeline

### Phase 1: offline detector benchmark

Use the saved fixtures and compare at least:

- SIFT;
- AKAZE;
- ORB.

Measure:

- keypoint count;
- mutual match count;
- RANSAC inlier count and ratio;
- spatial coverage;
- transform error against the known transform;
- runtime and estimated WASM size.

Do not select ORB merely because OpenCV Stitcher uses it by default. Near
duplicates are easy, but AI-edited regions, scale, blur and grading can alter
descriptors. Choose from measured corpus reliability.

### Phase 2: worker correctness baseline

The worker should:

1. receive reduced-resolution reference and target luminance plus validity
   masks;
2. detect multi-scale features;
3. retain spatially distributed features using image buckets;
4. perform KNN descriptor matching;
5. apply a best-versus-second-best ratio;
6. require mutual matches;
7. estimate a translation candidate from robust displacement statistics;
8. estimate a similarity candidate with `estimateAffinePartial2D` and RANSAC;
9. compare models using verified residual improvement and complexity penalty;
10. reject weak, clustered, collinear or implausible results;
11. refine the accepted model with masked pyramidal ECC;
12. return transform, inliers, coverage, residuals and rejection reasons.

### Phase 3: integration

Keep the existing editor semantics:

- reference never moves;
- Preview is non-destructive;
- Apply creates one undo command;
- Cancel restores exactly;
- source pixels are never rewritten;
- final resampling stays in the WebGPU renderer;
- analysis artifacts are cached by source and geometry revision;
- worker code is loaded only when Auto Align is invoked.

## Recommended decision

Use OpenCV as the executable correctness foundation and Hugin/OpenPano as
algorithm references:

```text
OpenCV WASM:
  detector + matcher + RANSAC similarity + ECC refinement

Hugin concepts:
  spatial sieves + coverage + pair rejection + masked bad regions

LightTable:
  fixed reference + selection ROI + preview/apply/cancel + WebGPU resampling
```

Do not continue tuning the existing exhaustive gradient scorer. Preserve it
temporarily behind a development flag only if it helps compare diagnostics.
