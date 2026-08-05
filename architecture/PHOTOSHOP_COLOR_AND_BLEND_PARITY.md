# Photoshop color and blend parity

Status: authoritative implementation and verification contract, 6 August 2026.

This document defines how LightTable approaches Photoshop-compatible color,
alpha, opacity and blend behavior. It complements:

- `PHOTOSHOP_INTERCHANGE.md`, which owns PSD adapter boundaries;
- `RENDERING_AND_PROCESSING.md`, which owns the GPU render contract;
- `PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md`, which records current support;
- `PSD_BLEND_MODE_COLOR_PROFILE_CORPUS.md`, which contains measured evidence.

## Measured baseline

The current controlled corpus contains 32 Photoshop-canonical 400 x 400 PSDs:
all 26 blend modes exposed by LightTable, four 50% layer-opacity cases and two
50% fill-opacity cases. The reference run records the Photoshop color context
with every output.

The measured context is:

- RGB, 8 bits/channel;
- untagged source documents;
- Photoshop Color Settings: `North America General Purpose 2`;
- identical source pixels and semantic blend parameters in both applications.

Results:

- opaque Normal is exact in all opaque chart regions;
- 21 of 26 opaque blend modes have RMSE at or below 1;
- 24 of 26 have opaque RMSE below 3;
- Multiply and Screen use the expected encoded-channel equations and are not
  the source of the broad discrepancy;
- Vivid Light and Hard Mix are structural outliers caused by Color Dodge/Burn
  endpoint handling;
- alpha, antialias coverage, layer opacity and fill opacity expose a separate
  color-domain mismatch;
- Normal at 50% opacity produces approximately `[187, 188, 188]` in LightTable
  versus `[127, 128, 128]` in Photoshop for the controlled red/cyan sample.

These findings apply to the recorded configuration. They are not evidence for
untested tagged profiles, 16/32-bit Photoshop behavior, proof colors or a
different `Blend RGB Colors Using Gamma` preference.

## Formula contract

Let `Cb` be the backdrop, `Cs` the source, `Ab` backdrop alpha, `As` effective
source alpha after masks/coverage/layer opacity, and `B(Cb, Cs)` the blend
function in its declared blend domain. The general premultiplied source-over
shape is:

```text
Co = Cs * As * (1 - Ab)
   + Cb * Ab * (1 - As)
   + B(Cb, Cs) * As * Ab

Ao = As + Ab * (1 - As)
```

Multiply and Screen are:

```text
Multiply(Cb, Cs) = Cb * Cs
Screen(Cb, Cs)   = 1 - (1 - Cb) * (1 - Cs)
```

Correct equations alone do not establish parity. The profile transform,
transfer function, alpha representation, blend domain and the domain used for
coverage interpolation are part of the result and must be explicit.

## Canonical color contract

LightTable keeps these concepts separate:

1. **Source color description**: embedded ICC bytes or an explicit missing-
   profile interpretation, source bit depth and source color mode.
2. **Canonical working representation**: high-precision, linear, premultiplied
   GPU content used for filtering, blur, transforms and most processing.
3. **Document blend behavior**: the transfer/profile domain required when a
   blend or coverage operation must match the document's compatibility mode.
4. **Display/output transform**: conversion to the display or export profile
   and requested output precision.

The native document stores the source/profile provenance and the chosen
document working/blend policy. It does not store a profile copy on every layer
after that layer has been normalized. Imported unknown ICC payloads remain
preservable provenance; they are never silently guessed.

The initial production document policy is deliberately bounded:

- default new documents: sRGB working profile;
- missing profile: explicit `assumed sRGB`, never an invisible assumption;
- internal compositing/filtering: linear high precision;
- Photoshop compatibility blend behavior: document-defined and serialized;
- conversion to a different profile: explicit, undoable document operation;
- assigning a profile changes interpretation, not pixels, and is a distinct
  advanced operation from conversion.

## Photoshop-compatible GPU path

Photoshop parity does not require moving pixels back to the CPU or storing the
entire document encoded. The GPU path remains:

```text
linear premultiplied inputs
-> decode/unpremultiply only where the blend contract requires it
-> fused transfer to the declared blend domain
-> blend equation plus coverage/opacity composition
-> fused transfer back to linear premultiplied output
```

Implementation rules:

- perform the domain conversion in the existing compositor shader/pass;
- use a pipeline specialization or compact uniform, not a new full-frame pass;
- do not introduce CPU readback or CPU-to-GPU image uploads;
- preserve fast exact bypasses for opaque Normal and other proven no-op cases;
- share transfer helpers across ordinary layers and Layer Styles;
- keep blur, resampling, gradients and neighborhood effects in linear space
  unless their own declared compatibility contract requires another domain;
