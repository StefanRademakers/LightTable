# LightTable Snapping & Guides — Photoshop-Parity V1

## Status
Implementation specification for a first Photoshop-like snapping system in LightTable.

The goal is **behavioral parity where Photoshop behavior is documented**, while keeping uncertain internals clearly separated from implementation choices. This document deliberately does **not** invent undocumented Photoshop behavior.

Research baseline: Adobe Photoshop desktop documentation available in August 2026.

---

# 1. Scope

Implement these snapping methods first:

1. **Layer ↔ Layer**
   - left / centerX / right
   - top / centerY / bottom
2. **Layer ↔ Canvas**
   - canvas left / centerX / right
   - canvas top / centerY / bottom
3. **Layer ↔ Manual Guides**
   - vertical and horizontal guides
   - Photoshop documents an **8 screen-pixel** guide snap distance
4. **Layer ↔ Grid**
   - snap to grid lines
   - only when grid snapping is enabled
5. **Selection ↔ same targets**
   - selection bounds participate as movable snap geometry
6. **Multi-selection / group bounds**
   - selected layers move as one temporary bounding box
7. **Guide ↔ Ruler ticks**
   - `Shift` while dragging a guide snaps the guide to ruler ticks
   - treat as quantization to ruler ticks, not normal proximity snapping

Out of scope for V1:

- equal-spacing/distribution snapping
- path anchor / Bézier point snapping
- rotation-angle snapping
- resize-handle specific snapping
- pixel-grid snapping for vector creation/transforms
- 3D projected geometry snapping
- slice support

The architecture should make these possible later without replacing the core engine.

---

# 2. Important conceptual split

Photoshop exposes three related but distinct concepts:

1. **Snap** — position correction / magnetic placement.
2. **Snap To** — which target classes are allowed to participate.
3. **Smart Guides** — temporary visual alignment/measurement feedback.

Do not collapse these into one UI toggle.

Recommended LightTable mental model:

```text
Snap Engine
  ├─ candidate discovery
  ├─ target filtering
  ├─ best-match selection
  └─ corrected transform

Smart Guide Overlay
  └─ visualization of current alignment relationships

Guide / Grid / Ruler System
  └─ persistent non-printing layout helpers
```

A user must be able to hide Smart Guides without necessarily disabling snapping, and conversely manage visible guides/grid independently from the global Snap command.

Adobe explicitly exposes `View > Snap`, `View > Snap To`, and `View > Show > Smart Guides` as separate controls.

---

# 3. Photoshop View-menu parity

## 3.1 Recommended LightTable View menu

```text
View
├─ Rulers
├─ Extras
│
├─ Snap
├─ Snap To                    >
│  ├─ Guides
│  ├─ Grid
│  ├─ Layers
│  ├─ Document Bounds
│  ├────────────
│  ├─ All
│  └─ None
│
├─ Show                       >
│  ├─ Grid
│  ├─ Guides
│  └─ Smart Guides
│
└─ Guides                     >
   ├─ New Guide…
   ├─ Edit Selected Guides…
   ├─ Lock Guides
   ├────────────
   ├─ Clear Selected Guides
   └─ Clear Guides
```

Photoshop additionally exposes legacy `Slices` under `Snap To`; LightTable should omit this unless slices ever become a product feature.

Photoshop also has richer guide-layout functionality such as New Guide Layout. That is useful, but not required for this snapping V1.

### Verified Photoshop behavior

`View > Snap`
- toggles snapping globally.
- a check mark indicates snapping is enabled.

`View > Snap To`
- Photoshop exposes Guides, Grid, Layer, Slices, Document Bounds, All and None.
- Adobe says Layer snapping is to **content in the layer**.
- Adobe says Grid cannot be selected as a Snap To target when the grid is hidden.
- Adobe says choosing a single Snap To target while Snap is disabled can automatically enable Snap and select only that target. This is a Photoshop-specific menu convenience and is worth reproducing if exact menu parity is desired.

