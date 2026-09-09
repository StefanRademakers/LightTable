# AI coding-agent onboarding

This is the operational entry point after a fresh session or context collapse.
It tells an agent how to recover enough context to make a safe change without
loading the repository, completed task archive or full architecture catalog.

The deeper technical model is in [QUICKSTART.md](QUICKSTART.md). Current code
and tests remain authoritative; see [README.md](README.md) for the complete
authority order.

## Phase 1: recover the live situation

From the repository root, run:

```powershell
npm run context:agent
```

This read-only command reports the current commit, dirty paths, active task
packages and workspace packages. Never assume a worktree is clean and never
overwrite changes merely because their purpose is not immediately obvious.

The command also reports the last 72 hours of commits, recoverable Git stashes,
discoverable `resume.md` checkpoints and queue-integrity warnings. This is live
recovery evidence, not architecture. Read every reported resume checkpoint and
reconcile its recorded baseline and next step with current `HEAD`, stashes and
the dirty paths before trusting it. A resume records interrupted work; it never
overrides newer code, tests or owner direction.

Then read, in this order:

1. every resume checkpoint reported by `context:agent`;
2. the reset card and relevant system sections in
   [QUICKSTART.md](QUICKSTART.md);
3. [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md);
4. the complete requested/current task package under `work/todo/`, including
   fixtures;
5. only the contracts selected by the routing table below.

A directory under `work/todo/` is actionable only when it contains a readable
`task.txt`. An empty directory, or a package name duplicated in `work/done/`, is
a queue-integrity warning rather than evidence of open product work. Resolve or
record those warnings; do not inflate scope or completion counts from directory
names alone.

Do not preload `work/done/`, `architecture/reference/`, `obsolete/`, every test
or every source file. Search those collections only to answer a concrete
question. Context is a working set, not a measure of diligence.

### Editor-kernel migration -- mandatory for editor mutations

Updated 2026-09-08. A new isolated `@lighttable/editor-kernel` foundation is
being built beside the legacy editor. Its purpose is to establish one
enforceable owner for a complete edit transaction; it is not evidence that the
current tools have already migrated or become stable.

For selection, transform, layer finalization, text, adjustments/effects,
history, rendering or command-route work, read
[Editor kernel migration](editor-kernel/README.md) and its routed contract
before editing. Check
[Migration status](editor-kernel/MIGRATION_STATUS.md) to distinguish target,
partial and proven behavior.
Use the
[stabilization execution ledger](editor-kernel/STABILIZATION_EXECUTION_LEDGER.md)
for work order and completion gates. Do not invent a parallel checklist or skip
its independent critic, maximum two repair loops, packaged real-app proof and
owner-acceptance gate.

The continuation rules are strict:

- React remains UI and low-frequency projection only; it is not canonical edit
  authority.
- A semantic operation uses either its complete legacy route or its complete
  kernel route. Never split preview, commit, history or cleanup across both.
- Existing algorithms stay in their domain packages. The kernel coordinates
  identity, transaction, ownership and invalidation; it does not absorb paint,
  vector, text, filter or WebGPU implementations.
- No legacy route is removed until one explicit artist-visible vertical passes
  canonical state, pixels, layers, history, cleanup and real-app validation.
- A retained legacy fallback is quarantined compatibility debt, not a valid
  place to add features or a pattern to copy. Do not add callers, commands or
  behavior to one. Change it only when the ledger explicitly removes it after
  owner acceptance, or when the owner explicitly asks for a reproduced blocker
  to be repaired without mixing it into the kernel route.
- A passing unit suite does not advance the migration ledger's real-app column.
- Large files are reduced only as a migrated slice removes a named authority;
  mechanical file splitting is not an architectural milestone.

The package boundary check rejects React, DOM/host and concrete WebGPU
dependencies inside `editor-kernel`. Do not weaken that check to make an
adapter convenient; adapters belong outside the kernel.

Selection-specific reset, updated 2026-09-08: read
[Selection vertical slice](editor-kernel/SELECTION_VERTICAL_SLICE.md) before
touching marquee, selection paint, clipboard crop or selection history.
Geometric pointer-up, `selection.applyShape`, move, nudge and selection-paint
terminal commits use `SelectionShapeCommandService` and the kernel coordinator.
Pointer movement is renderer-only: previews may use semantic overlay geometry
and compound masks use a shader sampling offset over the opening mask; committed
contours and hit-tests always use exact mask coverage. Exact
mask snapshot, measured support bounds, semantic provenance and monotonic
selection revision are one committed value. Document rebind projects that
value without authoring a revision. Copy/Copy Merged and raster paint retain a
revision lease through completion.

The packaged `smoke:desktop:selection-kernel` acceptance covers byte-identical
edge excursions and return on all sides, clipped-translation undo/redo, nudge,
paint clipping, drag from paint-only coverage, selection paint, copy bounds and
tab rebind. Selection-paint preview owns the live GPU mask through a token lease
bound to the concrete document renderer. Preview operations use that lease and
façade mask consumers fail closed; a stale release after a tab switch cannot
unlock another document. `SelectionTextureStore` mutation primitives and
transform-history enforce the lease at the resource boundary, covering
Actions/MCP, history, rebind, geometry and resize. Paint releases the preview
only after exact baseline restore and then transfers rollback ownership to the
kernel; the controller must never restore stale state after that handoff.
`smoke:desktop:pixel-clipboard` additionally proves
UI/Actions/MCP pixel-copy equivalence. This advances real-app automation, not
owner visual acceptance: keep the complete legacy fallback until the owner has
confirmed the contour and pointer feel in a manual run.

