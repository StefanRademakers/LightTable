# LightTable smart object selection architecture

Status: active implementation, 2026-08-10.

## Product boundary

Object Selection is a normal selection producer. The inference backend may
prepare an image and return candidate alpha masks, but it does not own boolean
selection operations, marching ants, selection history or document commands.
The existing GPU selection engine remains authoritative for replace, add,
subtract and intersect.

The UI depends only on `SmartSelectionBackend`. Tensor shapes, model ids and
runtime fallback stay inside a backend adapter/worker. This allows a future
SAM 2.1, smaller mobile model or optional server backend to replace SlimSAM
without changing tool interaction or the selection model.

## Data flow

```text
document or active-layer GPU result
  -> one bounded PNG readback per visual revision
  -> lazy worker image encoder
  -> prepared source keyed by document/layer revision
  -> point or box prompt decoder
  -> document-sized Uint8 alpha candidate
  -> SelectionRasterizer GPU upload
  -> existing New/Add/Subtract/Intersect mask compositor
```

Inference therefore does not create a second mask compositor. Raster masks are
immutable and shared by reference across selection-only undo snapshots; undo
does not duplicate a full mask for every history entry.

## Shared inference lifecycle

`WorkerInferenceClient` owns the common lazy-worker concerns already needed by
Depth Anything and future model-backed features: request correlation, progress
fan-out, shared in-flight work, bounded result caching, failure teardown and
dispose. Depth now uses this component. Multi-stage promptable segmentation
retains a dedicated protocol because prepared embeddings outlive individual
prompt requests, but follows the same lifecycle policy.

Face Warp continues to use MediaPipe's dedicated runtime because landmark
tracking and promptable segmentation are not the same inference contract. It
shares revision/cancellation principles, not model-specific plumbing.

## Current prototype backend

The first adapter uses `Xenova/slimsam-77-uniform` through Transformers.js.
The model is Apache-2.0 licensed and remains lazy/optional. A practical Node
WASM/CPU probe on the documented 614 x 410 corgi image completed with:

- model/runtime load: about 1.56 s with a warm package cache;
- one image encode: about 1.40 s;
- one point prompt decode and full-size post-process: about 105 ms;
- three valid 410 x 614 candidate masks, best predicted IoU about 0.967.

These numbers prove API/operator compatibility only. Electron WebGPU latency,
GPU memory coexistence with the compositor, hover stability and quality corpus
gates must pass before the tool is called release-ready.

A second practical probe on a 1920 x 1080 LightTable test image, using the
current nine-prompt Select Subject proposal pass, measured about 0.40 s warm
runtime load, 1.00 s encode and 0.66 s for 27 decoded candidates on CPU q8.
The proposal rank combines predicted IoU with conservative area, center and
border-contact priors. It is genuine distributed object proposal, not a hidden
center click, but it remains a v1 dominant-subject heuristic rather than a
semantic subject detector. The backend contract permits replacing it without
changing the tool or selection engine.

## Cache and invalidation policy

- Keep one prepared visual source initially.
- Include document revision, active layer identity when applicable,
  Sample-All-Layers mode and model identity in the source key.
- A newer prepare or prompt generation invalidates older results.
- Never replace a useful hover preview merely because a newer request is
  pending.
- Switching document, changing sampled pixels or leaving the tool invalidates
  the relevant source.

## Implemented integration

- The Photoshop-compatible W group contains Object Selection and Magic Wand.
- Object Finder, rectangle and lasso prompts share one controller and backend.
- Sample All Layers exports the composite; otherwise only the active subtree
  and transform-bearing ancestors are sampled, without mutating visibility.
- Hover is debounced, supersedable and drawn by one transient WebGPU overlay.
- New/Add/Subtract/Intersect and undo use the normal raster-selection path.
- Select Subject uses distributed cached-embedding proposals and one commit.
- Concurrent preparation is coalesced and stale document revisions are rejected.

## Remaining release-quality gates

1. Measure Electron WebGPU and WASM fallback cold/warm latency, compositor GPU
   memory coexistence and repeated document-switch cleanup on target hardware.
2. Run a labelled visual corpus for people, isolated products, crowded scenes,
   transparent objects, hair and low-contrast boundaries.
3. Compare the current PNG source export with a measured direct GPU-source path;
   only replace it if the transfer/complexity trade-off is demonstrably better.
4. Supply a dedicated Object Selection icon in the established icon language.
5. Add the separate refine-selection workflow; it is not faked inside this tool.

## References

- Transformers.js WebGPU guide: https://huggingface.co/docs/transformers.js/guides/webgpu
- SlimSAM Transformers.js model: https://huggingface.co/Xenova/slimsam-77-uniform
- Meta SAM 2 repository and Apache-2.0 license: https://github.com/facebookresearch/sam2
