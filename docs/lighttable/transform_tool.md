# LightTable transform tool

Status: first implementation complete; browser WebGPU interaction and
edge-quality smoke testing remain.

## Goal

Add a GPU-native transform tool for raster content.

- When a selection is active, transform only the selected pixels on the active layer.
- Without a selection, transform the active layer.
- Support move, scale and rotate first.
- Preview must be non-destructive until commit.
- One completed transform is one undo step.

Perspective and warp are later extensions of the same matrix/preview seam.

## UX

- Add a Transform tool to the left toolbar, shortcut `T`.
- Drag inside the bounds to move.
- Drag corner handles to scale both axes.
- Drag edge handles to scale one axis.
- Drag outside the bounds to rotate.
- Hold Shift while corner-scaling to preserve aspect ratio.
- Hold Shift while rotating to snap to 15-degree increments.
- Enter commits.
- Escape cancels.
- Switching tool or layer must follow one explicit rule. Prefer committing an
  active transform, with Escape remaining the deliberate cancel action.

The overlay contains four corner handles, four edge handles and the transformed
bounding outline. Handle positions and hit testing use document coordinates;
their visible size stays constant in screen pixels.

## Target and bounds

Target resolution happens once when the transform session starts.

```text
active selection
    -> selected pixels from the active raster layer

no active selection
    -> active raster layer content
```

For a selection, use its pixel bounds and multiply the extracted source by the
selection mask. For a complete layer, prefer tight non-transparent content
bounds. A conservative tracked bound or document-sized bound is acceptable for
the first version, but it produces a less useful gizmo.

Locked, hidden or missing raster layers cannot start a transform.

## Transform session

Transform state is transient editor-session state, not document state.

```ts
interface TransformSession {
  layerId: LayerId;
  channel: "pixels" | "mask";
  sourceBounds: Rect;
  originalMatrix: Mat3;
  matrix: Mat3;
  sourceKind: "selection" | "layer";
}
```

GPU resources belonging to the session:

- extracted source texture;
- preview texture;
- immutable selection snapshot when a selection supplied the source;
- transform uniform buffer;
- temporary destination copy needed to avoid texture read/write hazards.

Cancel destroys these resources without changing the live layer.

## Preview flow

Do not mutate the live layer during dragging.

```text
copy live target into preview
    -> clear original source shape in preview
    -> render transformed source into preview
    -> compositor substitutes preview for the active layer
```

The clear shape is:

- the snapshotted selection mask for selection transforms;
- the original source rectangle for a complete-layer transform.

Every pointer move updates only the matrix and rebuilds the derived preview.
The document model does not receive per-move mutations.

## Commit and cancel

Commit:

1. Calculate the union of original and transformed bounds.
2. Capture the pre-transform pixels for undo.
3. Clear the original source shape on a temporary target.
4. Render the transformed source.
5. Copy/swap the completed result into the live layer texture.
6. Increment the layer pixel revision once.
7. Push one reversible pixel edit to the existing LightTable history.
8. Destroy transient transform resources.

Cancel:

1. Discard the floating source and preview.
2. Leave the live layer texture and document revisions unchanged.

The current full-layer GPU snapshot mechanism can support the first version.
Region snapshots should replace it later using the affected-bounds union.

## Matrix and sampling

Use a row-major 3x3 matrix:

```text
[m00, m01, m02,
 m10, m11, m12,
 m20, m21, m22]
```

Affine move/scale/rotate uses the last row `[0, 0, 1]`. Keeping the 3x3
contract allows perspective to be added without replacing the renderer.

The shader uses inverse mapping:

```text
destination pixel -> inverse transform -> source coordinate
```

Use transparent sampling outside the source bounds. Bilinear sampling is the
minimum. A rotated 2x2 supersample pattern is preferred for rotated edges and
minification.

The source is linear, premultiplied `rgba16float`. Composite it with the same
alpha convention as the layer compositor. Do not sRGB-decode or encode inside
the transform pass.

## Coordinate rules

Keep these frames explicit:

- screen/CSS coordinates;
- viewport coordinates after pan and zoom;
- document coordinates;
- source-local coordinates inside the extracted texture.

Pointer conversion happens once through shared helpers. Transform handles,
source bounds, dirty bounds and matrices use document pixels. Shader sampling
subtracts `sourceBounds.x/y` before applying source-local coordinates.

Test with non-zero pan, multiple zoom levels and bounds touching every document
edge. Do not rely on `offsetX`/`offsetY` as the transform implementation; those
fields are not yet consistently applied by compositor and persistence.

## Selection behavior

On entry:

1. Snapshot the current selection mask.
2. Extract and mask the selected layer pixels.
3. Use selection pixel bounds as the gizmo bounds.

The transform preview must not remain clipped by the live selection mask.

The exact post-commit selection behavior is a product decision. Recommended
first behavior: transform the selection mask with the same matrix and keep it
active after commit. Darkly instead consumes/clears the selection when the
floating transform begins. Keeping a transformed selection is generally more
useful for subsequent edits, but both source pixels and mask must then commit
atomically in one undo entry.

## Code placement

Keep transform logic out of `LightTableEditorOverlay.tsx` where possible.

```text
editor/tools/transform/
    transformTypes.ts
    affine.ts
    transformSession.ts
    TransformOverlay.tsx

editor/rendering/transform/
    TransformRenderer.ts
    transformShaders.ts
```

`LightTableEditorOverlay` should select the tool and route normalized input.
`TransformOverlay` owns only display and hit testing. `TransformRenderer` owns
derived GPU resources and preview/commit passes. Document commands only receive
the final committed pixel revision.

## First implementation boundary

Implement:

- selection or active-layer target;
- body move;
- eight scale handles;
- rotation;
- Shift constraints;
- Enter commit and Escape cancel;
- non-destructive GPU preview;
- one undo/redo entry;
- persistence through the existing flattened/layered save paths.

Defer:

- perspective;
- warp/mesh;
- numerical transform fields;
- transform-center editing;
- linked multi-layer transforms;
- groups and vector targets;
- content-aware fill of exposed areas.

## Tests

Math:

- identity, translation, scale and rotation;
- composition order;
- inverse round trip;
- singular matrices are rejected;
- transformed bounds include all four corners.

Interaction:

- body drag translates;
- corner and edge handles scale correctly;
- Shift preserves ratio and snaps rotation;
- Enter creates one undo step;
- Escape leaves pixels unchanged;
- tool/layer switching cannot commit to a stale layer.

GPU:

- identity commit is pixel-equivalent;
- selection transform moves only selected pixels;
- original selected pixels are cleared;
- complete-layer transform preserves transparency;
- rotation and downscale have stable antialiased edges;
- undo and redo restore exact pre/post states;
- preview never mutates the live texture;
- transforms at document edges do not produce validation errors.

## Darkly reference

Darkly is a conceptual and algorithmic reference; its implementation is not a
dependency.

- `Darkly/frontend/src/tools/transform.svelte.ts`: target routing and lifecycle.
- `Darkly/frontend/src/tools/transform_gizmo.ts`: consumer-independent gizmo.
- `Darkly/frontend/src/tools/transform_modes/basic.ts`: handles, move, scale,
  rotation and Shift constraints.
- `Darkly/crates/darkly/src/engine/floating.rs`: extract, preview, commit, cancel
  and undo boundaries.
- `Darkly/crates/darkly/src/gpu/floating_preview.rs`: derived preview texture.
- `Darkly/crates/darkly/shaders/transform_commit.wgsl`: inverse transform
  sampling and source-over commit.
- `Darkly/docs/coordinate-systems.md`: coordinate-frame invariants.