Document/clipboard reset, updated 2026-09-09: read
[Document and clipboard vertical slice](editor-kernel/DOCUMENT_AND_CLIPBOARD_VERTICAL_SLICE.md)
before changing Ctrl+N, clipboard dimensions, Copy, Copy Merged or Paste.
Clipboard probing is host I/O and dialog-session state, not document/history or
renderer state. `NewDocumentDialog` is the sole probe owner. Never restore a
parent clipboard-dimension cache: it can outlive the clipboard contents and
recreate wrong-size documents. Desktop dimension reads must prefer encoded
containers over DIB, isolate broken advertised formats and decode no pixels on
the normal path. Manual width/height edits always beat late probe results and a
pending probe cannot submit provisional defaults.

Image Size, Canvas Size, Crop and document Rotate share one document-surface
mutation contract. `DocumentSession.updateDocumentAndEditorIf` publishes the
new canonical document and exact document-sized selection in one notification;
never return to sequential `setDocument`/selection publication. Geometry GPU
services exchange every layer mask and all selection targets under the same
history owner. Apply a document mapping to root layer transforms once, but
project document-space masks recursively at every tree depth. An active
selection may have no in-canvas support after crop/resize and must remain active
and movable. Surface dimension changes invalidate renderer-internal clipboard
textures; they do not clear or reinterpret the OS clipboard.

Open/Place/Save/Export reset, updated 2026-09-09: host file delivery has an
exact `committed | canceled | failed` result. Cancellation is normal and must
not publish success or an error; resolved failure must never be treated as
successful I/O. UI Place enters through `executeUiPlaceArtifact` and
`layer.placeArtifact`, completes one history mutation, then releases its
transient artifact. It is deliberately excluded from Actions recording because
that artifact cannot be replayed durably. Do not retain it for playback or
silently accept an asynchronous `accepted` result; define durable artifact
ownership first. Multi-file Open remains serialized through the application
document route.

Layer-finalization reset, updated 2026-09-08: read
[Layer finalization vertical slice](editor-kernel/LAYER_FINALIZATION_VERTICAL_SLICE.md)
before changing rasterize, Merge Down/Selected, Flatten Group/Image, their
affordances or GPU retention. These operations use one fresh raster destination
and one atomic document/history publication. Never reintroduce the removed
same-ID text rasterizer or a UI/controller fallback. A correction adjustment,
non-normal blend or pass-through group that reads pixels outside the selected
subtree must fail closed until a contextual compositor plan exists. History
retention includes group descendants, masks and derived previews. The packaged
layer-finalization matrix is automated proof; owner feel acceptance is still
pending.

Mask/background reset, updated 2026-09-09: read
[Mask and background-removal vertical slice](editor-kernel/MASK_AND_BACKGROUND_REMOVAL_VERTICAL_SLICE.md)
before changing raster masks, Apply Mask, mask-as-selection or Remove
Background. Supported entry points use semantic `layer.setMask`; GPU edits,
canonical metadata and history publish through the shared pixel-mutation
coordinator. Remove Background is one document/renderer-generation-bound task.
Raster Apply Mask preserves the layer ID and unrelated live semantics;
non-raster Apply Mask is deliberately disabled/fail-closed until the S01
fresh-destination route is integrated. Do not reintroduce panel fallbacks or
store inference/task/GPU state in React or the document. The packaged mask
smoke is automated proof; owner acceptance and S03 paint-session cleanup remain
open.

Raster-paint reset, updated 2026-09-09: read
[Raster paint vertical slice](editor-kernel/RASTER_PAINT_VERTICAL_SLICE.md)
before changing Brush, Erase, Clone/Healing, tone brushes, Fill/Clear, raster
Gradient, pixel/mask coordinates or their GPU history. A continuous stroke is
bound at admission to one document transaction, concrete renderer, committed
selection revision, immutable target matrix, brush and operator. Do not resolve
a later renderer or selection during delivery or close. All raster authoring
coordinates come from `paintTargetSourceToDocument`: full scene transform for
pixels, persisted mask transform for masks. Unpublished rollback belongs to
`UnpublishedPixelRollbackOwner`; never destroy or drop recovery snapshots after
a failed undo/compensation. New pixel work must remain blocked until its exact
stateful retry succeeds. `RasterPixelCommandService` owns discrete GPU
fill/gradient/invert resources; React and the kernel do not own shader work.
The packaged smoke is automated proof, while owner paint-feel acceptance on a
large document remains open.

Transform reset, updated 2026-09-09: read
[Transform and snapping vertical slice](editor-kernel/TRANSFORM_AND_SNAPPING_VERTICAL_SLICE.md)
before changing Free Transform, selected-pixel movement, multi-layer/mask
transforms, snapping, smart guides or transform edge-pan. Admission binds one
document, concrete renderer generation, selection revision, immutable source
and snap snapshot. Pointer-up checkpoints the gizmo only; terminal Enter/tool
exit publishes once. `TransformPublicationOwner` owns terminal results and
durable compensation, `BoundSelectionPublication` spans async mask restore and
canonical CAS under one binding, and `AuxiliaryTransformSessionOwner` owns
group/mask preview lifetime. Never rediscover the current renderer inside
cleanup/history, publish against the current selection revision instead of the
admitted lease, or rebuild a transformed document per pointer frame. The
packaged transform smoke is automated proof; owner feel acceptance and the
remaining non-React overlay gesture extraction are still open.

