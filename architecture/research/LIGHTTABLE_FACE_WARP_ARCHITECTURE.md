# LightTable professional Face Warp architecture

## Decision

Face Warp is a standalone, non-destructive mesh deformation tool. It is not a
preset of the freehand Warp brush and it must not compile its canonical state
into overlapping pixel-push strokes.

The source of truth is one detected source mesh plus an editable target mesh.
Semantic sliders, direct feature handles and the proportional brush all create
constraints on that same target mesh. The image is sampled once through a
dedicated GPU mesh warp. The debug overlay draws the exact target mesh used by
the renderer.

This replaces the provisional face-to-`WarpStroke` compiler. Keeping that
compiler would preserve the current overdraw, non-linear strength accumulation
and mismatch between the visible mesh and the rendered pixels.

## Shared deformation-kernel boundary

Face Warp is the current product focus, but its low-level renderer must not be
face-specific. LightTable may later support a custom screen-space warp mesh in
which the user chooses a rectangular grid, inserts horizontal, vertical or
crosswise splits and edits grid anchors and Bezier handles. Photoshop Transform
Warp exposes default 3x3, 4x4 and 5x5 grids, custom row/column counts and local
Split Warp lines; those operations describe a parametric patch network rather
than a facial landmark surface.

The two authoring models therefore remain distinct:

- Face Warp owns the canonical irregular facial triangle topology, semantic
  feature regions, pose, visibility and connected deformation constraints.
- A future Custom Warp owns a logical rectangular patch network, editable split
  rows/columns, anchor/handle modes and patch continuity.

They share a generic evaluated `DeformationSurface` contract:

- immutable source positions and source UVs;
- evaluated target positions;
- triangle indices used for rasterization;
- stable vertex/topology revisions and dirty ranges;
- optional adjacency, boundary pins and hit-test metadata;
- one source-to-target mapping consumed by renderer and overlay.

Custom Bezier patches are adaptively tessellated into that triangle contract;
the face solver emits its canonical triangles directly. The indexed WebGPU
texture-warp pass, target-buffer upload, overlay composition, history contract,
foldover validation and visual comparison fixtures are shared. Topology
editing, semantic controls and solver policy remain pluggable and must not leak
face-specific landmark indices into the generic kernel.

This boundary deliberately avoids two bad abstractions: forcing a face into a
rectangular grid, or reducing a Split Warp patch network to an uneditable bag of
triangles. The common layer begins after each authoring model has evaluated its
target surface.

Additional references:

- https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/reshape-and-distort-images-with-transform-warp.html
- https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/get-precise-distortions-with-split-warp.html
- https://doc.cgal.org/latest/Triangulation_2/index.html

## Research basis

The design follows these established techniques:

- MediaPipe supplies a canonical 468-vertex facial surface, fixed triangle
  topology and UV coordinates. Its additional iris landmarks remain useful for
  detection and handles but are not surface vertices. The face pose matrix maps
  canonical geometry to the detected face.
- Adobe Face-Aware Liquify exposes identity-relative facial controls and direct
  on-image manipulation. Ordinary Liquify separates brush size, pressure and
  density and uses a reconstruct/smoothing operation.
- Connected proportional editing spreads influence through mesh connectivity,
  not merely through screen-space proximity. This prevents edits jumping across
  nearby but topologically separated lips, eyelids or profile contours.
- Moving Least Squares (MLS), Laplacian editing and As-Rigid-As-Possible (ARAP)
  deformation are established handle-driven deformation methods. Rigid MLS
  preserves untouched facial areas well; ARAP better preserves local mesh shape
  under larger edits.

Primary references:

- https://github.com/google-ai-edge/mediapipe/wiki/MediaPipe-Face-Mesh
- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/overview-of-liquify-filter.html
- https://helpx.adobe.com/in_hi/photoshop/how-to/face-aware-liquify.html
- https://docs.blender.org/manual/en/latest/editors/3dview/controls/proportional_editing.html
- https://doi.org/10.1145/1179352.1141920
- https://diglib.eg.org/items/e0b21a71-350e-41e7-a586-3bfa526ed21c/full
- https://libigl.github.io/tutorial/
- https://arxiv.org/abs/1910.13671

## Canonical document representation

`lt.face-warp` stores, per detected face:

- the 468 surface XYZ landmarks in layer-source space; the ten iris-only
  detector landmarks are intentionally excluded from the warp surface;
- the fixed canonical triangle topology;
- the detected pose matrix and detector/model identity;
- semantic edit coefficients;
- direct manipulation constraints, expressed relative to canonical facial
  dimensions;
- proportional brush constraints and optional smooth/relax constraints;
- the source content revision used for detection.

Landmarks are persisted. Reopening a document must not change its result when a
detector is updated or unavailable. Redetection is explicit. The target mesh is
derived deterministically from the source mesh and commands; a cached target may
be stored only as a validation/performance cache.

No baked bitmap and no generated freehand Warp strokes are canonical document
state.

## Relative semantic morphs

Semantic morphs must be independent of image position, face size and in-plane
rotation:

1. Transform detected vertices into face-local canonical coordinates using the
   pose matrix. Fall back to a Procrustes-aligned local basis when the detector
   cannot provide a usable matrix.
2. Normalize edit magnitudes by stable facial measures: interpupillary distance,
   face width/height, eye aperture, nose width and mouth width.
3. Apply per-vertex morph deltas in canonical space.
4. Project the target vertices back into layer-source space.

