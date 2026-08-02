# Lighttable — Photoshop-Compatible Selection Tools UX Specification

**Scope:** pixel/raster selections and their interaction model.  
**Reference target:** Adobe Photoshop Desktop behavior and muscle memory.  
**Out of scope:** path selection, direct path selection, vector anchor editing, layer/object selection, and internal selection-mask implementation.

---

## 1. Goal

Lighttable should make Photoshop users immediately understand:

- which tool creates which kind of selection;
- whether a new gesture replaces, adds to, subtracts from, or intersects the current selection;
- whether dragging moves only the selection boundary or moves selected pixels;
- which modifier keys temporarily change the current operation;
- how unfinished lasso gestures are completed, corrected, or cancelled;
- which options belong to the current selection tool;
- that a pixel selection is persistent document state, independent of the currently active layer or tool.

The target is not merely feature parity. The interaction timing, cursor feedback, modifier precedence, and selection persistence should feel familiar to Photoshop users.

---

## 2. Selection tool groups and default shortcuts

| Tool group | Tools | Photoshop shortcut |
|---|---|---:|
| Marquee | Rectangular, Elliptical, Single Row, Single Column | `M` |
| Lasso | Lasso, Polygonal Lasso, Magnetic Lasso | `L` |
| Automatic selection | Object Selection, Quick Selection, Magic Wand | `W` |
| Selection Brush | Brush-based selection overlay | No separate shortcut should be assumed; expose it through the toolbar and allow customization |

When **Use Shift Key for Tool Switch** is enabled, use:

- `Shift+M` to cycle through Marquee tools;
- `Shift+L` to cycle through Lasso tools;
- `Shift+W` to cycle through Object Selection, Quick Selection, and Magic Wand.

When that preference is disabled, repeated presses of `M`, `L`, or `W` may cycle through the group directly.

### Recommended Lighttable behavior

Support both models through the same preference Photoshop uses conceptually:

- **Enabled:** plain shortcut selects the last-used tool in the group; `Shift+shortcut` cycles.
- **Disabled:** repeated plain shortcut presses cycle the group.

Remember the last-used tool separately for each group.

---

## 3. The shared pixel-selection interaction model

All pixel-selection tools should operate on one persistent document selection.

The active selection:

- survives switching tools;
- survives switching layers;
- may contain multiple disconnected regions;
- may have hard or partially transparent edges;
- may be hidden visually while remaining active;
- limits painting, filling, deletion, adjustments, copying, transforms, and mask creation;
- is not the same thing as selecting a layer, shape, path, or object.

### 3.1 The four selection operations

Every applicable selection tool should present the same four operation icons in the same order:

1. **New Selection**
2. **Add to Selection**
3. **Subtract from Selection**
4. **Intersect with Selection**

Do not rename or reorder these between tools.

### 3.2 Temporary modifier keys

| Modifier before starting a new selection gesture | Temporary operation |
|---|---|
| No modifier | Current Options-bar operation, normally New Selection |
| `Shift` | Add to Selection |
| `Alt/Option` | Subtract from Selection |
| `Shift+Alt/Option` | Intersect with Selection |

Cursor feedback should change before pointer-down:

- plus badge for Add;
- minus badge for Subtract;
- intersection badge for Intersect;
- no badge for New Selection.

The modifier is temporary. Releasing it after the gesture must restore the selected Options-bar mode.

### 3.3 Modifier timing is important

For Rectangular and Elliptical Marquee, `Shift` and `Alt/Option` have two meanings:

- **before pointer-down:** choose Add/Subtract/Intersect;
- **after pointer-down:** constrain proportions or draw from center.

Photoshop users rely on this timing distinction.

Examples:

- Hold `Shift`, start dragging to add, release `Shift`, then press `Shift` again while still dragging to make the added region square or circular.
- Hold `Alt/Option`, start dragging to subtract, release it, then press it again while dragging to resize the subtracting marquee from its center.
- Hold `Shift+Alt/Option` before pointer-down to intersect; after the drag starts, modifiers may be released and reapplied for geometric constraints.

Lighttable should not collapse these into one ambiguous behavior.