Vector reset, updated 2026-09-09: read
[Vector paths and live shapes vertical slice](editor-kernel/VECTOR_PATHS_AND_LIVE_SHAPES_VERTICAL_SLICE.md)
before changing Pen, point/direct/path selection, live shapes, vector gradients,
semantic vector transforms or Pixels-mode shape rasterization. One
`VectorToolSessionController` admits document identity and renderer generation;
`VectorTransformPreviewBinding` owns retained renderer-only preview and total
cleanup, while pointer-up is the sole canonical vector-transform stage.
Renderer replacement cancels every captured gesture and idle multi-click Pen
transaction. Never stage a document per transform frame or rediscover the
current renderer during cleanup/rasterize. Packaged debug and instrumented
vector gates passed; owner feel acceptance and the named Pen-session extraction
from the no-growth session router remain open.

Text reset, updated 2026-09-09: read
[Text and Path Text vertical slice](editor-kernel/TEXT_AND_PATH_TEXT_VERTICAL_SLICE.md)
before changing point/paragraph/vertical text, Path Text, glyph measurement,
text hit-testing or semantic text transform. The document text layer is
canonical; shaped glyphs and editing layout are renderer projections bound to
their preparation key and renderer generation. Existing-text activation may
wait, but a continuation after layer selection must revalidate its activation
revision, document, tool, renderer, source identity and repeat the exact hit.
Path Text first targets the native contour under the pointer and records stable
path ids. Never interpret pending layout as empty content, retain a stale layout
under a current key, or observe a Pen result through a later React projection.
Packaged Type and Path Text/Actions gates passed. Imported Text Warp remains a
canonical document/rendering feature, but there is no user-facing Text Warp
authoring control. Do not mistake removed/dead overlay callbacks for an
extension point or invent that feature during stabilization. Any future Text
Warp authoring starts behind a bounded application controller. Owner feel
acceptance is open, and no more text policy may enter the 9k-line overlay before
its post-hit adapter is extracted.

Warp reset, updated 2026-09-09: read
[Warp vertical slice](editor-kernel/WARP_VERTICAL_SLICE.md) before changing
raster Warp, imported Text Warp or experimental Face Warp. One renderer-bound
lease owns the immutable source and transient previews; an accepted gesture
rebuilds from that source and publishes one canonical/history transition.
Never use a committed preview as the next source or add Text Warp authoring to
the text overlay as an incidental extension. Raster and Face Warp packaged
gates passed; owner feel acceptance remains open.

Adjustment reset, updated 2026-09-09: read
[Adjustment-layer vertical slice](editor-kernel/ADJUSTMENT_LAYER_VERTICAL_SLICE.md)
before changing Adjustment Layers, attached adjustments or their Properties
panels. `ImageDocument.layers` owns layer-local stacks and
`DocumentSession.processing.adjustments` independently owns document-wide
processing. Panels and renderer pipelines are projections, not history truth.
Every gesture locks one exact contextual sub-owner and ends as one strict,
complete `adjustment.setSnapshot`; creation and masked duplication use the
shared document/pixel-history routes. Do not restore panel mirrors, publish the
same edit through multiple owners, route filter-only nodes through this generic
snapshot command, or treat specialized kinds as generic stack replacement.
Grain is a Lens-Fx sub-owner and not a standalone creation item; hidden legacy
Vibrance stays readable without a duplicate menu item. Automated packaged and
critic gates passed. Owner acceptance remains open, and S13 must define durable
quarantine/retry ownership when both history publication and GPU compensation
fail.

Layer Style reset, updated 2026-09-09: read
[Layer Style vertical slice](editor-kernel/LAYER_STYLE_VERTICAL_SLICE.md) before
changing Effects, their Properties editor or PSD effect import.
`LayerNode.styleStack` is the only committed owner. The UI draft is keyed by
document, layer and cancel generation; `layerStyleInteractionSession` binds the
exact effect target, renderer object and renderer generation. Preview is
renderer-only and one accepted gesture records one strict complete
`layer.style.setSnapshot`. Granular UI/Action/MCP commands use the same
canonical bounds and semantic no-op rules. Locked owners fail closed, and all
non-commit terminal reasons reset the draft. PSD effect scalars and collections
must be normalized at import and pass `parseLayerStyleStack`; never admit a
second domain through an adapter. Do not restore direct panel/overlay mutation
fallbacks or add transaction/history policy to the 1,027-line
`LayerStyleEditor.tsx`; it is a presentation hotspot to decompose by UI
responsibility only. Automated package and critic gates passed; owner
acceptance remains open.

