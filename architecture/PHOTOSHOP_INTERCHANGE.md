# Photoshop interchange

Photoshop compatibility is an adapter target, not LightTable's internal
architecture. The native LightTable document model, processing stack and UX
remain leading so the product can support capabilities beyond PSD, including
AI, 3D and LightTable-specific GPU operations.

## Four parity dimensions

Every imported feature is classified independently:

1. **Structural parity**: order, groups, clipping, masks, transforms and owner
   relationships are reconstructed correctly.
2. **Editable semantic parity**: the feature maps to a native editable layer,
   style, processing node, vector, text object or smart container.
3. **Visual parity**: LightTable's render is acceptably close to Photoshop's
   stored composite/reference for a defined fixture and color path.
4. **Preservation parity**: unsupported data can be reported and, only where
   the native format has an intentional carrier, round-tripped without being
   presented as editable.

These states must never be collapsed into one vague “supported” label.

## Import contract

PSD/PSB import translates into the native model in visual stack order. The
current target includes:

- raster layers and precise local bounds;
- nested groups and pass-through/isolation semantics;
- blend mode, opacity and fill opacity;
- clipping chains;
- layer and vector masks;
- transforms and smart-object placement;
- adjustment layers and attached Smart Filter-like stacks;
- Layer Styles, pattern/gradient assets and effect order;
- text and vector content with explicit native/preview/missing status;
- color mode, bit depth and profile metadata.

Color and blending compatibility follows the explicit document contract in
`PHOTOSHOP_COLOR_AND_BLEND_PARITY.md`. The PSD adapter may select and preserve
a compatibility policy, but it may not hide profile assumptions or implement
Photoshop-only gamma branches outside the shared compositor.

The embedded Photoshop composite is transient comparison truth. It may be
shown as Original/reference during import diagnostics, but is not embedded as
a second PSD payload in a saved LightTable document. A raster preview is not
an editable semantic reconstruction and must be labeled as such.

Unknown blocks are recorded with location and identifier. Import must not
silently flatten, silently drop a mask/style/transform or report a comparison
with zero sampled pixels as success.

## Export contract

The PSD release-candidate writer projects from the canonical document through
the same adapter boundary. It writes a merged 8-bit RGB composite and editable
descriptors only for the tested subset. Known lossy mappings are blocking
compatibility findings, not console-only warnings. Desktop, web and command
automation share this projection; Photoshop export never changes the native
save target or clears native dirty state.

Current evidence and explicit gates are recorded in
`PSD_EXPORT_RELEASE_CANDIDATE.md`. PSB, Smart Object packages, PSD pattern
resources and native operations without a tested Photoshop descriptor remain
outside the released writer boundary. Supported classic adjustment nodes are
written as editable Photoshop adjustment descriptors rather than neutral
placeholders.

Color Lookup adjustments preserve an embedded 3D `.cube` payload in both
directions. LightTable stores the original bytes as a document asset and emits
those same bytes in the Photoshop Color Lookup descriptor; PSD import restores
that descriptor as a native document asset. Basic `LUT_3D_SIZE` tables and
`DOMAIN_MIN`/`DOMAIN_MAX` are supported. 1D LUTs and combined shaper/3D formats
remain an explicit unsupported boundary.

## Mapping to LightTable

- Photoshop Adjustment Layer -> LightTable adjustment/Grade or Lens Fx layer
  with mask, clipping, opacity and blend semantics.
- Smart Object filter stack -> ordered processing stack attached to a native
  smart/source owner when supported.
- destructive Image > Adjustments result -> imported raster pixels; no fake
  editable history is invented.
- layer-local filter/grade -> attached processing stack on that layer.
- Layer Style -> ordered native style stack; rasterize/merge evaluates it.
- clipping mask -> native clipping relationship visible in the Layers UI.

LightTable can expose simpler modern UX while keeping those relationships
representable. Unsupported Photoshop-specific behavior belongs in the import
report, not in conditional branches throughout the compositor.

## Comparison workflow

Fixtures should contain the smallest document that isolates one semantic and
a Photoshop-saved composite. The verification path is:

1. decode the embedded reference through its declared color path;
2. semantically import layers/assets;
3. render the native document;
4. compare in a defined common encoding/domain;
5. report sampled pixels, threshold, mean and maximum error;
6. inspect structural/editable import status separately from pixel error.

Every generated Photoshop reference records document mode, bit depth,
assigned profile, Photoshop Color Settings and the relevant RGB blend
preference. Untagged evidence is not silently presented as tagged-sRGB proof.

Golden coverage grows from order/groups/blend/opacity/masks/clipping and
transforms toward adjustments, styles, text, vectors and smart content. Web
and Electron must produce the same native document semantics.

Detailed Photoshop research and historic implementation matrices are retained
under `reference/photoshop/`; they are not the current architecture contract.

Current implementation status, corpus evidence, missing features and priority
decisions are maintained in `PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md`.
