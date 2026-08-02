# LightTable Layer Styles support report

Status: alpha implementation, 29 July 2026.

## Current contract

Layer Styles are ordered, editable effects on raster layers. They use
premultiplied linear-sRGB `rgba16float` working textures. Fill affects source
content; layer opacity affects the finished content plus styles. Merge and
flatten commands bake the visible result once and clear the destination style
stack.

Disabled stacks, disabled effects and zero-opacity effects allocate and submit
no style passes. When the document has no active styles, the style cache and
all three style work textures are released.

## Effect audit

| Effect | Native state | Alpha/outside-canvas audit | Asset failure behavior |
|---|---|---|---|
| Drop Shadow | Editable, multiple | Bounded alpha, normalized blur, clamped coverage | n/a |
| Inner Shadow | Editable, multiple | Interior coverage cannot replace canvas alpha | n/a |
| Outer Glow | Editable color/solid gradient | Bounded alpha, normalized blur | n/a |
| Inner Glow | Editable color/solid gradient | Interior coverage only | n/a |
| Color Overlay | Editable, multiple | Preserves source coverage | n/a |
| Gradient Overlay | Editable solid gradients | Preserves source coverage | Noise gradients use fallback |
| Pattern Overlay | Editable when resolved | Preserves source coverage | Unresolved/missing GPU asset is an explicit no-op |
| Satin | Editable | Interior coverage only | n/a |
| Stroke | Editable color/solid gradient/pattern | Outside samples are transparent, not edge-clamped | Unresolved pattern is an explicit no-op |
| Bevel & Emboss | Editable supported subset | Outer variants use bounded alpha | Missing texture disables only texture contribution |

The former black-canvas failure was caused by materializing a layer shape
through the ordinary compositor and sampling clamped edge alpha. A dedicated
shape pass and one shared bounded alpha sampler now cover every effect.
Pattern-backed effects also require a real registry texture; layer pixels are
never substituted as a fake pattern.

## PSD adapter semantics

`ag-psd` 31.0.2 is a codec dependency. The isolated adapter maps PSD effect
descriptors into the canonical stack and returns a compatibility report.

- **Editable:** supported RGB effects, solid gradients, multiple shadows,
  fills, strokes and gradient overlays.
- **Preserved:** unresolved pattern references and incomplete Bevel Texture
  metadata.
- **Rasterized:** unsupported Photoshop blend modes, non-RGB effect colors and
  noise gradients until a matching evaluator exists.
- **Lossy:** never chosen silently. Export must require an explicit policy.

The adapter result retains unsupported source descriptors for the future PSD
document preservation envelope. Wiring that envelope into full PSD open/save
is a later PSD workstream; the Layer Style adapter itself does not own files.

## Known visual-parity limits

- Effect-specific blend modes for outside effects are currently precomposed
  with the styled layer before the layer is blended into the document. Exact
  Photoshop backdrop interaction still needs golden-image validation.
- Gradient and pattern coordinates are canvas-relative. Photoshop
  align-with-layer, pattern phase and layer-relative origin need exact bounds.
- Anti-alias toggles and gradient interpolation variants are preserved in the
  model but are not all distinct shader algorithms yet.
- Photoshop noise gradients are preserved/rasterized, not approximated.
- The current blur kernel is a deterministic preview/final approximation, not
  claimed pixel-identical to Photoshop.

## Browser smoke sequence

Use a sparse white brush stroke on transparency over a colored background:

1. Toggle each effect alone at opacity 0, 1, 35 and 100 percent.
2. Confirm disabled and zero opacity are pixel-identical to the no-effect
   composite.
3. Move the stroke against all four canvas edges; no effect may fill the
   canvas or smear an edge.
4. Stack two Drop Shadows, two Color Overlays and two Strokes; reorder and
   undo/redo them.
5. Test color and solid-gradient glows, all Stroke positions and all Bevel
   styles.
6. Remove a pattern asset after opening. Pattern effects must become no-ops
   and Bevel must retain its non-texture lighting.
7. Merge Down, Merge Selected, Flatten Group and Flatten Image. Compare before
   and after with the effect editor closed; styles must be baked exactly once.
8. Save/reopen the native layered document and repeat the comparison.

Reference-image sign-off still needs Photoshop-generated goldens from
`docs/lighttable/styles/`. Until that pass, “editable” means the semantic
controls and stable LightTable rendering work, not pixel-identical Adobe
rendering.
