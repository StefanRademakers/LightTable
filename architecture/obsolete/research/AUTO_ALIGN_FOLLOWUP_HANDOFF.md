# Archived Auto Align follow-up handoff

Status: the legacy scorer was not working. A feature-based V2 replacement is
now wired for browser validation; see the resume checkpoint in
`../auto_align_v2_implementation_plan.md`.

This handoff predates the standalone extraction. Current implementation lives
under `packages/lighttable-app/src/lighttable/editor/autoAlign/` and
`packages/lighttable-app/src/lighttable/application/tools/autoAlign/`. Preserve
the research and acceptance criteria below, but do not restore the old
`client/src/features/lighttable/...` ownership.

Do not tune or restore the legacy brute-force scorer described below. Its
practical failures motivated V2. Do not call V2 production-ready until the
real-layer browser gate and direct-refinement milestone are complete.

Read first:

- `docs/lighttable/auto_align_v2_implementation_plan.md`
- `docs/lighttable/photoshop_auto_align_research.md`
- `docs/lighttable/open_source_alignment_research.md`
- `docs/lighttable/archive/auto_align_audit_and_production_plan.md`
- `docs/lighttable/archive/LIGHTTABLE_WEBGPU_AUTO_ALIGN_LAYERS.md`
- `docs/lighttable/transform_tool.md`
- `packages/lighttable-app/src/lighttable/editor/autoAlign/`
- `packages/lighttable-app/src/lighttable/editor/rendering/renderContract.ts`

## Actual user goal

The main workflow is aligning an AI-edited image back onto the highest-quality
original. AI edits may come back translated, uniformly scaled, slightly
rotated, cropped, locally changed, differently exposed or differently graded.
The user then wants to mask the useful AI-edited region and composite it onto
the original without sending the whole image through another latent roundtrip.

Other intended use cases include brackets, focus stacks and handheld
near-duplicates.

The locked reference layer must never move. Only target-layer transforms may
be previewed and committed.

## Known reproduction

1. Create two layers from the same image.
2. Lock the bottom layer as the reference.
3. Translate and uniformly scale the upper target layer. Do not rotate it.
4. Run Auto Align.

Observed:

- confidence has been very low despite abundant shared content;
- Apply sometimes produced no useful visual alignment;
- another attempt produced a visibly rotated, incorrectly positioned result;
- the current conservative patch disables rotation but still does not produce
  a correct alignment.

This should be an easy registration case and must pass before local AI edits,
crops, affine motion or multiple targets are attempted.

## Important current implementation facts

What should be preserved:

- `RasterRenderContract` exposes the raw source texture, source dimensions,
  linear-sRGB/premultiplied-alpha semantics, revisions and the affine
  source-to-document transform.
- Both layers are reprojected into a shared document analysis space.
- The source raster is analyzed, not the graded/composited result.
- Preview is non-destructive.
- Apply composes the correction with the existing target transform and creates
  one history entry.
- Cancel does not mutate the document.
- The locked reference is not modified.

What must not be trusted:

- the current single-resolution brute-force gradient-direction scorer;
- its confidence percentage;
- the broad scale search as proof of a correct scale;
- a lowest-error candidate without ambiguity and model verification;
- threshold tuning on the current score as a production solution.

At the default maximum translation radius, the current scorer evaluates roughly
196 million candidate-pixel combinations. Increasing the analysis texture from
128 to 256 would roughly quadruple this dominant work without fixing the
estimator.

A concrete bug was found where a zero rotation limit still allowed local
rotation refinement. That path has been closed, but it was only one symptom.

## Required research

This is established image-registration technology. Research proven approaches
before writing another estimator. Use primary papers, official documentation
and mature open-source implementations. At minimum inspect:

- phase correlation and subpixel peak estimation;
- coarse-to-fine Gaussian pyramids;
- masked and locally normalized correlation;
- Fourier-Mellin/log-polar scale and rotation estimation;
- Harris/FAST/DoG-style feature detection;
- ORB/BRIEF/AKAZE/SIFT-style descriptors;
- mutual matching and Lowe-style ratio filtering;
- spatial match coverage;
- RANSAC/MAGSAC-style robust similarity and affine estimation;
- ECC/direct pyramidal refinement;
- forward/backward verification;
- ambiguity and unrelated-image rejection;
- crop, alpha and exclude-mask handling.

Relevant starting points:

- OpenCV `phaseCorrelate`
- OpenCV `findTransformECC`
- OpenCV `estimateAffinePartial2D`
- OpenCV feature matching and stitching detail modules
- scikit-image `phase_cross_correlation`
- scikit-image log-polar rotation/scale registration example

Also inspect how mature panorama, HDR and focus-stacking software selects and
rejects motion models. Do not copy GPL implementation code into LightTable.
Algorithms, papers and behavior may be studied; implement an independent,
documented LightTable version.