View/multi-document reset, updated 2026-09-09: read
[View and multi-document vertical slice](editor-kernel/VIEW_AND_MULTI_DOCUMENT_VERTICAL_SLICE.md)
before changing pan/zoom, workspace geometry, retained-canvas presentation,
window foreground handling or renderer activity. Electron native window state
is the desktop foreground authority. Blur/minimize synchronously cancel active
mutable gestures before renderer suspension; React only projects that state.
Suspend retires the current presentation and first-frame generation. Restore
must re-blit the retained final texture and cross a new GPU/compositor attempt
before exposing canvas or overlays; never mark a surface ready from an older
double-rAF, force `active: true` in a document projection, or recompute the
document graph merely to restore the swap chain. Hidden-document transient
resource release remains the open S12 boundary.

### Current Agent/Actions/MCP recovery capsule

When the recovered work concerns Agent Access, Actions or MCP, read these after
the reported resume checkpoint:

1. [LightTable MCP v1](integrations/LIGHTTABLE_MCP_V1.md) for the current
   command/query/permission boundary;
2. [Local Codex acceptance](integrations/LOCAL_CODEX_MCP_ACCEPTANCE.md) for the
   shortest packaged practice flow and the separate isolated harness;
3. [Agent-native creative runtime target](goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md)
   for the long-running product outcome;
4. Tasks 214, 220, 221 and 264 for the remaining program work.

Current reset fact, updated 2026-08-25: a fresh Codex client has inspected a
reference and built a separate editable raster/vector/text composition through
MCP only. The design guide now requires one context read, explicit inspection
of every user-named source document, compact semantic layer planning, reuse of
one vector `layerId` for related shapes, batched construction and economical
512-pixel WebP review. Document/layer bounds, bounded previews and palettes,
native/bitmap artifacts and complete layered-design transactions exist.
`adjustment.create` can atomically create configured Posterize, Threshold,
Gradient Map and all twelve P0 full-frame filter nodes in standalone or
attached placement; other adjustment families still have narrower mutation
coverage.

The ordinary local connection flow starts inside **Preferences > Agent Access**
and no longer requires terminal command copy/paste. A ready, clean, unchanged
single-raster document may be inspected while inactive through its bounded
source artifact. Edited, layered or processed inactive documents still require
the active presentation renderer for pixel previews; never solve that by
mounting a hidden editor per tab or returning stale source pixels. The full
Task 264 save/export, independent verification, error/reconnect and cleanup
acceptance remains open. Do not turn a successful design pass into a claim that
all artist capabilities or the complete A-Z benchmark are finished.

### Current editor-stabilization reality -- read before the renderer capsule

Updated 2026-09-06. This section supersedes optimistic integration or release
interpretations in the older renderer capsule and roadmap. The durable
subsystems described there still exist, but their presence does not prove that
the current editor integration is usable.

#### What changed architecturally

The stabilization program started from commit `0298946f` after repeated bugs
showed that document state, transient previews, GPU resources, selection state
and history could be changed or restored by different owners. Between that
baseline and current committed `HEAD` (`cce15c7c`) 38 commits moved the editor
toward this transaction model:

```text
input / command
  -> operation transaction bound to one document generation
  -> immutable baseline plus disposable preview
  -> validate
  -> atomic document + GPU + selection + resource + history commit
     or complete rollback
```

The main changes are:

- committed exact selection snapshots now belong to document editor state;
  renderer selection textures and outlines are disposable projections;
- selection, clipboard, history restore, source publication and GPU readback
  work is bound to the document/session generation that started it;
- fill, document geometry, LUT import, merge/rasterize/flatten and several
  text/grade/vector/warp operations gained explicit commit or rollback
  boundaries;
- transform previews retain a stable source instead of repeatedly sampling
  the previous preview, and snapping derives from a gesture baseline;
- layer resources and temporary history resources gained explicit ownership,
  transfer and disposal rules;
- optional GPU pipeline compilation is shared and async presentation rejects
  results for a stale document generation;
- renderer selection snapshot IO remains behind the rasterizer boundary rather
  than widening the renderer facade.

The canonical program and its remaining matrix are in
[EDITOR_TRANSACTION_AND_RENDERING_STABILIZATION_PLAN.md](EDITOR_TRANSACTION_AND_RENDERING_STABILIZATION_PLAN.md).
Do not reconstruct the migration from commit subjects alone.

#### What this led to

The positive result is a clearer target architecture: more operations now have
an explicit document identity, immutable starting state, rollback boundary and
resource lifetime. Several previously implicit cross-document and late-async
failure modes are now represented in code and narrow tests.

The negative result is more important for current work: the migration crossed
too many user workflows before each complete workflow was accepted in the real
application. Canonical state, renderer projections, capability/affordance
checks and history restore are therefore not consistently in sync. Narrow
tests often proved the new local contract while missing the artist-visible
state transition across tool, layer, renderer and undo owners. A passing test
suite or successful command return must not be reported as proof that the
editor is usable.

The owner's short manual run after this migration found core regressions,
including:

- marquee visibility disappearing, and visible selection bounds diverging
  from the effective paint/copy mask after edge-clipped movement;
- rasterize affordance or capability disappearing for text, shape, gradient,
  processed raster and layers with effects, plus `Ctrl+E` merge doing nothing;
- transform gestures progressively degrading pixels within one tool session,
  while snapping could fight, shrink or return geometry toward stale state;
- visible text failing edit/transform measurement, path text rejecting a
  visible native path and warp preview alternating between old and new state;
