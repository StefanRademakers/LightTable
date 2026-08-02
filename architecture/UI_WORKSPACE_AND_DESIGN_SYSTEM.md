# UI, workspace and design system

LightTable owns its entire UI, CSS, icons and interaction language. Hosts mount
the product and provide capabilities; StoryBuilder is not a design-system or
asset dependency. The same shared UI runs in web and Electron.

## Workspace

The workspace supports multiple open documents and exactly one active
document. Document tabs switch document-scoped state: canonical document,
history, tools, selection, viewport, tasks and renderer. Panel layout is a
workspace preference, not document content.

Panels have stable IDs and can be docked, tabbed, resized and floated. Dockview
owns the panel/group layout mechanics and serialized layout graph;
`workspacePanelRegistry.ts` owns which LightTable panels exist and their fresh
workspace placement. LightTable owns panel content, constraints, tokens and
interaction policy. Neither Dockview state nor DOM nodes are document content.
Grade, Lens Fx, Layers, Scopes, Debug and future media/AI/3D panels use this
same registry/host contract. Floating panels must remain recoverable on
window/display changes.

The built-in fresh-workspace profile currently creates:

- a floating `Layers` group within the document host at roughly 260 x 370;
- `Channels` and `Scopes` as initially inactive tabs in that group;
- a 250-pixel `Grade` group docked to the right of the document host;
- `Lens Fx` and `Debug` as initially inactive tabs in the Grade group.

A valid persisted Dockview layout takes precedence over these fresh-workspace
positions. This is workspace preference only: switching documents must not
replace it, and opening a saved image document must not deserialize Dockview
nodes into the scene model.

## Design tokens and controls

Shared visual meaning uses LightTable-owned tokens for surfaces, headers, tab
strips, active tabs, borders, text hierarchy, selection, focus, sliders,
scrollbars and layer states. Repeated controls use shared components; a new
feature must not introduce a private dropdown, button, slider or switch style.

Feature-specific layout may have local CSS, but it composes the shared tokens
and primitives. Removing visible browser focus rings requires an intentional
keyboard-focus replacement, not `outline: none` globally.

## Interaction contract

- Menus, dropdowns and panels return shortcuts to the editor unless a text
  field intentionally owns them.
- Tool property bars and pointer-local quick settings bind to the same command
  and settings model.
- Continuous UI gestures publish at most once per animation frame and commit
  one history entry.
- Disabled controls stay spatially stable and explain unavailable semantics.
- Layer rows use fixed layout slots for thumbnails/status icons; thumbnails
  preserve aspect ratio inside a bounded box.
- Status and errors live in the status/debug systems, not transient layout
  shifts above the canvas.

Current detailed interaction specs live under `ux/`. UI reference images under
`ui/` are visual direction, not executable contracts. When a spec and current
code disagree, verify whether the spec is an active target before changing
working behavior.

## Current visual direction

The references in `ui/` capture one shared interaction language and several
valid Dockview layouts, not four competing workspace defaults:

- a compact start surface for Open, New document and recent files;
- a fixed top menu, tool-specific property bar and document tabs;
- a narrow left tool rail and canvas-centered editing surface;
- Layers, Channels and Scopes hosted by the same dock/tab/floating system;
- Grade, Lens Fx and Debug accessory panels built from shared sections,
  switches, sliders and tokens;
- vector/path overlays drawn over the document without modifying its pixels.

The current workspace registry and persisted Dockview profile decide actual
placement. Screenshots never override panel IDs, layout serialization or code.