`View > Show`
- Grid controls grid visibility.
- Guides controls guide visibility.
- Smart Guides controls Smart Guide visibility.

`View > Extras`
- Photoshop uses Extras as a master visibility toggle for non-printing overlays including guides, grid, selection edges, target paths and slices.
- LightTable may map this onto its own overlay/extras system rather than making snapping depend on Extras.

---

# 4. Suggested persisted settings

```ts
interface SnapSettings {
  enabled: boolean;

  targets: {
    guides: boolean;
    grid: boolean;
    layers: boolean;
    documentBounds: boolean;
  };

  smartGuidesVisible: boolean;
  guidesVisible: boolean;
  gridVisible: boolean;
  rulersVisible: boolean;

  guidesLocked: boolean;
}
```

Do **not** expose a user-facing snap tolerance preference in V1 unless there is a clear product reason. Photoshop does not expose one in the normal snapping UI.

---

# 5. Snap tolerance

## 5.1 What Photoshop actually documents

Adobe currently documents this concrete value for guides:

> Elements snap to guides when dragged within **8 screen pixels**.

Important implications:

- this is a **screen-space** distance, not a document/image pixel distance;
- zoom should therefore not change the perceived magnetic radius;
- on a modern app, interpret this as logical UI/CSS pixels rather than raw framebuffer/device pixels.

## 5.2 What Photoshop does NOT publicly document

Adobe does not publicly specify separate numeric tolerances for:

- layer ↔ layer
- layer ↔ document bounds
- centers
- grid
- selection snapping
- multi-selection snapping
- Smart Guide activation
- snap release hysteresis

Therefore do **not** claim that Photoshop uses 8 px for all of them.

## 5.3 LightTable V1 implementation choice

For a coherent first implementation, use one internal default:

```ts
const SNAP_TOLERANCE_SCREEN_PX = 8;
```

for all proximity-based V1 candidates.

This is a **LightTable design choice based on Photoshop's documented guide threshold**, not a claim about undocumented Photoshop internals.

Convert only when needed:

```ts
const toleranceDocument = SNAP_TOLERANCE_SCREEN_PX / viewportZoom;
```

Prefer comparing in screen space if the engine already has screen-space snap features.

Do not add hysteresis until actual interaction testing demonstrates a need. Adobe does not document a separate release threshold.

---

# 6. Coordinate spaces

Keep a strict distinction between:

```text
Document space   — document coordinates / pixels
Viewport space   — after pan + zoom
UI space         — logical screen/CSS pixels
Framebuffer      — physical device pixels
```

Rules:

- layer/content positions live in document space;
- guide positions live in document space;
- grid positions live in document space;
- canvas bounds live in document space;
- ruler values represent document coordinates relative to ruler origin;
- snap tolerance lives in UI/screen space;
- guide/Smart Guide line width and UI text size live in UI space.

Use the existing document-to-screen transform. Do not build a second coordinate model specifically for snapping.

---

# 7. Snap geometry

## 7.1 Basic rectangular features

For each rectangular movable/target geometry expose:

```ts
interface AxisSnapFeatures {
  min: number;
  center: number;
  max: number;
}
```

For a layer:

```text
X: left, centerX, right
Y: top, centerY, bottom
```

For the canvas:

```text
X: left, centerX, right
Y: top, centerY, bottom
```

For a selection:

```text
X: left, centerX, right
Y: top, centerY, bottom
```

X and Y snapping are evaluated independently.

---

# 8. Layer ↔ Layer snapping

## Required V1 behavior

When dragging selected layer geometry, compare its:

```text
left / centerX / right
```

to the corresponding X-axis features of eligible target layers, and independently compare:

```text
top / centerY / bottom
```

to Y-axis features.

Do not constrain candidate pairs only to “same type”. Useful Photoshop-like relationships include:

```text
moving.left    ↔ target.left
moving.left    ↔ target.centerX
moving.left    ↔ target.right
moving.centerX ↔ target.left
moving.centerX ↔ target.centerX
moving.centerX ↔ target.right
moving.right   ↔ target.left
moving.right   ↔ target.centerX
moving.right   ↔ target.right
```