### 3.4 Empty-selection behavior

- New Selection creates the first selection.
- Add to Selection with no existing selection behaves effectively like creating a new selection.
- Subtract from Selection with no existing selection produces no selected result.
- Intersect with Selection with no existing selection produces no selected result.

### 3.5 Gesture commit

For drag-based tools:

- show a live preview during the gesture;
- commit one selection operation on pointer-up;
- one complete gesture equals one Undo step;
- Escape cancels the active unfinished gesture and restores the previous selection.

---

## 4. Selection display and feedback

### 4.1 Marching ants

The normal committed selection is displayed as animated marching ants around its visible threshold boundary.

Important UX implications:

- a feathered selection may contain significant partially selected pixels outside the ants;
- the ants do not fully visualize soft alpha coverage;
- hiding selection edges must not deselect the selection;
- a newly made selection should make edges visible again.

### 4.2 Overlay mode

Brush-based selection workflows may show a translucent color overlay rather than only marching ants.

The overlay should have:

- configurable color;
- configurable opacity;
- clear meaning: selected area or protected/unselected area;
- consistent Add/Subtract brush feedback;
- no ambiguity with a painted raster layer.

### 4.3 Cursor consistency

Each selection cursor should communicate both:

1. the active tool;
2. the active operation.

Examples:

- marquee crosshair plus Add badge;
- lasso plus Subtract badge;
- Magnetic Lasso with visible detection-width circle;
- Quick Selection brush with Add or Subtract mark;
- Object Selection hover highlight before clicking.

---

# 5. Rectangular Marquee Tool

## Purpose

Creates rectangular pixel selections.

## Basic gesture

- Click-drag from one corner to the opposite corner.
- Pointer-up commits the selection.
- With New Selection active, a new drag normally replaces the previous selection.

## Modifier behavior during the drag

- Hold `Shift` after beginning the drag to constrain the marquee to a square.
- Release the pointer before releasing `Shift` to preserve the square constraint at commit.
- Hold `Alt/Option` after beginning the drag to resize from the initial point as the center.
- Hold `Shift+Alt/Option` after beginning the drag for a centered square.
- Hold `Spacebar` while pointer-down to reposition the unfinished marquee without changing its size.
- Release `Spacebar`, while keeping pointer-down, to continue resizing.

## Repositioning the unfinished marquee

This is core Adobe muscle memory:

1. Begin dragging the marquee.
2. Keep pointer-down.
3. Hold `Spacebar`.
4. Move the entire unfinished marquee.
5. Release `Spacebar` to continue resizing.
6. Release the pointer to commit.

The tool must not switch to permanent Hand/Pan behavior during this specific pointer-down state.

## Options bar

- New / Add / Subtract / Intersect
- Feather
- Style:
  - Normal
  - Fixed Ratio
  - Fixed Size
- Width and Height fields where applicable
- Select and Mask

## Style behavior

### Normal

The user freely determines width and height by dragging.

### Fixed Ratio

- The marquee always maintains the entered width-to-height ratio.
- Decimal ratios are valid.
- Drag distance determines final size.
- Spacebar repositioning remains available during the gesture.

### Fixed Size

- Width and height come from explicit values.
- Units may include pixels and physical document units.
- Clicking places a selection of that exact size.
- The selection may then be moved as a boundary without changing its dimensions.

## Snapping

When snapping is enabled, marquee edges may snap to:

- document bounds;
- guides;
- grid;
- slices or equivalent Lighttable layout helpers.

Snapping should be visible but not aggressive enough to make small selections impossible.

---

# 6. Elliptical Marquee Tool

## Purpose

Creates elliptical and circular pixel selections.

## Basic gesture

- Drag from the bounding box corner to its opposite corner.
- The ellipse is inscribed within that temporary bounding rectangle.

## Modifier behavior

- `Shift` after pointer-down constrains the ellipse to a circle.
- `Alt/Option` after pointer-down draws from the center.
- `Shift+Alt/Option` creates a centered circle.
- `Spacebar` repositions the unfinished ellipse while preserving its current size.

## Options bar