Left/right feature groups use an explicit canonical symmetry map. Linked eye or
mouth edits share coefficients but retain each side's detected source shape.
Slider value zero always preserves the source expression; detected blendshape
coefficients may guide feature state and safety limits but never silently
neutralize the photographed expression.

Semantic targets are authored for face width, forehead, jaw, eye size/width/
height/tilt/spacing, nose width/height, smile, mouth width/height and lip size.
They operate on regions with smooth boundary weights rather than a few landmark
points.

## Proportional brush

The brush is a mesh-edit interaction, not pixel painting.

- Pointer position is attached to the nearest visible source triangle using
  barycentric coordinates.
- Influence distance follows connected mesh edges. For the 468-vertex surface,
  exact bounded Dijkstra per new brush anchor is fast, deterministic and simpler
  than a heat-method approximation.
- Default influence uses compact C2 smooth falloff. Size changes radius;
  Strength scales displacement. `[`` and ``]` change Size.
- Screen-space distance is used only for hit testing. It must not determine
  vertex influence because opposite lips, eyelids and profile surfaces can be
  close in the image but distant on the surface.
- Hidden/back-facing vertices are not brush seeds. Their movement follows the
  regularized solve rather than direct projected input.
- One pointer gesture is one history transaction.

`Shift`-drag is Smooth/Relax: constrained Laplacian smoothing moves affected
vertices toward the weighted average of their connected neighbours. Feature
boundary loops and pinned vertices prevent smoothing across eyelid, lip and face
contours. A Restore mode can move constraints back toward the detected source
mesh without rerunning detection.

The user-facing brush remains deliberately small: Size, Strength and Smooth.
Solver weights, iterations and falloff implementation are not general UI
parameters.

## Deformation solver

The professional path is a hybrid solver:

- During pointer movement, update the directly constrained vertices and run a
  bounded low-iteration ARAP/Laplacian preview.
- At pointer-up, run the exact configured solve and atomically replace the
  provisional target.
- For small facial corrections, a similarity/rigid MLS field may be used around
  the outer collar to blend deformation into surrounding pixels without a hard
  face-outline seam.

Topology adjacency, boundary loops, feature loops, weights and sparse
factorization are prepared once per face. With 468 vertices the solve belongs in
a lazy worker/WASM module and transfers only a small target-vertex buffer to the
GPU. No full-resolution CPU pixel readback is permitted.

Cotangent weights must be clamped or replaced with stable mean-value weights on
poor/thin facial triangles. Every result validates triangle orientation and
minimum area; excessive displacement is line-searched/clamped to prevent
foldovers and texture inversions.

## GPU rasterization

Face Warp gets a dedicated indexed WebGPU mesh pass:

- immutable source UV/position buffer;
- dynamic target XY/Z vertex buffer;
- immutable canonical triangle index buffer;
- source layer texture sampled barycentrically;
- depth/back-face visibility for profile faces;
- one collar/cage around the face outline, pinned to zero displacement at its
  outer boundary, so skin and nearby background transition without seams.

Only the target vertex buffer and face-warp node become dirty during editing.
The document is not recomposited merely to animate or toggle the debug mesh.
The existing GPU editor-overlay pass renders the target topology in screen-space
stable line/point sizes.

## Eyes, mouth and missing texture

Eye and mouth boundary loops are explicit constraints. Eye size and aperture
edits move upper/lower eyelid loops symmetrically and enforce ordering so the
loops cannot cross. The debug mesh must visibly follow these edits.

A mesh can close the geometric eye aperture, but an open-eye photograph does not
contain the hidden closed-eyelid texture. Likewise, a mouth warp cannot invent
teeth, tongue or hidden lip texture. Therefore:

- modest aperture/closure edits use mesh stretch and seam-aware blending;
- ranges are limited before visible texture collapse;
- a future full blink or large mouth-content change requires a separate local
  synthesis/inpainting stage and is not presented as solved by geometry alone.

## Profile and occlusion

Profile detections contain estimated landmarks for the occluded side. They are
valuable for regularization but must not be presented or edited as equally
visible geometry.

Visibility uses pose, triangle normal and depth, not a global Z percentile.
Hidden triangles participate in the continuity solve but are excluded from
direct hit testing and ordinary debug drawing. The GPU depth pass prevents the
far side from appearing over the visible cheek/nose surface.

## Runtime and performance contract

- Detector/model code and memory remain lazy until Face Warp is selected.
- Detection runs in a worker from a bounded color-managed preview and never owns
  document state, history, rendering or UI.
- Detection is cancelled/superseded when source identity changes.
- Slider and brush previews never rerun face detection.
- Interactive work uploads vertices, not pixels. Full-resolution pixels stay on
  the GPU.
- Preview budget is one visible frame on ordinary hardware; exact pointer-up
  refinement is supersedable and must not block subsequent gestures.
- Save/reopen reproduces the same mesh without network or detector access.

## Delivery gates

1. Canonical 468-surface topology, adjacency, feature/boundary loops and
   symmetry mapping with license attribution.
2. Pose-relative semantic morph evaluator and connected proportional falloff.
3. Smooth/restore constraints and foldover validation.
4. Dedicated indexed GPU mesh/collar renderer; remove the provisional
   `WarpStroke` compiler from the render path.
5. Front, three-quarter and profile visual fixtures; eye/lip separation tests;
   roll/scale invariance; undo/redo and save/reopen tests.
6. Performance measurement for detector cold start, gesture frame time, exact
   solve time, vertex upload and GPU pass time.

Task 118 is complete only when the overlay and rendered pixels use the same
target mesh, proportional edits cannot jump across feature boundaries, profile
visibility is correct, and round-trip output is deterministic and offline.
