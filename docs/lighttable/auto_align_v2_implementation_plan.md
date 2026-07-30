# Auto Align V2 implementation plan

Status: V2 feature pipeline implemented; browser validation and direct
refinement remain.

Goal: replace the current scorer with a robust, browser-native registration
pipeline. This is a replacement, not another threshold-tuning pass.

Read first:

- `docs/lighttable/open_source_alignment_research.md`
- `docs/lighttable/photoshop_auto_align_research.md`
- `docs/lighttable/AUTO_ALIGN_FOLLOWUP_HANDOFF.md`
- `client/src/features/lighttable/editor/autoAlign/`

## Architecture

Use WebGPU for pixel-heavy parallel work and TypeScript for the small,
deterministic geometry solver:

```text
raw layer textures
  -> WebGPU luma/gradient pyramid
  -> WebGPU multi-scale oriented keypoints + binary descriptors
  -> WebGPU top-2 Hamming matching
  -> CPU mutual/ratio filtering
  -> CPU robust translation + similarity RANSAC
  -> CPU inlier refinement and validation
  -> WebGPU pyramidal direct refinement
  -> accept or reject
  -> existing preview/apply/cancel transform contract
```

The first feature implementation should be ORB-like:

- FAST/Harris-style corners at multiple pyramid levels;
- spatial bucket top-K selection;
- orientation;
- rotated BRIEF-style binary descriptor;
- bounded feature count and deterministic output.

Do not implement panorama projection, homography, bundle adjustment, seams or
blending. LightTable first needs translation plus uniform scale and small
rotation.

## Milestones

### 0. Freeze behaviour and corpus

- Put the current estimator behind `legacy`; V2 becomes a separate service.
- Save deterministic fixtures with known transforms.
- Include translation, scale, small rotation, crop, grading, local AI changes,
  repeated texture, low texture and unrelated images.
- Add difference-view and match/inlier diagnostic output.

Gate: every fixture has an expected transform or expected rejection.

### 1. WebGPU features and matching

- Build luma/gradient pyramids from raw ungraded layer textures.
- Detect and spatially distribute multi-scale keypoints.
- Generate oriented binary descriptors.
- Find best and second-best descriptor matches on the GPU.
- Apply ratio test, mutual match check and validity masks.

Gate: stable correspondences cover multiple image regions under translation,
scale, crop and moderate grade changes.

### 2. Robust geometry

- Estimate translation from robust match displacement.
- Estimate four-DOF similarity with deterministic RANSAC.
- Use symmetric reprojection error.
- Refit on all inliers with normalized coordinates.
- Prefer translation unless similarity provides meaningful verified gain.
- Never enable arbitrary affine or homography in this milestone.

Gate: known synthetic transforms are recovered without false rotation.

### 3. Validation and rejection

Require:

- minimum mutual matches and inliers;
- useful inlier ratio;
- multi-cell spatial coverage;
- non-collinear geometry;
- bounded scale, rotation and translation;
- adequate overlap after transform;
- low median and p90 residual;
- a distinct winning hypothesis;
- measurable improvement over identity/current transform.

Return structured rejection reasons. A rejected result must not preview or
mutate the document. Replace the current vague confidence percentage with
evidence diagnostics; a UI score can be derived later.

Gate: unrelated, ambiguous, repetitive and feature-poor fixtures reject.

### 4. Direct subpixel refinement

- Initialize only from the accepted feature transform.
- Refine over a coarse-to-fine luma/gradient pyramid.
- Use valid-overlap and selection masks plus a robust loss.
- Solve only translation/similarity parameters.
- Keep the feature solution if refinement diverges or reduces validation.

Gate: final error is within 0.5 output pixel, 0.2% scale and 0.1 degree on the
clean synthetic corpus.

### 5. Editor integration and hardening

- Locked reference remains immutable.
- Preview is non-destructive.
- Apply produces exactly one undo entry.
- Cancel restores exactly.
- Cache analysis by source and geometry revision.
- Handle device loss, cancellation, superseded jobs and resource destruction.
- Keep all analysis off graded/composited pixels.
- Add browser/WebGPU regression tests and measured timings.

Gate: all positive and negative fixtures pass repeatedly; no GPU validation
errors; no document mutation on failure.

## Commit boundaries

Use one focused commit per milestone:

1. fixtures and diagnostics;
2. WebGPU features/matching;
3. RANSAC similarity solver;
4. validation/rejection;
5. direct refinement;
6. editor integration and hardening.

Do not mix unrelated LightTable UI, grading or layer changes into these commits.

## Resume checkpoint

Update this section after every work session so another agent can continue
without reconstructing history.

- Current milestone: 4, direct subpixel refinement
- Last completed gate: deterministic feature detection, matching, translation
  and similarity RANSAC pass synthetic translation, scale/rotation, local-edit
  and rejection tests
- Active implementation paths:
  - `client/src/features/lighttable/editor/autoAlign/FeatureAlignmentService.ts`
  - `client/src/features/lighttable/editor/autoAlign/featureAlignment.ts`
  - `client/src/features/lighttable/editor/autoAlign/featureAlignment.test.ts`
- Editor integration: V2 is wired into the existing target-only
  Preview/Apply/Cancel path. Apply remains one history step.
- Diagnostics: accepted previews report inliers, spatial coverage and residual;
  rejected estimates throw an explicit evidence-based reason and never preview.
- Verification:
  - `npm test -- --run src/features/lighttable/editor/autoAlign` — 13 passing
  - `npm run build` — passing
- Known blocker: no browser fixture runner yet, so WebGPU reprojection and the
  final document-space correction still need hands-on validation in LightTable
  with real layers.
- Next action: test duplicate/translate/scale in the browser. Save any failing
  pair and its diagnostics before changing thresholds. Then add initialized
  coarse-to-fine direct refinement for subpixel accuracy.
- Legacy estimator status: retained in source for comparison, no longer used by
  `WebGpuEngine`

## Definition of first working release

V2 is ready for controlled production testing only when:

- the simple duplicate/translate/scale case passes numerically;
- small rotation works only when actually present;
- local AI changes do not dominate the fit;
- ambiguous and unrelated inputs reject;
- Preview, Apply, Cancel and undo are exact;
- diagnostics explain every accepted and rejected result;
- repeated browser runs are deterministic within the stated tolerances.