- undo failing to restore the selection and reporting an incomplete undo;
- Remove Background and other established end-user flows no longer working
  reliably.

This is not a claim that every item has the same cause, nor that all older
features are lost. It is evidence that the current integration is an
**unstable internal development build under feature freeze**, not a
tester-ready technical preview. A broad rewrite is not authorized by this
finding; the architecture direction must be judged through repaired vertical
workflows, not another repository-wide migration.

#### Current dirty worktree

At this update, committed `HEAD` and the working tree are materially different.
`npm run context:agent` reports active changes in the stabilization plan and in
selection translation, snapping geometry, document/history commands, layer
resource ownership, merge/flatten operations and point-text creation. The
worktree attempts, among other things, to:

- keep an exact opening selection mask and apply the final cumulative
  translation so temporary clipping at a document edge does not become the
  durable selection;
- exclude the selected snap geometry and dependent ancestors/descendants from
  its own snap targets;
- preserve group outer compositing semantics while flattening intrinsic group
  contents and keep rollback/history resource IDs unique;
- bind queued paste/clipboard work to the initiating document generation;
- settle pixel interactions before undo/redo and allow point text to use the
  one active native vector layer when no explicit vector selection reference
  exists.

These are **uncommitted repair attempts**, not verified fixes. Preserve them,
inspect their diff and separate them explicitly from committed behavior. Do
not mark the corresponding bugs done until the owner-visible GPU workflow has
been exercised.

#### Required continuation discipline

Feature freeze remains in force. Work one user-visible vertical at a time:

1. Write the exact interaction sequence and expected pixels, selection,
   layers, affordances and undo result before editing.
2. Trace its real authority chain from input/command through canonical state,
   GPU projection, resource ownership, history and UI capability. Do not add a
   parallel repair path.
3. Fix the owning boundary and use narrow tests while iterating. Run broader
   boundary/type/build suites at a meaningful milestone, not after every edit.
4. Exercise the complete workflow in the real WebGPU application before
   claiming it fixed. Owner validation remains required for interaction and
   visual behavior that automation cannot establish.
5. After every slice, report what is proven, what is only inferred, what
   remains broken and whether the dirty worktree is safer than its baseline.

Restore these short acceptance chains before resuming breadth:

- marquee draw -> move/nudge at edges -> paint/copy/paste/invert -> undo/redo;
- repeated transform and snapping in one tool session without pixel
  degradation, shrinking or stale-state jumps;
- rasterize and merge for raster, processed/effected raster, text, vector and
  gradient layers, including failure rollback and undo/redo;
- text edit/measure/transform, path text and warp preview/commit/undo;
- open -> first correct frame -> edit -> save/close for representative desktop
  and web formats.

For the active S12 renderer path, `useWorkspaceDocumentPresentation.ts` is the
only owner of retained-canvas readiness and delayed document thumbnails. A
document or renderer-generation change must invalidate presentation in a
layout effect before paint; do not reintroduce an id-only `ready` flag, a timer
that reads the latest renderer, or a second gate in `LightTableEditorOverlay`.

### Renderer/editor subsystem recovery capsule

When the recovered work concerns rendering, SVG, document startup, canvas
tools or workspace state, use this reset state before reading historical task
reports:

- **Typed document foundation, 2026-08-26:** the workspace surface contract
  distinguishes image, video and the reserved future `model-3d` kind.
  `@lighttable/video-core` owns read-only video lifecycle, playback/view state
  and extracted-frame artifacts. MP4/WebM now open in the same persistent
  workspace shell through a seekable desktop capability URL (or a browser Blob
  URL). The toolbar rail and panel graph stay mounted; only their contents and
  command capabilities change with the active document kind. Do not represent
  video as an empty `ImageDocument`, fake pixel layer, hidden image runtime or
  a second Dockview shell; read
  [Multi-document types and video](features/MULTI_DOCUMENT_TYPES_AND_VIDEO.md).
  Pan and Zoom are shared application tools for image and video: their existing
  IDs, H/Z shortcuts, option bar, preset/context UI and pure viewport math are
  reused. A typed surface supplies only the presentation adapter and storage;
  never fork a video-specific toolbar or properties system for shared behavior.
  The Video workspace projects the registered bottom Video Controls panel.
  Automatic kind changes may hide/show accessory groups only; never use
  Dockview deserialization or document-host remounting to switch workspaces.
  The stable image canvas binding may remain hidden beneath video, but its
  lifecycle and render work must be disabled and its canonical state untouched.

- **Current, 2026-08-25:** LightTable has one shipping **hybrid vector
  renderer**. There are no normal `:vello` development/package switches and no
  per-document backend mode. `run_clean.bat`, `run_dev.bat`, `run_release.bat`,
  `build.bat`, `npm run dev:desktop` and `npm run package:desktop` all build the
  same hybrid architecture.
- A pure `RenderIslandPlanner` projects independently editable canonical vector
  layers into the minimum currently representable compositing islands. Stable
  runtime resource IDs, retained cross-layer PaintScene fragments and Vello
  Rust scenes are derived resources; they never merge or rewrite document
  layers.
- Backend admission is **per island**. Eligible vector islands use
  retained Vello; unsupported islands and specialized editor paths use the
  native LightTable WebGPU implementation on the same shared `GPUDevice`.
  Inverted clips, unsupported masks/effects and other explicit boundaries must
  fall back or fail visibly, never silently lose semantics.
