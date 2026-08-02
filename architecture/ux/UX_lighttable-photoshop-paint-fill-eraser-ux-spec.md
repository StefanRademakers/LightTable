# Lighttable — Photoshop-Compatible Paint, Fill & Eraser UX Specification

**Scope:** UI/UX, tool ownership, interaction states, modifiers, cursor feedback, options-bar behavior, shortcuts, layer targeting, selections, masks, and undo expectations for raster painting, filling, gradients, and erasing.  
**Reference target:** Adobe Photoshop Desktop behavior and muscle memory.  
**Out of scope:** brush-rasterization algorithms, GPU implementation, Bézier/vector rendering, brush texture synthesis, internal flood-fill implementation, and retouching tools such as Clone Stamp, Healing Brush, Remove, Blur, Sharpen, and Smudge.

---

## 1. Goal

Lighttable should feel immediately familiar to a Photoshop user when they:

- paint with a brush or pencil;
- sample and switch colors without leaving the active painting tool;
- resize or harden a brush from the keyboard or directly on canvas;
- change opacity and flow with number keys;
- temporarily erase using the same brush;
- draw straight connected strokes with Shift-click;
- fill a region by color similarity;
- apply and subsequently adjust a gradient;
- erase normally, erase by sampled background color, or erase a whole color range;
- work inside an active pixel selection or layer mask;
- encounter locked, non-raster, background, shape, text, adjustment, or smart-object layers.

The target is not merely that each feature exists. The **tool grouping, modifier timing, cursor state, target-layer behavior, options-bar layout, and state persistence** should match what users already know from Photoshop.

---

## 2. Tool groups and default shortcuts

| Tool group | Tools | Photoshop shortcut |
|---|---|---:|
| Painting | Brush, Pencil, Color Replacement, Mixer Brush | `B` |
| Erasing | Eraser, Background Eraser, Magic Eraser | `E` |
| Fill | Gradient, Paint Bucket | `G` |

When **Use Shift Key for Tool Switch** is enabled:

- `Shift+B` cycles Brush, Pencil, Color Replacement, and Mixer Brush;
- `Shift+E` cycles Eraser, Background Eraser, and Magic Eraser;
- `Shift+G` cycles Gradient and Paint Bucket.

When the preference is disabled, repeated presses of `B`, `E`, or `G` may cycle the tools directly.

### Recommended Lighttable behavior

- Remember the last-used tool in each group.
- Plain `B`, `E`, or `G` returns to that last-used group member.
- Support spring-loaded tools: holding a tool shortcut temporarily activates it, and releasing the key returns to the previous tool when no text field is active.
- Keep hidden-tool cycling and toolbar flyout order stable. Adobe users build strong muscle memory around this ordering.

---

# 3. Shared painting and erasing interaction model

## 3.1 The active editing target

Every paint, fill, gradient, and erase gesture operates on one clearly identified target:

- raster layer pixels;
- a layer mask;
- another editable pixel channel or mask;
- a newly created raster layer when Photoshop-compatible auto-layer behavior applies.

The canvas must never leave ambiguity about which data is being edited.

### Target highlighting

When a layer mask is active:

- the mask thumbnail, not merely the layer row, must show the active-target border;
- painting edits mask values rather than layer color;
- the foreground/background swatches should still be available, but their effective mask result should be visually understandable;
- the brush preview should not imply that full RGB color is being added to the image.

When normal layer pixels are active, the pixel thumbnail should carry the active-target border.

## 3.2 Pixel selections constrain all operations

An active pixel selection limits:

- Brush and Pencil strokes;
- Color Replacement strokes;
- Mixer Brush output;
- Paint Bucket fills;
- Gradient application;
- Eraser, Background Eraser, and Magic Eraser output;
- Edit > Fill and direct foreground/background fills.

The brush cursor may extend beyond the selection boundary, but only selected pixel coverage is modified. Feathered selection alpha proportionally attenuates the operation.

Hiding marching ants must not disable the selection.

## 3.3 One pointer gesture equals one history step

For normal painting and erasing:

- pointer-down begins a stroke;
- all pointer movement belongs to the same live stroke;
- pointer-up commits one Undo step;
- cancelling an unfinished gesture restores the pre-stroke state where cancellation is supported.

For click-based tools such as Paint Bucket and Magic Eraser, one click is one Undo step. A drag that performs repeated click-like evaluations should still be one history step until pointer-up.

## 3.4 Tool settings persist independently

Photoshop users expect each tool to remember its own options.

Examples:

- Brush opacity should not unexpectedly become the Eraser opacity;
- Background Eraser tolerance should remain independent of Paint Bucket tolerance;
- the last Brush preset may be shared across brush-based tools, but tool-specific values remain separate;
- Mixer Brush Wet/Load/Mix settings should survive switching away and back;
- the selected Gradient preset and type should be remembered;
- the last-used group member should be remembered.

A deliberate **Reset Tool** action may restore defaults. Switching tools should not.

---

# 4. Shared brush gestures, modifiers, and shortcuts

These interactions are central to Photoshop painting muscle memory and should work consistently across compatible brush-based tools.

## 4.1 Freehand stroke

- Click-drag paints or erases continuously.
- A click without meaningful movement produces a single brush dab.
- Stylus pressure, tilt, rotation, and wheel input affect only properties enabled for those inputs.
- The stroke begins at pointer-down; there should be no extra first-dab delay.

## 4.2 Straight connected stroke with Shift-click

With a painting tool active:

1. Click or finish a stroke at point A.
2. Hold `Shift`.
3. Click point B.
4. Photoshop draws a straight stroke from the previous paint position to point B.

Expected behavior:

- successive Shift-clicks continue a polyline-like sequence;
- brush spacing, pressure fallback, opacity, flow, blend mode, texture, and selection clipping still apply;
- the line connects from the previous stroke endpoint, not from the current cursor preview center before a first paint point exists;
- a tool change, document change, or clearly unrelated operation may reset the remembered endpoint.