and equivalent Y combinations.

The engine should return the smallest required correction on each axis within the tolerance.

## Content bounds

Adobe explicitly describes Photoshop's `Snap To > Layer` as snapping to **the content in the layer**.

Therefore LightTable should prefer meaningful visual/content bounds rather than blindly using source texture dimensions.

Recommended abstraction:

```ts
interface SnapGeometry {
  visualBounds: Rect;
  transformBounds?: Rect;
}
```

Examples:

- raster layer: cached alpha/content bounds where practical;
- vector shape: rendered/vector visual bounds;
- text: text visual bounds;
- group: union of participating child visual bounds;
- ordinary opaque photo layer: layer/image bounds.

Do not make expensive pixel-bound scans during pointer movement. Cache/recompute content bounds when layer content changes.

## Eligible target layers

At minimum exclude:

- the moving layer itself;
- all members of the same moving multi-selection as individual targets;
- hidden layers / layers made invisible by parent hierarchy;
- layers that have no meaningful geometry.

Whether locked layers should remain valid **snap targets** is a product/compatibility behavior that should be verified interactively before hard-coding. Locking movement and being usable as an alignment reference are separate concepts.

---

# 9. Layer ↔ Canvas snapping

Treat document bounds as a normal target source.

Required target features:

```text
canvas.left
canvas.centerX
canvas.right
canvas.top
canvas.centerY
canvas.bottom
```

Photoshop's documented `Snap To > Document Bounds` specifically says it snaps to the **edges of the document**. Adobe's Snap To documentation does not explicitly state that Document Bounds includes canvas center.

Therefore:

- **edge snapping is verified Photoshop behavior**;
- **canvas-center snapping should be implemented as Smart Guide/alignment behavior only if verified in the target Photoshop version or intentionally adopted as LightTable behavior.**

For strict parity, keep `documentBounds` candidate generation capable of separating:

```ts
edges: true
center: optional / separately enabled internally
```

This avoids baking an assumption into the engine.

---

# 10. Manual Guides

## 10.1 Guide model

```ts
interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number; // document coordinate
  color?: GuideColor;
}
```

Guide lines are non-printing workspace overlays.

## 10.2 Creating guides from rulers

Photoshop behavior verified by Adobe:

- enable rulers with `View > Rulers`;
- drag from the horizontal ruler into the document to create a horizontal guide;
- drag from the vertical ruler into the document to create a vertical guide;
- hold `Shift` while dragging to snap the guide to ruler ticks.

## 10.3 Moving guides

Photoshop behavior:

- use the Move tool;
- pointer over a guide changes to a double-headed arrow;
- drag to reposition;
- hold `Alt` (Windows) / `Option` (macOS) during drag to flip horizontal ↔ vertical;
- hold `Shift` while dragging to snap to ruler ticks.

Current Photoshop also supports selecting/moving multiple guides with `Shift + Alt` (Windows) / `Shift + Option` (macOS).

For LightTable V1, single-guide movement is required; multi-guide selection can be included cheaply if guide selection already exists.

## 10.4 Removing guides

Photoshop behavior:

- drag an individual guide outside the document window to remove it;
- `View > Guides > Clear Guides` removes all guides;
- current Photoshop supports `Clear Selected Guides` for selected guide(s).

## 10.5 Numerical guide creation/editing

Photoshop provides a New Guide dialog with:

- orientation: horizontal / vertical;
- position;
- color.

Current Photoshop also lets selected guides be edited numerically through `View > Guides > Edit Selected Guides`.

Recommended LightTable dialog:

```text
New Guide

Orientation: [ Vertical ▼ ]
Position:    [ 320 px      ]
Color:       [ Default ▼   ]

             Cancel   OK
```

Use the current ruler unit for parsing/display where practical; internally normalize to document coordinates.

## 10.6 Guide snapping