- New / Add / Subtract / Intersect
- Feather
- Anti-alias
- Style: Normal / Fixed Ratio / Fixed Size
- Width and Height where applicable
- Select and Mask

## Anti-aliasing

Anti-aliasing is available because the selection boundary may cross pixels diagonally or along a curve.

Changing Anti-alias after a selection has already been created must not retroactively modify that existing selection.

---

# 7. Single Row and Single Column Marquee Tools

## Purpose

Create exactly one-document-pixel-wide selections across the document.

- Single Row selects a horizontal 1-pixel row.
- Single Column selects a vertical 1-pixel column.

## Interaction

- Click near the required location to create the row or column.
- Drag before release to position it precisely.
- At low zoom the selected row or column may be difficult to see; the UI must still provide clear cursor and coordinate feedback.
- Add, Subtract, and Intersect operations should remain supported.

## Options bar

- New / Add / Subtract / Intersect
- Feather where technically applicable, though Photoshop’s primary use is an exact 1-pixel selection

Avoid applying ellipse-style Anti-alias controls to these tools.

---

# 8. Lasso Tool

## Purpose

Creates a freehand selection boundary.

## Basic gesture

- Pointer-down starts the boundary.
- Drag freely around the intended area.
- Releasing the pointer closes the boundary automatically with a straight segment from the release location back to the start.

The live closing segment should be predictable and visible near completion.

## Mixed freehand and straight segments

While drawing with the Lasso:

- hold `Alt/Option` to temporarily create straight Polygonal-Lasso-style segments;
- click to place endpoints for those straight segments;
- return to freehand dragging by continuing the gesture without the temporary modifier;
- Delete removes recently created straight segments while the selection is still unfinished.

This lets users combine organic and precise edges in one selection without changing tools.

## Escape and cancellation

- `Escape` cancels the unfinished lasso and restores the previous committed selection.
- Switching tools while an unfinished gesture exists should either commit by the tool’s normal completion rule or explicitly cancel; silently producing an unexpected partial selection is unacceptable.

## Options bar

- New / Add / Subtract / Intersect
- Feather
- Anti-alias
- Select and Mask

---

# 9. Polygonal Lasso Tool

## Purpose

Creates a selection boundary from connected straight segments.

## Basic interaction

1. Click to place the first point.
2. Move the pointer; show a live segment from the last point.
3. Click to place each next point.
4. Continue until closing or completing the selection.

## Closing the selection

Support all familiar completion methods:

- click the starting point when the close-circle cursor indicator appears;
- double-click to close from the current point to the start;
- `Ctrl/Cmd+click` to close from the current point to the start.

The closing line is straight unless the user has temporarily entered a freehand section.

## Constraints and corrections

- Hold `Shift` while positioning the next point to constrain the new segment to 45-degree increments.
- Press `Delete/Backspace` to remove the most recently placed point and segment.
- Repeated Delete steps backward through the unfinished polygon.
- Press `Escape` to cancel the entire unfinished polygon and restore the prior selection.

## Temporary freehand sections

- Hold `Alt/Option` and drag to temporarily use the freehand Lasso.
- Releasing the temporary gesture returns to Polygonal Lasso point placement.

This switching must happen inside one unfinished selection gesture.

## Options bar

- New / Add / Subtract / Intersect
- Feather
- Anti-alias
- Select and Mask

---

# 10. Magnetic Lasso Tool

## Purpose

Creates a selection whose live boundary searches for image edges near the pointer.

## Initial interaction

- Click once to place the first fastening point.
- The user may then move with the pointer up or continue while holding it down.
- The active segment searches for the strongest qualifying edge within the detection width.
- Automatic fastening points are inserted as the user progresses.
- Clicking manually places an explicit fastening point.

Manual points must override the automatic tendency and give the user deterministic local control.

## Options bar

- New / Add / Subtract / Intersect
- Feather
- Anti-alias
- Width
- Contrast
- Frequency
- Stylus Pressure
- Select and Mask

## Width

Defines how far from the pointer the tool searches for an edge.

Interaction expectations:

- `[` decreases width by 1 document pixel;
- `]` increases width by 1 document pixel;
- `Caps Lock` toggles a precision cursor that visualizes the current detection width;
- width changes are allowed while the tool is selected but should not destabilize an already completed selection.

## Contrast

Controls how much contrast is required for an edge to be considered.

- High Contrast: favors strong, clearly separated edges.
- Low Contrast: accepts softer tonal transitions and requires more careful tracing.

## Frequency

Controls how often automatic fastening points are created.

- High Frequency: more automatic anchors and tighter adherence.
- Low Frequency: fewer anchors and a looser, smoother trace.

## Stylus Pressure

When enabled, greater pen pressure reduces the detection width, allowing a user to move from loose tracing to fine precision without leaving the gesture.

## Corrections

- `Delete/Backspace` removes the most recent fastening point.
- Repeated Delete continues stepping backward.
- Clicking adds a manual fastening point at the current edge location.
- `Escape` cancels the entire unfinished selection.

## Temporary switching to other lasso behavior

- `Alt/Option+drag` temporarily uses the freehand Lasso.
- `Alt/Option+click` temporarily uses Polygonal Lasso point placement.
- Releasing the modifier returns to Magnetic Lasso tracing.

## Completion

- Double-click or `Enter/Return` closes using a final magnetic segment.
- `Alt/Option+double-click` closes using a straight segment.
- Tracing back over the start point may close manually when the close indicator appears.

## Compatibility note

Photoshop does not expose Magnetic Lasso for 32-bits-per-channel images. Lighttable may technically support it in a float pipeline, but UI parity should not require copying this historical restriction unless the algorithm actually has such a limitation.

---

# 11. Object Selection Tool

## Purpose

Selects a detected semantic object or region rather than only matching raw color or a manually traced edge.

## Object Finder interaction

When Object Finder is enabled:

- hovering over the canvas highlights a detected object or region;
- the highlight appears before selection so the user knows what a click will select;
- clicking the highlighted object applies the current selection operation;
- `Shift`, `Alt/Option`, and `Shift+Alt/Option` temporarily switch to Add, Subtract, and Intersect;
- moving away removes or changes the hover highlight without altering the committed selection.

The hover highlight is a preview, not a committed selection.

## Manual region mode

When Object Finder is disabled, or when a user explicitly requests a region:

- Rectangle mode: drag a rectangle loosely around the target object;
- Lasso mode: draw a loose freehand enclosure around the target object;
- the detector chooses an object primarily within that region;
- the region itself is not necessarily the final selection boundary.

## Options bar

- New / Add / Subtract / Intersect
- Object Finder toggle
- Manual region type: Rectangle / Lasso
- Sample All Layers
- Hard Edge
- Select Subject where supported
- Select and Mask

## Sample All Layers

- Off: analyze the active layer.
- On: base detection on the visible composite.

The generated selection remains a document selection; it does not automatically change the active layer.

## Hard Edge

Hard Edge produces a sharper boundary rather than a naturally softened object edge. It should be an explicit option and not silently applied based on zoom level.

---

# 12. Quick Selection Tool

## Purpose

Paints over image regions and expands the selection toward detected boundaries.

It is not a normal selection brush: the painted stroke guides a region-growing/edge-aware selection.

## Basic interaction

- The first New Selection stroke creates a selection.
- Subsequent strokes normally expand it.
- Add mode paints more regions into the selection.
- Subtract mode paints unwanted regions out.
- `Alt/Option` temporarily switches an Add brush to Subtract.
- Releasing `Alt/Option` restores Add.

For Photoshop familiarity, after the first successful New Selection stroke the tool may continue in Add behavior so users can build the selection through multiple strokes without repeatedly choosing Add.

## Brush cursor

The circular cursor must accurately show the effective brush size in screen space.

Expected brush controls:

- `[` decrease size;
- `]` increase size;
- Size;
- Hardness;
- Spacing;
- Angle;
- Roundness;
- optional pen-pressure or stylus-wheel size control.

## Options bar

- New / Add / Subtract
- Brush settings
- Sample All Layers
- Enhance Edge
- Select Subject where supported
- Select and Mask

