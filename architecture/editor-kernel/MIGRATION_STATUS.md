# Editor kernel migration status

Updated: 2026-09-08.

| Domain | Legacy | Kernel contract | Kernel route | Real-app proof | Legacy removed |
| --- | --- | --- | --- | --- | --- |
| shared identities and lifecycle | n/a | partial | n/a | n/a | n/a |
| selection/marquee vertical | fallback retained | implemented | shape/move/nudge/paint/rebind | packaged automated | no |
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
selection-paint terminal commits, undo/redo and exact document rebind. Copy,
Copy Merged and raster paint consume a revision-bound selection lease.

The current owners, implemented shape path and remaining gates are recorded in
[Selection and marquee vertical slice](SELECTION_VERTICAL_SLICE.md). Its
authority inventory, renderer staging, state/history adapters and consumer
leases are implemented. A packaged WebGPU smoke proves four-edge excursions
and return, nudge, selection paint, paint clipping, exact Copy bounds,
undo/redo and tab rebind. Rectangle, ellipse, free and polygon UI paths have
packaged coverage; unit tests cover combine modes and failure rollback.

The legacy fallback remains until owner visual/interaction acceptance. The
next decision is whether this slice feels correct in a manual editor run. Do
not begin a second domain migration or delete the fallback before that gate.

## Structural baseline still failing

The 2026-09-08 source-structure audit is not green. It reports responsibility
growth in `useLayerDocumentCommands.ts`, `useSelectionSessionController.ts`,
`LayerStyleEditor.tsx`, `LightTableEditorOverlay.tsx` and
`LightTableStandaloneApp.tsx`, plus an unreviewed 1,260-line
`useTransformSessionController.ts`. These are existing legacy concentration
risks, not failures introduced by the kernel package. Do not “fix” this by only
raising the baseline. Each relevant hotspot must lose a named responsibility as
its vertical slice migrates.