This applies to Brush, Pencil, Mixer Brush, and Eraser modes that use brush tips.

## 4.3 Temporary Eyedropper with Alt/Option

For normal painting tools:

- hold `Alt` on Windows or `Option` on macOS;
- the cursor changes to the Eyedropper;
- click or drag to sample a foreground color;
- release the modifier to return immediately to the painting tool;
- the current stroke does not continue through the sampling action.

Tool-specific exceptions take precedence:

- Mixer Brush uses `Alt/Option-click` to load paint from the canvas into the current brush load;
- Eraser uses `Alt/Option` for temporary **Erase to History**;
- Background Eraser samples through its own hotspot and sampling mode.

## 4.4 Temporary erase with the same brush

While using a compatible painting brush, hold the **grave accent/backtick key** `` ` `` to temporarily switch that same brush from painting to erasing.

Expected behavior:

- brush tip, size, hardness, spacing, dynamics, smoothing, texture, opacity/flow behavior, and cursor footprint remain the same;
- the tool does not permanently change to the Eraser tool;
- releasing the key returns to paint mode;
- cursor feedback must visibly indicate temporary erase mode;
- the gesture should work mid-workflow without losing the current Brush preset;
- this mode erases to transparency on a normal editable raster target and follows the target’s normal transparency rules.

This is distinct from pressing `E`, which activates the Eraser tool group with its own remembered settings.

## 4.5 Brush size and hardness from the keyboard

| Shortcut | Behavior |
|---|---|
| `[` | Decrease brush size |
| `]` | Increase brush size |
| `{` | Decrease brush hardness |
| `}` | Increase brush hardness |
| `,` | Previous brush preset |
| `.` | Next brush preset |
| `<` | First brush preset |
| `>` | Last brush preset |

Expected behavior:

- changes update the on-canvas cursor immediately;
- size steps should feel progressive rather than excessively coarse;
- hardness shortcuts only affect brush tips for which hardness is meaningful;
- Block Eraser ignores brush-size/hardness shortcuts if its size is intentionally fixed;
- shortcuts must not trigger while typing in a text or numeric input.

## 4.6 Direct on-canvas size and hardness adjustment

Photoshop supports a HUD-style brush adjustment:

### Windows

- hold `Alt` and right-drag left/right to resize;
- hold `Alt` and right-drag up/down to change hardness.

### macOS

- hold `Control+Option` and drag left/right to resize;
- hold `Control+Option` and drag up/down to change hardness.

Expected Lighttable feedback:

- show the live brush outline;
- show current diameter numerically;
- show current hardness numerically when relevant;
- horizontal and vertical changes should not fight each other after a direction is clearly established;
- pointer release commits the setting change but does not create a paint stroke;
- Escape restores the size/hardness values from before the HUD gesture.

## 4.7 Opacity and flow number shortcuts

For compatible painting and editing tools:

- `1` sets opacity to 10%;
- `5` sets opacity to 50%;
- `0` sets opacity to 100%;
- two digits entered quickly set an exact percentage, such as `4`, `5` for 45%;
- `Shift` plus number keys changes Flow instead of Opacity.

Airbrush mode reverses the normal number-key emphasis in Photoshop, because Flow becomes the more direct airbrush control. Lighttable should either reproduce this exactly or make the alternate behavior an explicit compatibility preference.

Numeric shortcuts should:

- update the Options bar immediately;
- show a brief unobtrusive HUD value near the cursor;
- not activate while a text field has focus;
- use a short, predictable two-digit timing window.

## 4.8 Foreground and background color shortcuts

| Shortcut | Behavior |
|---|---|
| `D` | Reset foreground/background to default black and white |
| `X` | Swap foreground and background colors |

The toolbar swatches should clearly show:

- foreground color in front;
- background color behind;
- a small swap control equivalent to `X`;
- a small default-colors control equivalent to `D`.

## 4.9 Precise cursor with Caps Lock

`Caps Lock` toggles between the normal painting cursor and a precise crosshair cursor.

This should be treated as a cursor-mode toggle, not as a brush-setting change. The actual brush diameter and effect remain unchanged.

## 4.10 Temporary Hand tool

Holding `Spacebar` while no pointer gesture requiring Spacebar is active temporarily switches to Hand/Pan. Releasing Spacebar returns to the active paint, fill, or erase tool.

Painting must not begin while panning.

---

# 5. Brush cursor and visual feedback

## 5.1 Cursor display modes

Support Photoshop-like painting cursor preferences:

- standard tool icon;
- precise crosshair;
- normal brush tip;
- full-size brush tip;
- optional crosshair inside the brush outline;
- optional crosshair only while painting.

### Normal Brush Tip

The cursor represents the stronger central portion of a soft brush, approximately the region at or above the visible half-opacity boundary.

### Full Size Brush Tip

The cursor represents the full affected brush footprint, including low-opacity soft falloff. This is visibly larger for soft brushes.

## 5.2 Cursor outline visibility

Allow cursor-outline boldness choices comparable to:

- Thin;
- Normal;
- Bold;
- Extra Bold.

The cursor must remain visible over both bright and dark image regions. A contrasting two-tone outline is preferable to a single fixed color.

## 5.3 State badges

Use a small cursor badge or temporary HUD where the same footprint can perform different actions:

- Eyedropper while sampling;
- erase indicator while holding the grave accent key;
- history indicator during Erase to History;
- invalid/prohibited indicator over a non-editable target;
- Background Eraser hotspot crosshair;
- Mixer Brush load/sample indicator.

The user should know what a click will do before committing it.

---

# 6. Brush Tool

## Purpose

Paints the current foreground color using the selected brush preset and brush dynamics.

## Basic behavior

- click creates one dab;
- click-drag creates a continuous stroke;
- Shift-click connects the previous paint point to the new point with a straight stroke;
- `Alt/Option` temporarily samples foreground color;
- holding the grave accent key temporarily erases with the same brush;
- the active selection and active mask constrain the stroke;
- one complete stroke is one Undo step.

## Options bar

Minimum Photoshop-compatible controls:

- Tool Preset;
- Brush Preset / brush tip preview;
- Mode;
- Opacity;
- Flow;
- pressure override for opacity;
- pressure override for size;
- Airbrush toggle;
- Smoothing percentage;
- smoothing options menu;
- Symmetry menu where supported;
- Brush Settings panel shortcut.

## Mode

Tool blend mode affects how each stroke combines with pixels already present on the active target. This is separate from the layer blend mode.

Photoshop-specific modes worth preserving include:

- **Behind:** paints only into transparent portions of the active layer;
- **Clear:** paints transparency using the active brush, effectively another explicit erase mode when transparency is unlocked.

Mode remains a tool setting and should not silently alter the layer’s blend mode.

## Opacity versus Flow

### Opacity

Sets the maximum contribution of a single pointer-down stroke. Repeated passes over the same pixels during that same stroke do not exceed the stroke’s opacity ceiling in the ordinary brush model.

Starting a new stroke can add more paint.

### Flow

Controls how quickly paint accumulates as dabs pass over an area during one stroke. Lower Flow creates gradual buildup while remaining capped by Opacity.

The UI should not describe these as synonyms.

## Airbrush

When enabled:

- holding the pointer still continues to build paint;
- Flow controls the rate of buildup;
- brush hardness and opacity still influence the result;
- the cursor should give no false impression that motion is required.

## Painting on non-raster layers

Current Photoshop behavior creates a new transparent raster layer when Brush is used while a smart object, text layer, shape layer, or adjustment layer is targeted, rather than asking the user to rasterize the original content.

Recommended Lighttable parity:

- create a new transparent paint layer immediately above the targeted non-raster layer;
- make that new layer the active paint target;
- preserve the original non-raster layer;
- show a brief notification such as **“New paint layer created above Shape layer”**;
- do not interrupt the first stroke with a modal dialog.

This behavior should be undoable as one coherent action with the first stroke.

---

# 7. Stroke smoothing

Brush, Pencil, Mixer Brush, and Eraser should expose the same smoothing family where applicable.

## Smoothing amount

- range: 0–100%;
- low values closely follow the pointer;
- high values stabilize the stroke but may introduce visible lag;
- the cursor/stroke relationship should remain understandable.

## Photoshop-compatible smoothing modes

### Pulled String Mode

- the stroke does not advance until the pointer exits a visible tether radius;
- display the tether or guide so the delay feels intentional;
- useful for deliberate curves and controlled line work.

### Stroke Catch-up

- while the pointer pauses, the painted stroke catches up toward the pointer position.

### Catch-up on Stroke End

- on pointer-up, the remaining gap is completed smoothly toward the final pointer position.

### Adjust for Zoom

- smoothing behavior remains perceptually consistent across zoom levels.

Smoothing settings belong to the tool, not to the document, unless stored in a tool preset.

---

# 8. Pencil Tool

## Purpose

Paints hard-edged, non-softened strokes with the current foreground color.

## Shared interactions

Pencil should support:

- click and freehand drag;
- Shift-click straight connected lines;
- `Alt/Option` temporary Eyedropper;
- size shortcuts;
- opacity number shortcuts;
- compatible blend modes;
- selection and mask clipping;
- stroke smoothing where enabled;
- temporary Hand tool;
- one stroke per Undo step.

## Hard-edge expectation

- there is no soft hardness falloff;
- the cursor should communicate the exact or near-exact pixel footprint;
- hardness controls should be hidden or disabled rather than appearing to work;
- anti-aliased-looking edges should not be introduced by ordinary Pencil behavior.

## Auto Erase

Auto Erase is a Pencil-specific Options-bar checkbox.

At the start of a stroke:

- if the initial pixel matches the current foreground color, Pencil paints with the background color;
- otherwise, Pencil paints with the foreground color.

The chosen foreground/background role remains fixed for that stroke. It should not alternate continuously as the pointer crosses different colors.

Cursor or HUD feedback should make it clear whether the new stroke will use foreground or background color before substantial movement occurs.

---

# 9. Color Replacement Tool

## Purpose

Paints a replacement color over pixels that match a sampled source color while preserving more of the underlying tonal structure than an ordinary opaque Brush stroke.

The current foreground color is the replacement color.

## Core cursor model

The brush outline determines where replacement is allowed. A central hotspot determines which source color is sampled.

The cursor should therefore show:

- the brush footprint;
- a distinct center crosshair/hotspot;
- a sampling-state indicator where necessary.

Users must understand that touching the wrong source color with the hotspot changes what the tool targets.

## Sampling modes

### Continuous

- resamples the source color continuously as the hotspot moves;
- suitable for surfaces whose color varies gradually;
- easiest mode in which to accidentally sample across an edge.

### Once

- samples only when the stroke begins;
- the sampled source color remains fixed for the whole stroke;
- useful for protecting nearby differently colored regions.

### Background Swatch

- uses the current background swatch as the source color to replace;
- hotspot position still limits where the brush applies, but does not redefine the target color continuously.

## Limits

### Contiguous

Only matching pixels connected to the sampled region within the brush footprint are replaced.

### Discontiguous

Matching pixels anywhere under the brush footprint may be replaced, even when separated by nonmatching pixels.

### Find Edges

Replaces matching connected color while more aggressively preserving visible boundaries.

## Tolerance

- low tolerance changes only colors very close to the sampled source;
- high tolerance accepts a wider color range;
- changing Tolerance updates future sampling decisions, not already committed strokes.

## Anti-alias

Smooths the replacement boundary. It should not blur the entire painted region.

## Replacement modes

Photoshop exposes replacement behavior by color component:

- Hue;
- Saturation;
- Color;
- Luminosity.

Default to **Color**, as that most closely matches the common expectation of replacing hue and saturation while retaining source luminance structure.

## Modifier behavior

`Alt/Option` temporarily samples a foreground replacement color through the Eyedropper rather than redefining the tool’s source-color sampling mode.

## Options bar

- Brush preset;
- replacement Mode;
- Sampling: Continuous / Once / Background Swatch;
- Limits: Contiguous / Discontiguous / Find Edges;
- Tolerance;
- Anti-alias;
- size/pressure controls as supported.

---

# 10. Mixer Brush Tool

## Purpose

Simulates painting with a brush that contains loaded paint, picks up paint from the canvas, and mixes both sources during a stroke.

Its UI should communicate two conceptual paint wells:

- **reservoir:** paint loaded into the brush;
- **pickup:** paint collected from the canvas during the stroke.

## Loading paint from the canvas

- `Alt-click` on Windows or `Option-click` on macOS loads paint from the clicked canvas area;
- release the modifier to return to painting;
- the current Brush Load swatch updates immediately;
- when multicolor loading is enabled, the brush-load preview should retain sampled variation;
- **Load Solid Colors Only** converts the sampled load to a uniform color.

This differs from the normal Brush tool’s temporary Eyedropper behavior and must have different cursor feedback.

## Current Brush Load control

The Options bar should provide:

- current load preview/swatches;
- **Load Brush** action;
- **Clean Brush** action;
- **Load Brush After Each Stroke** toggle;
- **Clean Brush After Each Stroke** toggle;
- Load Solid Colors Only option.

Automatic load and automatic clean are independent concepts and should not be merged into a single vague reset option.

## Wet

Controls how much paint the brush picks up from the canvas.

- low Wet: the canvas contributes less to the stroke;
- high Wet: more canvas paint is picked up and dragged into longer streaks.

## Load

Controls how much reservoir paint is available.

- low Load: the brush runs dry quickly;
- high Load: reservoir color lasts longer.

## Mix

Controls the ratio of picked-up canvas paint to reservoir paint.

- 0%: output favors reservoir paint;
- 100%: output favors paint picked up from the canvas;
- Wet still determines how strongly canvas colors physically participate.

## Flow

Controls how quickly the resulting mixed paint is deposited.

## Sample All Layers

When enabled:

- pickup color is computed from all visible layers;
- actual paint output is still written only to the active editable target;
- hidden layers do not contribute;
- the UI must not imply that all visible layers are being modified.

## Preset combinations

Provide named presets for common Wet/Load/Mix combinations, but expose all values directly after selection. A preset must not become an opaque mode that hides the actual parameters.

## Number shortcuts

Photoshop assigns Mixer Brush-specific numeric behavior:

- number keys change Wet;
- `Alt+Shift+number` on Windows or `Option+Shift+number` on macOS changes Mix;
- entering `00` sets Wet and Mix to zero.

If implemented, show the changed parameter in a brief HUD because these shortcuts differ from ordinary Brush opacity controls.

## Shared interactions

Mixer Brush should also support:

- freehand painting;
- Shift-click straight connections;
- brush size/hardness shortcuts;
- smoothing;
- selection clipping;
- tablet dynamics;
- one stroke per Undo step.

---

# 11. Paint Bucket Tool

## Purpose

Fills pixels whose color falls within a tolerance range of the clicked pixel.

## Basic interaction

- select foreground color or pattern as the fill source;
- click the target pixel;
- evaluate matching pixels using Tolerance, Contiguous, Anti-alias, and sampling settings;
- apply the fill only to the active editable target and active selection;
- one click equals one Undo step.

Dragging may repeat fill evaluations as the pointer moves, but one pointer-down sequence should remain one history step.

## Fill source

Options:

- Foreground Color;
- Pattern.

The source control should be visible before Tolerance because it changes the meaning of the entire tool.

## Mode

Controls how the fill combines with existing target pixels. This is a tool blend mode, not a layer blend mode.

## Opacity

Controls the strength of the applied fill.

## Tolerance

Photoshop uses a 0–255 range:

- low values fill pixels very close to the clicked color;
- high values include a broader range.

The clicked pixel always establishes the reference color for that fill gesture.

## Contiguous

- enabled: fill only connected matching pixels reachable from the click point;
- disabled: fill every matching pixel within the active target and selection, even in disconnected regions.

## Anti-alias

Smooths the boundary of the filled region. It should not globally blur the filled pixels.

## All Layers / Sample All Layers

When enabled:

- matching decisions use the visible composite of all visible layers;
- fill output is written only to the active target;
- hidden layers do not contribute;
- the cursor or tooltip should make this sample-versus-output distinction clear.

## Transparency lock

When transparent pixels are locked:

- Paint Bucket changes only existing nontransparent pixels;
- it cannot expand paint into fully transparent regions;
- the tool should not appear broken—show a lock-related status when a click produces no visible result.

## Layer masks

When a mask is active, Paint Bucket fills mask values rather than layer RGB. The active selection still constrains the fill.

## Options bar

- Fill source: Foreground / Pattern;
- Pattern picker where relevant;
- Mode;
- Opacity;
- Tolerance;
- Anti-alias;
- Contiguous;
- All Layers.

---

# 12. Gradient Tool

## Purpose

Creates a gradual transition based on the selected gradient preset, type, direction, length, and target area.

## Tool grouping

Gradient shares shortcut `G` with Paint Bucket. `Shift+G` cycles between them when Shift-based tool switching is enabled.

## Basic gesture

- pointer-down sets the starting point;
- dragging defines direction and length;
- pointer-up creates the gradient;
- a live preview should be visible during drag;
- an active pixel selection limits the result;
- without a selection, the gradient applies to the active target area.

## Direction and length

- the drag direction determines orientation;
- the drag distance determines transition scale;
- a very short drag creates a compressed transition;
- a long drag creates a gradual transition;
- holding `Shift` constrains the direction to 45-degree increments.

## Gradient types

Expose these in the familiar order:

1. Linear;
2. Radial;
3. Angle;
4. Reflected;
5. Diamond.

## Reverse

Swaps the direction/order of the current gradient for newly created gradients without editing the stored preset itself.

## Dither

Reduces visible banding. This is a creation option, not merely a display-preview option.

## Preset and editor

- clicking the gradient preview opens preset selection;
- an explicit editor action opens color-stop and opacity-stop editing;
- choosing a preset should not unexpectedly overwrite a custom gradient without confirmation;
- foreground/background-based presets update when the foreground/background swatches change.

## Live post-creation editing

Current Photoshop lets users adjust a newly drawn gradient through on-canvas controls, the Properties panel, or the Contextual Task Bar.

Recommended parity:

- keep gradient controls visible after pointer-up;
- allow repositioning and resizing through start/end handles;
- allow type-specific center or angle adjustment where relevant;
- show a midpoint/balance control where the gradient model supports it;
- editing the selected live gradient should not create a second gradient;
- Options-bar values define newly created gradients and should not silently rewrite an existing gradient unless the existing gradient is explicitly active for editing;
- `Escape` cancels the current uncommitted creation/edit gesture;
- `Enter/Return` commits active on-canvas editing;
- switching tools commits the current valid gradient and hides handles.

## Options bar

- Gradient preset preview;
- gradient creation/edit mode where applicable;
- type icons;
- Mode;
- Opacity;
- Reverse;
- Dither;
- transparency handling where supported;
- gradient editor access.

## Layer-mask use

When a layer mask is active, Gradient writes a grayscale transition into the mask. This is a core masking workflow and must not require a separate special tool.

---

# 13. Direct fill commands

Paint Bucket is a similarity-based click tool. Direct fill commands instead fill the current selection or target area without color-range evaluation.

## Foreground and background fills

| Action | Windows | macOS |
|---|---|---|
| Fill with foreground color | `Alt+Backspace` | `Option+Delete` |
| Fill with background color | `Ctrl+Backspace` | `Command+Delete` |
| Preserve transparency while filling foreground | `Shift+Alt+Backspace` | `Shift+Option+Delete` |
| Preserve transparency while filling background | `Shift+Ctrl+Backspace` | `Shift+Command+Delete` |

Expected behavior:

- active pixel selection limits the fill;
- without a selection, the editable target area is filled;
- Preserve Transparency affects only currently nontransparent pixels;
- on a mask, the corresponding foreground/background mask value is filled;
- one command is one Undo step.

## Fill dialog

| Action | Windows | macOS |
|---|---|---|
| Open Fill dialog | `Shift+Backspace` | `Shift+Delete` |

Contents should include:

- Foreground Color;
- Background Color;
- Black;
- 50% Gray;
- White;
- Color…;
- Pattern.

Blending controls:

- Mode;
- Opacity;
- Preserve Transparency.

The dialog should preview nothing destructively until confirmed. `Escape` cancels without modifying the document.

## Content-Aware Fill separation

Content-Aware Fill, Generative Fill, and Remove-style operations are separate workflows. Do not hide them behind ordinary Paint Bucket or basic Fill behavior. A predictable solid/pattern fill must remain immediate and deterministic.

---

# 14. Eraser Tool

## Purpose

Removes or restores pixels through a brush-like stroke, depending on target type and selected Eraser mode.

## Basic transparency behavior

### Normal editable raster layer

Erasing reduces alpha toward transparency.

### Background layer or transparency-locked target

Erased areas are filled with the current background color rather than becoming transparent.

This distinction must be visible in the UI before the stroke:

- show lock/background state in the Layers panel;
- optionally show a tooltip such as **“Eraser paints Background Color because transparency is locked.”**

## Eraser modes

### Brush

- uses brush tip, softness, opacity, flow, dynamics, and compatible smoothing;
- supports size and hardness controls;
- best for soft or textured erasing.

### Pencil

- hard-edged erasing;
- no soft hardness falloff;
- suitable for exact pixel editing.

### Block

- fixed hard square footprint;
- no Opacity control in Photoshop;
- cursor should match the actual block exactly;
- brush-tip controls that do not apply should be hidden or disabled.

## Opacity and Flow

For Brush and Pencil modes:

- Opacity controls maximum erasure strength of a stroke;
- Flow controls buildup during the stroke where supported;
- lower values create partial transparency on normal raster layers;
- on background/locked-transparent targets, lower values blend partially toward the background color.

## Erase to History

Options bar checkbox: **Erase to History**.

When enabled, strokes restore pixels from the selected history source/state rather than erasing to transparency.

Temporary behavior:

- hold `Alt` on Windows or `Option` on macOS while dragging to temporarily use Erase to History;
- release the modifier to return to normal erasing;
- cursor feedback must show the history state;
- this modifier overrides normal painting-tool Eyedropper behavior while Eraser is active.

## Straight strokes and smoothing

Brush/Pencil Eraser modes should support:

- Shift-click straight connected erasures;
- brush size shortcuts;
- hardness shortcuts where meaningful;
- smoothing options;
- tablet pressure controls;
- active selection clipping;
- symmetry where supported.

## Options bar

- Eraser mode: Brush / Pencil / Block;
- Brush preset where applicable;
- Size/Hardness where applicable;
- Opacity where applicable;
- Flow where applicable;
- Smoothing where applicable;
- Erase to History;
- Symmetry where supported;
- pressure overrides.

---

# 15. Background Eraser Tool

## Purpose

Erases pixels similar to a sampled background color while attempting to preserve foreground edges.

## Cursor model

The cursor must contain:

- a brush circle showing the area that may be affected;
- a central crosshair/hotspot showing the exact location used for color sampling.

The hotspot, not the entire brush, establishes the sample color. This is essential Photoshop behavior.

## Basic interaction

- position the hotspot over the background color;
- pointer-down starts the stroke and sampling behavior;
- drag along the background while keeping the hotspot away from foreground colors;
- matching pixels inside the brush footprint are erased;
- nonmatching pixels inside the footprint are preserved;
- selection and mask constraints still apply.

## Sampling modes

### Continuous

Samples continuously while dragging. If the hotspot crosses the foreground, that foreground color may begin to erase.

### Once

Samples only at the beginning of the stroke. The target color remains fixed until pointer-up.

### Background Swatch

Targets the current background swatch rather than the color currently under the hotspot.

## Limits

### Discontiguous

Erases matching pixels anywhere under the brush footprint.

### Contiguous

Erases matching pixels connected to the hotspot region.

### Find Edges

Preserves harder visible boundaries while erasing adjacent sampled color.

## Tolerance

- low tolerance protects colors that differ even slightly from the sample;
- high tolerance erases a broader color range;
- tolerance is evaluated continuously according to the active sampling mode.

## Protect Foreground Color

When enabled, pixels close to the current foreground swatch are protected from erasure.

This requires clear foreground-color visibility and a tooltip explaining that the foreground swatch is acting as a protection color, not a paint color.

## Brush settings

Expose:

- Size;
- Hardness;
- Spacing;
- Angle;
- Roundness;
- pen-pressure control for Size or Tolerance where supported.

## Background-layer conversion

Using Background Eraser on a Background layer should convert it into a normal layer so transparency can be created.

Recommended behavior:

- conversion happens automatically on the first committed erasure;
- the layer name/state updates visibly;
- the conversion and first stroke undo together coherently;
- no modal rasterization/conversion dialog interrupts the stroke.

## Options bar

- Brush preset/settings;
- Sampling: Continuous / Once / Background Swatch;
- Limits: Discontiguous / Contiguous / Find Edges;
- Tolerance;
- Protect Foreground Color;
- pressure control where supported.

---

# 16. Magic Eraser Tool

## Purpose

Removes a range of similar colors across a connected region or the entire active layer with one click-like action.

It combines color-range logic similar to Paint Bucket with transparency output rather than fill output.

## Basic interaction

- click a source pixel;
- determine matching colors using Tolerance;
- limit the result with Contiguous and the active selection;
- soften boundaries with Anti-alias when enabled;
- erase matching active-layer pixels using the selected Opacity;
- one click is one Undo step.

Dragging may repeatedly sample new pixels, but should remain one history step until pointer-up.

## Tolerance

Range: 0–255.

- low values erase colors very similar to the clicked pixel;
- high values erase a broader range.

## Contiguous

- enabled: erase only adjacent matching pixels connected to the clicked area;
- disabled: erase matching pixels across the active target, including disconnected regions.

## Anti-alias

Smooths the edge of the erased result.

## Sample All Layers

When enabled:

- the color match is evaluated against the visible composite;
- only pixels on the active editable target are erased;
- other visible layers are never directly modified by the click.

This sample-versus-output distinction should match Paint Bucket.

## Opacity

- 100% removes matching pixels fully;
- lower values create partial transparency;
- on a transparency-locked target, behavior should be clearly disabled or redirected according to the target’s rules rather than silently producing no result.

## Background-layer conversion

Using Magic Eraser on a Background layer automatically converts it to a normal layer before transparency is created.

The conversion and erase should behave as one coherent user action for Undo.

## Options bar

- Tolerance;
- Anti-alias;
- Contiguous;
- Sample All Layers;
- Opacity.

---

# 17. Masks, transparency locks, and layer locks

## 17.1 Layer masks

When a mask thumbnail is active:

- Brush, Pencil, Paint Bucket, Gradient, Eraser, and direct Fill affect mask values;
- black conceals, white reveals, and gray creates partial visibility;
- foreground/background shortcuts and `X` remain valuable;
- the mask thumbnail updates live during the gesture;
- the image preview updates live through the mask;
- tool cursors remain on canvas rather than forcing edits inside the thumbnail.

## 17.2 Lock Transparent Pixels

Lock Transparent Pixels prevents paint/fill from changing fully transparent pixels and prevents erasure from changing alpha.

Shortcut parity:

- `/` toggles Lock Transparent Pixels for the active layer where applicable.

Show the lock state both in the Layers panel and through a brief status/HUD message when toggled.

## 17.3 Fully locked layers

For a fully locked layer:

- cursor shows a prohibited state;
- pointer-down does not begin a hidden no-op stroke;
- a concise nonmodal message identifies the lock;
- do not auto-unlock without explicit user action.

## 17.4 Non-raster content

Use tool-specific behavior:

- Brush/Pencil painting may create a new transparent raster layer above the target for Photoshop parity;
- Eraser should not silently rasterize text, shapes, adjustment layers, or smart objects;
- Fill/Gradient behavior should clearly state whether a new fill/raster layer is created or whether the target is unsupported;
- never modify vector/source content destructively without an explicit conversion action.

---

# 18. Symmetry behavior

Photoshop supports paint symmetry for Brush, Pencil, and Eraser.

## Options-bar interaction

- butterfly/symmetry control opens the symmetry menu;
- users can choose Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial, Mandala, or a saved/custom symmetry path where supported;
- active symmetry guides remain visible while painting;
- reflected/repeated strokes preview live;
- the original input stroke and all generated mirrored strokes commit as one Undo step.

## Transforming a symmetry path

- choosing a new symmetry type may enter a transform state;
- `Enter/Return` confirms;
- `Escape` cancels;
- the path can be edited later without altering existing painted pixels.

## Compatibility limits

Live brush-tip simulations such as some airbrush, bristle, or erodible behaviors may not support symmetry exactly. Disable unsupported combinations visibly rather than producing inconsistent partial output.

---

# 19. Options-bar ownership and ordering

Keep the left-to-right structure predictable.

## Brush

1. Tool Preset;
2. Brush Preset;
3. Mode;
4. Opacity;
5. Flow;
6. pressure overrides;
7. Airbrush;
8. Smoothing;
9. Symmetry;
10. Brush Settings.

## Pencil

1. Tool Preset;
2. Pencil/Brush tip;
3. Mode;
4. Opacity;
5. Smoothing;
6. Auto Erase;
7. Symmetry;
8. Brush Settings.

## Color Replacement

1. Tool Preset;
2. Brush Preset;
3. replacement Mode;
4. Sampling;
5. Limits;
6. Tolerance;
7. Anti-alias;
8. pressure/brush controls.

## Mixer Brush

1. Tool Preset;
2. Brush Preset;
3. Current Brush Load;
4. load/clean controls;
5. Wet;
6. Load;
7. Mix;
8. Flow;
9. Sample All Layers;
10. Smoothing;
11. Brush Settings.

## Paint Bucket

1. Tool Preset;
2. Fill source;
3. Pattern picker if relevant;
4. Mode;
5. Opacity;
6. Tolerance;
7. Anti-alias;
8. Contiguous;
9. All Layers.

## Gradient

1. Tool Preset;
2. Gradient preview/preset;
3. gradient type icons;
4. Mode;
5. Opacity;
6. Reverse;
7. Dither;
8. gradient editor/options.

## Eraser

1. Tool Preset;
2. Mode: Brush / Pencil / Block;
3. Brush Preset where relevant;
4. Opacity/Flow where relevant;
5. Smoothing;
6. Erase to History;
7. Symmetry;
8. pressure controls.

## Background Eraser

1. Tool Preset;
2. Brush Preset/settings;
3. Sampling;
4. Limits;
5. Tolerance;
6. Protect Foreground Color;
7. pressure control.

## Magic Eraser

1. Tool Preset;
2. Tolerance;
3. Anti-alias;
4. Contiguous;
5. Sample All Layers;
6. Opacity.

---

# 20. Modifier precedence

Modifiers must be resolved by the active tool and interaction state. Do not assign one global meaning to `Alt/Option` or `Shift`.

| Active tool/state | Modifier | Expected action |
|---|---|---|
| Brush/Pencil/Color Replacement | `Alt/Option` | Temporary Eyedropper for foreground color |
| Mixer Brush | `Alt/Option-click` | Load brush paint from canvas |
| Eraser | `Alt/Option` while dragging | Temporary Erase to History |
| Any compatible painting tool | `Shift-click` | Straight stroke from previous endpoint |
| Gradient drag | `Shift` | Constrain direction to 45° increments |
| Brush-compatible tool | `` ` `` held | Temporary erase with same brush |
| Brush-compatible tool | `Spacebar` held outside active stroke | Temporary Hand/Pan |
| Painting tool | number keys | Opacity or tool-specific numeric parameter |
| Painting tool | `Shift` + number keys | Flow or tool-specific alternate parameter |
| Brush-compatible tool | `Caps Lock` | Toggle precise cursor |