Normal object → guide snapping:

```text
vertical guide   -> X-axis candidate
horizontal guide -> Y-axis candidate
```

Use the V1 proximity tolerance of 8 logical screen pixels.

---

# 11. Guide ↔ Ruler tick snapping

This is distinct from normal proximity snapping.

Photoshop explicitly says `Shift` while creating or moving a guide makes the guide snap to ruler ticks.

Recommended behavior:

```ts
if (input.shift && draggingGuide) {
  position = ruler.nearestTick(rawDocumentPosition);
}
```

Do **not** apply the normal 8 px proximity rule here. The active modifier requests ruler-tick quantization.

The ruler tick generator used for rendering and snapping must be shared so displayed tick positions and actual snap positions can never drift apart.

---

# 12. Rulers

Photoshop rulers:

- appear at the top and left of the active document window;
- display cursor markers as the pointer moves;
- have a configurable `(0,0)` origin;
- the ruler origin also determines the grid origin;
- can be shown/hidden using `View > Rulers`.

Photoshop also allows the user to drag from the top-left ruler intersection to redefine the ruler origin, with `Shift` snapping that origin to ruler ticks; double-clicking the intersection resets the origin.

This is not required for basic snapping V1, but the coordinate model should not prevent it.

## Adaptive ruler ticks

Ruler tick density should adapt to zoom so labels remain readable.

Use a “nice number” sequence such as:

```text
1, 2, 5 × powers of ten
```

Choose major/minor document-space intervals based on a desired screen-space tick separation.

The precise Photoshop threshold table is not publicly documented, so this part should be tuned visually rather than presented as exact Photoshop parity.

---

# 13. Grid

## 13.1 Photoshop UI behavior

Photoshop exposes:

```text
View > Show > Grid
View > Snap To > Grid
```

Adobe states that Photoshop's Grid Snap To option cannot be selected while the grid is hidden.

For strict parity reproduce this dependency:

```text
grid hidden -> Snap To > Grid disabled/unavailable
```

Alternatively LightTable can deliberately allow hidden-grid snapping, but that would be a behavior deviation and should be intentional.

## 13.2 Grid preferences

Photoshop exposes guide/grid preferences under:

```text
Windows:
Edit > Preferences > Guides, Grid, & Slices

macOS:
Photoshop > Settings > Guides, Grid, & Slices
```

Relevant Photoshop settings include:

- guide color;
- guide line style;
- grid color;
- grid line style;
- `Gridline Every` value + measurement unit;
- `Subdivisions` count.

Recommended LightTable preference UI:

```text
Guides & Grid

Guides
  Color: [ Cyan ▼ ]
  Style: [ Lines ▼ ]

Grid
  Color:          [ Gray ▼ ]
  Style:          [ Lines ▼ ]
  Gridline Every: [ 100 ] [ Pixels ▼ ]
  Subdivisions:   [ 10 ]
```

Do not include slice settings.

## 13.3 Grid snapping

Generate nearby grid coordinates mathematically rather than materializing every grid line.

Example:

```ts
const nearestX = gridOriginX + Math.round((x - gridOriginX) / gridSpacingX) * gridSpacingX;
```

Then evaluate the relevant moving X/Y features against nearest grid lines within the snap tolerance.

The ruler origin and grid origin should be compatible because Photoshop explicitly ties the ruler origin to the grid point of origin.

---

# 14. Selection snapping

Adobe explicitly says Photoshop snapping supports **selection edges**.

Treat the active selection bounds as movable snap geometry:

```text
left / centerX / right
top / centerY / bottom
```

The same Snap To target filters should apply:

- Guides
- Grid
- Layers
- Document Bounds

Avoid writing separate snapping logic for selections. The selection tool should submit a different `SnapGeometry` to the same engine.

Important implementation distinction:

- moving the **selection boundary only** and
- moving **selected pixel content**

may be separate tool operations in LightTable. Both can use the same snapping engine, but the operation owner must decide which geometry is being transformed.

