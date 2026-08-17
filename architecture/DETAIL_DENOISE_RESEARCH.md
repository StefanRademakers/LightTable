# Detail, sharpening and denoise research

Status: implementation decision record, 2026-08-17.

## Product boundary

LightTable needs two different products that must not be presented as one
algorithm:

1. **Interactive Detail** for the current Grade workflow. It operates on the
   decoded, linear, 16-bit-capable working image and provides photographic
   sharpening plus manual luminance and color noise reduction.
2. **AI/RAW Denoise** as a later analysis-backed smart operation. It may use
   sensor metadata or a learned model and may take seconds. It is not part of
   the always-live Grade path.

The first implementation must not be called "profiled denoise". LightTable's
current source texture is normally already decoded and color-managed; it no
longer contains the original mosaiced sensor samples needed to reproduce a
camera/ISO noise profile faithfully.

## External findings

### Adobe Camera Raw / Lightroom behavior

Adobe's manual Detail controls are:

- Sharpening: Amount, Radius, Detail and Masking.
- Noise Reduction: Luminance, Luminance Detail, Luminance Contrast, Color,
  Color Detail and Color Smoothness.

Amount zero disables sharpening. Masking moves processing from the whole image
toward strong edges. Luminance Detail trades smoothness for retained fine
detail; Luminance Contrast trades smoothness for retained local contrast;
Color Detail protects thin color edges; Color Smoothness attacks larger color
mottling. Adobe advises judging these controls at 100% zoom. Camera Raw can
derive a sharpening threshold from camera model, ISO and exposure metadata for
RAW input, while its AI Denoise is a separate, GPU-heavy Enhance operation.

Sources:

- [Adobe Camera Raw sharpening and noise reduction](https://helpx.adobe.com/camera-raw/using/sharpening-noise-reduction-camera-raw.html)
- [Adobe Camera Raw Enhance / AI Denoise](https://helpx.adobe.com/camera-raw/using/enhance.html)
- [Adobe Detail controls including Color Smoothness](https://helpx.adobe.com/ie/photoshop-elements/desktop/working-with-colors/color-camera-raw.html)

### darktable behavior and lessons

darktable's profiled denoise uses camera/ISO-dependent signal-noise profiles
and offers non-local means and wavelet implementations. Its wavelet path is the
default and is less resource-intensive; one module handles luminance and
chroma independently. Critically, profiled denoise is placed before the input
color profile so the sensor-noise parameters still describe the data.

The `diffuse or sharpen` module is a generalized anisotropic, multiscale PDE
solver. It is powerful and useful as a reference for edge sensitivity,
variance thresholds, scale selection and exact neutral behavior, but its
iterations make it explicitly resource-intensive. It is not the right first
live Grade implementation.

darktable is GPL-3.0. We may study its documented behavior, test images,
pipeline placement and public algorithms, but must not copy its implementation
into LightTable.

Sources:

- [darktable profiled denoise](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/denoise-profiled/)
- [darktable diffuse or sharpen](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/diffuse/)
- [darktable wavelet concepts](https://docs.darktable.org/usermanual/development/en/darkroom/processing-modules/wavelets/)
- [darktable repository and GPL-3.0 license](https://github.com/darktable-org/darktable)

### Algorithmic basis

Sensor noise is signal-dependent. The established Poisson-Gaussian model uses a
Poisson component for photon noise and a Gaussian component for remaining
stationary sensor disturbances. This is the correct future basis for RAW and
camera-profile-aware work; a single constant Gaussian curve is not.

Non-local means preserves repeated structure by averaging pixels according to
patch similarity, but its search is expensive. It remains a useful quality
reference and possible offline/high-quality mode, not the first interactive
Grade path.

Sources:

- [Foi et al., practical Poisson-Gaussian sensor-noise model](https://pubmed.ncbi.nlm.nih.gov/18784024/)
- [Buades, Coll and Morel, non-local means](https://epubs.siam.org/doi/10.1137/040616024)

## LightTable implementation decision

Build one registered conditional `lt.detail` node in the linear-spatial stage.
Its UI is one Grade section with two subgroups, but its executor shares analysis
and scratch textures across sharpening and denoise.

### V1 controls

Sharpening:

- Amount: 0–150, neutral 0.
- Radius: 0.5–3.0 px at full document resolution.
- Detail: 0–100.
- Masking: 0–100.

Noise Reduction:

- Luminance: 0–100, neutral 0.
- Luminance Detail: 0–100, default 50; disabled when Luminance is zero.
- Luminance Contrast: 0–100, default 0; disabled when Luminance is zero.
- Color: 0–100, neutral 0.
- Color Detail: 0–100, default 50; disabled when Color is zero.
- Color Smoothness: 0–100, default 50; disabled when Color is zero.

The UI uses existing `EffectPanel`, `PanelSection` and `AdjustmentSlider`
components. Alt/Option-drag on Masking should later expose the edge mask as a
presentation-only view, following the same architecture required by Point
Color Visualize Range.

### V1 processing

Use an edge-aware, undecimated multiscale (à trous-style) decomposition rather
than non-local patch search or iterative diffusion:

- Transform once to a perceptual lightness/chroma representation while keeping
  alpha untouched.
- Estimate local variance and edge strength at each scale.
- Suppress chroma coefficients first, with Color Detail protecting fine color
  boundaries and Color Smoothness controlling coarser mottling.
- Suppress luminance coefficients with signal- and scale-dependent thresholds.
  Luminance Detail lowers the threshold around legitimate detail; Luminance
  Contrast restores guarded low-frequency contrast without recreating speckle.
- Apply edge-masked multiscale sharpening after denoise. Radius selects the
  dominant scale, Detail mixes finer scales, and Masking gates the gain using
  the shared edge estimate.
- Reconstruct once and return premultiplied linear RGB.

This does not claim Adobe numeric parity. The first parity corpus must measure
the response at 0, 5, 20, 50, 80 and 100/maximum, including flat gradients,
fine fabric/hair, skin, foliage, color-chart patches, dark shadows and clipped
highlights.

### Performance contract

- All neutral values: exact bypass, no textures, no pipeline creation and no
  GPU submission.
- Chroma-only or sharpening-only settings must skip unused branches.
- Reuse one edge/variance analysis and a bounded ping-pong texture pair.
- No CPU readback in the interactive path.
- Pointer drag updates at animation-frame cadence; React commits final state on
  pointer-up through the existing transaction system.
- Preview may use fewer scales while dragging only if pointer-up always runs
  the full result and the preview/final transition is covered by telemetry.
- Scopes consume the completed Detail output revision, never trigger Detail.
- Resource estimates and per-stage encode telemetry are mandatory before the
  node is enabled by default.

## Deferred RAW/profiled path

A future RAW source pipeline may add a pre-demosaic or pre-input-profile node
using make/model/ISO/exposure metadata and a measured Poisson-Gaussian profile.
That node must be distinct from interactive Detail. If no exact profile exists,
the UI must say generic/manual rather than silently pretending it is profiled.

AI Denoise is likewise a separate analysis-backed smart node or generated
source revision. It should cache its result, be cancellable and preserve the
original source. It must never run once per slider frame.

## Acceptance gates

- Synthetic noise fixtures with known clean references: Gaussian, shot-like,
  chroma speckle and coarse color mottling.
- Real high-ISO RAW-derived and rendered images, plus existing generic images
  from the test corpus.
- PSNR/SSIM are supporting metrics only; also inspect method-noise images,
  edge halos, color bleeding, waxy skin and repeated texture loss.
- Compare LightTable, current Lightroom/Camera Raw and darktable wavelet output
  at matched visible strength, not only matched slider numbers.
- Verify 100% and fit-view behavior separately; denoise correctness cannot be
  judged solely from a downsampled preview.
- Benchmark drag and committed quality on representative 24 MP, 45 MP and
  large layered documents.