### Pointer-down precedence

Once a paint stroke has begun:

- `Alt/Option` should not unexpectedly convert that active stroke into sampling halfway through unless Photoshop does so for that exact tool;
- temporary modes should normally be chosen before pointer-down;
- Spacebar should not turn an already active paint stroke into a pan gesture;
- changing a tool modifier should update the cursor before the next stroke begins.

---

# 21. Undo, cancellation, and history expectations

## Strokes

- one pointer-down-to-pointer-up stroke = one Undo step;
- symmetry copies belong to the same step;
- an automatically created paint layer and its first stroke should undo coherently;
- live preview updates are not separate history entries.

## Paint Bucket and Magic Eraser

- one click = one Undo step;
- click-drag repeated evaluations remain one step until release.

## Gradient

- the initial creation is one step;
- subsequent committed live edits are separate logical steps;
- Escape during an uncommitted edit restores the previous gradient state;
- moving multiple on-canvas controls within one drag is one step.

## Tool-setting changes

Brush size, hardness, opacity, flow, tolerance, sampling mode, and preset changes are application/tool state and should not pollute document Undo unless they directly alter pixels.

---

# 22. Context menus and right-click behavior

For brush-based tools, right-clicking the canvas without the HUD modifier should open a compact Brush Preset picker containing at minimum:

- recent/preset brushes;
- Size;
- Hardness where meaningful;
- quick access to Brush Settings.

Context behavior should not begin a stroke.

For non-brush tools such as Paint Bucket or Magic Eraser, right-click may open tool-specific context actions, but should not unexpectedly open the brush picker when no brush preset is involved.

---

# 23. Error and no-op feedback

A no-visible-change gesture must explain itself when the cause is knowable.

Examples:

- target layer is locked;
- transparency is locked;
- active selection excludes the clicked/stroked area;
- mask rather than pixels is active;
- target is not raster-editable;
- Paint Bucket tolerance finds no additional visible region;
- Background Eraser Protect Foreground Color blocks the pixels;
- tool opacity is 0%;
- layer or target is hidden.

Use a brief nonmodal status or toast. Avoid repeated disruptive alerts during painting.

---

# 24. Photoshop-parity checklist

## Shared painting

- [ ] `B` activates the last-used painting tool.
- [ ] `Shift+B` cycles Brush, Pencil, Color Replacement, and Mixer Brush.
- [ ] `[` and `]` resize the brush.
- [ ] `{` and `}` change hardness.
- [ ] Number keys change Opacity.
- [ ] Shift-number changes Flow where applicable.
- [ ] `D` resets foreground/background colors.
- [ ] `X` swaps foreground/background colors.
- [ ] `Alt/Option` temporarily samples color for normal painting tools.
- [ ] Shift-click draws a straight connected stroke.
- [ ] Grave accent/backtick temporarily erases with the same brush.
- [ ] Caps Lock toggles precise cursor.
- [ ] Spacebar temporarily pans.
- [ ] Right-click opens the brush picker.
- [ ] On-canvas size/hardness HUD works.
- [ ] Active selections and feathering constrain strokes.
- [ ] Active layer masks are edited directly.
- [ ] One stroke equals one Undo step.

