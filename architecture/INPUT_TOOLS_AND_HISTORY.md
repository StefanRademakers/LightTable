# Input, tools and history

## Command routing

Keyboard input resolves through a declarative keymap into semantic editor
commands. `Ctrl` and `Cmd` share the primary-modifier concept. Browser page
zoom and tab navigation chords are owned by the editor where necessary so the
application remains at host zoom 100%.

Bindings are data with stable IDs, chords, guards and command results. This is
the base for user-editable shortcut sets and import/exportable presets; do not
scatter new `keydown` checks through panels.

UI controls must release or deliberately route focus so tool shortcuts remain
available after sliders and dropdowns. Text-editing contexts are the explicit
exception.

## Tools

A tool owns:

- a stable ID and registry definition;
- activation and temporary-tool behavior;
- property-bar and pointer controllers;
- preview state separate from canonical document state;
- commit/cancel boundaries;
- one reversible command per completed gesture;
- dirty regions and render invalidation.

Paint, erase, fill, selection, transform, warp, vector shape/path editing, pan
and zoom should reuse shared brush, scene-transform, overlay and scheduling
systems. A tool may not patch layer offsets or GPU resources directly to make a
single case work.

The Zoom tool uses `Z`. `Ctrl/Cmd++` and `Ctrl/Cmd+-` step the viewport zoom,
`Ctrl/Cmd+1` selects actual pixels, and `Ctrl/Cmd+0` fits the document. Dragging
with the Zoom tool fits the marked document region; a short click keeps stepped
zoom centered beneath the pointer. Holding `Alt` reverses the active Zoom tool.
`Ctrl/Cmd+Space` temporarily activates zoom-in and `Alt+Space` temporarily
activates zoom-out without replacing the selected tool. Temporary tools end on
Space release or window blur. The drag marquee is presentation-only and uses
the shared GPU overlay; it is never serialized or added to history.

Live-shape gestures read `Shift` and `Alt` continuously, so constraints and
centre-origin drawing can be engaged or released after pointer-down. While a
shape pointer is captured, holding Space translates the gesture origin by the
pointer delta instead of resizing the preview; releasing Space resumes sizing
from the translated origin. This gesture-local Space behavior takes precedence
over temporary viewport panning and still commits one history command.

The Brush tool uses `B`; brackets step size and Shift+brackets step hardness.
Digit input changes opacity while Shift+digit changes flow. `D` resets and `X`
swaps the shared foreground/background colours. Holding Alt temporarily samples
one display-composited GPU pixel without changing tools. A Shift-click begins
at the last completed Brush point and commits through the normal paint engine.
`F5` opens the existing shared tool-settings surface, and Caps Lock replaces
the GPU diameter preview with the precise crosshair. Modifier state is cleared
on window blur so temporary input cannot remain stuck.

Fill commands use Alt+Backspace for foreground and Ctrl/Cmd+Backspace for
background. Adding Shift preserves existing pixel transparency for that one
command without mutating the layer's transparency lock. Shift+F5 opens the
shared Fill dialog. Holding Alt over the Fill tool temporarily routes a click
to the same display-composited GPU eyedropper used by Brush. Fill, dialog Fill,
and shortcuts all converge on one reversible pixel transaction.

Gradient and Paint Bucket share the `G` family while Paint Bucket remains the
first/default toolbar icon. A Gradient drag creates one semantic full-canvas
Gradient Fill vector layer; its reusable color/opacity asset remains separate
from document-space drag geometry. Shift constrains the axis to 45-degree
increments. Type, blend mode, opacity, reverse, dither, transparency and
interpolation are canonical tool settings, and the shared stop editor edits the
same gradient asset used by imported shapes, text and effects. The drag preview
and final GPU render remain vector-backed and one completed drag produces one
history command.

Gradient stop interaction is centralized in that shared editor so consumers
cannot drift into separate stop models. Color and opacity stops drag directly
along the ramp, remain bounded to eight with a two-stop minimum, and support
both explicit controls and right-click/Delete removal. Application settings
stay in the consuming property bar instead of being duplicated in the stop
editor.

## Selection model

Selections are document-space authoring state. Rectangle, ellipse, freehand and
polygonal tools support new/add/subtract/intersect and may operate outside the
canvas until commit. Feathering expands the work envelope. Adding a layer mask
with a selection bakes that selection into the mask. Ctrl-click on
Windows/Linux or Cmd-click on macOS reloads the mask coverage as a selection;
a normal thumbnail click only selects the mask as the active edit target.

Selection visualization is presentation-only and must stay cheap while
panning/zooming. Consolidate outlines and handles onto shared GPU vector overlay
primitives.

## Command history

Undo/redo is document-scoped, serial and bounded by entry count and estimated
bytes. Commands identify their document and may retain resource IDs plus an
explicit disposer; GPU resources remain renderer-owned. Save state is a history
state ID, not a heuristic based on UI events.

Preview updates are not history entries. Pointer-down starts a transaction,
motion updates one preview, and pointer-up commits one command. Cancellation
restores the before-state and releases preview resources.

Merging multiple selected layers uses visual stack order—top into bottom—not
selection click order. Rasterization/merge commands must include masks, local
processing, Lens Fx, styles, clipping and transforms in both the output and the
undo resource accounting.

## Multi-document safety

Commands, tasks, tools, clipboard previews, viewport state and renderers always
belong to a `DocumentSessionId`. Late worker/GPU callbacks are guarded against
closed or replaced sessions. Switching the active document changes presentation
and pauses/resumes renderers; it must not move canonical state between sessions.