Photoshop’s current Quick Selection workflow emphasizes New, Add, and Subtract. Intersect need not be presented as a primary brush mode unless Lighttable intentionally extends the tool.

## Sample All Layers

- Off: analyze the active layer.
- On: analyze the visible composite.

## Enhance Edge

Automatically improves the generated edge, typically making it smoother and more refined. It should be applied consistently and not alter previously committed selections merely because the checkbox is toggled later.

---

# 13. Magic Wand Tool

## Purpose

Selects pixels similar in color or tone to the sampled point.

## Basic interaction

- Click a pixel to sample it.
- The resulting selection is based on Sample Size, Tolerance, Contiguous, Anti-alias, and Sample All Layers.
- Add/Subtract/Intersect modifiers work per click.

## Options bar

- New / Add / Subtract / Intersect
- Sample Size
- Tolerance
- Anti-alias
- Contiguous
- Sample All Layers
- Select and Mask

## Sample Size

Controls whether the sampled color comes from:

- a single pixel;
- an averaged neighborhood around the click.

The cursor target remains the clicked location even when a larger neighborhood is sampled.

## Tolerance

Photoshop-style range:

- `0`: extremely narrow similarity;
- `255`: very broad similarity.

A higher value selects a wider range around the sampled color.

The value should be editable numerically and with normal slider or scrub behavior.

## Contiguous

- On: select only connected qualifying pixels reachable from the clicked region.
- Off: select qualifying pixels anywhere in the sampled scope, even when disconnected.

This option must be visibly persistent; it changes the tool’s meaning dramatically.

## Anti-alias

Smooths the generated boundary and must be selected before creating the selection. Toggling it afterward does not retroactively alter the current selection.

## Sample All Layers

- Off: sample and evaluate the active layer.
- On: sample and evaluate the visible composite.

The operation still creates one document selection and does not merge or modify source layers.

---

# 14. Selection Brush Tool

## Purpose

Lets the user paint the selection mask directly with a brush and a visible overlay.

Unlike Quick Selection, this tool does not attempt to expand automatically to detected image boundaries. The painted coverage itself defines the selection.

## Interaction

- Paint in Add mode to include pixels.
- Paint in Subtract mode to exclude pixels.
- `Alt/Option` should temporarily toggle Add and Subtract for consistency with other brush-based selection workflows.
- Brush strokes should preview immediately in the selection overlay.
- Each continuous stroke is one Undo step.

## Options bar

- Add brush / Subtract brush
- Size
- Hardness
- Overlay Color
- Overlay Opacity
- Select and Mask

## Overlay behavior

Photoshop uses a red overlay by default. Lighttable should:

- default to a clearly visible red or configurable contrasting color;
- allow color and opacity changes;
- keep overlay meaning consistent;
- avoid making the overlay look like raster paint on the layer;
- switch cleanly back to marching ants when leaving the brush-overlay workflow, while retaining the same selection.

---

# 15. Moving a selection boundary versus moving selected pixels

This distinction must be unambiguous.

## Move only the selection boundary

With a selection tool active and **New Selection** selected:

- position the pointer inside an existing selection boundary;
- the cursor changes to a boundary-move cursor;
- drag to reposition the selection boundary;
- image pixels do not move;
- all disconnected selection regions move together;
- the selection may be moved partially beyond the canvas and brought back intact.

Keyboard movement:

- Arrow key: move boundary by 1 document pixel.
- `Shift+Arrow`: move boundary by 10 document pixels.
- `Shift` while dragging: constrain movement to 45-degree directions.

## Move selected image content

With the Move Tool active:

- dragging inside the selection moves the selected pixels/content;
- the selection boundary moves with that content as appropriate;
- this is an image edit, not merely a selection edit.

Do not let identical cursors represent these two operations.

---

# 16. Transform Selection versus transforming content

These must be separate commands.

## Transform Selection

Transforms only the selection mask/boundary:

- scale;
- rotate;
- skew;
- distort or equivalent supported boundary transforms.

Underlying image pixels remain unchanged until a later edit uses the transformed selection.

## Transform selected content

Transforms the pixels or selected layer content itself.

Do not map both behaviors to one ambiguous command based solely on whether marching ants are visible.

