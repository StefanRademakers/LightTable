# GPU text contract boundaries

Status: frozen for schema/protocol version 1 (Slice 02).

## Ownership

```text
DocumentSession
  owns app CommonLayer + TextLayerData + authored revisions + FontAssetRef
        |
        | session/generation/cache-keyed structured-clone request (version 1)
        v
TextLayoutRuntime worker
  owns registered font bytes + shaping/layout caches
        |
        | RealizedTextLayout + transferable typed arrays (version 1)
        v
TextLayerRuntimeStore
  owns the last valid realized layout and derived cache key
        |
        v
TextWebGpuRenderer (future slice)
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
  boundary.
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