---

# 15. Multi-selection / group bounds

Photoshop's Move tool can move multiple selected layers together. For LightTable, represent these as one movable snap geometry.

Recommended rule:

```ts
movingBounds = union(selectedLayers.map(getVisualBounds));
```

Then expose:

```text
left / centerX / right
top / centerY / bottom
```

from that union.

All selected members must be excluded from the target candidate set so a group does not snap to itself.

Apply the resulting X/Y offset identically to all selected layers.

This keeps snapping stable and predictable and avoids members fighting one another.

---

# 16. Smart Guides

## 16.1 Verified Photoshop behavior

Adobe describes Smart Guides as temporary dynamic visual guides that appear while creating/moving layers, shapes and selections. They can indicate:

- edge alignment;
- center alignment;
- object boundaries;
- pixel distances between objects;
- consistent/symmetrical spacing workflows.

Photoshop renders these as pink/magenta alignment feedback.

For V1, implement only the visual feedback required by the seven scoped snapping methods. Equal spacing may wait for V2.

## 16.2 Smart Guides must not own snapping logic

Recommended:

```ts
interface SnapResult {
  offsetX: number;
  offsetY: number;
  snappedX: boolean;
  snappedY: boolean;
  matches: SnapMatch[];
}
```

Overlay generation consumes the matches:

```ts
const guides = smartGuidePresenter.fromSnapMatches(result.matches);
```

Do not let renderer code recompute alignment independently.

## 16.3 Alignment lines

When an X-axis alignment is active, draw a vertical Smart Guide through the aligned feature.

When a Y-axis alignment is active, draw a horizontal Smart Guide through the aligned feature.

Prefer extending the line far enough to clearly connect/relate the participating geometries without covering the whole viewport unnecessarily.

Line thickness should remain constant in UI space regardless of zoom.

## 16.4 Measurement labels

Photoshop Smart Guides can show pixel distances between objects.

The measurement system should therefore be structurally supported in V1, but it does not need to become an equal-spacing snap implementation yet.

Suggested representation:

```ts
interface SmartGuideMeasurement {
  axis: "x" | "y";
  from: number;
  to: number;
  valueDocumentPx: number;
}
```

---

# 17. Modifier keys and shortcuts

## 17.1 Temporary snapping bypass

Adobe's Photoshop snapping documentation states that while using the Move tool, holding `Ctrl` temporarily disables snapping.

Do not mutate the persisted preference.

Conceptually:

```ts
const effectiveSnapEnabled = settings.enabled && !interaction.snapBypass;
```

Modifier handling belongs to the current tool/input layer. Do not hard-code OS keyboard policy deep inside SnapEngine.

Photoshop's modifier behavior can be context-sensitive, so LightTable's central command/input mapping should decide the actual Windows/macOS mapping.

## 17.2 Guide modifiers

Verified Photoshop behavior:

```text
Shift + guide drag
  -> snap guide to ruler ticks

Alt/Option + guide drag
  -> switch guide orientation

Shift+Alt / Shift+Option while selecting guides
  -> multi-guide selection in current Photoshop
```

## 17.3 Visibility shortcuts

Current Adobe help documents:

```text
Grid
  Windows: Ctrl + '
  macOS:   Command + '

Guides
  Windows: Ctrl + ;
  macOS:   Command + ;

Smart Guides
  Windows: Ctrl + Shift + ;
  macOS:   Command + Shift + ;
```

Use LightTable's existing shortcut/command system and keep these configurable if possible.

Note: an Adobe Smart Guides help page also currently lists a different Smart Guide shortcut (`Ctrl/Cmd+U`), which conflicts with Adobe's dedicated Show/Hide Guides page and Photoshop's established command mappings. For parity work, prefer the dedicated current Show/Hide documentation above rather than duplicating the conflicting value.

---

# 18. Candidate model

Keep the SnapEngine generic.