- Island resources have active/warm/cold/evicted states. Visibility affects
  compositing, not canonical ownership. A hidden island stays warm; memory
  pressure may evict its texture while retaining the JS projection and Rust
  scene; deleted canonical content releases both.
- Pan and zoom are presentation-only. They must not rebuild PaintScene,
  retessellate document geometry or recompose document pixels. Retained vector
  geometry is adaptive to authored/document scale, not viewport zoom.
- Untrusted SVG uses `@lighttable/vector-svg-normalizer` (pinned, local-only
  `usvg` WASM) before the editable `@lighttable/vector-svg` codec. The current
  product routes Open, Place/import, paste, Actions and MCP through the shared
  boundary. Linear/radial gradients, opacity groups and bounded local vector
  clips are current; patterns, filters, SVG text/images and richer mask/boolean
  semantics remain incomplete.
- Warm `VORTEXT.SVG` time-to-first-useful-pixel is proven below 500 ms in five
  packaged runs (428--446 ms). A conservative transient browser-rendered SVG
  preview may provide those first pixels, but it is renderer-only, cannot enter
  history/save/document state, and must be replaced by the final editable
  canonical Vello result. Cold GPU startup and final edit-readiness remain
  separate performance work.
- Document data and editor/workspace state are separate authorities. Switching
  document tabs or Dockview presets must not mutate pixels/layers. Workspace
  layout and the active tool are application/editor state; canonical content
  changes only through an explicit user, command, Action or MCP operation.
- One active presentation port overlays document-lifetime canonical command
  ports in `LightTableCommandPortRegistry`. Model-only commands may address an
  inactive session without changing the active tab; GPU readback, selection,
  raster duplication and other presentation-dependent work must advertise that
  dependency and fail closed when the target has no renderer. Never route a
  semantic command through React just because its document is visible.
- File > Open may select several files, but their initial publication is
  serialized through the one application renderer. Every tab must finish with
  its own source/document/history snapshot; a background tab may not remain a
  title-only `opening` shell merely because another tab became active.
- Recent stability fixes preserve raster pixels across renderer rebinding,
  overlap format-aware CPU preparation with GPU startup (without sending
  ordinary PNG/JPEG/WebP files through PSD import), preserve Copy Merged color through
  the OS clipboard, invalidate attached adjustments, keep transform gizmos
  alive after gestures/picks, use tight multi-layer bounds, restore
  selection-aware pixel Invert and support topmost alpha-aware Shift-click
  canvas layer selection.
- Source preparation and export now carry the document/session/renderer
  generation they were started against. A late decode, preview, export or
  recovery callback is rejected after a renderer rebind instead of publishing
  into the newly active document. Prepared source, document and history state
  publish as one session snapshot rather than three observable partial states.
- Pointer-hot group transforms and partial vector drags keep their transient
  transform in retained renderer state until pointer-up. React and canonical
  state receive one final semantic commit. Settled composites are reused while
  moving layers, and floating controls cannot leak keyboard commands into the
  canvas command router.
- `layer.rasterize` is the universal semantic finalization command for every
  admitted unlocked layer type. Layer-panel UI, Actions and MCP use the same
  command/capability decision and the packaged route-equivalence gate compares
  canonical state, history and pixels after replay.
- The P0 full-frame filter family is one vertical slice across UI, Actions,
  MCP, save/load, rasterize and the GPU compositor. `@lighttable/filter-core`
  owns bounded settings; reusable `@lighttable/filter-webgpu` cores share one
  lazy three-target document pool. The packaged P0 smoke requires changed
  pixels, exact baseline restoration, no renderer errors and stable warm GPU
  memory. Photoshop Smart Filter masks and production visual/vendor calibration
  remain separate open gates; read [P0 GPU filters](features/P0_GPU_FILTERS.md).
- Filter edits use one complete `filter.setSnapshot` value for standalone and
  attached owners. A Properties gesture binds document, target, kind and
  renderer generation; every pointer sample gets a disposable projection
  generation, while commit rebuilds exactly one canonical revision from the
  immutable origin. Never mutate attached filter visibility directly from the
  Layers panel or accumulate canonical revisions per pointer sample. Displace
  map ids must resolve to same-document rasters on edit and creation; destructive
  layer commands clear references to removed maps atomically. The old
  Gaussian-specific controller/panel/renderer alias is deleted and must not be
  recreated. Locked-filter read-only presentation remains tracked P2 work.
- Layer Styles remain a separate alpha-derived compositor stage rather than
  P0 filter nodes. Smooth Bevel now retains ROI-sized height/distance fields
  and crossfades bounded multiscale levels; shadows, glows and Satin reuse
  retained dense Gaussian alpha fields where their semantics permit it. This
  is a visual/performance improvement, not a Photoshop-parity claim. Geometry
  caches, final style presentation and PSD mapping remain independently owned.
- Layer > Add Adjustment and Layer > Add Effect are discoverability routes into
  the same canonical creation/style controllers used by the Layers footer and
  contextual Properties. They must not become alternate document mutation
  paths. The GPU brush cursor now projects hardness as a concentric inner ring;
  it is presentation feedback only.
