# P0 GPU filters

## Current product slice

LightTable has twelve authored full-frame filters behind one canonical
processing contract:

- Gaussian Blur, Motion Blur and Surface Blur;
- Displace;
- Median and Reduce Noise;
- Smart Sharpen, Unsharp Mask and High Pass;
- Maximum, Minimum and Offset.

Every filter supports the same two current placements. A standalone filter
layer processes the accumulated lower composite and owns a normal layer mask.
An attached filter is an ordered processing node owned by one raster layer and
moves with that layer. Both placements use the same definition, settings,
history, renderer, Properties panel, save/load, rasterize and semantic command
paths. UI, Actions and MCP call `adjustment.create`; they do not maintain
parallel filter implementations.

This is not yet Photoshop's complete Smart Object/Smart Filter model. The
attached stack has no shared Smart Filter mask or embedded-source authority.
PSD export therefore preserves a semantic filter only where an explicit
adapter proves equivalence; otherwise it reports degradation and bakes through
the normal raster/export boundary.

## Package and renderer ownership

```text
@lighttable/filter-core
  definitions, defaults, controls and bounded serializable settings
            |
canonical adjustment/attached-processing stack
            |
LayerCompositor filter stage
            |
P0FilterRenderer
            +-- @lighttable/filter-webgpu reusable GPU cores
            +-- one lazy, document-sized FilterTargetPool (1..3 targets)
            |
normal mask / clipping / opacity / blend / group composition
```

The cores operate on premultiplied linear RGBA16F textures and return an exact
input-texture bypass for neutral or unavailable inputs. They retain pipelines
and uniform buffers, but all P0 cores in one document share one alias-safe
scratch pool. The pool grows lazily to at most three document-sized targets,
does not allocate on warm slider changes and is destroyed by the document
renderer. A reusable core instantiated outside `P0FilterRenderer` may instead
own a private pool.

Displace accepts only a canonical raster layer ID in the same document. It
does not fetch URLs or host paths. A missing or null map is an exact bypass.
Surface Blur and Median use bounded schedules rather than data-dependent or
unbounded shader loops. Reduce Noise reuses retained multiscale wavelet work;
the sharpening family reuses the blur and directional sampling cores.

## Verification boundary

`npm run smoke:desktop:p0-filters` requires a packaged executable through
`LIGHTTABLE_TEST_EXECUTABLE`. It creates and renders every filter through the
public command route and verifies:

- non-neutral settings change the document canvas;
- deleting the filter restores the exact baseline canvas;
- no page, console or WebGPU validation error occurs;
- Displace resolves a real canonical raster map;
- GPU memory stops growing after the shared three-target pool is warm.

Unit gates cover settings schedules, shader packing, target aliasing,
persistence, menu/Properties projection, command schemas, MCP admission and
rasterization. The packaged smoke is a runtime integration gate, not a visual
parity oracle.

## Partial and release gates

Before this slice may be called production-calibrated, it still needs a small
reference corpus with expected images and edge/alpha/HDR cases, large-document
latency measurements, repeated edit/toggle soak and packaged evidence on the
supported NVIDIA, AMD, Intel and Apple GPU matrix. Those gates must tune the
shared implementation; they must not introduce vendor-specific document state
or a second UI/MCP path.

## Adjacent Layer Style reuse pass

Layer Styles remain a different semantic stage: Drop/Inner Shadow and
Outer/Inner Glow derive pixels from layer alpha and compose around the layer;
they are not full-frame filters. Once the P0 visual/performance gates are
stable, review the style renderer for reuse of the proven blur target pool,
bounded blur kernels, warm pipeline ownership, alpha-safe edge sampling and
interactive/final quality scheduling. Reuse GPU primitives where it reduces
work, but preserve Layer Style ordering, Fill-versus-Opacity behavior, style
bounds, contours, spread/choke and PSD mappings. Do not implement a shadow or
glow by inserting a P0 filter node into the document stack.
