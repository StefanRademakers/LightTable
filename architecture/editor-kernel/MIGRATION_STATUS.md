# Editor kernel migration status

Updated: 2026-09-08.

| Domain | Legacy | Kernel contract | Kernel route | Real-app proof | Legacy removed |
| --- | --- | --- | --- | --- | --- |
| shared identities and lifecycle | n/a | partial | n/a | n/a | n/a |
| selection/marquee vertical | yes | implemented | shape commit | no | no |
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

## Next decision slice

Build the selection/marquee vertical as the first proof. Before implementation,
inventory the current selection mutations and identify the one canonical mask
store, renderer projection adapter and history payload. If that cannot be done
without mixed legacy/kernel ownership, stop and revise the boundary rather than
adding another bridge.

The current owners, implemented shape path and remaining gates are recorded in
[Selection and marquee vertical slice](SELECTION_VERTICAL_SLICE.md). Its
authority inventory, renderer staging, state/history adapters, shape command
route and first copy/paint leases are implemented. Move/nudge, draft projection,
renderer-side consumer assertions, rebind and real-app proof remain open.

## Structural baseline still failing

The 2026-09-08 source-structure audit is not green. It reports responsibility
growth in `useLayerDocumentCommands.ts`, `useSelectionSessionController.ts`,
`LayerStyleEditor.tsx`, `LightTableEditorOverlay.tsx` and
`LightTableStandaloneApp.tsx`, plus an unreviewed 1,260-line
`useTransformSessionController.ts`. These are existing legacy concentration
risks, not failures introduced by the kernel package. Do not “fix” this by only
raising the baseline. Each relevant hotspot must lose a named responsibility as
its vertical slice migrates.
