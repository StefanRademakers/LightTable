# Text and Path Text Vertical Slice

Status: kernel cut-over accepted (C07); owner feel acceptance and the C08 Warp
hand-off remain open.

## Artist contract

- A visible editable text layer can be entered with the Type tool even while its
  renderer layout is still being prepared. A click may wait for exact hit-test
  geometry; it must not create an accidental second text layer.
- Point, paragraph and vertical text remain semantic until an explicit
  convert-to-shape, rasterize, merge or flatten command.
- Path Text binds to the native contour under the cursor. A retained explicit
  path selection is only the fallback when the cursor does not hit a contour.
- Transform waits for current text measurement. It never reports an empty layer
  merely because shaping was still in flight.
- Typing, IME and formatting publish live renderer projections but create one
  reversible history unit per explicit edit group. Renderer work never becomes
  canonical document state.
- Document switch, renderer replacement, font-runtime replacement, cancel and
  unmount invalidate pending activation/conversion work.
- Document activation and active-document close first commit the current
  typing/IME group. A rejected terminal blocks the transition; observed
  external replacement resets editing fail-closed.
- Text warp belongs to S07. S06 proves only the hand-off and preserves semantic
  text; it does not add another warp preview owner.

## Ownership map

| Concern | Canonical owner | Projection/session owner |
| --- | --- | --- |
| Text content, runs, layout mode and path references | `ImageDocument` text layer | none |
| Typing/IME edit grouping | `FlowTextEditingSessionController` + `textEditTransactionController` | `TextInputBridge` |
| Glyph layout and GPU source | none | `TextLayerRenderCoordinator` |
| Caret/selection overlay | editing controller selection | `FlowTextEditingRuntime` |
| Existing-text click waiting and edit activation | none | `ExistingTextHitController` + `ExistingTextActivationController` |
| Path Text target | stable layer/element/subpath ids in document | cursor hit projection, selection fallback |
| Text transform | document mutation transaction | transform semantic preview |
| Convert/rasterize | registered document command | renderer final-output source lease |

## Current route

1. The Type tool asks `ExistingTextHitController` for an exact renderer-layout
   hit. If layout is absent but shared document geometry contains the click, the
   controller retains the intent while `TextLayerRenderCoordinator` finishes.
2. The pending result is admitted only if its activation revision, document,
   active tool, renderer object/generation and text source still match. After an
   asynchronous layer selection it obtains the current exact layout and repeats
   the original hit-test before the editing controller may begin.
3. Path Text first exact-hit-tests visible native vector paths at the cursor and
   records stable path ids. It falls back to the retained explicit selection.
4. Semantic transform awaits current editing layout before measuring bounds and
   then uses the existing transform publication owner.
5. Convert-to-shape and rasterize request current renderer output and commit via
   the existing registered command/document transaction paths.

## Structural limits

- `LightTableEditorOverlay.tsx` wires ports only. New text policy belongs in a
  controller/query module and may not be added as another overlay-local state
  machine.
- `TextLayerRenderCoordinator.ts` is already a legacy hotspot. S06 may add a
  narrow generation-safe query but no new tool policy. Its required follow-up
  decomposition boundaries are: scheduling/session, layout preparation, source
  realization, and telemetry.
- Text commands may depend on renderer ports for derived output, never on React
  state or component lifetime.
- ExistingTextActivationController owns candidate ordering, scoped post-hit
  selection/rehit and editing-selection entry. useExistingTextActivation binds
  cancellation to document/tool/renderer generation and unmount. Genuine current
  layout/selection failures are reported; retired requests cannot publish UI.
  TextCreationInteraction owns point/paragraph/path draft/readiness lifetime and
  captured authoring intent; useTextCreation retires on tool/document/renderer/
  font registry replacement. Preparation never configures a successor renderer.
  Both awaited preparation and its continuation reject and retire stale drafts.
  TextEditingEntry owns current-font gating and scoped layer/recovery entry;
  TextPointerRouter owns pointer precedence and deferred miss routing, not
  gesture state. Existing handle/selection/draft controllers keep their lifetime.
  Remaining controller construction/presentation cleanup follows Task416;
  do not add policy to the Overlay.

## Acceptance matrix

- Point click/create/edit, paragraph drag/create/edit and vertical create/edit.
- Re-enter visible text immediately after creation and after reopen.
- Transform immediately after creation/reopen without an intermittent
  “no measurable content” failure.
- Path Text by direct contour click, path edit propagation, undo/redo and Action
  replay.
- Formatting/IME edit grouping, cancel/checkpoint and document switch.
- Convert to shape and rasterize retain placement/pixels and undo/redo.
- Missing-font recovery and derived-preview behavior remain explicit.
- Debug and instrumented packaged browser runs report no page errors or stale
  publication after document/renderer replacement.

## Verification loop

1. Focused text, path dependency, transform and finalization tests.
2. Independent read-only architecture critic.
3. At most two evidence-backed repair passes.
4. Packaged Type and Path Text browser acceptance with generated fixtures.
5. Relevant boundary/typecheck suite; full verification at the slice checkpoint.

## Delivered fixes

- Existing-text click/drag intent is buffered while exact shaping is pending and
  is canceled on tool, document or renderer replacement.
- Retained interaction layouts preserve their original preparation key. A
  transformed layer can therefore never expose old glyph geometry as current.
- Semantic text transforms wait for a generation-bound exact layout instead of
  interpreting in-flight shaping as “no measurable content”.
- Path Text resolves the native contour under the pointer before considering an
  explicit-selection fallback and records stable layer/element/subpath ids.
- Pen commit publishes its Action result from the admitted vector transaction,
  not from a later React document projection.
- Ancestor-hidden or effectively transparent text is excluded from edit hits.
- Direct overlay text creation and text-owned document/history publishers were
  removed. Semantic commands, typing, property gestures and font recovery use
  the shared document transaction owner.
- Property and typing previews stage every input but project at most once per
  animation frame. Caret and input presentation require the exact document id.

## Acceptance evidence

- App typecheck passed.
- The C07 focused text/layout/command/transform set passed 346 tests.
- Independent architecture review completed its repair loop and returned
  `ACCEPT` with no P0/P1. The overlay adapter extraction above is the sole
  nonblocking P2.
- Instrumented packaged Type Tool acceptance passed point, paragraph and vertical text,
  re-entry after semantic transform, repeated transforms and history. The
  measured interaction sample was 21.2 ms input-to-submit and 30.2 ms
  input-to-GPU, with no page errors.
- Debug packaged Path Text acceptance passed direct contour targeting, semantic
  Action recording, two undo operations and Action playback back to a
  path-bound text layer.
- Windows system-font authoring passed across 460 discovered faces, and the
  packaged missing-font recovery gate passed.
- Full `npm run verify` passed: boundaries, every workspace typecheck/test,
  web build and instrumented desktop packaging.
- `audit:source-structure` remains red on the registered legacy hotspots,
  including the overlay and `WebGpuEngine`; no threshold was raised. The S06
  overlay extraction above remains mandatory debt.
