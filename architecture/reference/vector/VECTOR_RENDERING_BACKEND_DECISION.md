# Vector rendering backend decision

Status: accepted direction; initial fill backend implemented.

## Boundary

`vector-core` owns serializable paths and exact editing geometry.
`vector-rendering` owns immutable document-space realization, revision keys and
backend-neutral caches. A WebGPU backend owns buffers, textures, pipelines and
command encoding. React, Electron and viewport state stay outside all three.

## Implemented first route

The first backend uses adaptive cubic flattening followed by signed triangle
fans and stencil-then-cover rasterization into a document-space premultiplied
linear-sRGB texture. It supports nonzero and even-odd fill rules without making
triangulation the authority for concavity, holes or self-intersection.

GPU pipelines are compiled lazily per target format. Flattened geometry is
cached by the backend-neutral realization revision key under a bounded byte
budget. Per-draw uniforms live until the containing command buffers have been
submitted; hosts must call `notifySubmitted()` immediately after
`queue.submit(...)` so those transient buffers are retired safely.

Use adaptive cubic flattening followed by a robust fill/stroke realization and
WebGPU rasterization into a document-space premultiplied linear-sRGB texture.
Cache by stable path ID, geometry/style revision and quantized document-space
tolerance. Pan never invalidates it. Zoom may request another bounded tolerance
bucket, while interaction can temporarily reuse the nearest cached bucket.

Do not use SVG or Canvas as rendering authority. Do not store GPU resources in a
document. Do not make viewport pixels the canonical geometry space.

## Why this route

- Lyon demonstrates the useful separation between path events, flattening,
  tessellation and a backend-specific geometry builder.
- Skia attaches cached derived data to non-volatile paths; LightTable expresses
  the same idea explicitly through stable IDs and revisions.
- Vello proves compute-centric WebGPU-class rendering is viable, but its own
  documentation still calls out alpha-stage renderer and memory-management
  concerns. Adopting that complexity before LightTable's path editing and cache
  contracts are stable would be premature.
- Stencil-then-cover is a strong future benchmark for complex/self-intersecting
  fills. The backend contract must allow it without changing document or tool
  models.

## References reviewed

- Lyon `FillTessellator` and tessellator architecture:
  https://docs.rs/lyon_tessellation/latest/lyon_tessellation/struct.FillTessellator.html
- Skia `SkPath` caching/non-volatile behavior:
  https://api.skia.org/classSkPath.html
- Vello GPU renderer and architecture:
  https://github.com/linebender/vello
- NVIDIA stencil-then-cover paper:
  https://developer.nvidia.com/gpu-accelerated-path-rendering

These are algorithm and architecture references, not copied production code.
Any future dependency needs a separate benchmark and license decision.

## Acceptance constraints

- Nonzero and even-odd fills, holes, concavity and self-intersection have tests.
- Caps, joins, miter limit and dashes have tests before stroke is called done.
- Every backend resource has deterministic disposal and an estimated byte cost.
- Stale worker/backend results cannot replace newer revisions.
- One edit gesture commits one document transaction and one undo entry.
- Web and desktop run the same core and backend implementation.

## Still required before production vector fills

- Browser/device validation fixtures for concavity, holes, both fill rules and
  self-intersection.
- Bounded tile/cover rectangles instead of a full-target cover pass.
- Stroke realization including caps, joins, miter limits and dashes.
- Device-loss recovery and integration into LightTable's shared render graph.