## Brush and Pencil

- [ ] Brush exposes Mode, Opacity, Flow, Airbrush, Smoothing, pressure, and Symmetry.
- [ ] Airbrush builds paint while the pointer is held still.
- [ ] Pencil has hard edges.
- [ ] Pencil Auto Erase chooses foreground/background from the starting pixel.
- [ ] Painting on non-raster content creates a new transparent layer rather than rasterizing the source.

## Color Replacement

- [ ] Cursor shows brush footprint and sampling hotspot.
- [ ] Sampling supports Continuous, Once, and Background Swatch.
- [ ] Limits support Contiguous, Discontiguous, and Find Edges.
- [ ] Tolerance and Anti-alias are exposed.
- [ ] Foreground color is clearly the replacement color.

## Mixer Brush

- [ ] `Alt/Option-click` loads paint from the canvas.
- [ ] Current Brush Load preview updates.
- [ ] Load Brush and Clean Brush are separate actions.
- [ ] Auto Load and Auto Clean after each stroke are separate toggles.
- [ ] Wet, Load, Mix, and Flow are directly editable.
- [ ] Sample All Layers affects pickup only, not output target.

## Paint Bucket and direct Fill

- [ ] `G` activates the last-used Gradient/Paint Bucket tool.
- [ ] `Shift+G` cycles Gradient and Paint Bucket.
- [ ] Paint Bucket supports foreground/pattern, Mode, Opacity, Tolerance, Anti-alias, Contiguous, and All Layers.
- [ ] Sample All Layers reads the composite but edits only the active target.
- [ ] Foreground/background direct-fill shortcuts match Photoshop.
- [ ] Shift-added fill shortcuts preserve transparency.
- [ ] Fill dialog exposes contents, Mode, Opacity, and Preserve Transparency.

