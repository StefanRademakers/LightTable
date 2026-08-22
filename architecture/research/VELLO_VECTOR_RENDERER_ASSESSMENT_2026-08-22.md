# Vello vector renderer assessment

Date: 2026-08-22
Reference checkout: `.referenceCode/vello`, upstream commit
`3fabef9315914fc2fa32eed12afac8922785396b`

## Decision

Use Vello as an architecture and algorithm reference, not as a direct
LightTable runtime dependency yet.

LightTable should keep its canonical, format-neutral editable vector model and
derive a packed renderer scene from it. The next renderer generation should
adopt Vello's strongest ideas—linear scene encoding, bulk resource upload,
tiling/binning and bounded coarse/fine raster work—behind the existing
document/render contract. It must not introduce a second document authority or
a separate SVG rendering path.

Direct integration is currently too risky:

- Vello Classic identifies itself as alpha and still lists rendering
  artifacts and GPU memory allocation among its open boundaries.
- The web is not Vello Classic's primary target. A Rust/wgpu renderer would
  not naturally share LightTable's existing JavaScript WebGPU device and
  document-scoped texture graph.
- Vello Sparse Strips is explicitly under active development and not yet
  suitable for production use.
- Vello Hybrid documents unsupported paths that can panic, including mask
  layers and parts of filter/blend handling. LightTable requires fail-safe
  document rendering and explicit device-loss/lifetime ownership.

Vello is dual Apache-2.0/MIT. Any copied or adapted implementation still
requires the normal third-party disclosure and source-level license review.

## What Vello does differently

Vello Classic records a whole scene into compact linear streams for path tags,
path coordinates, draw commands, transforms and styles. Rendering then runs a
bounded sequence of compute stages over the scene:

```text
scene encoding
-> path tag reduction/scan
-> GPU curve flattening and bounds
-> draw/clip reduction
-> binning and tile allocation
-> path counting/tiling
-> coarse commands
-> fine per-tile rasterization
```

The number of GPU stages is principally tied to the renderer pipeline, not to
the number of SVG elements. Work inside stages scales across GPU workgroups.
The current LightTable backend instead realizes each element separately and,
for every fill or stroke, creates/looks up geometry, allocates a uniform,
creates a bind group and encodes a stencil/cover render pass.

Vello's README reports 177 fps for its `paris-30k` best-case scene on an M1
Max at 1600 x 1600. This is useful directional evidence, not a LightTable
performance promise or a cross-hardware benchmark.

The newer Sparse Strips work addresses device compatibility, memory cliffs and
performance cliffs through CPU path processing plus efficient sparse strips,
sorting and GPU compositing. That design is particularly relevant if
LightTable's existing CPU/Wasm curve realization remains preferable to a full
compute renderer.

## Measured LightTable finding

The first VORTEXT investigation initially appeared to indict the renderer:
the 7.2 MB file contains 26,492 editable strokes and produces 1,347,141 stroke
vertices. Packaged cold-open evidence showed 65.6 seconds to the first rendered
document.

A CPU profile proved that the dominant cost was actually SVG traversal:

- about 59 seconds in `@xmldom/xmldom` descendant lookup;
- about 5.9 seconds in garbage collection caused by that work;
- about 0.17 seconds self-time in GPU vertex preparation;
- about 0.15 seconds self-time in vector geometry command encoding.

`preflightReferences` repeatedly called `root.getElementsByTagName('*')` while
constructing its candidate array. The full descendant scan was therefore
recomputed for each descendant, producing quadratic behavior.

Replacing all three descendant queries with one bounded iterative DFS changed
the same packaged evidence as follows:

| Phase | Before | After |
| --- | ---: | ---: |
| First rendered document | 65,592 ms | 3,007 ms |
| Complete smoke and visual evidence | 70,554 ms | 7,970 ms |
| Pan, 24 input steps | 410 ms | 409 ms |
| Pan document composites | 0 | 0 |

The rendered pixel evidence remained identical to the measured baseline.

An attempted renderer fast path that combined opaque strokes into one stencil
union was rejected: it changed antialias/compositing evidence and made the
packaged run slower. A second experiment that kept separate draws but placed
the complete scene in one render pass also regressed the measured cold run.
Neither experiment remains in the product source.

## Recommended renderer evolution

1. Keep phase telemetry for parse, import planning, document publication,
   vector realization, resource upload, command encoding, queue completion and
   preview readback. Optimize the largest owned phase, not total wall time.
2. Introduce a renderer-only packed scene contract keyed by the vector-layer
   and element geometry/style/transform revisions. Canonical document objects
   remain unchanged.
3. Replace one-buffer/one-uniform/one-bind-group-per-draw ownership with bounded
   geometry and settings arenas. Preserve draw order, opacity, gradients,
   fill rules and stroke semantics exactly.
4. Add viewport/document-tile binning so a large scene does not rasterize
   off-target geometry. Presentation pan must continue to reuse the settled
   content texture and trigger zero document composites.
5. Prototype either compute-centric coarse/fine rasterization or sparse-strip
   generation behind the same backend interface. Choose only after VORTEXT,
   the SVG feature corpus, ordinary small documents and integrated-GPU memory
   evidence are compared.
6. Require pixel parity, validation-scope cleanliness, bounded memory,
   cancellation/device-loss safety and native save/reopen before replacing the
   current backend.

The immediate linear traversal fix should ship independently. A renderer
rewrite is justified only for the remaining roughly three-second first-frame
budget and broader complex-scene workloads, not as a substitute for removing
ordinary CPU scale bugs.
