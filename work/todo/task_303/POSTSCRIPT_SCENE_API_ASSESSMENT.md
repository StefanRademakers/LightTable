# PostScript-style scene/API assessment

Recorded: 2026-08-22
Status: architecture input for the Task 303 bake-off, not a frozen API

## Verdict

Vello's PostScript-inspired API is a strong backend and compiler target for
LightTable. It is not sufficient as the canonical document model or as the
lossless source-preservation representation for SVG, PDF-compatible AI, EPS or
PDF.

Use four explicit layers:

1. Source adapter and preservation IR: format-specific bytes, object IDs,
   unsupported operators, color resources, text semantics and round-trip data.
2. Canonical LightTable document: editable paths/live shapes/text/raster/layer
   hierarchy, stable IDs and revisions, history authority.
3. Immutable LT paint scene/display list: ordered graphics commands compiled
   from one document revision and reusable by multiple renderers.
4. Backend encoding: current WebGPU resources or Vello `Scene`/`Encoding`.

Only layers 1 and 2 are serialization authority. Layers 3 and 4 are disposable
derived data.

## Why the model helps

- SVG, PostScript/EPS and PDF share a 2D imaging vocabulary: paths, fill rules,
  strokes, transforms, brushes, images, text/glyphs, clips and compositing.
- LightTable's parser-independent `PdfNormalizedDisplayList` already models a
  graphics-state command stream: save/restore, concatenated transforms, fill
  and stroke state, clip paths, path/image/text draws, transparency groups and
  soft masks.
- Vello accepts exact Bezier paths plus transform/brush/stroke state and moves
  flattening, clipping, binning, tile allocation and raster work into a GPU
  compute pipeline. Its encoded path is therefore a much better candidate than
  LightTable's current per-element CPU mesh and per-draw render-pass route.
- Vello `Encoding::append` can assemble independently compiled fragments with
  an additional transform. That is useful evidence for revision-keyed scene
  fragments and worker compilation, but it does not itself define LightTable
  invalidation semantics.

## Proposed LT paint-scene vocabulary

The first bake-off scene should be immutable and ordered. Do not expose a
mutable PostScript graphics-state machine to document code. A compiler may
consume stateful source operations but emits explicit snapshots/fragments.

```ts
interface LtPaintScene {
  schemaVersion: 1;
  documentId: string;
  documentRevision: number;
  fragments: readonly LtPaintFragment[];
}

interface LtPaintFragment {
  stableId: string;
  sourceRevisionKey: string;
  bounds: Rect | null;
  commands: readonly LtPaintCommand[];
}

type LtPaintCommand =
  | { kind: 'push-group'; group: LtGroupState }
  | { kind: 'push-clip'; geometry: LtPath; transform: Matrix; rule: FillRule }
  | { kind: 'pop' }
  | { kind: 'fill-path'; geometry: LtPath; transform: Matrix; paint: LtPaint;
      opacity: number; rule: FillRule }
  | { kind: 'stroke-path'; geometry: LtPath; transform: Matrix; paint: LtPaint;
      opacity: number; stroke: LtStroke }
  | { kind: 'draw-positioned-glyphs'; run: LtPositionedGlyphRun }
  | { kind: 'draw-image'; assetId: string; transform: Matrix;
      sampling: LtImageSampling; opacity: number };
```

This sketch is deliberately incomplete. Masks, color conversion and group
semantics must be proven against PDF/PSD fixtures before freezing it.

## Mapping and gaps

| LT/source need | Vello API direction | Decision |
| --- | --- | --- |
| Cubic path, nonzero/evenodd fill | `Scene::fill` | Direct backend mapping. |
| Center stroke, cap/join/miter/dash | `Scene::stroke` | Map; Vello currently handles undashed strokes on GPU and expands dashed strokes on CPU. Measure both. |
| Solid/linear/radial/sweep paint | Peniko brush/gradient | Map with explicit color-space conversion before backend encoding. |
| Transform and brush transform | `Affine`, optional brush transform | Direct mapping; retain LT matrix conventions and tests. |
| Ordered clip/group stack | `push_clip_layer`, `push_layer`, `pop_layer` | Map only covered semantics; validate nesting and blend behavior. |
| Group opacity/blend | `push_layer` | Candidate, but upstream clip/blend limitations require fixtures and fallback. |
| Luminance mask | `push_luminance_mask_layer` | Candidate only; upstream documents alpha/premultiplication caveats. |
| Raster/image resource | `draw_image` / image brush | Map only after zero-copy GPU texture/resource ownership is proven. |
| Positioned glyphs | `draw_glyphs` | Backend target; shaping and semantic Unicode remain LightTable-owned. |
| Inside/outside strokes | no direct ordinary PostScript stroke equivalent | LT compiler must preserve semantics and expand or use current backend. |
| PDF isolated/knockout groups | partial layer model | Keep in LT/source IR; backend capability/fallback required. |
| PDF soft masks and image soft masks | partial luminance-mask model | Not assumed equivalent; retain resources and test alpha/luminosity cases. |
| CMYK/ICC/spot/DeviceN/overprint | outside ordinary Vello scene contract | Convert through LT color pipeline for display while preserving source resources for export. |
| PDF mesh gradients, patterns, shadings | not covered by base scene mapping | Explicit extension, raster fallback or preserved-unsupported path. |
| PDF/AI/EPS unknown/private operators | no Vello representation | Preserve in source IR; never silently reinterpret or discard on round-trip. |
| PDF optional content / Illustrator layers | not a renderer concern | Map to canonical document/layer visibility, retain source metadata. |

