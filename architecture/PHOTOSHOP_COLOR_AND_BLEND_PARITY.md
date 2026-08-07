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
- 24 of 26 opaque blend modes have RMSE below 1;
- all 26 opaque blend modes have RMSE at or below 3.08;
- Multiply and Screen use the expected encoded-channel equations and are not
  the source of the broad discrepancy;
- Color Dodge/Burn require backdrop-first endpoint handling; Vivid Light has
  separately measured pure-source endpoint behavior;
- Photoshop 8-bit Hard Mix uses a binary channel-sum threshold. At the exact
  255 boundary it resolves to the backdrop side: backdrop 128..255 becomes
  white and 0..127 becomes black;
- encoded document-space coverage/compositing is required for Photoshop
  parity even though LightTable stores working textures in linear light;
- the four 50% opacity cases now measure RMSE 0.21..0.37 and the two 50% fill
  cases measure RMSE 0.30..0.31;
- the full 32-case packaged-desktop run passes, with Hard Mix at RMSE 0.07.

These findings apply to the recorded configuration. A second controlled run
now covers untagged, tagged sRGB and tagged Adobe RGB in 8 and 16 bits/channel.
It is not evidence for 32-bit Photoshop behavior, proof colors or a different
`Blend RGB Colors Using Gamma` preference.

## Controlled profile and precision matrix

The follow-up matrix contains 48 Photoshop-canonical documents: Normal,
50%-opacity Normal, Multiply, Screen, Overlay, Color, Color Dodge and Hard Mix
crossed with untagged/sRGB/Adobe RGB and 8/16-bit documents. Photoshop first
flattens each duplicate in its declared document profile and only then converts
the result to sRGB for PNG export. Converting the layered document before
flattening changes the blend domain and is not a valid oracle.

The production implementation preserves Adobe RGB 8/16-bit encoded layer
samples to the GPU boundary, decodes them directly into canonical linear
storage, and evaluates blend/coverage in the declared document profile inside
the existing compositor pass. Other embedded ICC profiles remain handled by
the lazy LittleCMS normalization boundary until a profile LUT is justified by
a supported editable document contract.

Measured packaged-desktop result on 6 August 2026:

- all 48 cases pass the RMSE <= 3 gate;
- the complete range is RMSE 0.07..0.79;
- Adobe RGB Hard Mix is RMSE 0.13 (8-bit) and 0.15 (16-bit), improved from
  10.27 and 47.47 respectively;
- the worst case is Adobe RGB Color at RMSE 0.79;
- the 16-bit import route no longer uses an authoritative RGBA8 intermediate;
- raw Difference images, 4x heatmaps, region metrics and maximum-error samples
  remain in `D:\Mediavibe\LightTableTests\BlendColorMatrix`.

The solution is profile-domain infrastructure, not an Adobe/Hard-Mix branch.
The only Hard Mix endpoint rule is the measured Photoshop rule shared by all
profiles and precisions.

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
   blend or coverage operation must match the document format contract.
4. **Display/output transform**: conversion to the display or export profile
   and requested output precision.

The native document stores source/profile provenance and document color
settings. Blend behavior is one canonical renderer contract, not a serialized
legacy/compatibility switch. The document does not store a profile copy on
every layer after that layer has been normalized. Imported unknown ICC payloads
remain preservable provenance; they are never silently guessed.

The initial production document policy is deliberately bounded:

- default new documents: sRGB working profile;
- missing profile: explicit `assumed sRGB`, never an invisible assumption;
- internal compositing/filtering: linear high precision;
- layer blending and coverage: the canonical Photoshop/PDF-compatible
  document-space path;
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
- do not add a user-facing or serialized legacy blend-gamma branch;
- do not introduce CPU readback or CPU-to-GPU image uploads;
- preserve fast exact bypasses for opaque Normal and other proven no-op cases;
- share transfer helpers across ordinary layers and Layer Styles;
- keep blur, resampling, gradients and neighborhood effects in linear space
  unless their own declared compatibility contract requires another domain;
- compile and cache the bounded matrix/TRC decode pipeline per GPU device;
- changing document profile interpretation invalidates affected composites,
  not source realization, vector geometry, text shaping or unrelated overlays.

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
  requested.

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

- [x] Add explicit Photoshop-compatible endpoint branches to Color Dodge and
  Color Burn.
- [x] Verify Color Dodge, Color Burn, Vivid Light and Hard Mix at exact and
  near-zero/one inputs.
