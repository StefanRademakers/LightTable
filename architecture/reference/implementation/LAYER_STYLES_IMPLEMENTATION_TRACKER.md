# LightTable Layer Styles implementation tracker

This is the execution and handoff list for Photoshop-compatible Layer Styles
(`fx`). Layer Styles are attached to a layer result. They are not LightTable
Lens Fx, Adjustment Layers or Smart Filters.

## Rendering contract

```text
source pixels
-> layer transform
-> layer mask
-> Fill opacity (content only)
-> Layer Style stack
-> layer Opacity (content + styles)
-> layer blend mode into the parent composite
```

The editor previews styles on the real document canvas. The style dialog never
uses a separate preview tile as its source of truth.

## Twenty implementation slices

- [x] 01. Inventory the Photoshop dialog references and record every exposed
      style family and parameter group.
- [x] 02. Add a typed, ordered `LayerStyleStack` with stable IDs, visibility,
      scale, global-light settings and multiple same-kind effects.
- [x] 03. Add normalized defaults, cloning, validation and neutral/no-op
      helpers with unit tests.
- [x] 04. Attach styles to every canonical layer node and cover creation,
      duplication, grouping and document commands.
- [x] 05. Persist the complete stack in native layered documents and verify a
      save/open roundtrip.
- [x] 06. Add undo-safe commands for add, remove, reorder, enable, update,
      clear, copy and paste style operations.
- [x] 07. Add the `fx` disclosure tree and per-effect visibility controls to
      the Layers panel.
- [x] 08. Build one modern Layer Style editor shell with category navigation,
      OK/Cancel, reset and live document preview.
- [x] 09. Build shared controls for blend mode, opacity, colors, angle/global
      light, contours, gradients and patterns.
- [x] 10. Implement Color Overlay in the linear WebGPU layer compositor.
- [x] 11. Implement Drop Shadow, including multiple instances, spread, size,
      noise, contour and “layer knocks out shadow”.
- [x] 12. Implement Inner Shadow with the same shared lighting model.
- [x] 13. Implement Outer Glow and Inner Glow, including edge/center source,
      choke, range and jitter.
- [x] 14. Implement Stroke with inside/center/outside placement and color,
      gradient and pattern fill sources.
- [x] 15. Implement Gradient Overlay plus an editable multi-stop gradient
      model and gradient editor.
- [x] 16. Implement Satin with contour, angle, distance, size and invert.
- [x] 17. Implement Bevel & Emboss, contour and the supported texture subset,
      with explicit UI for unsupported Photoshop texture metadata.
- [x] 18. Implement Pattern Overlay and a document asset registry that can
      preserve unresolved PSD pattern references.
- [x] 19. Add style-aware bounds, cache invalidation, VRAM accounting, quality
      tiers and zero-cost inactive paths.
- [ ] 20. Add PSD adapter fixtures, reference renders, browser smoke tests and
      a support report for editable/preserved/rasterized style semantics.

## Photoshop dialog inventory

| Style | Parameter groups represented by the supplied references |
|---|---|
| Drop Shadow | blend/color, opacity, global light/angle, distance, spread, size, contour, anti-alias, noise, knockout |
| Inner Shadow | blend/color, opacity, global light/angle, distance, choke, size, contour, anti-alias, noise |
| Outer Glow | blend, opacity, noise, color/gradient, technique, spread, size, contour, anti-alias, range, jitter |
| Inner Glow | blend, opacity, noise, color/gradient, technique, edge/center source, choke, size, contour, anti-alias, range, jitter |
| Bevel & Emboss | style, technique, depth, direction, size, soften, global light, angle, altitude, gloss contour, highlight/shadow blend/color/opacity |
| Color Overlay | blend, color, opacity |
| Gradient Overlay | blend, opacity, gradient, dither, reverse, style, align, angle, scale, interpolation method |
| Pattern Overlay | blend, opacity, pattern reference, angle, scale, link with layer, origin |
| Satin | blend/color, opacity, angle, distance, size, contour, anti-alias, invert |
| Stroke | size, position, blend, opacity, overprint, color/gradient/pattern fill |

## Manual browser verification log

The implementing agent records exact steps here when a slice needs visual or
interactive verification that unit tests cannot provide.

- Foundation verification: 36 document/style/persistence tests pass and
  TypeScript builds cleanly. Interactive Layer Style runtime is not exposed yet.
- WebGPU runtime foundation: shader reflection, packing and style command suites
  total 77 passing tests; TypeScript builds cleanly.
