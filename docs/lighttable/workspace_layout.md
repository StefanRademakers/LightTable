# LightTable workspace layout

Status: active workspace contract; implementation updated 31 July 2026.

## Contract

LightTable has one workspace layout and one or more document sessions. Workspace
state is not image-document state.

The workspace owns:

- dock groups, tabs, splits, floating positions and panel sizes;
- the document host;
- Scopes, Layers, Grade and Lens Fx panels;
- later Media Browser and GenAI panels.

Each document session owns:

- image/layer document state;
- WebGPU runtime and derived resources;
- tool/session state;
- undo/redo history;
- dirty and save state.

Changing the active document must never share undo history or mutable GPU image
resources between documents.

## Dock semantics

- Dropping in a panel-group centre adds a tab.
- Dropping on a group edge creates a split relative to that group.
- Dropping on the outer workspace edge creates the outermost dock.
- Dropping away from a dock target creates a floating group.
- An empty dock disappears; drag targets are transient.

The document host is stable and locked against accessory panels. It keeps its
own document-tab strip so the persisted accessory layout never contains stale
image-document tabs.

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
current storage key is `lighttable.workspace.layout.v2`. Invalid or incomplete
layouts fall back to the default workspace.

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
- [x] Document-session controller for opening and switching multiple live
  documents with exactly one active document.
- [x] Inactive renderer suspension without sharing mutable document state.
- [x] Typed panel registry and feature-owned panel composition.
- [ ] Rebindable Parade/Vectorscope surfaces.
- [ ] True same-origin browser popout and multi-monitor smoke tests.
- [ ] Window menu entries for restoring closed panels and workspace presets.
- [ ] Reusable Media Browser and GenAI panel registrations.
