# LightTable Layer Styles support report

Status: semantic implementation with automated Adobe reference corpus, 4 August 2026.

## Current contract

Layer Styles are ordered, editable effects on raster and semantic layers. They
use premultiplied linear-sRGB `rgba16float` working textures. Fill opacity
affects source content; layer opacity affects the finished content plus styles.
Merge and flatten bake the visible result once and clear the destination stack.

Blend equations run in the document's encoded sRGB blend colour space and are
converted back to linear light for filtering and Porter-Duff compositing. This
matches Photoshop/PDF Color Burn semantics much more closely than evaluating
the blend equation directly in linear light.

Disabled stacks, disabled effects and zero-opacity effects submit no style
passes. With no active styles the cache and all style work textures are
released. Interactive and final quality share geometry and compositing
semantics; only the evenly distributed blur sample count changes.

## Effect audit

| Effect | Native state | Asset/fidelity behavior |
|---|---|---|
| Drop Shadow | Editable, multiple | Bounded alpha, normalized blur, spread and contour |
| Inner Shadow | Editable, multiple | Interior coverage preserves canvas alpha |
| Outer/Inner Glow | Editable color/solid gradient | Bounded/interior coverage; deterministic blur |
| Color Overlay | Editable, multiple | Preserves source coverage |
| Gradient Overlay | Editable solid gradients | GPU gradient contract; noise gradients retain fallback |
| Pattern Overlay | Editable when resolved | Missing pattern asset is an explicit no-op |
| Satin | Editable | Interior coverage only |
| Stroke | Editable color/gradient/pattern | Inside/center/outside; transparent out-of-bounds samples |
| Bevel & Emboss | Editable supported subset | Missing texture disables only the texture contribution |

The former black-canvas and radial-spike failures came from clamped edge alpha
and disconnected stroke samples. A dedicated bounded shape pass and shared
coverage evaluation now serve every effect. Zero spread/choke preserves soft
blur coverage rather than thresholding it away.

## PSD adapter semantics

`ag-psd` is a codec dependency, not renderer authority. The isolated adapter
maps PSD descriptors to the canonical stack and returns a compatibility report.

- Editable: supported RGB effects, solid gradients, multiple shadows, fills,
  strokes and gradient overlays.
- Preserved: unresolved pattern references and incomplete Bevel Texture data.
- Rasterized fallback: noise gradients and unsupported source semantics.
- Lossy: never selected silently; export must require an explicit policy.

## Automated reference evidence

`scripts/capture-photoshop-layer-style-references.ps1` captures enabled and
bypassed Photoshop composites from disposable source copies. The matching
packaged-Electron runner,
`scripts/capture-lighttable-layer-style-references.mjs`, targets layers by
stable PSD source id through the transport-neutral command driver. The plan is
versioned in `LAYER_STYLE_REFERENCE_PLAN.json`; generated images remain
disposable `tmp/` evidence.

The 4 August run completed five targets without page errors. It records context
and solo pairs plus vector-mask/group, controlled fill-opacity, stacked-effect
and 400% zoom cases. Mean enabled-versus-bypassed effect magnitude was close
for both Drop Shadows (LightTable/Photoshop ratios 0.97 and 1.30), Color Overlay
(0.84), and Color Burn Gradient Overlay (1.47 after encoded-space blending;
previously 5.43). Unresolved Pattern Overlay remains an intentional no-op until
the referenced pattern asset is available. These are fidelity baselines, not a
claim of pixel-identical Adobe rendering.

## Remaining bounded limits

- Exact Photoshop pattern phase awaits resolved pattern assets.
- Anti-alias toggles and every gradient interpolation variant are preserved but
  do not yet all select distinct shader algorithms.
- Photoshop noise gradients remain preview-backed rather than approximated.
- The deterministic blur kernel is visually close, not pixel-identical.
