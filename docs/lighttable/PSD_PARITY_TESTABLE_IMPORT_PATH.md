# PSD parity: testable import path

## Target

A PSD import is useful only when LightTable renders the imported Photoshop
document graph itself. The embedded Photoshop composite is the oracle, not the
editable result.

Every import exposes three views:

1. **Photoshop reference** — embedded composite.
2. **LightTable reconstruction** — canonical document rendered by LightTable.
3. **Difference** — absolute and amplified pixel difference plus metrics.

Never silently replace the reconstruction with the reference composite.

## Vertical gates

Each gate uses real Photoshop-authored fixtures and must render through the
normal LightTable compositor. A gate is complete only after structure,
properties, pixels and visual comparison are testable.

### Gate 1 — document graph

- [x] Worker DTO with document metadata, stable source IDs and ordered nodes.
- [ ] Raster pixels as separate **full-precision** assets. Layer assets are
      separate now, but the worker canvas bridge still normalizes them to
      8-bit PNG.
- [x] Layer bounds plus visibility, opacity, fill and transparency lock.
      Bounds are preserved as Photoshop metadata; current full-canvas assets
      intentionally render with zero canonical offset.
- [x] Exact sibling order and nested groups.
- [x] Known blend modes mapped; unknown modes preserved and reported.
- [x] Pass-through and isolated group state imported.
- [x] Photoshop reference/reconstruction/difference switch. The difference
      view is a 4x display-domain absolute-difference diagnostic and never
      replaces the reconstructed document or its scopes.
- [ ] Fixture matrix: order, hidden nodes, nested groups, opacity and blend.

This gate deliberately tests the existing canonical tree and compositor. Do
not hide failures with flattening. The compositor now recursively evaluates
pass-through and isolated groups, including group opacity, blend and bitmap
mask. Browser fixtures still have to verify Photoshop equivalence.

### Gate 2 — alpha, masks and clipping

- [ ] Layer alpha remains premultiplied linear RGB at the render contract.
- [x] Bitmap mask pixels, bounds/default color metadata and enabled state.
- [x] Mask density and feather are part of the canonical mask contract and are
      evaluated consistently for raster layers, groups, Adjustment Layers and
      Layer Style source shapes. Photoshop golden-fixture calibration remains.
- [x] Prefer Photoshop's rasterized real/vector-mask result when present while
      preserving the original user-mask and vector-path descriptors for later
      native path reconstruction.
- [x] Clipping stacks for raster, group and Adjustment nodes. The compositor
      materializes the nearest unclipped sibling's alpha once per active
      chain; malformed chains without a base render transparently.
- [ ] Fixture matrix covering transparent edges and nested masks.

### Gate 3 — Layer Styles

- [x] Feed imported `ag-psd` effect descriptors through
      `layerStylePsdAdapter`, never through a second PSD-only renderer.
- [x] Apply imported styles to raster layers and isolated group composites
      through the shared Layer Style pipeline. Adjustment-node styles and
      Photoshop fixture calibration remain.
- [ ] Import effect ordering, global light, scale, blend, opacity and Fill.
- [ ] Exercise every currently implemented LightTable style immediately:
      Drop Shadow, Inner Shadow, Outer/Inner Glow, Bevel & Emboss, Satin,
      Color/Gradient/Pattern Overlay and Stroke.
- [x] Preserve unsupported descriptor fields on the canonical imported node
      and report lossy mappings.
- [x] Import embedded Photoshop pattern resources and resolve Pattern Overlay
      and pattern Stroke through the shared LightTable pattern asset path.
      `ag-psd` currently exposes these pattern pixels as 8-bit RGBA.
- [ ] One Photoshop fixture per effect, plus combined-effect fixtures.
- [ ] Merge/flatten tests include rendered styles.

### Gate 4 — Adjustment Layers

- [x] Map every already available LightTable adjustment to the shared module
      registry. Exposure, Brightness/Contrast, Vibrance, Hue/Saturation,
      Curves, Levels, Invert, Black & White, Color Balance and Photo Filter
      now have native mappings. Exact fixture calibration remains for the
      explicitly reported approximate mappings.
- [x] Preserve unknown Photoshop adjustment descriptors.
- [x] Correct ordered stack, recursive group scope, clipping, bitmap mask,
      opacity and native blend-mode evaluation. Photoshop golden fixtures
      remain required before visual-parity sign-off.
- [ ] Single-adjustment and combined-stack golden fixtures.

### Gate 5 — semantic layer types

- [ ] Text, vector/fill, Smart Object and Smart Filter DTOs.
- [ ] Editable native mapping where supported.
- [ ] Explicit preview-backed node plus preserved descriptor where not yet
      editable.
- [ ] Never substitute the full-document composite for one unsupported node.

## Import contract

The worker owns `ag-psd` and returns an immutable DTO:

- document/canvas/color metadata;
- recursive nodes in explicit bottom-to-top order;
- separate pixel and mask assets;
- raw preserved descriptors;
- per-property support classification;
- embedded Photoshop reference.

The main-thread adapter is the only place that creates LightTable
`ImageDocument` nodes. Import must not mutate `ag-psd` objects or leak them
into editor state.

## Verification report

For each file record:

- imported structure and property snapshot;
- unsupported/preserved/lossy fields;
- reference and reconstruction dimensions/profile;
- maximum and mean absolute error;
- differing-pixel percentage at configurable thresholds;
- generated reference, reconstruction and heat-map images.

The import now computes sampled reconstruction metrics on the GPU: differing
pixel percentage at a configurable threshold, mean absolute RGB error, maximum
channel error, sample count and stride. The editor exposes these alongside a
structured per-property support classification (`native`, `approximate`,
`preserved`, `raster-preview` or `placeholder`). The classification and warnings
are persisted in the native LightTable document and exposed through a filterable
import-report dialog.

The original PSD byte stream is not embedded in the native LightTable
container. During the import session, **Original** is Photoshop's embedded
composite and **Corrected** is LightTable's semantic reconstruction. A native
save stores the converted layer assets and its own flattened preview; exact
PSD re-export and unknown-block preservation remain a separate write-back
path.

Persisted exported heat-map fixtures remain test-corpus work.

## Manual comparison smoke test

1. Open a Photoshop-authored PSD and verify that **Corrected** contains an
   editable layer/group/adjustment tree rather than the flattened composite.
2. Toggle **Original** and verify that it shows Photoshop's embedded composite.
3. Open **Difference** and inspect the sampled mean/max/differing-pixel metrics.
4. Activate the import status in the bottom bar and filter the report by
   Native, Approximate, Preserved, Preview and Missing.
5. Save as a layered LightTable document, close it, reopen it and verify the
   native layer tree and flattened preview without expecting the source PSD
   reference to have been duplicated.
6. With suitable fixtures, verify nested groups, clipping, real/vector masks,
   Pattern Overlay and pattern Stroke against Photoshop.

The first useful checkpoint is Gate 1 plus the three comparison views. It will
tell us immediately whether the canonical tree, asset model and compositor are
fit for PSD parity.
