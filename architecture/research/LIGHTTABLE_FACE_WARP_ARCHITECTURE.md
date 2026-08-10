# LightTable Face Warp architecture

## Decision

Face Warp is a standalone semantic tool and processing node. It is not a preset
or hidden mode of the freehand Warp brush.

The implementation may reuse the existing GPU displacement-field compositor,
but it must not store face edits as opaque brush strokes. A saved face edit must
remain inspectable and editable as face parameters.

## User model

Selecting Face Warp starts lazy face analysis for the active editable raster
layer. Locked layers are rejected. Analysis runs once for a stable source
revision and is reused while parameters are edited.

The first release exposes the common, high-value controls:

- Face: width, forehead and jaw
- Eyes: size, width, height, tilt and spacing, linked by default
- Nose: width and height
- Mouth: smile, width, height, upper lip and lower lip

The canvas shows GPU overlay handles for the selected face. Multiple detected
faces are identified independently. Parameter changes update the preview without
rerunning face detection.

## Canonical document representation

`lt.face-warp` is a source-geometry processing node with:

- a versioned semantic parameter set;
- stable face ids;
- a normalized landmark snapshot in layer-source space;
- the source content revision used for detection;
- detector identity/version metadata;
- no baked bitmap and no generated freehand Warp strokes.

Landmarks are persisted because reopening a document must not change its result
when a detector model is updated or unavailable. Redetection is an explicit
operation.

## Runtime boundary

The detector is a lazy worker service behind a small application port. It
receives a bounded, color-managed preview and returns normalized landmarks. It
is not allowed to own document state, history, rendering, or UI.

Face parameters and landmarks are compiled deterministically into deformation
constraints. The shared GPU deformation runtime consumes those constraints and
builds the displacement field. Ordinary Warp continues to compile brush strokes
into the same runtime. This shares the expensive mechanism while keeping both
authoring models clean.

No full-resolution CPU/GPU round-trip occurs for slider changes. Detection may
use one cached preview readback when no CPU preview is already available.

## Performance contract

- Detector/model code and memory stay unloaded until Face Warp is selected.
- Detection is cancelled or superseded when layer/source identity changes.
- Slider and handle previews never wait for the detector after landmarks exist.
- Only the affected processing node, styled bounds and overlay become dirty.
- Pointer interaction uses provisional GPU updates; pointer-up creates one
  history entry and schedules the exact-quality field.

## Detector choice gate

MediaPipe Face Landmarker is the leading web/desktop candidate because it runs
on-device and supplies a dense face mesh. Before it is bundled, LightTable must
verify the package, WASM and model-asset licenses, add the required third-party
notice, verify whether metrics can be disabled, and validate offline desktop and
web builds. The processing architecture must remain detector-agnostic.

## Delivery sequence

1. Semantic model, validator and deterministic landmark-to-constraint compiler.
2. Standalone tool registration, icon, options panel, history and overlay state.
3. Lazy detector worker and bounded-preview bridge.
4. GPU constraint renderer and interactive handles.
5. Multi-face, cancellation, memory, visual and round-trip tests.

Task 118 is complete only when a user can detect a face, edit it, undo/redo it,
save/reopen it, and obtain the same rendered result without a network request.
