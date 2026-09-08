# Editor kernel migration status

Updated: 2026-09-08.

The ordered, checkable work queue and the mandatory critic/repair/real-app loop
live in the [stabilization execution ledger](STABILIZATION_EXECUTION_LEDGER.md).
This status file remains the compact statement of what is actually migrated.

| Domain | Legacy | Kernel contract | Kernel route | Real-app proof | Legacy removed |
| --- | --- | --- | --- | --- | --- |
| shared identities and lifecycle | n/a | partial | n/a | n/a | n/a |
| selection/marquee vertical | fallback retained outside migrated routes | implemented | shape/move/nudge/paint/Magic Wand/Object Selection/rebind | packaged automated | partial |
| transform and snapping | yes | documented | no | no | no |
| rasterize/merge/flatten | yes | documented | no | no | no |
| text/path text/warp | yes | documented | no | no | no |
| adjustments/effects/filters | yes | documented | no | no | no |
| open/render/save/recovery | yes | documented | no | no | no |
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

## Structural baseline still failing

The 2026-09-08 source-structure audit is not green. It reports responsibility
growth in `useLayerDocumentCommands.ts`, `useSelectionSessionController.ts`,
`LayerStyleEditor.tsx`, `LightTableEditorOverlay.tsx` and
`LightTableStandaloneApp.tsx`, plus an unreviewed 1,260-line
`useTransformSessionController.ts`. These are existing legacy concentration
risks, not failures introduced by the kernel package. Do not “fix” this by only
raising the baseline. Each relevant hotspot must lose a named responsibility as
its vertical slice migrates.
