# Rendering and processing

## Render contract

Raster inputs cross renderer boundaries as an explicit contract: texture,
dimensions, bounds, `linear-srgb`, premultiplied alpha, source and geometry
revisions, and source/local-to-document transforms. A raw `GPUTexture` without
these semantics is not a sufficient layer input.

## Compositor

The compositor first builds a pure, testable plan from the document tree and
only then allocates/encodes GPU work. The plan handles bottom-first ordering,
nested groups, clipping bases and group isolation envelopes. Layer masks,
styles, fill, opacity and blend belong to layer evaluation; adjustment layers
consume the composite below them.

A conceptual leaf path is:

```text
source pixels/vector realization
-> source geometry and local processing nodes
-> mask and layer styles
-> fill/opacity/clipping/blend
-> parent composite
```

An adjustment layer replaces the leaf source with the accumulated lower
composite, evaluates its processing stack and then applies its own mask,
opacity, clipping and blend semantics.

The exact executable order is code-owned by `LayerCompositor`,
`LayerDocumentRenderer`, the processing registry and effect-stage definitions.
Do not introduce a second hardcoded operation-order list in UI code.

## Processing model

A processing module declares:

- stable type and serializable settings;
- category and allowed owner scopes;
- color/data domain;
- alpha behavior and coordinate space;
- optional PSD semantic candidates.

Instances add identity, enabled state and revision. Serialized stack order is
authoritative. `buildProcessingPlan` validates scope and skips disabled or
unknown nodes with diagnostics. An enabled node without an executor fails
loudly instead of silently disappearing.

Current registered concepts include warp, white balance, light, global color,
color mixer, color grading, curves, detail, vignette, lens distortion,
chromatic aberration, lens blur, halation and grain. Module definitions live in
`processing/moduleDefinitions.ts`.

`DocumentEffectRuntime` currently executes effect-category nodes in serialized
order inside constrained texture-domain stages:

1. source geometry;
2. linear spatial;
3. display post.

Instances own their GPU effects and resources. Repeated node types therefore
do not share mutable uniforms accidentally. Stage ordering is validated.

## Color and alpha

- Normalize decoded sources deliberately; embedded profiles are import work,
  not an implicit browser-color assumption.
- Perform grade/composite/spatial math in linear RGB unless a module declares a
  perceptual or display domain.
- Use premultiplied alpha at compositor boundaries.
- Preserve high precision in intermediate textures; quantize at the requested
  export boundary, not between effects.
- Gamut/chroma fitting and display encoding are output responsibilities.

## Direction

The user does not need a visible node graph, but internally Grade, Lens Fx,
blur, sharpen, warp, halation, masks, styles and future AI texture producers
should converge on ordered registered executors. Neighborhood, multipass and
multi-input nodes are valid; the executor contract must describe their inputs,
resources and dirty dependencies rather than forcing every operation into one
fullscreen shader.

The same boundary must accept future producers such as a rasterized 3D scene,
an asynchronously generated AI result or a live procedural texture. Producers
resolve to revisioned texture/vector/depth contracts; downstream composition
does not special-case which product feature created them. Expensive producers
remain dormant until their own inputs are dirty, and background documents do
not keep them active.

Remaining migration work is tracked in
[Current state and roadmap](CURRENT_STATE_AND_ROADMAP.md).