- cache pipeline variants and color transforms per device/profile/policy;
- dirtying the blend policy invalidates affected composites, not source
  realization, vector geometry, text shaping or unrelated overlays.

This adds shader ALU to affected blend pixels, but no additional texture-sized
memory and no transfer bottleneck. It is expected to be a small cost compared
with blur and multi-pass styles, but acceptance is based on measurement rather
than expectation.

## Product UI exposure

Color management should be visible where it prevents mistakes, without
placing color-science controls in the everyday Grade workflow.

### Always available

- document status shows color mode, bit depth and profile, for example
  `RGB / 16-bit / sRGB` or `RGB / 8-bit / Untagged (assumed sRGB)`;
- Open/Import reports an embedded, missing or unsupported profile;
- Export shows the target profile and whether it is embedded;
- a mismatch or unsupported conversion produces a clear warning rather than
  silently changing appearance.

### Document color settings

A compact document panel/dialog should expose:

- working profile;
- bit depth;
- `Assign profile...` and `Convert to profile...` as distinct commands;
- rendering intent and black-point compensation when a real ICC conversion is
  requested;
- one advanced Photoshop-compatibility blend policy, normally inherited from
  import and hidden from the main toolbar.

Do not expose a generic artistic gamma slider, per-layer ICC selectors or raw
transfer-function controls in the normal UI. Gamma in Grade is an image
adjustment; blend gamma is document interpretation and must not be conflated.

For web builds, unsupported host display-profile discovery must degrade to a
declared sRGB display path. Documents and exports remain deterministic across
desktop and web even when OS display color management differs.

## Six-stage execution and acceptance plan

Each production change is a separate commit and remains buildable on desktop
and web. No stage is accepted only because its aggregate RMSE improves.

### 1. Blend endpoint parity

- [ ] Add explicit Photoshop-compatible endpoint branches to Color Dodge and
  Color Burn.
- [ ] Verify Color Dodge, Color Burn, Vivid Light and Hard Mix at exact and
  near-zero/one inputs.
- [ ] Confirm no NaN/Inf and no regression in the remaining blend corpus.

### 2. Explicit document blend-space contract

- [ ] Add a serializable document blend policy separate from working texture
  encoding and Grade gamma.
- [ ] Route normal layers, masks, opacity, fill opacity and Layer Styles
  through the same declared contract.
- [ ] Preserve imported policy/provenance through native save/reopen.

### 3. Fused GPU implementation

- [ ] Keep linear GPU storage/filtering and fuse only required domain
  conversions into the compositor.
- [ ] Retain fast paths for opaque Normal and unaffected blends.
- [ ] Measure GPU frame time, submissions, transient bytes and cache behavior
  before and after on representative small and large documents.
- [ ] Reject extra CPU readback/upload or a material interaction regression.

### 4. Full visual regression gate

- [ ] Re-run all 32 blend fixtures and inspect side-by-side images and heatmaps.
- [ ] Re-run isolated and stacked Layer Style corpora, including soft alpha,
  antialiasing, masks, fill opacity, clipping and groups.
- [ ] Re-run the ten-template PSD corpus and packaged Electron/web smokes.
- [ ] Reject new halos, seams, clipping, bounds or high-zoom quality failures.

### 5. Controlled color-management matrix

- [ ] Test untagged/assumed-sRGB, tagged sRGB and tagged Adobe RGB.
- [ ] Test 8- and 16-bit documents; add 32-bit only when the product contract
  supports it rather than simulating parity.
- [ ] Record Photoshop color settings and relevant RGB blending preference.
- [ ] Compare in one declared common output encoding with profile conversion
  kept separate from blend and opacity tests.

### 6. Product exposure and roundtrip

- [ ] Show profile/mode/bit depth in document status and import/export details.
- [ ] Add document-level Assign/Convert operations using existing LightTable UI
  components and styling.
- [ ] Keep compatibility controls under Advanced and persist them in native
  documents and verified PSD projection where representable.
- [ ] Verify undo/redo, native roundtrip, PSD roundtrip warnings and web
  fallback behavior.

## Release gates

The work is release-ready only when:

- semantic values survive import, edit and supported export;
- opaque blend parity does not regress;
- alpha/opacity errors improve in isolated and contextual fixtures;
- effect boundaries remain padded correctly at high zoom;
- interactive frame pacing does not materially regress on the standard stress
  document;
- no new full-frame texture, CPU readback or upload appears on the blend path;
- unsupported profiles or Photoshop behaviors are reported, not approximated
  silently.