```ts
type SnapAxis = "x" | "y";

type SnapSource =
  | "layer"
  | "canvas"
  | "guide"
  | "grid"
  | "selection";

interface SnapFeature {
  axis: SnapAxis;
  position: number;       // document space
  source: SnapSource;
  sourceId?: string;
  role: "min" | "center" | "max" | "line";
}

interface SnapMatch {
  axis: SnapAxis;
  moving: SnapFeature;
  target: SnapFeature;
  deltaDocument: number;
  deltaScreen: number;
}
```

The coding agent should adapt this shape to LightTable's existing document, transform, tool and overlay architecture rather than forcing these exact interfaces.

---

# 19. Candidate selection

For each axis:

1. generate features for movable geometry;
2. collect eligible target features according to Snap To settings;
3. compute delta;
4. convert/measure delta in screen space;
5. discard outside tolerance;
6. choose smallest absolute correction;
7. apply X and Y corrections independently.

Pseudo-flow:

```ts
const xMatches = findMatches("x", request);
const yMatches = findMatches("y", request);

const bestX = chooseBest(xMatches);
const bestY = chooseBest(yMatches);

return {
  offsetX: bestX?.deltaDocument ?? 0,
  offsetY: bestY?.deltaDocument ?? 0,
  matches: compactMatches(bestX, bestY, xMatches, yMatches),
};
```

Do not prematurely invent complicated semantic priorities. If multiple candidates are inside tolerance, nearest screen-space correction is the safest V1 rule.

However, keep target type/feature role in `SnapMatch` so future UX testing can introduce stable tie-break rules without changing the engine API.

---

# 20. Avoid snapping to everything in the document every pointer event

Snapping is interaction geometry and should normally remain CPU-side.

Do not involve WebGPU unless LightTable already stores useful geometry there and can access it cheaply.

Use a cheap broad phase:

- screen/viewport culling;
- expanded bounding-box query;
- existing spatial index if one exists;
- otherwise a simple list may already be sufficient for normal layer counts.

Do **not** introduce a complex BVH/R-tree purely on speculation. Profile first.

A useful search radius in document space is derived from the screen-space snap radius plus the size/location of moving geometry.

---

# 21. Drag stability

Always calculate the proposed transform from the original drag state + current pointer delta, then apply snapping to that proposal.

Avoid accumulating snapped transforms frame-to-frame:

```text
BAD
last snapped transform
  + pointer delta
  + new snap

GOOD
drag start transform
  + total pointer delta
  -> proposed transform
  -> snap correction
```

This avoids drift and reduces sticky/jittery behavior without requiring undocumented Photoshop-style hysteresis.

---

# 22. UI feedback states

Recommended cursor/overlay behavior:

### Normal layer drag
- no candidate: ordinary move cursor/transform overlay;
- candidate found + Snap enabled: corrected position + Smart Guide feedback if Smart Guides visible;
- Snap bypass modifier held: raw position; no magnetic correction;
- Smart Guides hidden: correction can still occur, but no Smart Guide visualization.

### Manual guide hover
- show guide-move double-arrow cursor when guides are unlocked/editable.

### Manual guide drag
- guide follows pointer in document space;
- `Shift`: quantize to current ruler tick positions;
- `Alt/Option`: flip orientation;
- dragging outside document window: remove guide on release, matching Photoshop's documented behavior.

### Locked guides
- guide remains visible and usable as snap reference;
- cannot be moved or deleted by drag while locked.

The last point is the natural semantics of guide locking; verify any exact Photoshop cursor/no-selection details during final UX parity testing.

---

# 23. Proposed Preferences UI

Keep snapping itself primarily in **View**, matching Photoshop.

Preferences should hold appearance/grid configuration, not everyday enable/disable controls.

```text
Preferences
└─ Guides & Grid

   Guides
     Color       [ Cyan ▼ ]
     Style       [ Lines ▼ ]

   Smart Guides
     Color       [ Magenta / Default ]   // LightTable extension if desired

   Grid
     Color       [ Gray ▼ ]
     Style       [ Lines ▼ ]
     Gridline every [ 100 ] [ Pixels ▼ ]
     Subdivisions   [ 10 ]
```