- Tall context/creation menus measure their intrinsic content before becoming
  visible, and recent-file tiles reserve stable geometry while previews load.
  During a Dockview sash gesture the editor freezes continuous viewport/scopes
  observers and the canvas CSS presentation to avoid stretching or resize
  feedback; pointer-up performs one normal final viewport resize. There is no
  post-release settlement animation in the current contract.
- Scope canvases explicitly wake and resize when a previously hidden section
  or workspace becomes visible. The packaged scopes gate verifies real signal
  in Hue Distribution, RGB Parade and Vectorscope, then confirms that scope UI
  changes leave canonical revision, history and document pixels unchanged.
- The same stabilization pass made command availability independent from a
  hidden editor mount, preserved application services through React Strict Mode
  reconnects, made workspace preset switching deterministic, rejected stale
  recovery publication after Save and restored an explicit recovery-discard
  workflow. Treat these as regression boundaries, not incidental fixes.
- Recovery/close authority is now explicit. `DocumentRecoveryTransitionGate`
  serializes switch/open/close against the active recovery flush;
  `prepareWorkspaceApplicationClose` retains command, session, history and task
  admission through host handoff. Never start Save/Export directly around the
  document task registry, delete recovery without `throughRevision`, or update
  a session-backed React document ref before `DocumentSession` accepts it.
- Generated-result delivery is document lifecycle, not panel state. A submitted
  job persists `editorDelivery` provenance (project, document, source revision
  and behavior); provider adapters never serialize it. Automatic delivery must
  fail closed before asset loading unless the current project matches, and a
  `place-edit` must also match the exact document. Placement crosses the normal
  `layer.placeArtifact` command boundary; Open waits for terminal decode.
  Legacy/no-provenance jobs and stale completions remain durable in History and
  may be opened only through the explicit user action. Do not infer a delivery
  target from whichever project or document happens to be active on completion.
- Viewport state is per-document presentation, never document history. Retained
  pan and coalesced pan/zoom frames live in `ViewportPresentationController` and
  carry the exact opening document/setter owner. During a tab change, render may
  only prepare a candidate owner; one `useLayoutEffect` commits it and clears all
  transient pointer/zoom/edge-pan work before paint or new input. Never mutate
  or cancel the committed viewport owner during render, relabel an old gesture
  with the current document, or add another hook-local RAF scheduler. Temporary
  modifier tools own their full chord: Alt+Space Zoom Out precedes an active
  Brush/Gradient Alt-eyedropper. See
  [View and multi-document vertical slice](editor-kernel/VIEW_AND_MULTI_DOCUMENT_VERTICAL_SLICE.md).

Archived Task 303 is a dated backend bake-off; completed Task 309 and current
code supersede its former "current backend by default" decision. Read its
historical measurements for evidence, not as today's launch configuration. Read
[Vector system](VECTOR_SYSTEM.md),
[Vector engine and SVG import](features/VECTOR_ENGINE_AND_SVG_IMPORT.md),
[Rendering and processing](RENDERING_AND_PROCESSING.md) and
[Performance contract](PERFORMANCE_CONTRACT.md) for the durable contracts.

## Phase 2: classify the requested change

| Change | Read first | Trace to |
| --- | --- | --- |
| canvas interaction, tool or shortcut | [INPUT_TOOLS_AND_HISTORY.md](INPUT_TOOLS_AND_HISTORY.md) and [Tool session protocol](editor-kernel/TOOL_SESSION_PROTOCOL.md) | input adapter -> one legacy or kernel route -> preview -> one history commit |
| transform, bounds, masks or layer semantics | [DOCUMENT_AND_SCENE_MODEL.md](DOCUMENT_AND_SCENE_MODEL.md), [Document ownership](editor-kernel/DOCUMENT_OWNERSHIP.md) and [Edit transaction](editor-kernel/EDIT_TRANSACTION.md) | canonical operation -> scene graph -> renderer projection -> export |
| compositor, shader, vector backend, effect or performance | [RENDERING_AND_PROCESSING.md](RENDERING_AND_PROCESSING.md), [VECTOR_SYSTEM.md](VECTOR_SYSTEM.md) and [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md) | dirty domain -> render island/resource owner -> encoder stage -> telemetry |
| visible UI, panel, workspace or accessibility | [UI_WORKSPACE_AND_DESIGN_SYSTEM.md](UI_WORKSPACE_AND_DESIGN_SYSTEM.md) and [ACCESSIBILITY_KEYBOARD_AND_FOCUS.md](ACCESSIBILITY_KEYBOARD_AND_FOCUS.md) | shared primitive/model -> projected panel -> desktop smoke |
| PSD, PDF, color or format behavior | [PHOTOSHOP_INTERCHANGE.md](PHOTOSHOP_INTERCHANGE.md) or [PDF_OPEN_AND_EXPORT_AUDIT.md](PDF_OPEN_AND_EXPORT_AUDIT.md) | importer model -> representability -> worker/export -> real oracle |
| MCP, Agent Access or command exposure | [integrations/LIGHTTABLE_MCP_V1.md](integrations/LIGHTTABLE_MCP_V1.md) and [Command routing](editor-kernel/COMMAND_ROUTING.md) | stable command ID -> validation/permission -> one semantic handler -> adapter |
| GenAI, local inference or model lifecycle | [features/GENAI_BOUNDED_CONTEXT.md](features/GENAI_BOUNDED_CONTEXT.md) | provider contract -> host process/auth -> asset/provenance -> document command |
| save, recovery, host or portability | [HOSTS_IO_AND_PORTABILITY.md](HOSTS_IO_AND_PORTABILITY.md) and [RELIABILITY_AND_VERIFICATION.md](RELIABILITY_AND_VERIFICATION.md) | host capability -> session revision -> durable result/failure |
| licensing, release or distribution | [COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md](COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md) and [SUPPORTED_HARDWARE_AND_SOAK_GATE.md](SUPPORTED_HARDWARE_AND_SOAK_GATE.md) | policy contract -> signed/packaged artifact -> exact-build evidence |

