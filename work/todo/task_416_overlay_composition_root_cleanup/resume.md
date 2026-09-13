# Task 416 current checkpoint — O08 accepted 2026-09-13

The Overlay composition-root milestone is complete and verified. Preserve
unrelated untracked `work/recovered/`.

## Accepted endpoint

- `LightTableEditorOverlay.tsx` is the React composition root: UI-local state,
  owner construction, explicit ports/subscriptions and view assembly.
- Document-open ordering, mounted command admission/families, history navigation,
  active-layer and mounted-interaction settlement, fixed-transform completion,
  processing settlement/observation, layer-panel/selection intents, viewport zoom
  and text/rendering lifetimes have named owners outside the root.
- No legacy fallback, catch-and-continue, shadow route or optional mutation path
  was added. Boundary checks prevent the removed authorities from returning.
- Overlay is 4,456 physical lines (from 9,090 at the Task416 baseline; 4,841 at
  the previous checkpoint). The audit ceiling is 4,456. WebGpuEngine remains
  approximately 4,003 lines and is explicitly O09, not part of this acceptance.

## Final proof

- Independent architecture critic: ACCEPT after two focused repair rounds.
- App typecheck, boundary/source-structure/diff checks pass.
- Focused changed-owner tests: 95 tests across 8 files pass.
- Fresh instrumented desktop package, distribution and render-telemetry gates pass.
- Packaged flows pass: selection kernel, transform kernel, processing rebind,
  scopes focus/workspace wake, Type Tool, tight merge, rasterize affordance with
  local Grade/effects, and pasted transform -> Exposure -> paint -> exact
  undo/redo.
- Twenty typed document switches: 67 ms median, 75 ms maximum, zero DOM node
  growth and zero listener tail/overall growth.

## Next

Commit/push this cohesive O08 endpoint. Then perform owner manual visual/feel
testing. Treat any defect as a bug in its named owner; do not restore root policy
or fallback code. If further structural work is desired, begin the separately
scoped O09 WebGpuEngine inventory—do not reopen Task416 by default.