## Gradient

- [ ] Supports Linear, Radial, Angle, Reflected, and Diamond types.
- [ ] Drag direction and length control orientation and scale.
- [ ] Shift constrains the drag angle.
- [ ] Reverse and Dither are available.
- [ ] New gradients preview live.
- [ ] Newly created gradients remain editable on canvas.
- [ ] Enter commits and Escape cancels the active edit state.
- [ ] Gradient edits layer masks correctly.

## Eraser

- [ ] `E` activates the last-used eraser tool.
- [ ] `Shift+E` cycles Eraser, Background Eraser, and Magic Eraser.
- [ ] Standard Eraser supports Brush, Pencil, and Block modes.
- [ ] Normal layers erase to transparency.
- [ ] Background or transparency-locked layers use background color.
- [ ] `Alt/Option` temporarily enables Erase to History.
- [ ] Background Eraser cursor shows hotspot and brush footprint.
- [ ] Background Eraser supports sampling modes, limits, tolerance, and Protect Foreground Color.
- [ ] Magic Eraser supports Tolerance, Anti-alias, Contiguous, Sample All Layers, and Opacity.
- [ ] Background/Magic Eraser convert a Background layer to a normal transparent layer.

---

# 25. Recommended implementation priority

## P0 — Core Adobe muscle memory

