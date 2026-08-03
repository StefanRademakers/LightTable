# GPU text contract boundaries

Status: document schema 1, realized-layout schema 2 and worker protocol 4
(Slice 08 migration).

## Ownership

```text
DocumentSession
  owns app CommonLayer + TextLayerData + authored revisions + FontAssetRef
        |
        | session/generation/cache-keyed structured-clone request (protocol 4)
        v
TextLayoutRuntime worker
  owns registered font bytes + shaping/layout caches
        |
        | RealizedTextLayout + transferable typed arrays (layout schema 2)
        v
TextLayerRuntimeStore
  owns the last valid realized layout and derived cache key
        |
        v
TextWebGpuRenderer
  owns GPU buffers/textures only; no canonical document state
```

`@lighttable/text-core` owns every text-specific type crossing these
boundaries. It may use
ES2022 primitives, plain objects, arrays, `ArrayBuffer` and typed arrays. It may
not own or import React, DOM objects, browser globals, WebGPU handles, the app
package or renderer implementations. `scripts/verify-boundary.mjs` enforces
that dependency direction.

## Canonical versus derived data

- `TextLayerData` contains authored flow or positioned text and five independent
  monotonic revisions. Generic `TextLayer<TBase>` composes this payload with
  the app's existing canonical `CommonLayer` in Slice 03; text-core deliberately
  does not duplicate locks, styles, masks, blend modes or timestamps.
- Flow run offsets are JavaScript UTF-16 offsets. Validators require complete,
  contiguous coverage and reject boundaries inside surrogate pairs. Editing
  code must additionally use grapheme-aware movement once the tool exists.
- `RealizedTextLayout` is derived, immutable-by-contract runtime data. Glyph
  IDs and clusters use `Uint32Array`; x/y/advance geometry and optional 3x3
  glyph transforms use `Float32Array`.
- Positioned and realized runs retain all eight PDF text rendering modes,
  including the fill/stroke combinations that also contribute clipping paths,
  separate fill/stroke paint, and the original encoded character-code width.
- Layout cache keys are derived from typed options and include document/layer
  identity, session generation, all authored revisions, the font snapshot and
  referenced-path geometry revision. Caches never enter document persistence.
- A dedicated font registration request transfers a private full-span buffer
  once. Layout requests reference registered `FontAssetRef` identities and do
  not detach canonical document font storage. Realized tables are transferable
  only when every table owns distinct dedicated JS storage.

## Coordinates, bounds, color and alpha

- Authored coordinates and bounds use layer-local document units. Rectangles
  have non-negative width/height. Matrices are row-major homogeneous 3x3. The
  worker request carries the explicit layer-local-to-document transform.
- Authored color components are straight (unpremultiplied), finite values in
  `[0, 1]`, tagged as sRGB or Display P3. The future GPU renderer converts to
  the document working space and premultiplies exactly once at its render
  boundary. Slice 08 implements this for solid sRGB fill into the compositor's
  linear-light `rgba16float` target; other paint spaces/modes fail explicitly.
- Ink bounds cover visible glyph marks; logical bounds cover layout/caret
  geometry. Neither includes the layer's parent/world transform.

## Error and fallback policy

Fallback is explicit and never substitutes a font silently:

| Error class | Last valid layout | Fallback |
| --- | --- | --- |
| cancelled | yes | preserve last layout |
| cancelled | no | none |
| engine unavailable, internal, resource limit | yes | preserve last layout |
| engine unavailable, internal, resource limit | no | diagnostic placeholder |
| malformed/schema/font/restriction/unsupported | either | diagnostic placeholder |

Every realized glyph run carries typed exact/substituted provenance, its source
run index, the authored request where applicable and an enumerated substitution
reason. A `font-substituted` warning is the user-facing diagnostic, not the
source of truth for provenance.

Font references distinguish container and outline formats plus embedding
level, no-subsetting and bitmap-only restrictions. Flow styles retain requested
font families independently from a resolved asset; positioned runs always name
the exact resolved/subset asset they reference.

## Versioning

Document schema, realized-layout schema and worker protocol versions advance
independently. Version 1 rejects unknown versions at the boundary. A future
migration must land before a producer emits a newer document schema, and both
worker endpoints must support a protocol version before it becomes active.

Worker protocol 2 adds `cancel-text` and `release-session`. Cancellation is
logical: the client rejects immediately and stale responses are discarded by
request/session/generation identity. Because Parley shaping is synchronous, it
is not described as cooperative interruption; hard cancellation terminates and
restarts the worker. Session release destroys the exact generation's Rust font
and layout state.

Worker protocol 3 added bounded `rasterize-glyph`. It referenced an exact
registered asset, collection face, glyph, ppem and font-snapshot revision. The
client validates that complete identity on the response. The worker returns a
dedicated transferable R8 mask and frees the temporary WASM allocation after
copying it.

Worker protocol 4 extends raster identity with sorted variation coordinates,
synthetic-bold/italic flags, the hinting profile and alpha render mode. The
Slice 08 worker rejects non-default variation/synthesis until the rasterizer
can honor them, rather than caching a mask under a false identity. Realized
layout schema 2 adds the authored `fontSize` to each derived glyph run. The
persisted document schema remains version 1; this runtime-only addition does
not invalidate existing LightTable files.

The production coverage cache key uses the exact font SHA-256, face, glyph,
f32-normalized variation coordinates, synthesis flags, hinting, ppem bucket,
render mode and rasterizer version. Fixed 1024x1024 R8 pages are append-only;
whole-page LRU eviction advances a page generation, while device loss advances
the atlas generation and requires a fresh renderer bound to the replacement
`GPUDevice`. Stale uploads/draws are rejected.

Realized glyph arrays and `clusterMap` are emitted in logical cluster order,
including RTL and mixed-bidi text, while geometry retains visual positions.
Renderer paint order must therefore use positions, not array order.

Slice 06 implements the Rust boundary as packed typed tables; flow layout does
not stringify or parse JSON. Style ranges are UTF-16 offsets at the TypeScript
boundary, converted once to UTF-8 scalar boundaries in Rust. Run metadata
proves that Parley's actual blob and face index match the requested registered
asset before the worker may report `flow-exact`. Dedicated per-run `.slice()`
buffers preserve the transfer-ownership contract.

Geometry uses unquantized layer-local document units. `fontStretch` and future
horizontal/vertical scales are percentages; tracking, baseline shift, indents
and spacing are document units; multiple line height is a multiplier. Slice 06
supports horizontal point/paragraph text with default paragraph formatting,
metrics/automatic kerning and zero baseline/scales. Vertical/path layout,
direction/script overrides, optical or disabled kerning, synthesis, variations,
custom OpenType features, scaling and non-default paragraph controls return a
typed `unsupported-feature`; none may be silently ignored.

Flow ink bounds are conservative scalable outline bounds from Skrifa at the
Parley-selected size and visual position. Empty/whitespace-only ink is a zero
rectangle. Positioned sources remain a frozen persistence/interchange contract
in Slice 06, but worker realization returns `unsupported-feature`. Exact
positioned realization must wait for registered-face outline bounds (including
stroke/clip paint expansion and projective-transform validation), so cache and
culling bounds can never clip visible content.

Successful registration/layout responses carry worker operation time and
reserved WASM linear-memory bytes. The client measures roundtrip and dedicated
response-transfer bytes separately. These are diagnostics, not cache identity
or correctness inputs.
