# LightTable workspace layout

Status: implementation reference; canonical persistence contract is
[`../../features/RESOURCES_WORKSPACES_AND_RECENTS.md`](../../features/RESOURCES_WORKSPACES_AND_RECENTS.md).

## Contract

LightTable has one workspace layout and one or more document sessions. Workspace
state is not image-document state.

The workspace owns:

- dock groups, tabs, splits, floating positions and panel sizes;
- the document host;
- Scopes, Layers, Grade and Lens Fx panels;
- later Media Browser and GenAI panels.

The application editor owns:

- one React editor UI and one Dockview workspace;
- one persistent document canvas and one active presentation renderer binding;
- active tool, tool options, colors and other application-wide interaction UI.

Each document session owns:

- image/layer document state;
- canonical pixel, mask and embedded document resources;
- lightweight document view state such as zoom, pan, selection and active layer;
- undo/redo history;
- dirty and save state.

Shared GPU devices and pipelines are application infrastructure. Derived render
caches may be discarded and rebuilt. A presentation renderer borrows the active
document's resources; it does not own or destroy canonical document data.

Changing the active document rebinds the one persistent canvas. It must never
mount a complete editor/canvas per tab, reopen source bytes, share undo history
or mutate either document.

## Dock semantics

- Dropping in a panel-group centre adds a tab.
- Dropping on a group edge creates a split relative to that group.
- Dropping on the outer workspace edge creates the outermost dock.
- Dropping away from a dock target creates a floating group.
- An empty dock disappears; drag targets are transient.

The document host is stable and locked against accessory panels. It keeps its
own document-tab strip so the persisted accessory layout never contains stale
image-document tabs.

Workspace presets may rearrange or show/hide docked accessories. They do not
destroy the document host. Floating panel geometry is stable application UI:
when a floating panel remains available across a preset change, its position
and size remain exactly where the user put it.

## Scopes

Scopes is a singleton accessory panel. It starts in its own right-hand column
and may be docked or floated. Histogram data is already view-independent.
Parade and Vectorscope still bind concrete canvas elements to the WebGPU scope
engine, so true browser-window popout requires a rebindable scope-surface
contract before it is enabled.

Target API:

```ts
scopeService.attachSurfaces(panelId, surfaces);
scopeService.detachSurfaces(panelId);
```

Scope computation remains editor-owned. Moving a panel must not recreate the
image, grade pipeline or document session.

## Grade, Lens Fx and Layers

Grade contains the core correction controls. Grade, Lens Fx and Debug share a
default tab group. Scopes starts in a separate adjacent column so scopes and
grading controls are visible together. Layers is a compact floating singleton
by default. Each accessory panel may be docked, tabbed, resized down to its
declared minimum or floated without changing image or layer state. The layer
list fills the available panel height and scrolls independently.

## Persistence

The Dockview layout is stored separately from LightTable image documents. The
current storage key is `lighttable.workspace.layout.v6`. It contains a
versioned preset/layout envelope and sanitizes panel parameters to content
keys. Invalid or incomplete layouts fall back to the default workspace; raw
v5 layouts migrate once.

`View -> Reset workspace layout` discards only this UI layout and recreates the
current Documents / Scopes / Grade + Lens Fx + Debug / floating Layers
arrangement. It does not alter an open image, layers, adjustments, history or
saved document.

## Implementation status

- [x] Stable document host with document-tab UI.
- [x] Dockable and resizable Scopes, Layers, Grade and Lens Fx panels.
- [x] Same-window floating groups.
- [x] Versioned, separately persisted workspace layout.
- [x] Explicit workspace-layout reset.
- [x] Document-session controller for opening and switching multiple documents
  with exactly one active document.
- [x] One persistent editor/canvas with active-document renderer rebinding.
- [x] Document-owned canonical GPU resources outside the presentation renderer.
- [x] Typed panel registry and feature-owned panel composition.
- [ ] Rebindable Parade/Vectorscope surfaces.
- [ ] True same-origin browser popout and multi-monitor smoke tests.
- [ ] Window menu entries for restoring closed panels and workspace presets.
- [ ] Reusable Media Browser and GenAI panel registrations.