## Recommended direction

Replace the estimator behind the existing editor/service seam with a hybrid
coarse-to-fine pipeline:

```text
raw source render contracts
  -> shared document-space analysis bounds plus search margin
  -> luminance, validity and optional exclude masks
  -> normalized Gaussian pyramid
  -> robust translation proposal
  -> keypoints and compact descriptors
  -> mutual matches and spatial filtering
  -> robust transform model ladder
  -> masked direct subpixel refinement
  -> independent verification
  -> confidence or safe rejection
  -> compositor preview
  -> atomic target-only commit
```

Model ladder:

```text
translation
  -> translation + uniform scale
  -> similarity with rotation
  -> limited affine
```

Only advance to a more complex model when held-out residual, inlier support,
spatial coverage and forward/backward consistency improve materially.
Homography does not fit the current affine document contract and must not be
silently approximated.

Likely browser/WebGPU split:

- GPU: reprojection, normalization, pyramids, gradients, feature response,
  descriptors, correlation/refinement and debug images.
- CPU: compact descriptor readback, matching, deterministic robust fitting,
  model selection, rejection policy and orchestration.

Never read full-resolution source images back to the CPU for alignment.

## First implementation milestone

Do not begin with rotation or affine.

Build reliable translation first:

- adaptive 64/128/256 Gaussian pyramid;
- local luminance normalization;
- robust translation proposal;
- coarse-to-fine refinement;
- subpixel result;
- peak/ambiguity analysis;
- explicit safe rejection;
- per-stage timings and debug output.

Required debug views:

- analysis bounds;
- reference and target normalized luminance;
- validity/exclude masks;
- gradients;
- correlation or score heatmap;
- best and competing peaks;
- overlay, difference, edge difference and flicker;
- residual before/after;
- exact chosen/rejected reason.

Do not enable uniform scale until translation passes the synthetic and
photographic gate. Do not enable rotation until similarity model selection
passes independently.

## Test gate

Create deterministic fixtures and store the expected transform or rejection.

Minimum positive cases:

- translation: +/-0.25, 0.5, 1, 10, 64 and 128 px;
- uniform scale: 0.90, 0.98, 1.001, 1.02 and 1.10;
- rotation, only after enabled: +/-0.02, 0.05, 0.5 and 3 degrees;
- combined transforms around different anchors;
- exposure up to +/-3 EV;
- contrast, gamma and white-balance changes;
- alpha borders and crops;
- local replacement covering 10%, 25% and 40%;
- blur, noise, JPEG damage and different resampling.

Minimum negative cases:

- unrelated images;
- flat/low-texture images;
- repeated windows, tiles, dunes and checkerboards;
- insufficient or badly distributed overlap;
- perspective/lens changes outside the supported model.

Acceptance for suitable inputs:

- translation error below 0.5 document pixel;
- uniform scale error below 0.001;
- rotation error below 0.05 degrees when enabled;
- forward/backward disagreement below 0.35 px median;
- exposure and local edits stay within these tolerances;
- ambiguous and unrelated pairs reject;
- rejected runs make no document/history changes;
- the reference transform and revisions remain identical;
- Apply creates exactly one undo step;
- Cancel creates none.

Run the same fixtures against every estimator revision. Report accuracy,
rejection result, candidate model, overlap, support/coverage, residual,
GPU time, CPU time, readback bytes and total latency.

## Keep the improvement clean

Preserve the external editor seam and split the implementation into modules:

```text
analysis preparation and cache
pyramid builder
translation estimator
feature detector/descriptor
matcher
robust model fitter
direct refiner
confidence/rejection policy
diagnostics
```

Rules:

- estimators return data and never mutate the document;
- only the editor controller owns Preview, Apply and Cancel;
- confidence is a policy result, not a renamed residual;
- uncertain results reject instead of applying a plausible-looking transform;
- caches are keyed by source and geometry revisions;
- debug resources are opt-in and explicitly destroyed;
- each phase gets its own tests and focused commit;
- do not mix registration work with unrelated LightTable UI or grade changes;
- do not broaden the document transform model during the first milestones.

Suggested implementation/commit order:

- observability, timing and saved regression fixtures;
- reliable pyramidal translation;
- confidence and hard rejection;
- uniform-scale proposal and verification;
- feature matching and robust similarity fitting;
- masked direct subpixel refinement;
- rotation enablement after its test gate;
- limited affine and multi-target caching later.

## Definition of done

Auto Align is not done when one example looks aligned. It is done when the
fixed corpus meets the numerical tolerances, all negative cases reject safely,
diagnostics explain every decision, the locked reference remains immutable,
undo/cancel are exact and measured browser/WebGPU performance is acceptable.
