# LightTable Auto Align audit and production plan

Status: research/design gate, 2026-07-28.

The current implementation is a prototype. Automatic rotation is temporarily
disabled by default until model selection is reliable.

## Current implementation audit

What is correct:

- `RasterRenderContract` exposes source texture, source dimensions,
  linear-sRGB/premultiplied-alpha semantics, source/geometry revisions and a
  source-to-document affine matrix.
- `WebGpuEngine.alignLayersTranslation()` resolves the runtime raster textures,
  not the graded/composited output.
- Both layers are reprojected through the inverse of their existing transform
  into one document-space analysis rectangle.
- The correction direction is consistent with the compositor:
  `correction * currentTargetTransform`. Unit tests cover translation and
  similarity inversion/composition.
- The locked reference is read-only. Only an unlocked target can preview or
  commit.
- Preview is compositor-only. Apply increments target geometry revision and is
  one document-history entry; Cancel does not mutate the document.
- GPU readback contains candidate scores, not image textures. Temporary
  textures and buffers are destroyed in `finally`.

What is incomplete or unsafe:

- There is no image pyramid. Everything is estimated at one analysis size.
- There is no local luminance normalization, Gaussian prefilter or Census-like
  representation.
- Translation, scale and (previously) rotation were selected by exhaustive
  single-resolution edge-direction error. This is prone to false minima.
- The previous implementation gave rotation another free parameter without
  proving that a rotated model was necessary. Repetitive terrain demonstrated
  a false rotation.
- Setting `maximumRotationDegrees` to zero previously disabled only the coarse
  rotation search. The local refinement still introduced up to 0.5 degrees of
  rotation. The prototype guard now closes both paths.
- Scale was searched over the very broad range 0.6–1.67. That is useful as a
  recovery range, but unsafe as the default AI-return prior.
- Analysis bounds are only the current transformed-bounds intersection. They
  are not expanded by a search margin, and different crops are represented
  only through alpha validity.
- Transparency is respected, but layer masks, selections and AI edit/exclude
  masks are not.
- The score compares gradient direction and uses gradient magnitude as weight.
  It is relatively exposure tolerant, but can match a small convenient set of
  similarly oriented edges. It has no local photometric normalization or
  robust residual over spatial structure.
- Confidence is not yet production confidence. It lacks feature inlier count,
  spatial coverage, bidirectional consistency, pyramid stability, parameter
  uncertainty, boundary-hit detection and an explicit unrelated-image test.
- There is no ambiguity heatmap/peak analysis and no safe rejection gate.
  Low-confidence results can still be applied manually.
- There is no analysis cache. Re-aligning several targets repeats reference
  reprojection and gradients.
- Only one target and exactly one other visible locked reference are supported.
- Progress is a single text state; per-stage timings and debug outputs do not
  exist.
- The document transform is affine. A homography cannot be persisted or
  composited correctly without first extending the render contract,
  compositor, bounds, gizmo and layered-document format.

The largest architectural mistake was advancing to similarity search before
the original translation milestone had a pyramid, normalization, rejection,
debug views and a measured test corpus.

## Strategy comparison

### 1. Exhaustive direct pixel/gradient search

Good:

- already WebGPU-native;
- small readback;
- deterministic;
- useful for local refinement.

Bad:

- search cost grows rapidly with parameters;
- ambiguous on repeated/low-texture content;
- local AI edits can bias it;
- a single resolution couples scale, rotation and translation;
- confidence from one score surface is weak.

Decision: retain only as a coarse translation fallback and final local
refinement, not as the global similarity estimator.

### 2. Phase correlation plus log-polar scale/rotation

Phase correlation gives an efficient global translation estimate and is fairly
insensitive to global illumination changes. A log-polar transform of Fourier
magnitude converts rotation and uniform scale into translations.

Good:

- global estimate without a large spatial candidate grid;
- subpixel translation is well understood;
- strong synthetic accuracy.

Bad:

- requires a solid WebGPU FFT, windowing and peak analysis implementation;
- phase normalization is sensitive to noise;
- masks/crops/local edits need masked correlation or careful weighting;
- repeated patterns can produce several comparable peaks.

Decision: valuable translation initializer and diagnostic score surface. Do
not make log-polar the only estimator for AI-edited/cropped images.

### 3. Feature matching plus robust model fitting

Detect structured points, describe local neighborhoods, match mutually, then
fit translation/similarity/affine with RANSAC-like robust estimation.

Good:

- naturally ignores many local edits and crop differences;
- produces explicit correspondences, inliers and spatial coverage;
- supports principled model selection;
- CPU model fitting works on compact data.

Bad:

- substantially more implementation and testing;
- weak on flat, defocused or heavily noisy images;
- descriptors and thresholds require calibration;
- full OpenCV.js would add a large dependency unless isolated/lazy-loaded.

Decision: use a LightTable-owned GPU feature path, initially Harris/FAST-like
points plus a binary Census/BRIEF-style descriptor. Read back only compact
keypoints/descriptors and run deterministic robust fitting on CPU.

