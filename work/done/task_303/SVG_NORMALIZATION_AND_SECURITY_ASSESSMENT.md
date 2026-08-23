# SVG normalization and security assessment

Date: 2026-08-22

## Decision

LightTable keeps its editable vector document model as the sole authority.
SVG parsing/normalization is a format adapter and Vello is a renderer. Neither
`usvg::Tree` nor `vello::Scene` may be persisted as a second mutable document.

The target boundary is:

```text
untrusted SVG bytes
  -> LightTable size/reference/depth preflight
  -> optional locked-down usvg normalization
  -> editable LightTable vector model
  -> backend-neutral PaintScene projection
  -> current WebGPU or Vello backend
```

`resvg` is also suitable as a visual regression oracle. It is not the normal
editable import route and must never silently replace unsupported editable
semantics with a bitmap.

## Implemented package boundary

`@lighttable/vector-svg-normalizer` now owns the optional normalization phase. Its native core is
`crates/vector-svg-normalizer-wasm`, pinned to `usvg` 0.48.1 and compiled without text, system-font,
SVGZ, or raster-decoder features. It has no dependency on the LightTable document model,
`PaintScene`, React, or either GPU backend.

The native boundary rejects DTDs, processing instructions, active elements, event attributes,
external/data `href` values, CSS imports and non-local `url()` references. Both `usvg` image
resolvers are replaced with resolvers that always return `None`.

Measured on the SVG torture fixture on 2026-08-22:

- WASM: 757,506 bytes raw / 282,340 bytes gzip.
- Runtime initialization: 20.45 ms.
- First normalization: 29.28 ms.
- Warm normalization: 1.51 ms.
- Input/output: 14,887 / 21,169 bytes; 122 input elements, maximum depth 4.

These figures justify product-path evaluation; they do not yet authorize replacing the editable
codec until round-trip and unsupported-feature policy tests pass.

The packaged product-path evaluation now passes on the torture fixture. File Open and semantic
placement/MCP both use this normalizer before the existing editable codec. Ordinary `<a>` hyperlink
targets are stripped while supported descendants are retained; resource-bearing `href` values
remain local-fragment-only. The packaged result improves browser-oracle RMSE from roughly 38 to
31.95 and retains zero document recomposites during pan/zoom.

## Evidence

- `usvg` resolves inherited/default attributes, CSS, basic shapes, path command
  variants, `<use>`, nested SVG viewports, units, markers and local references
  into a simpler typed tree. This can remove substantial parser complexity.
- `usvg` retains groups, clip paths, masks, gradients, images and text in its
  normalized tree. LightTable still needs explicit canonical equivalents or an
  explicit preserve/raster fallback for those semantics.
- `vello_svg` consumes a `usvg::Tree` and appends renderer commands. That is a
  useful implementation and correctness reference, but direct SVG-to-Vello
  would bypass editability, history, export and backend interchange.
- The product currently uses Vello 0.10, while the current `vello_svg` release
  line is not version-aligned enough to make it a zero-cost drop-in. Its
  feature coverage and Vello version must be evaluated independently.
- Vello exposes clip and compositing layers, but its own current documentation
  identifies interaction limitations between clip and blend layers. The
  PaintScene contract therefore must express the semantics; backend support is
  capability-gated rather than assumed.

Primary references:

- https://github.com/linebender/resvg
- https://docs.rs/usvg/latest/usvg/
- https://github.com/linebender/vello_svg
- https://docs.rs/vello/latest/vello/struct.Scene.html

Pinned local reference source:

- `.referenceCode/resvg`, commit
  `021d44b75af1455cb557aa6217da66f22c5c3dc0`
- `.referenceCode/vello`, used for renderer and `usvg` adapter study
- `.referenceCode/inkscape`, retained as an authoring/export behavior reference

## Security gates

SVG input is untrusted. Before any normalizer or renderer sees it:

1. Enforce byte, XML depth, element, attribute, path, subpath and anchor budgets.
2. Reject DTDs, entities, processing instructions, scripts, event attributes,
   active embedding elements and every non-local URL/reference.
3. Never use `usvg::Options::default()` in product import code. Its default
   string image resolver treats values as file paths and can read local files.
4. Install explicit `ImageHrefResolver` closures:
   - `resolve_string`: always `None`;
   - `resolve_data`: `None` until embedded raster import has its own MIME,
     decoded-byte, pixel-count and recursion budgets.
5. Keep `resources_dir` unset. Do not inject a stylesheet and do not allow a
   source document to choose a filesystem or network base URL.
6. Fonts come only from LightTable's font service and bounded font data. SVG
   text may not trigger arbitrary font-file discovery.
7. Run normalization off the UI thread with a cancellation/deadline and
   bounded result size. A memory-safe parser does not by itself prevent CPU or
   allocation denial of service.
8. Treat unsupported passive elements as scoped omissions with notices. Never
   crash or reject supported siblings merely because an unknown safe subtree
   exists. Active content and external references remain hard failures.

The upstream custom resolver example confirms the intended locked-down hook:
`.referenceCode/resvg/crates/resvg/examples/custom_href_resolver.rs`.

## Canonical coverage order

The next shared-model additions should be made in semantic dependency order:

1. Radial/two-circle gradients end-to-end (implemented in this pass).
2. Group/clip stack nodes in the canonical vector model and PaintScene.
3. `<use>` normalization into cloned editable elements with stable source
   provenance and cycle/depth limits.
4. Group opacity and blend isolation.
5. Patterns as reusable paint assets, not expanded duplicate geometry.
6. Markers as reusable editable geometry instances.
7. Masks and filters behind explicit capability/fallback policy.
8. SVG text through LightTable text-core/layout/rendering, preserving text when
   possible and converting to outlines only by an explicit user/import policy.

This ordering also fits future AI/EPS/PDF adapters: all can target the same
group, path, paint, clip, compositing and glyph-run semantics without importing
SVG-specific nodes into the renderer contract.

## Current corpus consequence

The local four-file corpus contains:

- two ordinary path-heavy authoring exports;
- one 26,492-path stress document;
- one feature matrix containing linear/radial gradients, `<use>`, patterns,
  markers, clip paths, a mask, CSS and a nested SVG.

Radial gradients were the largest paint feature that the existing canonical
model and both backends could support without inventing hierarchy semantics.
Clips and group compositing are the next correct model extension. Expanding
`<use>` before defining those nodes would create duplicated or semantically
incomplete document data, so it is deliberately not patched as a parser-only
shortcut.
