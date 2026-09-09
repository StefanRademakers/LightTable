# Editor kernel migration status

Updated: 2026-09-09.

The ordered, checkable work queue and the mandatory critic/repair/real-app loop
live in the [stabilization execution ledger](STABILIZATION_EXECUTION_LEDGER.md).
This status file remains the compact statement of what is actually migrated.

| Domain | Legacy | Kernel contract | Kernel route | Real-app proof | Legacy removed |
| --- | --- | --- | --- | --- | --- |
| shared identities and lifecycle | n/a | partial | n/a | n/a | n/a |
| selection/marquee vertical | fallback retained outside migrated routes | implemented | shape/move/nudge/paint/Magic Wand/Object Selection/rebind | packaged automated | partial |
| transform and snapping | gesture adapter retained | implemented | complete vertical | packaged automated | partial |
| rasterize/merge/flatten | no | implemented | complete vertical | packaged automated | yes |
| masks and background-result insertion | paint fallback retained for S03 | implemented | supported mask commands/task result | packaged automated | partial |
| raster paint and pixel mutations | no alternate session owner | implemented | brush/erase/sampled/tone/fill/gradient/mask | packaged automated | yes |
| vector paths and live shapes | renderer-only fallback retained | implemented | complete S05 vertical | packaged automated | partial |
| text/path text | overlay adapter retained | implemented | complete S06 vertical | packaged automated | partial |
| warp | compatibility paths retained | implemented | complete S07 raster/Face Warp vertical | packaged automated | partial |
| adjustment layers | compatibility paths retained | implemented | complete S08 lifecycle | packaged automated | partial |
| layer styles/effects | UI presentation adapter retained | implemented | complete S09 lifecycle | packaged automated | yes |
| filters | yes | documented | no | no | no |
| open/render/save/recovery/generated results | partial compatibility remains | implemented | open/place/save/export/recovery/close/GenAI delivery | packaged automated + focused delivery | partial |
| Action/MCP equivalence | yes | documented | no | no | no |

“Documented” means only that the cross-domain rule exists. It is not an
implementation or usability claim.

## Foundation delivered

- isolated `@lighttable/editor-kernel` workspace;
- branded document, resource, history and transaction identities;
- command, document, history, resource, render, tool and layer-capability ports;
- pure terminal transaction lifecycle with monotonic preview revisions;
- machine boundary blocking React, host and concrete WebGPU dependencies.

## Current decision slice

The selection/marquee vertical is the first implemented architecture proof.
Its canonical route now covers geometric commits, movement, keyboard nudges,
selection-paint, Magic Wand and Object Selection terminal commits, undo/redo and exact document rebind. Copy,
Copy Merged and raster paint consume a revision-bound selection lease.

The current owners, implemented shape path and remaining gates are recorded in
[Selection and marquee vertical slice](SELECTION_VERTICAL_SLICE.md). Its
authority inventory, renderer staging, state/history adapters and consumer
leases are implemented. A packaged WebGPU smoke proves four-edge excursions
and return, nudge, selection paint, paint clipping, exact Copy bounds,
undo/redo and tab rebind. Rectangle, ellipse, free, polygon, horizontal/vertical
strip, Magic Wand and Object Selection UI paths have packaged coverage; unit tests cover combine
modes, cancellation, resource teardown and failure rollback. Magic Wand stages
on a reusable full GPU workspace, publishes through the same atomic selection
coordinator, and records/replays one strict semantic Action after commit. Object
Selection keeps model inference transient, then transfers its exact mask to the
same atomic coordinator without retaining full mask bytes in canonical
provenance. Packaged Object Finder and Select Subject runs passed, including
Action undo/playback and execution through the external MCP tunnel.

Legacy fallbacks outside the migrated routes remain until owner
visual/interaction acceptance. Object Selection's direct renderer/history
fallback has been removed; do not begin a second domain migration or delete the
remaining S00 fallbacks before the owner gate.

Layer finalization is the second implemented vertical. Rasterize, Merge Down,
Merge Selected, Flatten Group and Flatten Image now reserve a fresh destination,
render once, publish one document/history transition and either transfer or
release every source/destination runtime. UI, keyboard, Actions and MCP share
the semantic eligibility route. Context-dependent pass-through, adjustment and
blend selections fail closed with the same explicit reason rather than baking
against transparent pixels. Packaged vector/text PSD evidence is recorded in
[Layer finalization vertical slice](LAYER_FINALIZATION_VERTICAL_SLICE.md).

Masks and background-result insertion form the third implemented vertical.
Supported UI, Action and MCP calls share `layer.setMask`; exact GPU edits,
document publication and history are one recoverable pixel mutation. Remove
Background owns one document/renderer-bound task generation, and stale or
canceled inference cannot publish. Raster Apply Mask keeps the layer identity
and unrelated live semantics; non-raster Apply Mask explicitly fails closed
until it can reuse the fresh-destination finalization lifecycle. Packaged debug
and instrumented evidence is recorded in
[Mask and background-removal vertical slice](MASK_AND_BACKGROUND_REMOVAL_VERTICAL_SLICE.md).

Raster paint is the fourth implemented vertical. Brush, Erase, Clone, Healing,
Dodge, Burn, Sponge, Paint Bucket/Clear and raster Gradient retain one opening
document, renderer, selection revision and target matrix. Failed unpublished
GPU edits are compensated or quarantined with their recovery snapshots until a
stateful retry succeeds. Pixel targets use the complete scene transform and
mask targets use the persisted mask transform. Discrete full-surface commands
now live in `RasterPixelCommandService`, leaving continuous stroke work in
`RasterPaintService`. Instrumented and debug packaged browser matrices passed;
manual paint-feel acceptance remains open. See
[Raster paint vertical slice](RASTER_PAINT_VERTICAL_SLICE.md).

