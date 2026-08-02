# Transform Tool UX Specification

## Purpose

The Transform Tool lets the user directly reposition and reshape the active layer, selection, group, text object, shape, or other transformable content on the canvas.

The interaction should feel immediate and visual. The user should rarely need to leave the canvas or select a separate transform mode.

---

## Activation

When the Transform Tool is active, draw a transform bounding box around the selected content.

The bounding box contains:

- four corner handles;
- four side handles;
- a visible or discoverable transform center/pivot;
- an interaction area inside the box for moving;
- rotation zones just outside the corners.

The bounding box and handles remain screen-readable at every zoom level. Handle size should stay approximately constant in screen pixels rather than scaling with the document.

---

## Move

Drag anywhere inside the bounding box to move the selected content.

Expected behaviour:

- movement begins without changing the scale or rotation;
- the transform preview updates continuously;
- snapping may align the content to guides, document edges, centres, or other objects;
- arrow keys provide small positional nudges;
- holding the precision modifier may reduce or disable snapping.

The cursor should clearly indicate a move interaction while hovering inside the box.

---

## Scale

### Corner handles

Drag a corner handle to scale both width and height.

By default, corner scaling should preserve the current aspect ratio. A modifier temporarily switches to free, non-proportional scaling.

Holding the centre-transform modifier scales around the transform pivot instead of the opposite corner.

### Side handles

Drag a side handle to scale along one local axis:

- left or right handle changes width;
- top or bottom handle changes height.

The handles follow the current rotation of the content. Therefore, scaling occurs along the transformed object's local axes rather than the screen axes.

### Feedback

While scaling, show useful live feedback such as:

- width and height;
- scale percentages;
- optional snapping indicators;
- the active pivot or fixed opposite point.

The preview must remain interactive even for large raster layers. A lower-cost preview may be used during the drag, followed by a full-quality render when the transform is committed.

---

## Rotate

Rotation is accessed by moving the pointer just outside a corner handle.

When the pointer enters a rotation zone:

- change it to a curved rotation cursor;
- rotate the cursor to approximately match the relevant corner orientation;
- avoid overlapping the scale-handle hit area.

Dragging in this zone rotates the content around the transform pivot.

The rotation interaction should use the pointer angle around the pivot, not horizontal mouse distance. This makes the movement predictable from every side of the object.

A modifier constrains rotation to fixed increments, normally 15 degrees. Snapping to common angles such as 0, 45, 90 and 180 degrees should feel slightly stronger.

### Rotatable corner zones

The corners serve two related interactions:

- directly over the square handle: scale;
- slightly outside the corner: rotate.

These hit zones must be forgiving but unambiguous. The rotation zone should extend beyond the visible handle and remain usable for very small selections.

For extremely small objects, enlarge the invisible interaction radius while keeping the visual handles unchanged.

---

## Transform Pivot

The pivot defines the centre used for rotation and centre-based scaling.

Default behaviour:

- start at the geometric centre of the transform bounds;
- move with the content;
- allow the user to drag it to a custom position;
- preserve the custom pivot during the current transform session.

The pivot must be visually distinct from resize handles and should not obstruct selecting or moving the object.

Example uses include rotating a door around its hinge or rotating an arm around its shoulder.

---

## Free Distort

Free Distort allows each corner to move independently.

The user enters Distort through a transform mode switch, context menu, or temporary modifier while dragging a handle.

In Distort mode:

- each corner is an independent control point;
- moving one corner does not automatically move the others;
- side handles may move an entire edge or adjust the associated axis;
- the transformed image is mapped into the resulting four-sided shape.

This is intended for fitting flat content onto an arbitrary quadrilateral, correcting photographed surfaces, or making non-perspective corner adjustments.

The cursor and handle appearance should indicate that a corner is no longer performing ordinary scale.

---

## Perspective Distortion

Perspective mode modifies opposing corners as a related pair to produce a perspective-like trapezoid.

Dragging a corner should move the corresponding opposite-side corner symmetrically along the relevant edge direction. This quickly narrows or widens one side of the object.

Typical uses:

- fitting artwork to a wall or sign;
- changing the apparent depth of a rectangular surface;
- matching converging edges.

Perspective mode should remain separate from fully independent Distort because their corner behaviour is materially different.

---

## Skew

Skew slants the content along one axis.

Dragging a side handle in Skew mode moves that edge parallel to itself while the opposite edge remains fixed.

Corner dragging may combine horizontal and vertical skew, but side handles should be the clearest primary interaction.

Skew should use the transformed object's local axes.

---

## Interaction States

The tool should expose clear hover and drag states:

| Pointer location | Interaction |
|---|---|
| Inside bounds | Move |
| Corner handle | Two-axis scale |
| Side handle | One-axis scale |
| Outside corner | Rotate |
| Pivot | Move pivot |
| Distort corner | Move corner independently |
| Perspective corner | Adjust paired perspective corners |
| Skew side | Slide edge parallel to itself |

Only one interaction should win at a given pointer position. Cursor changes are essential because most transform operations share the same small canvas area.

---

## Commit and Cancel

During a transform, all operations remain part of one temporary transform session.

- `Enter` or double-click inside the bounds commits.
- `Escape` cancels and restores the original state.
- Switching tools should either commit according to application convention or show a lightweight commit/cancel prompt.
- Undo after commit should revert the complete transform in one step.

Do not permanently resample raster content during every pointer movement. Maintain the original source plus a transform representation until commit, or preserve a non-destructive transform for supported layer types.

---

## Recommended Lighttable Behaviour

Use one unified canvas gizmo for move, scale and rotate. Distort, Perspective and Skew may change the behaviour of the same handles instead of replacing the gizmo with unrelated controls.

Priorities:

1. generous and predictable hit zones;
2. stable handles at every zoom level;
3. immediate GPU preview;
4. clear cursor feedback;
5. local-axis behaviour after rotation;
6. a movable pivot;
7. one-step commit, cancel and undo;
8. minimal mode switching for common transforms.

Warp and mesh-based deformation are outside the scope of this transform gizmo and should be implemented as a separate tool mode.
