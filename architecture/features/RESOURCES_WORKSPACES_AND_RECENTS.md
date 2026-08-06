# Resources, workspaces and recent documents

Status: current contract, 6 August 2026.

## Resource browsing

`LightTableResourceBrowser` is the shared metadata-first contract for fonts,
gradients, brushes, patterns and later asset kinds. A provider declares stable
resource kinds and implements paged search plus an explicit heavyweight load.
Pages are capped at 100 entries. Listing or filtering must never read font
bytes, brush payloads or pattern images; those load only after selection.

Desktop providers may enumerate private filesystem resources, but results
cross the host boundary as stable IDs and display metadata. Source paths are
not browser telemetry. Web providers use the same contract and can be empty or
remote without changing editor controls.

## Workspace persistence

Dock layout belongs to the application, never a document. The versioned
`lighttable.workspace.layout.v6` envelope contains the schema version, selected
preset (`default` or `custom`) and Dockview geometry, visibility, sizes and
panel content keys.

Panel parameters are sanitized to `contentKey`. Document IDs, source paths,
GPU objects, undo history and other runtime state are discarded before the
layout is written. Corrupt or incompatible layouts reset safely. The previous
v5 raw layout migrates once. Dockview bounds floating groups to the active
viewport so a layout restored after a monitor change remains reachable.

The existing `View -> Reset workspace layout` command restores the default and
does not touch open documents. Normal layout changes are debounced and saved as
the custom workspace.

## Desktop recent documents

The desktop main process owns recents. A file is recorded only after a
successful read or committed save, including native `.lighttable` documents.
Identity is the canonical absolute path (case-insensitive on Windows) hashed
before it crosses IPC. The manifest keeps at most 128 newest-first unique
entries; launcher and menu each expose a bounded 15-entry MRU window.

Missing entries remain listed and are marked unavailable. Opening one returns
cleanly, and the launcher offers removal instead of silently destroying useful
history. IPC exposes only ID, basename and availability, not the private path.

Thumbnail work is lazy: list IPC never decodes previews. Visible launcher
cards request a contained 320 px thumbnail through `IntersectionObserver`. The
desktop keeps only 24 encoded previews in an LRU cache and invalidates an entry
after open/save. The UI reserves a square area and uses `object-fit: contain`,
so portrait, landscape and square documents are never stretched.

## Verification

- `npm run test --workspace @lighttable/app`
- `npm run test --workspace @lighttable/desktop`
- `npm run smoke:desktop:recents` (isolated user data, newest-first ordering,
  missing-file removal, lazy thumbnail and square/contained geometry)
- `npm run build:web`
- `npm run package:desktop:verify`