For strict Photoshop similarity, avoid exposing dozens of tuning knobs such as snap radius, center weighting or hysteresis.

Those can remain internal constants until there is evidence users need them.

---

# 24. Command IDs

Route every menu item and shortcut through LightTable's existing command layer.

Suggested command names:

```text
view.toggleRulers
view.toggleExtras

view.snap.toggle
view.snapTo.guides.toggle
view.snapTo.grid.toggle
view.snapTo.layers.toggle
view.snapTo.documentBounds.toggle
view.snapTo.all
view.snapTo.none

view.show.grid.toggle
view.show.guides.toggle
view.show.smartGuides.toggle

guides.new
guides.editSelected
guides.lock.toggle
guides.clearSelected
guides.clearAll
```

The SnapEngine must read application/document state; it should not own menus or keybindings.

---

# 25. Document state vs application preferences

Recommended split:

### Document state
- actual guide objects and positions;
- ruler origin if LightTable supports custom ruler origin;
- possibly guide colors when individually customized.

### Application/workspace preference
- Snap enabled;
- Snap To target toggles;
- Smart Guides visible;
- grid visible;
- rulers visible;
- default guide/grid appearance;
- grid spacing/subdivisions, depending on LightTable's document model.

Photoshop behavior around persistence can vary by setting/version/workspace. Integrate with LightTable's existing preference/document conventions rather than copying persistence semantics blindly.

---

# 26. Acceptance tests

## Layer ↔ Layer

- [ ] moving left edge snaps to target left/center/right within tolerance
- [ ] moving center snaps to target left/center/right
- [ ] moving right edge snaps to target left/center/right
- [ ] equivalent top/center/bottom tests
- [ ] X can snap while Y remains free
- [ ] Y can snap while X remains free
- [ ] moving layer never snaps to itself

## Layer ↔ Canvas

- [ ] snaps to left document edge
- [ ] snaps to right document edge
- [ ] snaps to top document edge
- [ ] snaps to bottom document edge
- [ ] center behavior follows the explicitly chosen parity/product rule, not an accidental implementation side effect

## Guides

- [ ] drag from top ruler creates horizontal guide
- [ ] drag from left ruler creates vertical guide
- [ ] Shift quantizes guide to visible ruler ticks
- [ ] move-tool hover shows guide-move cursor
- [ ] drag existing guide changes position
- [ ] Alt/Option flips orientation during drag
- [ ] dragging guide outside document window removes it
- [ ] layer snaps to vertical guide in X only
- [ ] layer snaps to horizontal guide in Y only
- [ ] documented guide snap test is based on 8 logical screen px

## Grid

- [ ] grid visibility toggles independently
- [ ] grid snapping follows Snap To > Grid
- [ ] hidden-grid behavior matches chosen Photoshop parity rule
- [ ] zoom does not change perceived proximity tolerance
- [ ] grid origin follows ruler-origin model if custom origin is supported

## Selection

- [ ] selection bounds can snap to guides
- [ ] selection bounds can snap to grid
- [ ] selection bounds can snap to layer features
- [ ] selection bounds can snap to document edges

## Multi-selection

- [ ] union visual bounds form moving snap geometry
- [ ] selected members are not target candidates
- [ ] one correction moves all selected items identically

## UI

- [ ] View > Snap is a global checkbox
- [ ] View > Snap To contains target checkboxes
- [ ] All selects all supported V1 target types
- [ ] None clears all supported V1 target types
- [ ] View > Show > Guides is independent from View > Snap
- [ ] View > Show > Smart Guides is independent from View > Snap
- [ ] Smart Guide overlay is non-printing/non-exported

## Zoom / HiDPI

- [ ] 8 px proximity feels the same at 25%, 100%, 400%
- [ ] tolerance uses logical UI pixels, not raw device pixels
- [ ] guide line width remains constant visually across zoom
- [ ] Smart Guide line width remains constant visually across zoom

