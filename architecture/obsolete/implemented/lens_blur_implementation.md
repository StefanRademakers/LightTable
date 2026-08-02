# Lens Blur implementation

The product specification remains in `lens_blur.md`. The implementation is split between:

- `client/src/features/lighttable/analysis/depth`: shared lazy Transformers.js worker, WebGPU then WASM fallback, percentile normalization, cache and focus sampling;
- `client/src/features/lighttable/effects/lensBlur`: recipe settings, float depth upload and WebGPU passes;
- `WebGpuEngine.ts`: the explicit `Creative Grade -> Lens Blur -> Halation -> Output Transform` ordering;
- `LightTableEditorOverlay.tsx`: persisted controls, analysis status and focus picker only. Model/session state does not live in React.

## Analysis lifecycle

Depth Anything V2 Small is loaded only when Lens Blur is enabled. The worker tries WebGPU FP16, WebGPU FP32, WASM Q8 and WASM FP32 in that order. A WebGPU inference failure retries on WASM. The worker and model are shared across overlay sessions, while normalized results are cached for the two most recent source identities. Concurrent requests for the same source share one inference.

The renderer is lazy too: while Lens Blur is off it owns only its small settings buffers. Its pipelines and full/half-resolution render targets are created only after explicit enablement has produced a valid depth map.

The model's relative inverse depth is normalized with sampled 1st/99th percentiles to the invariant `near=1`, `far=0`. Flat maps become the stable middle plane. The full float result remains on the CPU for median focus picking and uploads once as normalized `r16float`; there is no 8-bit depth quantization.

The model and API choices follow the official model card and Transformers.js WebGPU guidance:

- https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX
- https://huggingface.co/docs/transformers.js/en/guides/webgpu

## GPU passes

1. Full-resolution guided depth refinement uses a conservative 5x5 spatial/color weight and samples raw depth through the same Lens Distortion mapping as the image.
2. A 2x2 pass creates half-resolution linear color plus average/min/max depth support.
3. A depth-aware optical gather writes separate foreground-premultiplied and background layers. Both paths use the source sample's own CoC reach. Background samples also reject 2x2 tiles containing materially nearer depth; foreground samples contribute only when their own positive CoC reaches the output pixel. A stable per-pixel rotation removes fixed phyllotaxis structure.
4. Slider and keyboard interaction uses 24 gather samples for immediate feedback. Once the interaction ends, persisted `balanced`, `high` and `ultra` quality settings use 48, 64 and 128 samples respectively; `high` is the default.
5. Full-resolution composite applies far/background blur, then foreground coverage. The selected focus interval remains sharp.

Blur radius scales with output resolution. Round, hexagonal, anamorphic and donut settings alter the aperture kernel. Cat Eye deforms the kernel radially toward frame edges. Bokeh Boost changes only bright gathered samples and normalizes their weights.

## UI and failure behavior

The eye switch persists `settings.effects.lensBlur.enabled`; disabled or zero Amount is a true render bypass and does not discard cached analysis. Focus Range is stored as a normalized interval. Pick Focus maps the click through Lens Distortion, takes a 7x7 median from CPU depth and preserves the current band width. Depth visualization shows near white/far black without downstream finishing effects.

Inference status and download progress stay inside the Lens Blur panel. The `48`, `64` and `128` quality selector persists the final gather sample count; slider movement temporarily uses 24 samples and releases into the selected final quality. The panel also reports the actual model depth-map dimensions. If all backends fail, only Lens Blur switches off; LightTable and its current image remain operational. Person autofocus is intentionally absent because the app has no reliable subject mask and the specification forbids pretending centre focus is subject detection.

## Release validation

Unit coverage protects normalization, orientation, focus/CoC direction, float-depth encoding, recipe restoration, bypass predicates and shader structure. Before declaring the effect release-ready, visually check portrait hair, foreground crossings, point lights, near foreground blur, flat walls and wide images on a real WebGPU device plus one forced WASM inference run.