- Brush and Eraser tool groups with `B` and `E`;
- freehand strokes and one-stroke Undo;
- foreground/background colors with `D` and `X`;
- temporary Eyedropper;
- brush size/hardness shortcuts;
- number-key opacity and flow;
- Shift-click straight strokes;
- temporary same-brush erase with grave accent;
- selection and mask clipping;
- Eraser transparency/background-color distinction;
- Paint Bucket core behavior;
- direct foreground/background fill shortcuts.

## P1 — Full everyday parity

- Pencil and Auto Erase;
- smoothing modes;
- on-canvas size/hardness HUD;
- Background Eraser;
- Magic Eraser;
- Gradient types and live editing;
- pattern fills;
- Sample All Layers behavior;
- layer-lock and invalid-target feedback;
- auto-created paint layer for non-raster targets.

## P2 — Advanced painting parity

- Color Replacement;
- Mixer Brush complete load/wet/mix workflow;
- symmetry paths and advanced symmetry types;
- cursor preference variants and outline boldness;
- all tool blend modes and their direct shortcuts;
- exact Photoshop tool-preset serialization behavior.

---

# 26. Reference sources

Primary behavioral reference: Adobe Photoshop Desktop documentation and Adobe’s current shortcut reference.

- Painting tools overview:  
  https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html