---

# 27. Deliberately postponed Photoshop-like behavior

Do not let these block V1, but preserve extensibility:

```text
Equal-spacing Smart Guides
Distance/distribution snapping
Path/anchor snapping
Shape creation snapping
Transform resize snapping
Rotation angle snapping
Pixel-grid alignment
Guide layouts / margins / columns
Per-guide advanced metadata
Artboard-specific snapping if LightTable adds artboards
```

The SnapEngine should accept additional candidate providers later rather than knowing every possible document element type directly.

---

# 28. Implementation principle for the coding agent

This document specifies **observable behavior and architecture boundaries**, not mandatory class names.

Before adding new subsystems, inspect LightTable's existing:

- Move Tool interaction lifecycle;
- transform state/model;
- selection model;
- document/layer bounds utilities;
- overlay/gizmo renderer;
- ruler/grid implementation if already present;
- command layer and menu system;
- preference storage;
- undo model.

Prefer integrating snapping into those systems rather than creating parallel state.

The most important invariant is:

```text
ONE generic snap solver
+ multiple candidate providers
+ independent Smart Guide visualization
+ shared document/viewport coordinate transforms
```

---

# 29. Research confidence / no-guessing notes

## Directly documented by Adobe

- View > Snap global toggle.
- Ctrl temporarily disables snapping while using Move tool (Adobe Windows documentation wording).
- View > Snap To targets: Guides, Grid, Layer, Slices, Document Bounds, All, None.
- Layer target means content in the layer.
- Document Bounds means document edges.
- Grid Snap To unavailable when grid hidden.
- Smart Guides can be independently shown/hidden.
- Smart Guides dynamically show object alignment and pixel-distance information.
- Manual guides can be created by dragging from rulers.
- Shift while guide-dragging snaps to ruler ticks.
- Alt/Option while guide-dragging changes orientation.
- Guides can be removed by dragging outside the document window.
- Current Photoshop supports multiple guide selection and selected-guide editing/clearing.
- Guides snap elements within 8 screen pixels.
- Ruler origin determines grid origin.
- Gridline Every + Subdivisions are Photoshop grid preferences.

## LightTable design decisions where Adobe's internal rule is not published

- applying the same 8 screen-pixel tolerance to every V1 proximity target;
- nearest-delta candidate winner as the generic conflict rule;
- no hysteresis in V1;
- precise internal content-bounds caching strategy;
- performance/spatial-index strategy;
- exact adaptive ruler tick thresholds;
- whether canvas center belongs to strict Document Bounds snapping;
- exact behavior of locked layers as snap targets;
- exact persistence scope of every setting.

These should remain easy to tune after direct A/B testing against Photoshop.

---

# 30. Adobe source references

Primary sources used for this specification:

1. Adobe — Position elements with snapping in Photoshop
   https://helpx.adobe.com/photoshop/using/positioning-elements-snapping.html

2. Adobe — Work efficiently with Smart Guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/work-efficiently-with-smart-guides.html

3. Adobe — Overview of guides, grids, and smart guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/overview-of-guides-grids-and-smart-guides.html

4. Adobe — Show or hide guides, grids, and smart guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/show-or-hide-guides-grids-and-smart-guides.html

5. Adobe — Create guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/create-guides.html

6. Adobe — Move guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/move-guides.html

7. Adobe — Edit guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/edit-guides.html

8. Adobe — Remove guides
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/remove-guides.html

9. Adobe — Set guide and grid preferences
   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/set-guide-and-grid-preferences.html

10. Adobe — Use rulers in Photoshop
    https://helpx.adobe.com/photoshop/using/rulers.html

---

# 31. V1 recommendation in one sentence

Implement a single CPU-side, screen-tolerance-aware SnapEngine that works on generic axis features, feed it layers/canvas/guides/grid/selections/group bounds, keep ruler-tick quantization separate, and render Smart Guides purely from the engine's resolved matches.
