# Photoshop Auto-Align research

Date: 2026-07-28

Purpose: establish an evidence-based replacement direction for LightTable Auto
Align. The current implementation is not working and should not be repaired by
confidence-threshold tuning alone.

Open-source implementation comparison:

- `docs/lighttable/open_source_alignment_research.md`

## What Adobe publicly confirms

Adobe documents that Photoshop:

- aligns layers from similar content such as corners and edges;
- aligns all moving layers to a reference layer;
- lets the user lock the reference or selects one automatically;
- exposes distinct Reposition, Collage, Perspective, Cylindrical and Spherical
  models;
- lets Auto select the model that produces the best result;
- can compensate lens distortion and vignetting.

For the near-identical two-layer compositing workflow, Adobe explicitly
recommends `Reposition Only`: Photoshop finds common regions and aligns them so
identical content overlaps.

Sources:

- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html
- https://helpx.adobe.com/sg/photoshop/using/combining-multiple-images-group-portrait.html

Adobe does not publish the current Photoshop detector, descriptor, thresholds
or complete solver. Claims below distinguish Adobe patent evidence from
implementation inference.

## Relevant Adobe patent evidence

### Reference selection and projective transforms

Adobe patent US7995861B2 describes automatic reference-image selection by
evaluating overall distortion. Candidate transforms are represented as 3x3
projective matrices. After selection, the reference transform is fixed and the
remaining transforms are corrected relative to it.

https://patents.google.com/patent/US7995861B2/en

LightTable already has a stronger user contract: the locked reference remains
fixed. It should not run automatic reference selection in that workflow.

### Feature matching

Adobe patent US8411961B1 describes establishing feature correspondences between
image pairs for automatic image stitching. It also describes reducing the
number of pair comparisons using file information, user information, heuristics
and previous matching results.

https://patents.justia.com/patent/8411961

This supports a feature-correspondence architecture. It does not establish
which current Photoshop feature detector or descriptor is used.

### Lens-aware feature geometry

Adobe patent US8368773B1 describes:

1. detecting image feature points;
2. establishing correspondences;
3. using camera/lens profiles to correct the feature coordinates;
4. solving alignment using those corrected coordinates.

It specifically avoids unwarping complete source images merely to estimate the
transform. Pixel resampling can therefore remain a render-time operation.

https://patents.google.com/patent/US8368773B1/en

This matches LightTable's desired non-destructive architecture: estimate a
transform from analysis data, store the transform, and sample the original
source only during rendering.

### Feature deficiency and fallback

Adobe patent US10783649B2 describes detecting feature-point deficiency based on
too few detected features, too few matches, or failure of the fitted feature
transform. It selects a feature-based affine/homography path when evidence is
sufficient and another alignment path when it is not.

https://patents.google.com/patent/US10783649B2/en

The mobile gyro fallback in that patent is not applicable to LightTable. The
important reusable pattern is explicit evidence checking, model selection and
fallback/rejection rather than always returning the lowest numerical error.

### Non-destructive layered result

Adobe patent US20080143820A1 describes a panorama stored as original image
layers plus alignment, masks and adjustment data, allowing later manual edits.

https://patents.google.com/patent/US20080143820A1/en

LightTable's layer transform, preview/apply/cancel and mask workflow are
therefore architecturally appropriate. The estimator is the broken part.

## Period-appropriate public algorithm

Brown and Lowe's 2007 paper, *Automatic Panoramic Image Stitching using
Invariant Features*, is not proof of Photoshop's exact implementation. It is a
strong public reference from the same era whose major ingredients agree with
the Adobe evidence:

- multi-scale invariant features;
- gradient-based normalized descriptors for illumination robustness;
- approximate nearest-neighbour matching;
- RANSAC geometric fitting;
- probabilistic verification and rejection;
- global refinement for multi-image panoramas.

https://ptacts.uspto.gov/ptacts/public-informations/petitions/1558155/download-documents?artifactId=wgIcNbm88wC2-ZNwE_yfDRkxNFA2rsqj61UWZ-U7LHFTUWdEOzPFWuw