## CPU, GPU and worker choices to test

Vello's full GPU path dispatches path-tag reduction/scans, Bezier flattening,
draw/clip reduction, binning, tile allocation/counting, backdrop, coarse and
fine rasterization. This directly attacks LightTable's current CPU flattening,
stroke-triangle generation, many vertex uploads and render-pass-per-draw costs.

Do not port individual shaders before the backend bake-off. First measure:

1. Current LT backend with immutable compiled fragments and current caches.
2. Vello GPU path on the same logical scene and same target texture.
3. Vello hybrid CPU/GPU choices where supported.
4. Main-thread versus worker scene compilation, including transfer/copy cost.
5. Full rebuild versus revision-keyed fragment append/update.

Accept a worker path only if wall latency or interaction responsiveness wins;
moving work off-thread while duplicating large scene buffers is not a win by
itself. Accept a GPU algorithm port only if it beats using Vello as a maintained
backend and remains compatible with LightTable's WebGPU device/compositor.

## Sources checked

- Local pinned Vello checkout: `vello/src/scene.rs`, `vello/src/render.rs`,
  `vello/src/shaders.rs`, `vello_encoding/src/encoding.rs`.
- Vello Scene API: https://docs.rs/vello/latest/vello/struct.Scene.html
- Vello crate and PostScript-inspired model:
  https://docs.rs/vello/latest/vello/
- Vello retained scene/encoding vision:
  https://github.com/linebender/vello/blob/main/doc/vision.md
- Adobe PDF transparency groups and soft masks:
  https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.5_v6.pdf
- Adobe PDF graphics-state transparency mapping:
  https://opensource.adobe.com/dc-acrobat-sdk-docs/library/pdfmark/pdfmark_Basic.html

## Next proof

The wgpu 30 browser-WebGPU bridge and actual Vello render are now executable
evidence. In LightTable's Electron 39, Rust/wgpu requested the device,
JavaScript created a texture on that exact device, Rust wrapped it, and Vello
rendered a background and circle. JavaScript read both expected RGBA values back
byte-exact. This proves Vello can use shared device/texture ownership without a
CPU or GPU texture copy. The isolated source is under
`spikes/wgpu30-webgpu-interop/`.

Next define only the smallest scene slice needed for one representative SVG and
one PDF page-scene fixture. Compile that identical slice
to the current backend and Vello. Do not migrate canonical document types until
pixel, latency, memory, mutation and round-trip gates all pass.

## Minimal shared slice implemented

The first slice is now implemented as `@lighttable/paint-scene`, with source
compilers isolated in `@lighttable/paint-scene-adapters`. It intentionally
contains only exact cubic paths, affine transforms, solid fills and centered
solid strokes. Native vector and PDF fixtures compile to the same command
types. Stable fragment revisions derive from canonical/source revisions, not
zoom or pan.

Geometry is stored once as a separately revisioned fragment path and paint
commands reference it by id. This avoids doubling large path payloads for
fill-plus-stroke and allows style-only edits to retain backend geometry.

This is not a claim of PDF/SVG parity. Every feature outside this slice returns
an explicit capability issue and selects `current-backend`, `rasterize` or
`preserve-only` fallback. The next backend bake-off therefore cannot silently
reward Vello for dropping clips, color spaces, masks, gradients or blends.

The Electron/wgpu probe now deserializes this exact schema, resolves path ids
and renders it through Vello into the shared JavaScript-owned texture. Both the
transparent background and solid interior samples are byte-exact. This closes
the API/serialization interop prerequisite; performance and feature parity are
still open gates.

## First shared-scene bake-off

The current LT WebGPU backend now consumes the same scene through a dedicated
adapter while retaining its existing stencil/fill/stroke implementation. Five
fresh Electron processes rendered 256 cubic paths with 512 fill/stroke commands
on the same device:

| Metric (p50) | Current LT | Vello 0.10 |
| --- | ---: | ---: |
| Cold call + GPU completion | 55.1 ms | 43.0 ms |
| Warm call + GPU completion | 18.9 ms | 4.8 ms |
| GPU-process working-set delta | 28,488 KiB | 10,164 KiB incremental |
| Tab-process working-set delta | 22,932 KiB | 5,080 KiB incremental |

The Vello WASM is 1,960,473 bytes raw and 531,698 bytes gzip. Upstream Vello
0.10 stores straight-alpha output; LightTable intermediates are premultiplied.
The reproducible integration patch writes Vello's already-premultiplied `fg`
value directly, avoiding an extra conversion pass. Focused RMSE is 1.03 for
opaque fill, 0.51 for alpha fill and 2.11 for fill plus stroke. Remaining edge
differences are antialiasing coverage, so exact byte equality is inappropriate
for cross-rasterizer acceptance.

This is enough evidence to continue with a selectable backend, not enough to
make it default: real imported scenes, gradients/clips, mutation updates,
device loss, disposal and packaged lifecycle remain required gates.
