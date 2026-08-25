# Multi-document types and video

Status: **typed image/video workspace and read-only video presentation implemented**,
updated 2026-08-25.

## Decision

LightTable's workspace is a host for typed documents, not an image editor that
occasionally displays other media. The current admitted kinds are `image` and
`video`; `model-3d` is reserved as the next known family so new shared APIs do
not bake in image/video-only assumptions. Reserving the kind is not a claim
that GLB import or presentation exists.

The existing `ImageDocument`, image `DocumentSession`, history, compositor and
tools remain image-owned. Video is never represented by an empty image, a fake
pixel layer or a special image codec. `@lighttable/video-core` owns the
host-neutral video source, metadata, lifecycle, playback/view state and frame
artifact contracts. A future 3D package will own equivalent model semantics.

```text
one application workspace / Dockview layout
  -> active typed document adapter
       -> image editor runtime
       -> video viewer runtime
       -> future model-3d runtime
```

Exactly one shared workspace shell remains mounted. Switching kinds changes
the active surface and projected capabilities; it must not replace the user's
Dockview graph or manufacture a second workspace.

## State ownership

Video source identity and decoded metadata belong to the video document.
Current time, play/pause, volume, playback rate, zoom and pan are presentation
state. They may survive a tab switch, but never create a document revision,
history entry, recovery record or unsaved-changes prompt.

Playback resources are runtime-only. An inactive tab is paused. Closing a tab
releases media handles, object URLs, decoded frames, animation callbacks and
audio. Late metadata/frame results must be generation-checked before publish.

## Workspace projection

The panel graph remains stable across document kinds:

- **Layers:** video shows an explicit no-editable-layers state; no fake layer.
- **Channels:** video explains that editable channels require an image.
- **Scopes:** initially unavailable for video. A future current-frame scope
  source is time-keyed and throttled independently from image dirty state.
- **Properties:** read-only video identity, dimensions, duration and playback
  metadata; transport belongs with the viewer controls.
- **Assets, AI History, GenAI, Agent and Actions:** application/project panels
  remain usable and retain their mounted state.
- **Toolbar:** the existing toolbar rail remains mounted so workspace geometry
  never collapses or shifts. Its contents are kind-specific. Video projects the
  existing Pan and Zoom tools; it does not define video copies of their icons,
  shortcuts or option controls. Playback lives in the video surface. Image tool
  state remains unchanged while a video tab is active. The horizontal tool
  options bar likewise remains mounted at its normal height: Pan uses the shared
  identity bar and Zoom uses the shared presets/Fit screen controls.
- **Status:** media lifecycle and time are shown without image revision data.

Menus, shortcuts, Actions and MCP use the same workspace command scopes.
Image-only commands remain visible where discoverability requires it but are
disabled with a stable reason. They never reach image controllers for a video
target. MCP document inspection reports the kind; an incompatible command
fails with `unsupported-document-kind`, not a transport error or `No image`.

## Frame operations

Frame extraction produces a `VideoFrameArtifact`; it does not directly mutate
another bounded context. The application then chooses the destination:

```text
extract current frame
  -> Copy Frame             -> host clipboard
  -> Open Frame as Document -> ordinary image open flow
  -> Place Frame as Layer   -> ordinary image artifact command (later)
```

This same artifact hand-off principle applies to future 3D operations such as
render snapshot, depth pass or material texture extraction.

## Host media boundary

Project video playback does not copy an entire large file through main-process
IPC into a renderer `Blob`. The desktop host issues a bounded, revocable,
capability-token media URL that supports seeking/range reads without revealing
arbitrary filesystem paths. Web hosts use a host-owned Blob URL.
The existing bounded byte transfer remains valid for image import and frame
artifacts, not long-lived video playback.

## Unified open and drag/drop

File > Open, OS Open With, recents, project Assets, AI History and window-level
file drag/drop all enter one typed open router before any image/video decoder.
MP4/WebM drops create peer video document tabs exactly as image drops create
image tabs. Mixed and multi-file drops preserve input order and create one tab
per admitted file. The window drop target never interprets video as a raster
layer or silently sends it through image probing. Project Home remains an
asset-import drop target; imported videos stay durable project assets and may
then be opened through the same typed router.

Content/header probing remains authoritative where practical; MIME type,
extension and picker filters are admission hints. Unsupported files are
reported once with accepted/skipped counts rather than failing the whole drop.

## Delivery status

Implemented: typed workspace surfaces and `@lighttable/video-core`; one
shared-shell document adapter; secure seekable desktop media sources; unified
File Open, OS launch and file-drop routing; a read-only video viewer; contextual
panels, stable toolbar geometry, shared Pan/Zoom tools and viewport math,
top-level menus, application shortcuts and MCP document-kind plus video
presentation reporting/gating. Video pan/zoom is stored in its presentation
session, survives tab switches and does not create document revisions.

Still future work: frame extraction to clipboard/new image documents, optional
current-frame scopes, editing/transport toolbar tools and richer media
operations.

Each milestone must preserve image document pixels, history, active tool and
workspace layout in mixed image/video tab switching tests.