Recommended menu wording:

- **Select > Transform Selection**
- **Edit > Free Transform**

---

# 17. Global selection commands and shortcuts

| Command | Windows | macOS | Expected result |
|---|---:|---:|---|
| Select All | `Ctrl+A` | `Cmd+A` | Select entire canvas/document bounds |
| Deselect | `Ctrl+D` | `Cmd+D` | Remove current selection |
| Reselect | `Shift+Ctrl+D` | `Shift+Cmd+D` | Restore the most recently deselected selection |
| Inverse | `Shift+Ctrl+I` | `Shift+Cmd+I` | Swap selected and unselected areas |
| Hide/Show Extras | `Ctrl+H` | `Cmd+H` | Hide or show selection edges and other extras without deselecting |

Lighttable should also expose:

- Select and Mask;
- Feather;
- Expand;
- Contract;
- Border;
- Smooth;
- Grow;
- Similar;
- Save Selection;
- Load Selection;
- Transform Selection.

Those commands operate on the persistent selection mask and are not separate drawing tools.

---

# 18. Feather and anti-alias behavior

## Anti-alias

- Smooths jagged diagonal or curved boundaries.
- Primarily affects edge pixels.
- Available for Elliptical Marquee, Lasso, Polygonal Lasso, Magnetic Lasso, and Magic Wand.
- Must be chosen before creating the relevant selection.
- Does not retroactively modify an existing selection merely because the option changes.

## Feather

- Creates a soft transition zone around the selection boundary.
- May be specified before drawing with Marquee and Lasso-family tools.
- May also be applied later through a selection-modification command.
- The softness is not fully represented by marching ants.
- The effect becomes apparent when painting, filling, deleting, masking, copying, or otherwise applying the selection.

Tool options should not imply that changing Feather after a selection is committed automatically rebuilds that selection.

---

# 19. Interaction precedence

When multiple behaviors could apply, use this priority:

1. Active unfinished selection gesture
2. Tool-specific temporary modifier
3. Selection-operation modifier
4. Existing-boundary move behavior
5. New selection gesture
6. Canvas navigation shortcuts

Examples:

- Spacebar during an unfinished marquee repositions the marquee, not the canvas.
- Spacebar when no selection gesture is active temporarily pans the canvas.
- Delete during an unfinished Polygonal or Magnetic Lasso removes the latest point, not selected image pixels.
- Escape during an unfinished lasso cancels the gesture, not the previously committed selection.
- Alt/Option during Quick Selection temporarily subtracts rather than invoking an unrelated application command.

---

# 20. Tool-switching and persistence rules

## Remember per-tool settings

Remember separately:

- Feather per relevant tool;
- Anti-alias per relevant tool;
- Marquee Style and ratio/size;
- Magnetic Lasso Width, Contrast, Frequency, Stylus Pressure;
- Quick Selection brush and edge settings;
- Magic Wand Sample Size, Tolerance, Contiguous, Sample All Layers;
- Object Selection Object Finder and region mode;
- Selection Brush overlay color and opacity.

## Preserve the committed selection

Changing selection tools must not clear the selection.

## Handle unfinished gestures explicitly

- Escape cancels.
- Polygonal Lasso double-click completes.
- Magnetic Lasso Enter completes.
- Tool switching must not silently invent an arbitrary closing point.

## Keep operation mode predictable

The Options-bar mode should remain visible at all times. Temporary modifiers must not permanently change it.

---

# 21. Recommended Lighttable toolbar grouping

## Marquee flyout

- Rectangular Marquee
- Elliptical Marquee
- Single Row Marquee
- Single Column Marquee

## Lasso flyout

- Lasso
- Polygonal Lasso
- Magnetic Lasso

## Automatic selection flyout

- Object Selection
- Quick Selection
- Magic Wand

## Brush selection

- Selection Brush may live with the automatic selection group or beside mask-painting tools, but its tooltip and icon must make clear that it edits the active pixel selection rather than a layer mask or raster layer.

---

# 22. Minimum Photoshop-parity acceptance checklist

## Shared behavior

