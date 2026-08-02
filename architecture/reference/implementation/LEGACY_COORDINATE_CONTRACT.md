# LightTable coordinate contract

Status: authoritative contract for raster layers, linked raster masks, painting
and affine transforms.

Document coordinates are intentionally not bounded by the pixel canvas. See
`canvas_bounds_and_unbounded_editor_space.md` for the authoring-space and
canvas-clipping contract.

## Spaces

- **Screen space**: CSS pixels in the editor window.
- **Document space**: image pixels, origin at the document's top-left, Y down.
- **Layer-local space**: texels in a raster layer before its open transform.
- **Mask-local space**: texels in a linked mask. This currently equals the
  owning layer's local space.
- **Selection space**: always document space.

Raster and mask textures are currently document-sized. Their allocation size is
not their visible-content bound.

## One geometry transform

`layer.transform` (`T`) maps layer-local pixels to document pixels:

```text
documentPixel = T * localPixel
localPixel = inverse(T) * documentPixel
```

The matrix uses the shared affine layout:

```text
x' = a*x + c*y + tx
y' = b*x + d*y + ty
```

There must not be a second implicit offset in painting, compositing or gizmo
code. Future tight texture storage may introduce an explicit placement matrix;
it must be composed into this same local-to-document contract at the boundary.

## Rendering

For every document-space output fragment:

1. Map the document pixel through `inverse(T)`.
2. Sample layer pixels in layer-local space.
3. Sample a linked mask at the same local coordinate.
4. Apply opacity, clipping, styles and blend mode.

WebGPU framebuffer and fragment coordinates have their origin at the top-left
and Y increases downward. Fullscreen UV and explicit fragment-position paths
must preserve that convention.

## Painting a linked mask

Pointer dabs and active selections are document-space data. The mask render
target is mask-local.

For every candidate mask fragment:

1. Read its mask-local pixel coordinate from fragment position.
2. Project it with `T` into document space.
3. Evaluate brush distance against the document-space dab center.
4. Evaluate selection coverage at the projected document pixel.
5. Blend only that mask-local target pixel.

An inverse matrix may conservatively determine which local target rectangle is
rasterized. It must not be the source of truth for brush coverage. Coverage is
defined by the explicit forward local-to-document projection in the fragment
shader.

The transform is snapshotted at pointer-down and remains immutable for the
complete stroke.

## Visible content bounds

Texture bounds are never transform-gizmo bounds.

Local visible coverage is:

```text
layer alpha * enabled mask
```

The gizmo uses the half-maximum contour of that coverage. Non-zero support
bounds remain available for invalidation and destructive commits. The local
bounds are projected through `T` to produce document-space handles and pivot.

Bounds are keyed by pixel revision, mask pixel revision and relevant mask
properties. Paint may expand a known bound incrementally. Erasing or changing a
mask at an edge invalidates it and requires a new alpha reduction.

## Merge and rasterize

Merge evaluates source pixels, transforms, masks, styles, clipping and blend
modes into a new document-space raster result.

The merged layer has:

- document-sized raster storage in the current implementation;
- `transform = identity`;
- newly measured visible alpha bounds;
- no inherited source transforms.

Identity means there is no open non-destructive transform. It does not mean the
visible content fills the canvas.

## PSD relationship

PSD layer records store a rectangle enclosing layer content. Layer-mask data
stores its own rectangle and flags, including whether mask positioning is
relative to the layer. Smart/placed content can additionally carry placement
transforms.

LightTable's current PSD adapter expands PSD layer and mask rectangles into
document-sized textures and uses an identity layer transform. This is compatible
with the current storage contract, but PSD bounds remain useful as imported
content-bound hints. They do not replace native alpha-bound verification.

## Required invariants

- The compositor and paint path use the same `T`.
- A translated, scaled or rotated linked mask paints under the document cursor.
- Zoom and pan affect only screen-to-document conversion.
- Selection coverage is sampled in document space.
- Transform handles follow visible content, not texture allocation.
- Merge resets geometry without losing visible bounds.
- No operation silently switches between document and local coordinates during
  one gesture.