- Layers/editor implementation: `fx` disclosure, aggregate and per-effect
  visibility, one editor for all style families, actual-canvas preview and
  cancel/one-step commit semantics are wired. Manual browser interaction and
  visual reference matching remain part of slice 20.
- Gradient/contour checkpoint: the WebGPU contract now carries up to eight
  color stops, eight opacity stops and eight contour points. The editor can add,
  remove and edit those stops, shape contours directly, and reorder effects.
  Shader reflection, packing tests and TypeScript pass. Browser reference
  matching remains part of the final parity verification in slice 20.
- Stroke/gradient checkpoint: Stroke now evaluates both color and editable
  multi-stop gradient fills (all five geometry modes, reverse and dither)
  instead of silently dropping non-color fills. Color-stop midpoints and
  opacity-stop midpoints are part of the GPU interpolation contract. Pattern
  Stroke remains explicitly unresolved rather than receiving a fake texture.
  The production build and 79 focused tests pass.
- Shared alpha/compositing regression pass: Layer Style shape materialization
  now has a dedicated source/transform/mask shader instead of routing through
  the normal layer blender. All implemented style families use the same
  bounded alpha sampler; samples outside the canvas resolve to transparent,
  and the shared 16-direction blur kernel is normalized by its actual weight
  (68). This fixes the failure mode where enabling a positive-opacity outer
  effect could replace a sparse paint layer with an opaque black canvas.
  Merge Selected, Merge Down, Flatten Group and Flatten Image intentionally
  bake visible styles into the destination pixels and then clear the style
  stack; the document-command regression test prevents applying baked styles a
  second time. Shader reflection, TypeScript, ESLint and 105 focused tests pass.
  Manual browser check: paint a sparse white stroke on a transparent layer,
  enable/disable Drop Shadow, test opacity 0/1/35/100%, then Merge Down and
  compare the pre/post-merge composite with the effect editor closed.
- Glow completion checkpoint: Outer and Inner Glow now expose Color/Gradient
  source selection and editable multi-stop gradients. Gradient midpoints and
  effect contours have independent uniform arrays, so a contour cannot corrupt
  gradient interpolation. Both gradient glow variants share the bounded alpha
  path and remain true no-ops when disabled or at zero opacity. TypeScript,
  shader reflection, ESLint and 88 focused tests pass. Manual browser check:
  compare color versus gradient source on sparse and edge-touching layers,
  test Inner Glow Edge/Center, and verify the contour remains unchanged while
  editing gradient midpoints.
- Pattern/Bevel checkpoint: the canonical document now owns a shared pattern
  registry. Native layered files persist each resolved pattern source once;
  restore decodes it lazily into an `rgba16float` texture. Pattern Overlay,
  Pattern Stroke and the supported Bevel Texture subset all resolve through
  that registry, while unresolved PSD pattern IDs remain editable metadata and
  render as an explicit no-op. Bevel now evaluates style, technique, direction,
  depth, size, soften, altitude, highlight/shadow modes and optional pattern
  texture instead of ignoring those controls. Pattern textures participate in
  VRAM accounting and lifecycle cleanup. TypeScript, shader reflection, ESLint
  and 127 focused tests pass. Manual browser check: open a native document with
  a resolved pattern, compare Pattern Overlay/Stroke at several scales and
  angles, toggle Bevel Texture/invert/depth, save/reopen, then merge and verify
  the visual result is baked once.
- Deliberate current limits shown in the editor instead of being hidden:
  unresolved pattern references remain preserved no-ops. Gradient and pattern
  coordinates are currently canvas-relative; exact layer-relative alignment
  and all Photoshop interpolation methods remain open.
- Runtime/quality checkpoint: conservative style-aware bounds cover every
  outer effect. Styled raster results are cached per layer and invalidate on
  source pixels, mask pixels, geometry, Fill, style revision, pattern restore
  and interactive/final quality. Cache textures are included in VRAM stats and
  are released with inactive styles. Interactive blur uses eight normalized
  directions and the committed result restores sixteen without an opacity
  jump. Missing pattern GPU data is now an explicit no-op for Pattern
  Overlay/Stroke and disables only the Bevel Texture contribution.
- PSD-adapter checkpoint: `ag-psd` 31.0.2 is isolated behind a typed adapter.
  Fixtures cover multiple-instance editable effects, resolved/unresolved
  patterns and explicit raster fallback for unsupported blend/noise-gradient
  semantics. See `LAYER_STYLES_SUPPORT_REPORT.md` for the complete audit and
  browser verification sequence.