- [ ] New / Add / Subtract / Intersect are consistent across applicable tools.
- [ ] `Shift`, `Alt/Option`, and `Shift+Alt/Option` temporarily modify selection operations.
- [ ] Cursor badges preview the operation before pointer-down.
- [ ] Selection persists across tools and layers.
- [ ] Deselect, Reselect, Inverse, and Select All match standard shortcuts.
- [ ] Hidden selection edges do not deactivate the selection.
- [ ] One complete gesture creates one Undo step.
- [ ] Escape restores the selection state from before an unfinished gesture.

## Marquee

- [ ] Shift constraint works after pointer-down.
- [ ] Alt/Option from-center behavior works after pointer-down.
- [ ] Spacebar repositions an unfinished marquee.
- [ ] Modifier timing allows Add/Subtract plus square/circle or center constraints.
- [ ] Normal, Fixed Ratio, and Fixed Size are supported.
- [ ] Single Row and Single Column produce exactly one-pixel-wide selections.

## Lasso family

- [ ] Freehand Lasso automatically closes on release.
- [ ] Lasso can temporarily create straight segments.
- [ ] Polygonal Lasso supports Shift 45-degree constraints.
- [ ] Delete steps backward through unfinished Polygonal and Magnetic selections.
- [ ] Polygonal Lasso closes through start-point click, double-click, and Ctrl/Cmd-click.
- [ ] Magnetic Lasso supports automatic and manual fastening points.
- [ ] Magnetic Width is visualized and adjustable with bracket keys.
- [ ] Magnetic Lasso can temporarily act as freehand or polygonal lasso.
- [ ] Enter and double-click complete Magnetic Lasso appropriately.

## Automatic and brush tools

- [ ] Object Finder hover highlight is distinct from a committed selection.
- [ ] Object Selection supports hover-click and manual Rectangle/Lasso regions.
- [ ] Quick Selection supports edge-aware Add/Subtract painting.
- [ ] Magic Wand supports Sample Size, Tolerance, Contiguous, Anti-alias, and Sample All Layers.
- [ ] Selection Brush uses an explicit configurable overlay and direct Add/Subtract painting.

## Boundary versus content

- [ ] A selection tool in New mode can move only the selection boundary.
- [ ] The Move Tool moves selected content rather than merely the boundary.
- [ ] Transform Selection is separate from Free Transform content.
- [ ] Arrow keys move the boundary by 1 pixel; Shift+Arrow by 10 pixels.

---

# 23. Recommended implementation priority from a UX perspective

## P0 — Core familiar behavior

- persistent selection state;
- New/Add/Subtract/Intersect;
- Rectangular and Elliptical Marquee;
- Lasso and Polygonal Lasso;
- modifier timing;
- Spacebar marquee repositioning;
- Deselect, Reselect, Inverse, Select All;
- moving the selection boundary separately from pixels;
- clear marching ants and cursor badges.

## P1 — Professional editing parity

- Single Row/Column;
- Feather and Anti-alias controls;
- Fixed Ratio and Fixed Size;
- Magnetic Lasso;
- Magic Wand;
- Quick Selection;
- Transform Selection;
- Select and Mask entry point;
- saving and loading selections.

## P2 — Modern Photoshop parity

- Object Selection and Object Finder hover previews;
- Selection Brush overlay workflow;
- Sample All Layers behavior;
- Enhance Edge and Hard Edge options;
- contextual selection actions.

---

# 24. Adobe reference sources

Verified against current Adobe documentation available on **1 August 2026**.

- Selection tools overview:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html

- Marquee tools:  
  https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html

- Lasso, Polygonal Lasso, and Magnetic Lasso:  
  https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html

- Magnetic Lasso details:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/snap-to-image-edges-using-magnetic-lasso-tool.html

- Object Selection:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/select-objects-with-object-selection-tool.html

- Quick Selection:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html

- Magic Wand:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html

- Selection Brush:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/create-quick-selections-with-selection-brush-tool.html

- Moving selection boundaries and content:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/move-selection-or-selection-border.html

- Anti-alias and Feather:  
  https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html

- Keyboard shortcuts:  
  https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html