Transform and snapping are the fifth implemented vertical. One renderer-bound
session retains immutable source pixels across repeated pointer gestures;
terminal publication carries the admitted document, renderer generation and
selection revision through async restore, CAS, history and compensation.
Group and mask previews live in `AuxiliaryTransformSessionOwner`, with group
scene terms captured once rather than rebuilding documents per pointer frame.
Deterministic per-axis snap latches, analytical long-distance grid snapping,
accepted-frame smart guides and shared bounded edge-pan remove the earlier
self-fighting and centre-rebound routes. Debug and instrumented packaged
acceptance passed; manual feel acceptance and extraction of the remaining React
gesture adapter are explicit follow-ups. See
[Transform and snapping vertical slice](TRANSFORM_AND_SNAPPING_VERTICAL_SLICE.md).

Vector paths and live shapes are the sixth implemented vertical. Every pointer
capture binds document identity and renderer generation; Pen lifetime between
clicks is invalidated on replacement, retained element/layer transforms avoid
canonical document work per frame, and Pixels-mode rasterization validates the
same generation at its terminal hand-off. Preview and cleanup are total,
exception-contained renderer operations. Debug and instrumented packaged
authoring, Pen, geometry/Pixels, native/PSD and repeated hybrid lifecycle gates
passed; owner interaction acceptance remains open. See
[Vector paths and live shapes vertical slice](VECTOR_PATHS_AND_LIVE_SHAPES_VERTICAL_SLICE.md).

Text and Path Text are the seventh implemented vertical. Existing-text entry
waits for exact generation-bound layout without treating pending shaping as an
empty layer; asynchronous layer activation revalidates the document, tool,
renderer, source and click before editing. Path Text targets the clicked native
contour and its stable result references survive Action recording, undo and
playback. Debug packaged Type and Path Text gates passed without page errors.
Text Warp remains S07, owner feel acceptance is open, and the accepted
overlay-local activation adapter must be extracted before adding more text
policy. See
[Text and Path Text vertical slice](TEXT_AND_PATH_TEXT_VERTICAL_SLICE.md).

Warp is the eighth implemented vertical. A renderer-bound lease retains the
immutable source across repeated Warp interactions; pointer previews remain
transient and each accepted gesture rebuilds from the canonical source rather
than repeatedly rasterizing the previous preview. Raster Warp and the hidden
experimental Face Warp route have packaged lifecycle and performance evidence.
Imported Text Warp remains renderable canonical data, but authoring it is not a
current product surface. See [Warp vertical slice](WARP_VERTICAL_SLICE.md).

Adjustment Layers are the ninth implemented vertical. The document owns layer
and attached adjustment stacks, while the Properties panel and renderer are
derived projections. Gesture targets are locked to one exact sub-owner and one
strict complete `adjustment.setSnapshot` command records the terminal change.
Creation, edit/cancel, exact undo/redo, masked duplication, Action recording,
catalog coverage and 4K packaged interaction passed. The final critic reported
no P0/P1; owner visual/feel acceptance and the S13 double-failure resource soak
remain open. See
[Adjustment-layer vertical slice](ADJUSTMENT_LAYER_VERTICAL_SLICE.md).

Layer Styles are the tenth implemented vertical. `LayerNode.styleStack` remains
the sole committed owner; renderer previews are disposable projections bound
to one exact document, layer/effect target, renderer and generation. A local
gesture publishes one strict complete `layer.style.setSnapshot`, while granular
commands share the same canonical validation and no-op rules. Cancel, failure,
lock, supersession, document switch and renderer rebind reset the draft and
clean the admitted renderer. PSD input is normalized at its boundary into the
same finite scalar, contour/gradient and effect-count domain. The final critic
found no P0/P1; packaged interaction, subtarget and PSD roundtrip gates pass.
Owner visual/feel acceptance and S13 resource-failure soak remain open. See
[Layer Style vertical slice](LAYER_STYLE_VERTICAL_SLICE.md).

View and multi-document presentation is the active twelfth vertical. Pan and
zoom now retain one pointer plus the exact opening document/setter owner outside
React; queued frames and terminal gestures cannot cross a tab switch. View,
Space and middle-button pan are history-free, while exact/fit/stepped/rectangle
zoom and both temporary zoom chords share the same document-bound publication.
Panel geometry, first-correct-frame rebind, foreground loss and hidden-document
resource lifetime remain open. See [View and multi-document vertical slice](VIEW_AND_MULTI_DOCUMENT_VERTICAL_SLICE.md).

## Structural baseline still failing

The 2026-09-09 source-structure audit is not green. It reports responsibility
growth in `useLayerDocumentCommands.ts`, `useSelectionSessionController.ts`,
`LayerStyleEditor.tsx`, `WebGpuEngine.ts`, `LightTableEditorOverlay.tsx` and
`LightTableStandaloneApp.tsx`, plus a still-red 1,002-line
`useTransformSessionController.ts`. These are legacy concentration risks, not
failures introduced by the kernel package. The transform hook has lost terminal
publication plus group/mask GPU ownership since its 1,164-line S04 baseline,
but its remaining gesture coordination is still tracked debt. Do not “fix” this by only
raising the baseline. Each relevant hotspot must lose a named responsibility as
its vertical slice migrates.
