# Task 114 result — GPU Magic Wand

## Delivered

- Magic Wand is a native member of the existing selection-tool flyout.
- `W` activates Magic Wand. Warp deliberately has no shortcut.
- Shared toolbar controls expose Point/3/5/11/31/51/101 sampling, tolerance
  0–255, anti-alias, contiguous and Sample All Layers.
- New, Add, Subtract and Intersect reuse the canonical selection-combine pass.
- Selection-only undo/redo stores replayable Magic Wand operations.
- Active-layer sampling uses the normal isolated-layer compositor; Sample All
  Layers uses the settled visible document composite.
- Sampling, candidate classification, 4-connected component labeling,
  localized fractional edge coverage and mask combination remain GPU-side.
  No full-resolution CPU image readback or mask upload is used.
- Size-dependent label storage is pooled. Tool activation prewarms isolated
  1×1 GPU resources so Dawn's lazy shader compilation does not delay the first
  document click or mutate selection/document state.
- Newest-result publication and tool-switch cancellation prevent stale work
  from replacing a newer selection; cancellation queues restoration of the
  authoritative selection snapshot.

## Architecture

The route stays inside existing boundaries:

`tool registry → editor session → selection session/history → WebGpuEngine → LayerDocumentRenderer → SelectionRasterizer → shared selection mask/combine/overlay`

The uncertain Photoshop color-distance behavior is centralized in one WGSL
function with an internal comparator selector. The alpha-aware initial baseline
uses maximum straight-RGBA channel distance in the editor's native linear GPU
source domain. It can be parity-tuned without changing tools, history,
connectivity or masks.

The current connected-component pass uses GPU label relaxation plus path
compression. It is isolated behind the selection rasterizer boundary so a
profiled block-based union-find replacement does not affect product APIs.
Relevant implementation research:

- https://arxiv.org/abs/1708.08180
- https://federicobolelli.it/pub_files/2019iciap_labeling.pdf
- https://pubmed.ncbi.nlm.nih.gov/29994708/

## Measured packaged-desktop results

Synthetic 3840×2160 fixture, after activation-time pipeline prewarm:

- 5×5, non-contiguous: 10.5–18.8 ms GPU-complete.
- 101×101, contiguous across New/Add/Subtract/Intersect: 30.9–41.9 ms
  GPU-complete.
- 1001×598 PSD, contiguous composite sampling: 11.5–13.5 ms GPU-complete.

The Playwright screenshot timing is recorded separately and is not treated as
GPU latency because Electron screenshot capture adds roughly 100 ms or more.

## Regression coverage

- Registry/flyout/shortcut ownership.
- Default document-scoped tool state and all toolbar options.
- Replay, add chaining, undo/redo, newest-result and cancellation restoration.
- Production Dawn validation of every new WGSL pipeline.
- Synthetic disconnected islands: contiguous selects one island;
  non-contiguous selects both.
- Packaged 4K runs, largest sample size, Sample All Layers and every combine
  mode, with page/console/WebGPU errors treated as failures.

## Parity note

The tool is ready for product use. Exact Photoshop tolerance and edge-coverage
matching remains an empirical parity-calibration problem rather than a missing
architecture or execution path. The comparator and AA boundary are deliberately
centralized for that future corpus pass.