Do not state that Photoshop uses SIFT or this exact pipeline. Use it as an
independent implementation reference.

## Reconstructed Photoshop-class architecture

The public evidence supports this general pipeline:

```text
source rasters
  -> analysis representations / pyramids
  -> corners, edges or invariant feature points
  -> feature descriptors and candidate correspondences
  -> robust geometric fit
  -> inlier, coverage and degeneracy verification
  -> choose the smallest model that explains the data
  -> optional direct subpixel refinement
  -> reject or return a transform
  -> non-destructive layer transform and render-time resampling
```

This is materially different from LightTable's current approach:

```text
small analysis raster
  -> exhaustive gradient-direction score over translation/scale/rotation
  -> choose minimum
  -> derive confidence from that score
```

The current approach has no independent correspondences, no spatial coverage
test, no robust inlier set and no strong model verification. A false transform
can therefore be the mathematical minimum.

## Recommended LightTable implementation

### Correctness baseline

Build an isolated, lazy-loaded alignment worker before optimizing for WebGPU.
Use a proven computer-vision implementation as the correctness baseline:

- multi-scale ORB, AKAZE or equivalent independently implemented features;
- mutual descriptor matching plus a ratio test;
- robust similarity estimation with RANSAC;
- normalized direct refinement on a luma/gradient pyramid.

A focused OpenCV WASM worker is a practical baseline if its download size is
acceptable. It should load only when Auto Align is invoked, like the isolated
wasm-vips path. This does not require pixel rendering to leave WebGPU. Once the
test corpus is reliable, expensive analysis stages can be ported selectively to
WebGPU without changing the estimator contract.

### Model ladder

For the current two-layer AI-edit workflow:

1. translation;
2. translation plus uniform scale;
3. similarity including small rotation only when evidence requires it;
4. limited affine later;
5. no homography in the first production milestone.

Start with the least flexible model. Promote only when the more complex model
improves verified residuals meaningfully and remains physically plausible.

### Required verification

Do not expose a confidence percentage derived from one residual. Require:

- enough detected features in both layers;
- enough mutual matches;
- enough RANSAC inliers;
- a useful inlier ratio;
- broad two-dimensional inlier coverage;
- non-collinear geometry;
- reasonable translation, scale and rotation;
- a distinct winning hypothesis;
- direct-refinement improvement;
- stable results across neighbouring pyramid levels.

If these checks fail, reject and leave the document unchanged.

### Robustness to AI edits

The intended target may have changed content and grade. Analysis should:

- use luminance/gradient structure rather than raw RGB equality;
- ignore transparent pixels;
- honor the current selection or a user mask as the analysis ROI;
- use robust losses so changed regions do not dominate;
- keep source pixels immutable;
- resample only during preview/render/export.

### Performance strategy

Do not begin by writing a large custom WebGPU feature stack. First produce a
measured correctness oracle and fixed fixtures. Performance work then has a
stable target:

- cache pyramids/features by source and geometry revision;
- analyze reduced resolutions but keep enough detail for scale-invariant
  features;
- refine only the winning local transform;
- reuse reference features for multiple targets;
- keep worker and GPU resources opt-in and explicitly disposable.

## Test gate

The first gate is intentionally simple:

1. duplicate one image;
2. lock the bottom reference;
3. translate and uniformly scale the upper layer;
4. align;
5. verify the recovered transform numerically;
6. verify a difference view after alignment;
7. verify Apply creates one undo command;
8. verify Cancel and rejection make no mutation.

Then add small rotation, crop, exposure/grade differences, local AI edits,
repeating texture, low texture and unrelated-image rejection.

The result is not successful because it looks plausible. It is successful only
when it recovers known transforms within tolerance and reliably rejects cases
without sufficient evidence.

## Conclusion

The current LightTable scorer is the wrong foundation. Photoshop-class
alignment is an evidence-driven registration system: features, correspondences,
robust geometry, model selection, refinement and rejection. Replace the
estimator behind the existing non-destructive editor contract; do not keep
tuning its confidence threshold.
