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

## Selection model

Selections are document-space authoring state. Rectangle, ellipse, freehand and
polygonal tools support new/add/subtract/intersect and may operate outside the
canvas until commit. Feathering expands the work envelope. Adding a layer mask
with a selection bakes that selection into the mask; primary-clicking a mask
thumbnail reloads its coverage as a selection.

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
