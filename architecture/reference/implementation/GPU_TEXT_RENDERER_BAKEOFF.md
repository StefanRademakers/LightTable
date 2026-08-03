# GPU text renderer bakeoff decision

Status: Slice 07 implementation decision, 2026-08-03.

## Decision

| Route | Decision | Intended role |
| --- | --- | --- |
| Hinted R8 coverage atlas | **GO** | Default live renderer for small and normal text |
| HarfBuzz `hb-gpu` outline shader | **CONDITIONAL GO** | Optional extreme-zoom/direct-fidelity route after cross-device evidence |
| `hb-gpu` as the only renderer | **NO-GO** | It is experimental and does not implement font hinting |
| MSDF | **NO-GO for now** | Reconsider only if later measurements beat the two implemented routes |

The production default remains hinted coverage. Slice 08 may productize only
that route. It must not silently enable `hb-gpu`; the latter remains an
isolated diagnostic prototype until its runtime encoder, quality and device
matrix have separate evidence.

## Implemented evidence seam

`@lighttable/text-rendering` owns bounded, platform-neutral atlas packing,
hb-gpu blob validation, quality comparison and decision contracts.
`@lighttable/text-webgpu` owns two disposable offscreen `rgba8unorm`
prototypes. Neither package imports the document canvas or compositor.

The development-only Debug action reuses realized Parley glyph order and
positions for eight fixed script cases, each at 12 px, 24 px, 96 px, 192 px
and a rotated/sheared 48 px case. It reports cold preparation,
completed-frame wall time, source upload bytes, widened/padded bytes, estimated
VRAM, batches, alpha error and capture hashes. The report deliberately calls
this wall time rather than GPU time because the shared device does not request
`timestamp-query`.

The fixed encoder corpus is generated from HarfBuzz commit
`c31bd6797a0e55c2b176a7be3a181f36814ec6aa`. Its RGBA16I source blobs use 8
bytes per texel and widen to `vec4<i32>` storage at 16 bytes per texel. CPU
validation checks band headers, offsets, curve references, shader-loop counts,
per-glyph texels and total bytes before every upload. Shader compilation,
entry points, vertex ABI and pipelines run inside WebGPU validation scopes.

## Performance and quality interpretation

R8 is hinted at the target ppem in the persistent Rust/WASM worker, uploads one
byte per atlas texel and draws one instanced batch in the prototype. This is
the correct baseline for UI-sized text. Its scale buckets, eviction and device
loss behavior belong to Slice 08.

hb-gpu keeps scale-independent outline data and therefore remains interesting
at extreme zoom and arbitrary transforms. It pays twice the source blob size
after widening, performs curve loops per fragment, and currently has no
hinting. A measured alpha difference above the provisional 0.02 mean threshold
keeps it conditional; passing on one adapter is not permission to ship it.

## Hardware status

The development machine exposes NVIDIA RTX 5090 and Intel integrated hardware,
but the automated browser surface did not expose a runnable WebGPU page during
this slice. AMD and integrated Mac hardware were unavailable. Consequently no
vendor is recorded as runtime-tested in the committed decision. The Debug JSON
report is the reproducible capture seam for filling this matrix; unavailable
platforms are never reported as passes.

## Distribution boundary

Fonts, `.lt-hbgpu` bundles, manifests and captures are test/development assets.
Production web and Electron builds must contain the lazy text worker and WASM,
but must reject all renderer-bakeoff fixtures. The generated pinned WGSL and
runtime prototype code may ship only if reachable from production code; the
Debug loader itself is removed by the production build.