### 4. ECC/direct iterative alignment

ECC optimizes an area-based photometrically normalized similarity criterion.
Coarse-to-fine direct alignment is useful for subpixel refinement.

Good:

- subpixel result;
- handles global brightness/contrast differences better than raw SSD;
- supports masks and several motion models.

Bad:

- local optimizer; it needs a good initializer;
- can converge to the wrong basin;
- unsuitable as the only global matcher.

Decision: final refinement and verification after phase/features, with robust
weights and validity/exclude masks.

## Recommended production architecture

```text
source raster contracts
  -> shared document-space bounds plus search margin
  -> luminance + validity/exclude masks
  -> Gaussian/local-normalized pyramid
  -> global translation proposal (phase correlation)
  -> GPU keypoints + compact binary descriptors
  -> CPU mutual/ratio matching and spatial filtering
  -> robust model ladder
  -> pyramidal direct/ECC-like refinement
  -> independent verification and safe rejection
  -> compositor-only preview
  -> atomic transform commit
```

GPU responsibilities:

- source reprojection and validity;
- local normalization, blur, gradient and pyramid;
- phase-correlation preprocessing/FFT when implemented;
- keypoint response, non-maximum suppression and descriptors;
- direct residual/refinement passes;
- debug images and score heatmaps.

CPU responsibilities:

- compact keypoint/descriptor readback;
- mutual/ratio filtering;
- deterministic RANSAC/PROSAC-style model fitting;
- model comparison, plausibility and confidence;
- orchestration, cancellation, cache and diagnostics.

No full-resolution image readback is needed.

### Model ladder

Evaluate models independently:

1. translation;
2. translation + uniform scale;
3. similarity including rotation;
4. limited affine.

A more complex model is accepted only if:

- it improves held-out/verification residual materially;
- inlier support and grid coverage do not decrease;
- the estimate is stable across adjacent pyramid levels;
- forward/backward transforms agree;
- parameters stay inside workflow-specific plausible bounds;
- the optimum is not pinned to a configured search boundary.

Homography is deferred until the document/render contract supports projective
geometry. It must never be silently approximated by the current affine matrix.

Default AI-return prior:

- translation + uniform scale;
- scale near 1 first, wider recovery only after rejection;
- rotation disabled unless explicitly requested or strongly proven;
- affine disabled unless similarity fails verification.

## Confidence and rejection

Confidence is a policy result, not a renamed residual. Record:

- best/second peak ratio and peak sharpness;
- matched features, mutual matches, inliers and inlier ratio;
- inlier distribution across a document grid;
- robust reprojection RMS and percentile;
- valid overlap and evidence coverage;
- direct residual improvement over identity;
- forward/backward consistency;
- parameter estimate at multiple pyramid levels;
- search-boundary hits;
- transform plausibility;
- unrelated-image classifier/rejection score.

Hard reject on insufficient texture, insufficient spatial coverage, ambiguous
repeated peaks, implausible determinant/scale/shear, low overlap, inconsistent
pyramid estimates, or unrelated content. Rejection leaves transforms and
history untouched.

## Phased implementation

### Phase 0 — safety and observability

- Keep automatic rotation off in the existing command.
- Add exact result diagnostics to the UI/dev console.
- Add Overlay, Difference, Edge Difference and Flicker preview.
- Add analysis bounds, gradient, validity and score-heatmap debug views.
- Add GPU stage timers and readback timing.

### Phase 1 — finish reliable translation

- Build 64/128/256 or adaptive Gaussian pyramid.
- Add local luminance normalization and Hann/window support.
- Implement coarse-to-fine translation and subpixel refinement.
- Add ambiguity/peak and safe rejection.
- Meet translation tests before enabling scale.

### Phase 2 — robust scale/similarity initialization

- Add GPU keypoint detection and compact binary descriptors.
- Mutual matching, ratio test and spatial filtering.
- Fit translation and partial affine/similarity robustly.
- Enable uniform scale after acceptance criteria pass.
- Enable rotation only when model evidence passes.

### Phase 3 — direct refinement

- Implement masked pyramidal ECC-like or robust normalized-gradient refinement.
- Use robust loss/exclude masks for AI-edited regions.
- Verify independently after refinement; refinement may be rejected.

### Phase 4 — limited affine and multi-target

- Add affine only with strict shear/non-uniform-scale constraints.
- Cache reference pyramids/features by layer/source/geometry revision.
- Align multiple targets independently and commit one undo transaction.

### Phase 5 — later geometry

- Decide whether projective layer transforms belong in the core document model.
- Only then consider homography, lens model or rolling-shutter correction.

## Acceptance criteria

Suitable synthetic and photographic pairs:

- translation error below 0.5 document pixel;
- uniform scale error below 0.001;
- rotation error below 0.05 degrees when rotation mode is enabled;
- forward/backward disagreement below 0.35 px median;
- reference transform and revisions remain bit-identical;
- Cancel creates no history entry;
- Apply creates exactly one entry; Undo/Redo restore exact matrices;
- exposure ±3 EV and substantial contrast/white-balance changes do not move
  the solution beyond tolerances;
- a local edit covering 25% of the overlap does not break alignment;
- crops with at least 35% well-distributed overlap align or reject safely;
- flat, repetitive, unrelated and insufficient-overlap pairs reject;
- no rejected result changes target geometry;
- translation preview target below 250 ms and similarity below 500 ms on the
  agreed reference GPU, measured per stage.

## Test corpus

Synthetic, generated deterministically from several source images:

- translations: ±0.25, ±0.5, ±1, ±10, ±64, ±128 px;
- scales: 0.90, 0.98, 1.001, 1.02, 1.10;
- rotations: ±0.02, ±0.05, ±0.5, ±3 degrees;
- combinations around center and non-central anchors;
- alpha borders, crops and partial overlap;
- exposure/gamma/contrast/white-balance changes;
- blur, noise, JPEG damage and resampling;
- rectangular/free masks and local replacement up to 40%;
- checkerboards, windows, dunes and other repeated structures;
- flat/low-texture and unrelated negative pairs.

Photographic:

- AI edit with unchanged background;
- focus stack;
- exposure bracket;
- handheld near-duplicate;
- different crop;
- portrait with local face/hair edit;
- architecture/repeated windows;
- landscape/repeated terrain;
- motion/subject change;
- lens/perspective mismatch that must reject or choose limited affine.

Every fixture stores the expected transform/model or expected rejection.

## Current performance baseline

The prototype has no timestamp-query instrumentation yet, so honest per-pass
milliseconds cannot be reported from code inspection alone. Its workload can
be bounded, however. At the default 128-pixel analysis dimension and the
maximum 48-analysis-pixel translation radius:

- reprojection: two fullscreen 128 x 128 passes;
- gradient extraction: two fullscreen 128 x 128 passes;
- coarse translation: up to 9,409 candidates, or about 154 million
  candidate-pixel evaluations;
- coarse scale at zero rotation: about 26 candidates;
- translation after scale: up to 2,401 candidates, or about 39 million
  candidate-pixel evaluations;
- local scale refinement at zero rotation: 5 candidates;
- subpixel translation refinement: 169 candidates, or about 2.8 million
  candidate-pixel evaluations;
- score readback: 16 bytes per candidate, approximately 188 KiB over those
  stages at the maximum search radius.

This explains why simply increasing the analysis dimension is not a sound
quality fix: doubling it to 256 would approximately quadruple the dominant
pixel-scoring work. Phase 0 must add timestamp queries (with a CPU wall-clock
fallback) around reprojection, preprocessing, each scoring/refinement pass,
mapping/readback and orchestration. Measurements must record adapter name,
analysis dimensions, candidate counts and warm/cold cache state.

## Debug and performance contract

Development output per run:

- request/options and layer revision cache keys;
- source/document/analysis matrices and bounds;
- pyramid dimensions;
- gradient/validity/exclude views;
- feature keypoints, accepted matches and inliers;
- correlation/score heatmap and top competing peaks;
- residual before/after and verification mask;
- chosen/rejected models with reasons;
- per-pass GPU time, CPU time, readback bytes and total latency.

Debug resources are opt-in and destroyed with the alignment session.

## Migration from the prototype

Keep the existing external seam:

- `RasterRenderContract`;
- `TranslationAlignmentResult`/future `AutoAlignResult`;
- compositor geometry preview;
- `applyTranslationAlignment`;
- document history.

Replace internals behind the service in order:

1. extract analysis preparation and cache;
2. replace single-resolution translation with pyramid translation;
3. add confidence/rejection evaluator;
4. add feature proposal and robust model fitter;
5. add direct refinement;
6. add multi-target controller.

The current brute-force scorer remains available as a local fallback and as a
reference implementation for synthetic tests. Existing layered documents need
no migration because only ordinary affine transforms are committed.

## References

- OpenCV phase correlation:
  https://docs.opencv.org/4.x/d7/df3/group__imgproc__motion.html
- scikit-image phase cross-correlation and masked registration:
  https://scikit-image.org/docs/stable/api/skimage.registration.html
- scikit-image log-polar rotation/scale example:
  https://scikit-image.org/docs/stable/auto_examples/registration/plot_register_rotation.html
- OpenCV ECC and masked ECC:
  https://docs.opencv.org/5.x/dc/d6b/group__video__track.html
- OpenCV partial affine estimation with RANSAC:
  https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
- OpenCV feature matching and mutual/cross checking:
  https://docs.opencv.org/4.x/d3/da1/classcv_1_1BFMatcher.html
- OpenCV affine stitching matcher:
  https://docs.opencv.org/4.x/d3/dda/classcv_1_1detail_1_1AffineBestOf2NearestMatcher.html
