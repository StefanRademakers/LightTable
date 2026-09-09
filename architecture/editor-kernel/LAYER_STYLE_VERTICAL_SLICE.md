# Layer Style vertical slice

Status: **automated and critic gates passed; owner acceptance open**.

Baseline: `bd768bfe` (`stabilize adjustment layer transaction lifecycle`).

## Artist-visible scope

- open the complete Effects stack or one child effect from Layers;
- add, edit, enable, reset, reorder and remove all ten Layer Style kinds;
- live preview without publishing pointer-rate React/document/history state;
- one terminal commit or complete cancel per interaction;
- exact undo/redo and Action/MCP replay;
- duplicate, rasterize, merge, flatten, save/open and renderer rebind;
- bounded interactive GPU quality, caches and resource disposal.

## Current authority map

| Concern | Current owner | Required owner |
| --- | --- | --- |
| committed stack, order, ids and settings | `LayerNode.styleStack` | unchanged canonical document owner |
| editor draft and control selection | `LayerStyleEditor` React state | UI-only draft/presentation |
| interaction transaction | `layerStyleInteractionSession` admitted by `useLayerStyleEditorController` | one exact document/layer/effect/renderer-generation application session |
| pointer preview | renderer-only document projection | disposable, newest-only projection on the admitted renderer |
| Action projection | one `layer.style.setSnapshot` observation per committed gesture | exact complete terminal snapshot |
| external semantic mutation | snapshot plus granular `layer.style.*` / `layer.effect.*` commands | shared strict canonical domain, validation and no-op semantics |
| evaluated pixels and quality | `LayerStyleRenderer` and `LayerStyleTextureStore` | unchanged retained renderer/resource owner |
| undo/redo | `DocumentMutationController` | one document-scoped terminal checkpoint |

## Proven opening state

The packaged PSD interaction baseline passes after replacing a stale CSS
selector in the audit with the user-facing role/name. It records 120 native
input events over 1.29 seconds, 22 submitted frames (17.0 Hz), no long tasks or
renderer errors, one `layer.effect.update` Action step and exact undo/playback.
The current hot path therefore meets its cadence budget and must not be
replaced by pointer-rate canonical or React publication.

Those opening gaps are closed. The session captures the exact document,
layer/effect target, renderer object and renderer generation. Rebind,
supersession, stale target, failure, lock, cancel and unmount all terminate the
admitted session and reset UI draft state. Locked owners fail closed and do not
mount an editable panel. Complete snapshots are exact-shape parsed, property
order independent and bounded; granular mutations use the same canonical
validator and do not publish revision/history on semantic no-ops. PSD import
normalizes non-finite values, contour/gradient collection bounds and the
64-effect maximum before a final `parseLayerStyleStack` assertion.

## Target route

```text
Layers / Properties control
  -> exact document + layer + presentation target + renderer session
  -> newest-only renderer document preview
  -> one strict complete LayerStyleStack terminal checkpoint
  -> canonical document publication + one history entry
  -> one layer.style.setSnapshot Action observation

Action / MCP layer.style.setSnapshot
  -> the same strict complete stack codec
  -> the same canonical document mutation service
```

Granular add/update/remove/move/toggle commands remain supported semantic
operations; they must use the same strict value constraints and may not become
a second interactive session owner.

## Performance and resource invariants

- control drafts update at native input rate;
- only the newest complete preview is published at the existing 33/100 ms
  document-size cadence and pointer-up flushes the exact final value;
- previews do not publish canonical React state or history;
- the exact renderer that entered interactive quality is the renderer that
  leaves it on commit, cancel, supersession, rebind or unmount;
- retained style, blur, bevel and effect-field caches remain renderer-owned,
  ROI/bounded and submit-fenced;
- one local gesture creates zero history/Action entries when cancelled and one
  of each when committed.

## Acceptance gates

- [x] generation/renderer-bound session and failure tests;
- [x] strict complete snapshot codec and semantic command parity;
- [x] all ten effect kinds and stack operations;
- [x] exact cancel, undo/redo, Action playback and external command execution;
- [x] duplicate/rasterize/merge/flatten and save/open/rebind neighbours;
- [x] independent read-only critic and two repair loops; final verdict ACCEPT;
- [x] packaged baseline at no repeatable regression above 10%;
- [ ] owner visual and interaction acceptance.

## Recorded evidence

- app typecheck and boundary verification pass;
- 567 app test files / 3,615 tests pass; command contract 34/34 passes;
- instrumented packaged desktop build passes;
- packaged Layer Style audit: locked owner has zero editors; 120 inputs over
  1,356 ms; 22 submitted frames (16.22 Hz); zero long tasks/page/renderer
  errors; exactly one 3,918-byte `layer.style.setSnapshot`; 30 -> 248 -> undo
  -> replay 248;
- packaged layer-subtarget smoke and Photoshop drop-shadow PSD roundtrip pass;
- source-structure remains red on legacy hotspots. `LayerStyleEditor.tsx` is a
  1,027-line presentation hotspot, but no longer owns transaction/history
  publication. Decompose it only by UI responsibility; do not put authority
  back into it.

P2 follow-up, not an S09 safety blocker: external granular no-ops currently
surface as `execution-failed` instead of successful `changed:false`; excess PSD
effects are preserved in normalized form rather than as raw descriptors; one
obsolete add-effect callback dependency can be removed during adjacent wiring
cleanup. S13 still owns durable double-failure/GPU-loss soak.