Before editing, be able to answer:

- What is the canonical state owner?
- What is runtime-only or reconstructable state?
- Which document/session does the operation address?
- Which semantic revision or dirty domain changes?
- Where are cancellation, disposal and stale-result rejection owned?
- What is one meaningful undo unit?
- Which narrow test proves the behavior, and which wider boundary could regress?

If these answers are unclear, trace one existing vertical slice. Do not invent
a second state path to avoid understanding the first one.

## Phase 3: preserve the engineering character

LightTable favors abstraction where it creates a stable semantic boundary, but
permits guarded, specialized fast paths inside that boundary. The goal is not
maximum indirection; it is reusable ownership with desktop-class latency.

- React owns chrome and low-frequency projection, not pointer-frequency canvas
  feedback or renderer state.
- Gizmos, selections, previews and animation belong in retained GPU overlays
  with narrow invalidation. Existing DOM/React hot paths are debt, not examples.
- The canonical document never contains DOM nodes, GPU handles or host paths.
- WebGPU performs high-volume rendering; workers/Wasm/Rust own suitable codecs,
  shaping and bounded analysis. CPU readback in a hot path requires evidence.
- Vello and native LightTable WebGPU are cooperating backends behind one hybrid
  renderer, not user modes. Backend-specific state is disposable projection;
  canonical vectors, PaintScene capability reports and compositor order remain
  authoritative.
- Preview and final quality may differ deliberately. Pointer-up produces one
  semantic, undoable commit.
- Optional resources are lazy, revision-keyed, cancellable and explicitly
  disposed. Device loss and late async completion must be safe.
- A generic package is valuable only when it preserves these properties and
  has a real consumer. Do not replace a direct fast path with abstraction churn.

## Phase 4: implement and prove a vertical slice

Prefer the smallest owner-correct slice that completes the behavior:

```text
intent / stable command
  -> validation and explicit document identity
  -> canonical mutation or bounded task
  -> one history entry
  -> smallest dirty domain
  -> retained renderer realization
  -> projected UI / artifact / export
```

Start with the nearest unit test. Widen according to the changed boundary; use
the verification map in [QUICKSTART.md](QUICKSTART.md#verification-map). A UI
handler returning quickly does not prove responsive rendering, and a synthetic
canvas screenshot does not prove Photoshop parity or lifetime safety.

When a contract changes, update canonical architecture in the same milestone.
Do not turn an implementation observation, active bug or temporary workaround
into a permanent design rule.

## Commercial stop check

Passing technical tests never authorizes a paid-release claim. Before wording
work as commercially ready, distinguish all of the following:

- exact build and supported hardware evidence;
- data-loss, crash recovery and rollback behavior;
- installer, signing, update and downgrade operations;
- licensing/activation, purchase restoration and outage behavior;
- privacy, diagnostics, security review and Agent Access permissions;
- third-party/model licenses, notices and redistribution rights;
- accessibility, external beta evidence and owner visual acceptance;
- pricing, tax, refunds, support and upgrade policy.

The repository contains strong technical subsystems, but the current editor
integration is an unstable internal development build during stabilization and
must not be described as tester-ready or commercially ready. In addition,
production entitlement is not implemented, model disclosures are incomplete,
platform qualification is not broad enough and owner/legal decisions remain.
Local editing, save, export and recovery are intended to remain available
without a live licensing server.

## Queue mode and completion

An ordinary request authorizes the requested change only. The explicit command
to work all todos activates the persistent queue contract in
[`work/README.md`](../work/README.md): finish tasks in order, verify, update
durable architecture, commit the milestone, move it to `work/done/` and
continue until the queue is empty, genuinely blocked, or the mandatory
eight-hour owner checkpoint is due. Persistence follows the autonomous-result
loop in that contract: implement, exercise the real flow, assess the net
product result, and redirect when a metric or approach stops serving the
product goal. A new autonomous period begins only after owner review or an
explicit instruction to continue.

At handoff, report the outcome, evidence run, known limitations and affected
files. Do not claim success from code inspection alone when a relevant test can
be run, and do not hide pre-existing failures as if they were introduced by the
current change. Do not move work to `done/` when its defining external or user
flow remains untested; record it as `manual validation required` in `todo/`
instead.

The owner leads product direction and expects decision-grade information, not
agreement for its own sake. Follow the evidence and decision hierarchy in
[`work/README.md`](../work/README.md): conclusion first, then facts,
interpretation, uncertainty, consequences, options and a reasoned
recommendation. Challenge weak product or technical choices directly. Count
tests and research as supporting work only; the complete user flow and the
quality it protects remain the result.