- Brush and Pencil painting behavior, opacity, flow, airbrush, cursors, and Auto Erase:  
  https://helpx.adobe.com/photoshop/using/painting-tools.html

- Stroke smoothing:  
  https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html

- Tool-pointer and on-canvas brush resizing behavior:  
  https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/change-tool-pointers.html

- Mixer Brush:  
  https://helpx.adobe.com/photoshop/using/painting-mixer-brush.html

- Paint Bucket:  
  https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html

- Gradient:  
  https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html

- Fill selection/layer with color:  
  https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-selection-layer-color.html

- Standard Eraser:  
  https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html

- Background Eraser:  
  https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/change-pixels-to-transparent-with-the-background-eraser-tool.html

- Magic Eraser:  
  https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/change-similar-pixels-with-the-magic-eraser-tool.html

- Pencil Auto Erase:  
  https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html

- Paint symmetry:  
  https://helpx.adobe.com/photoshop/using/paint-symmetry.html

- Photoshop default keyboard shortcuts PDF:  
  https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf

---

## Final design principle

The familiar Photoshop feeling comes primarily from the **temporary modifiers and state transitions**, not from the existence of separate toolbar icons.

A user should be able to stay on the Brush tool and fluidly:

- sample with `Alt/Option`;
- swap colors with `X`;
- resize with brackets or the HUD gesture;
- adjust opacity and flow with number keys;
- draw straight segments with Shift-click;
- temporarily erase with the grave accent key;
- pan with Spacebar;
- continue painting without losing the active preset or tool state.

The Fill and Eraser families should follow the same principle: the cursor and options bar must make the next click predictable before pixels are changed.