- [x] Confirm no NaN/Inf and no regression in the remaining blend corpus.

### 2. Explicit document blend-space contract

- [x] Define one canonical document blend-space contract separate from working
  texture encoding and Grade gamma; do not serialize a legacy switch.
- [x] Route normal layers, masks, opacity, fill opacity and Layer Styles
  through the same declared contract.
- [x] Preserve imported color-profile provenance through native save/reopen.

### 3. Fused GPU implementation

- [x] Keep linear GPU storage/filtering and fuse only required domain
  conversions into the compositor.
- [x] Retain the existing sRGB decode path and opaque source realization; Adobe
  RGB adds only a cached decode pipeline and two scalar compositor uniforms.
- [x] Measure GPU frame time, submissions, transient bytes and cache behavior
  before and after on representative small and large documents.
- [x] Reject extra CPU readback/upload; the implementation remains in the
  existing compositor pass and allocates no texture-sized intermediate.

### 4. Full visual regression gate

- [x] Re-run all 32 blend fixtures in the packaged desktop and inspect their
  side-by-side images and heatmaps.
- [x] Re-run isolated and stacked Layer Style corpora, including soft alpha,
  antialiasing, masks, fill opacity, clipping and groups.
- [x] Re-run the ten-template PSD inventory and the large EHS-396 packaged
  compositor endurance audit.
- [x] Reject new halos, seams, clipping, bounds or high-zoom quality failures.

### 5. Controlled color-management matrix

- [x] Test untagged/assumed-sRGB, tagged sRGB and tagged Adobe RGB.
- [x] Test 8- and 16-bit documents; add 32-bit only when the product contract
  supports it rather than simulating parity.
- [x] Record Photoshop color settings and relevant RGB blending preference.
- [x] Compare in one declared common output encoding with profile conversion
  kept separate from blend and opacity tests.

### 6. Product exposure and roundtrip

- [x] Show profile/mode/bit depth in document status and import details.
- [x] Keep current PNG/native output explicitly sRGB and retain document blend
  profile/provenance in the current native schema. PSD export remains an explicitly sRGB,
  8-bit release-candidate boundary rather than silently claiming Adobe output.
- [x] Add the truthful document-level Assign operation using existing LightTable UI
  components and styling.
- [ ] Add Convert Profile as an undoable document operation; it remains disabled
  until it can update semantic colors and high-precision raster content together.
- [x] Do not expose a compatibility toggle; blend behavior is canonical.
- [x] Verify native roundtrip, PSD projection tests and web
  fallback behavior.

## Final performance evidence

The profile-domain work adds no full-frame pass, readback or persistent
texture. The Adobe decode pipeline is immutable and device-cached. A 16-bit
Adobe source uploads 8 bytes/pixel instead of the former clipped 4 bytes/pixel;
that transfer increase is the required precision payload, after which the
persistent `rgba16float` storage is unchanged.

On EHS-396 (3000 x 4242), eight repeated hide/show cycles produced identical
settled canvas hashes, 1.09 MiB retained JS heap, 8.56 MiB bounded GPU cache
growth, and a maximum compositor CPU encode time of 1.20 ms. The 40-case
effect corpus passed structurally with no fidelity failure. These measurements
are regression evidence, not a claim that large-template presentation latency
itself is finished product work.

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

## Primary references

- W3C Compositing and Blending Level 1 defines non-premultiplied blend inputs,
  source-over alpha composition and the standard separable/non-separable
  equations: <https://www.w3.org/TR/compositing-1/>.
- Adobe's current blend-mode descriptions define Photoshop mode intent,
  including Hard Mix and the restricted 32-bit mode set:
  <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html>.
- Adobe's layer blending documentation distinguishes layer opacity, fill
  opacity, effects, group isolation and clipping behavior:
  <https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html>.
- Adobe's color-settings documentation confirms that the optional global
  `Blend RGB Colors Using Gamma` preference changes compositing appearance and
  may differ from other applications:
  <https://helpx.adobe.com/photoshop/using/color-settings.html>.

Adobe's prose is treated as behavioral guidance, not executable truth. For
example, it describes Darker/Lighter Color as comparing the total channel
values, while controlled Photoshop output follows a Rec.601-like weighted
luminance decision far more closely. Exact acceptance therefore comes from
Photoshop-rendered fixtures recorded with profile, bit depth and color settings.
