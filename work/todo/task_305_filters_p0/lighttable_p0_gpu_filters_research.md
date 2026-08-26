# LightTable P0 GPU Filters — Research & Implementation Specification

**Status:** Working implementation spec  
**Date:** 2026-08-25  
**Scope:** P0 filters only  
**Target:** LightTable desktop renderer, WebGPU/WGSL-first, high image quality, very low latency  

---

## 0. Goal

Implement the current LightTable **P0 filter set** using the fastest high-quality GPU algorithms we can reasonably ship, while avoiding legacy Photoshop implementation constraints.

The target is **not** to clone Photoshop internally. The target is:

1. Photoshop-familiar behavior where users expect it.
2. Higher quality where a modern algorithm is clearly better.
3. Interactive performance on modern GPUs.
4. Shared GPU primitives instead of one bespoke renderer per menu item.
5. Deterministic, non-destructive filters suitable for LightTable smart layers.
6. WebGPU/WGSL portability as the baseline.
7. Optional faster paths when `shader-f16`, subgroups, or hardware-specific tuning are available.

### Current P0 working list

- Gaussian Blur
- Motion Blur
- Surface Blur / Edge-Aware Blur
- Displace
- Median
- Reduce Noise / Denoise
- Smart Sharpen
- Unsharp Mask
- High Pass
- Maximum
- Minimum
- Offset

Already solved elsewhere in LightTable and therefore **not part of this filter implementation task**:

- Liquify
- Lens Correction
- Film Grain / Add Noise
- Camera Raw-like image adjustments

---

# 1. High-level architecture recommendation

Do **not** build 12 unrelated filters.

Build approximately six reusable GPU cores and expose the P0 filters as parameterized nodes on top of them.

| GPU core | Filters using it |
|---|---|
| `BlurCore` | Gaussian Blur, Unsharp Mask, High Pass, Smart Sharpen base/detail separation |
| `EdgeAwareCore` | Surface Blur, Smart Sharpen helpers, denoise helpers |
| `WarpSampler` | Displace, Offset, later Wave/Ripple/Twirl/etc. |
| `RankCore` | Median |
| `MorphologyCore` | Maximum, Minimum |
| `DenoiseFrequencyCore` | Reduce Noise, future deconvolution / large convolution paths |

The renderer should aggressively fuse nodes where mathematically safe.

Example:

```text
source
  -> Gaussian(radius=4)
  -> HighPass(radius=4)
  -> output
```

should **not** necessarily materialize both intermediates. For several filters the final operation can be produced directly from the source + blur result.

---

# 2. Global image-processing rules

These rules apply to the complete P0 implementation.

## 2.1 Work in the correct color domain

For physically meaningful convolution and detail extraction, prefer a **linear-light working buffer**.

Do not blindly blur/filter gamma-encoded display RGB if the current LightTable pipeline already has a linear working representation.

Sharpen algorithms borrowed from post-processing/game SDKs may have assumptions about display-referred input. Treat those implementations as architectural references, not necessarily as drop-in color science.

AMD FidelityFX CAS explicitly documents linear input requirements in its current SDK integration guidance.

Source:
- https://gpuopen.com/manuals/fidelityfx_sdk/techniques/contrast-adaptive-sharpening/

## 2.2 Premultiplied alpha

Spatial filters should operate with correct premultiplied-alpha behavior to prevent color bleeding from fully or partially transparent pixels.

Recommended internal behavior:

```text
straight RGBA
  -> premultiply
  -> filter / resample
  -> keep premultiplied through composition if possible
  -> unpremultiply only when actually required
```

Reference explanation:
- https://ciechanow.ski/alpha-compositing/

## 2.3 Do not force FP16 everywhere

Provide at least:

- portable FP32 WGSL path
- optional FP16-heavy path if `shader-f16` is available and validation shows no unacceptable quality loss

Current WebGPU feature detection exposes `shader-f16` as optional.

Source:
- https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

## 2.4 Subgroups are an optimization, not a dependency

Subgroups can make reductions, scans, sorting/select operations and shared communication faster, but they are optional across WebGPU adapters/browsers.

Design the algorithms so:

```text
portable workgroup/shared-memory implementation
        +
optional subgroup specialization
```

Source:
- https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

## 2.5 Tune workgroup dimensions per adapter family

Do not assume one workgroup shape is always optimal.

A practical startup strategy:

1. identify adapter/vendor/device class;
2. choose a known preset;
3. optionally run a tiny one-time benchmark;
4. cache the selected shader permutation.

NVIDIA NIS explicitly ships hardware-dependent optimizer choices for block dimensions/thread-group sizes, which supports this approach.

Source:
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling

## 2.6 Quality tests must compare images, not only milliseconds

Every optimized approximation needs a high-quality reference implementation.

Test at least:

- flat gradients
- high-frequency texture
- hair/fur
- text/UI/vector edges
- skin
- dark noisy photographs
- HDR/bright highlights
- alpha edges
- extreme radii/parameters
- 8-bit-looking banding-sensitive gradients even when internal data is float

Metrics can include PSNR/SSIM where useful, but visual difference heatmaps and adversarial fixtures are mandatory.

---

# 3. Gaussian Blur — P0

## Recommendation

Use **AMD FidelityFX Blur 1.1 as the main architectural reference** for the normal-radius path.

FidelityFX Blur is currently documented as a compute-based, optimized **single-pass Gaussian blur**. Its implementation performs the separable horizontal + vertical work inside one compute dispatch by caching intermediate horizontal results in thread-group shared memory.

Source:
- https://gpuopen.com/manuals/fidelityfx_sdk/techniques/blur/

This is a very good fit for LightTable because traditional separable Gaussian usually means:

```text
input
 -> horizontal pass
 -> intermediate global texture
 -> vertical pass
 -> output
```

while a tiled single-dispatch design can avoid an entire global-memory intermediate round trip.

## Proposed `BlurCore`

Conceptually:

```text
1. Load source tile + halo
2. Horizontal Gaussian into workgroup/shared cache
3. Reuse/cache rows in a ring-style scheme
4. Vertical Gaussian from shared values
5. Write result
```

### Key goal

Memory bandwidth is likely to dominate before arithmetic does. Optimize data movement first.

## Kernel/radius strategy

Do not use one algorithm for all radii.

### Range A — small radius

Use exact or near-exact separable Gaussian.

- precomputed symmetric weights
- constant/unrolled kernels when practical
- group-shared tile + halo
- FP32 accumulation unless FP16 path has been validated

### Range B — medium radius

Use paired/bilinear tap reduction where sampling semantics allow it.

Two adjacent weighted samples can often be represented by a single linearly filtered sample at a shifted location, reducing texture-fetch count significantly.

Useful background/reference:
- https://www.rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling/

This is an implementation technique to verify against WGSL/WebGPU sampler behavior and the chosen storage/sample format.

### Range C — very large radius

Do **not** allow cost to scale linearly forever with radius.

Benchmark alternatives such as:

- repeated box/moving-average approximations
- recursive/IIR Gaussian approximation
- multi-resolution Gaussian path

Intel has a useful engineering survey comparing real-time GPU blur families including Gaussian, moving-average and Kawase-style approaches:
- https://www.intel.com/content/www/us/en/developer/articles/technical/an-investigation-of-fast-real-time-gpu-based-image-blur-algorithms.html

### Important: do not silently replace Gaussian with Kawase

Dual/iterative Kawase blur is excellent for bloom/UI effects, but its point spread function is not an exact Gaussian.

For an image editor, a user expects `Gaussian Blur` to remain visually stable and mathematically predictable.

Kawase may be useful for a distinct effect or a deliberately approximate preview mode, but should **not** be the final Gaussian renderer by default.

## Fusion opportunities

`BlurCore` should support output modes so one blur calculation can directly produce:

```text
GAUSSIAN:
    out = blur

HIGH_PASS:
    out = source - blur

UNSHARP:
    detail = source - blur
    out = source + detail * amount

SMART_SHARPEN_BASE:
    produce base/detail fields for next stage
```

This can remove entire additional full-frame passes.

## Acceptance criteria

- stable at tiny and very large radii
- no alpha color fringe
- no visible tile seams
- predictable sigma/radius mapping
- identical output regardless of workgroup boundaries
- filter remains responsive on multi-megapixel documents

---

# 4. High Pass — P0

High Pass should be treated as a cheap mode of `BlurCore`, not a separate filter engine.

Core operation:

```text
low  = gaussian(source, radius)
high = source - low
```

Internally retain a **signed detail signal**.

If the UI/filter output must mimic a traditional neutral-gray high-pass visualization, apply the neutral bias only at the output/view representation stage.

Do not permanently destroy the signed representation if downstream effects can consume it directly.

## Benefits

The same detail signal can later support:

- High Pass filter
- sharpening
- texture/detail masks
- frequency-separation tools
- edge/detail analysis

---

# 5. Unsharp Mask — P0

Again, this should be a `BlurCore` mode.

Core equation:

```text
low    = gaussian(source, radius)
detail = source - low
out    = source + amount * gated(detail)
```

`Threshold` should suppress very small local differences so noise is not amplified unnecessarily.

## Recommended threshold domain

Prefer thresholding based on a perceptual/luminance/detail metric instead of naïvely thresholding R, G and B independently.

Goal: avoid chromatic edge artifacts and rainbow noise amplification.

## Photoshop behavior reference

Adobe describes Unsharp Mask as increasing contrast around edge detail, and Smart Sharpen's Gaussian mode as similar to Unsharp Mask.

Sources:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html
- https://helpx.adobe.com/ca/photoshop/desktop/effects-filters/smart-filters/sharpen-controls-with-smart-sharpen.html

## Fusion

Best case:

```text
source tile
 -> Gaussian in workgroup memory
 -> compute source - blur
 -> threshold/gain
 -> write final sharpened pixel
```

No globally materialized blur texture unless another node needs it.

---

# 6. Surface Blur / Edge-Aware Blur — P0

## Photoshop semantic target

Photoshop Surface Blur is explicitly edge-preserving and controlled by `Radius` and `Threshold`.

Adobe reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

Do not assume Photoshop's internal implementation is desirable. Reproduce the useful behavior, then exceed it where possible.

## Required reference path

First implement a slow/high-quality **reference bilateral filter** for correctness testing.

Do not ship brute-force bilateral as the main production path for large radii.

## Production candidate A — Fast Guided Filter

The Fast Guided Filter by Kaiming He and Jian Sun is a particularly strong candidate.

The paper shows that guided filtering can be accelerated using subsampling, reducing complexity from O(N) to roughly O(N / s²) for subsampling ratio `s`, and reports greater than 10x speedup in multiple uses with little visible degradation.

Primary source:
- https://arxiv.org/abs/1505.00996

### Why it maps well to WebGPU

The algorithm is composed largely of:

- downsampling
- local means
- local correlations
- box filtering
- simple coefficient solve
- upsampling/reconstruction

These are GPU-friendly and can share prefix/box-filter infrastructure later.

### Candidate pipeline

```text
input / guide
 -> downsample
 -> compute local means/correlations
 -> solve linear coefficients a,b
 -> smooth coefficients
 -> upsample coefficients
 -> reconstruct full-res output
```

## Production candidate B — Bilateral Grid

The bilateral grid is another strong option when more bilateral-like behavior is desirable.

It lifts the image into a higher-dimensional grid (typically x, y, intensity/range), performs local operations there, then slices back to the image.

Primary project/paper:
- https://groups.csail.mit.edu/graphics/bilagrid/

The original work specifically targets real-time edge-aware image processing on GPUs.

The project also historically published source code under a permissive MIT-style license notice:
- https://groups.csail.mit.edu/graphics/bilagrid/code.html

### Caution

Do not copy old GPU code blindly. Re-derive the architecture for modern WGSL and current LightTable formats.

## Candidate C — Domain Transform

Domain Transform edge-aware filtering is also valuable research, especially for linear-time edge-aware smoothing.

Background:
- https://www.inf.ufrgs.br/~eslgastal/DomainTransform/

The recursive dependencies can be less convenient for a first portable WebGPU implementation, so this is currently a secondary candidate rather than the preferred first path.

## Recommended bake-off

Build:

```text
Reference: brute/high-quality bilateral
Candidate A: Fast Guided Filter
Candidate B: Bilateral Grid
```

Then tune a user-facing parameter mapping:

```text
Radius    -> spatial support
Threshold -> edge/range sensitivity
```

Compare:

- skin smoothing
- hair against background
- line art
- text edges
- noisy shadows
- large smooth gradients

## Current preference

**Fast Guided Filter first**, Bilateral Grid as a serious alternative if visual behavior is closer to the target.

---

# 7. Displace — P0

The displacement math itself is cheap. The quality is determined mostly by **resampling and anti-aliasing**.

Basic form:

```text
displacement = displacementTexture(...)
sourceUV = outputUV + displacement.xy * scale
out = sample(source, sourceUV)
```

## Do not settle for naïve bilinear-only HQ output

Bilinear is useful for fast previews, but strong deformation can become soft or aliased.

### HQ reconstruction target

Implement a reusable `WarpSampler` with at least:

- nearest (utility/debug)
- bilinear fast
- Catmull-Rom/bicubic-style HQ reconstruction

Efficient bicubic/Catmull-Rom GPU reconstruction can reduce the naïve 16-tap requirement by exploiting hardware linear filtering.

Useful implementation reference:
- https://rreusser.github.io/notebooks/bicubic-texture-interpolation-using-linear-filtering/

Treat this as a mathematical/implementation reference, not a required library dependency.

## Critical improvement: deformation-aware LOD

Under strong displacement, some output pixels represent a compressed region of source space.

If the sampler always uses mip 0, the result aliases even if bicubic interpolation is used.

Estimate the local mapping derivative/Jacobian:

```text
sourceUV(x,y) = uv + D(x,y)

J = d(sourceUV) / d(outputUV)
```

Use this footprint to choose sampling gradients/mip level.

WGSL provides explicit-gradient sampling with `textureSampleGrad`.

Current WGSL spec:
- https://www.w3.org/TR/WGSL/

Relevant function background:
- https://www.w3.org/TR/2026/CRD-WGSL-20260513/

## `WarpSampler` should become reusable infrastructure

Future users:

- Wave
- Ripple
- Twirl
- Spherize
- perspective warp
- mesh warp
- some Liquify presentation paths
- lens/distortion utilities

Spend engineering time here once.

---

# 8. Offset — P0

Offset should often cost **zero additional render passes**.

Represent it in the render graph as a coordinate transform whenever possible:

```text
sampleCoordinate = baseCoordinate + offset
```

Example graph:

```text
source
 -> Offset(20, -15)
 -> GaussianBlur(8)
```

can potentially compile so the Gaussian source sampling already includes the offset.

No separate Offset output texture is needed unless:

- Offset is explicitly materialized/cached;
- another branch needs the offset result;
- a boundary-mode requirement forces a distinct resource stage.

## Boundary modes

Support explicit, deterministic edge behavior:

- transparent
- clamp
- wrap

Potential later option:

- mirror

## Fallback materialized path

A standalone Offset pass should be essentially one source sample + one output write per pixel.

---

# 9. Median — P0

This deserves a modern implementation rather than a generic NxN sort.

## Key recent research

Louis Sugy, **A Fast Parallel Median Filtering Algorithm Using Hierarchical Tiling** (2025).

Primary paper:
- https://arxiv.org/abs/2507.19926

The paper introduces hierarchical tiling plus two variants:

- a data-oblivious selection-network approach that can remain heavily register-based;
- a data-aware approach using random-access memory.

The paper reports up to approximately 5x performance improvement versus contemporary GPU state of the art in tested cases and covers kernel sizes from 3x3 through 75x75 for several data widths.

This should be considered the main modern research reference for LightTable's GPU median design.

## Proposed `RankCore`

Use multiple paths.

### Small kernels

For sizes such as:

```text
3x3
5x5
7x7
possibly 9x9 / 11x11 depending benchmark
```

use generated compare-exchange / selection networks.

Benefits:

- predictable control flow
- register-heavy
- no generic sort allocation
- easy shader specialization

Do not hand-maintain huge networks. Generate them offline/build-time and test against CPU reference.

### Medium/large kernels

Port/adapt the hierarchical tiling concepts from Sugy's paper rather than extending naïve sorting.

### Crossover must be measured

Do not encode a theoretical crossover forever.

Benchmark candidates on:

- NVIDIA
- AMD
- Intel
- Apple/Metal backend if relevant to LightTable desktop distribution

The best crossover can depend on register pressure, shared-memory size and compiler behavior.

## Channel semantics

Decide explicitly whether Median means:

1. independent per-channel RGB median; or
2. vector/luminance-aware median.

Photoshop-compatible user expectations are likely closer to per-channel behavior, but advanced modes could later exist separately.

For P0, prioritize deterministic Photoshop-familiar results and performance.

---

# 10. Maximum / Minimum — P0

Treat these as morphology primitives:

```text
Maximum = dilation
Minimum = erosion
```

Adobe reference for filter family behavior:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Small radius path

Use a tiled direct min/max filter with workgroup/shared memory.

For tiny kernels, direct comparison can be fastest and simplest.

## Large square/separable path — van Herk / Gil-Werman

For large 1D structuring elements, investigate/implement **van Herk/Gil-Werman (vHGW)**.

The family is attractive because work per output becomes effectively independent of radius compared to naïve O(r) sliding windows.

GPU reference material:
- https://www.nvidia.com/content/GTC/posters/14_Domanski_Parallel_vanHerk.pdf

Conceptually a 1D dilation/erosion is built from prefix/suffix extrema and combined per output position.

For square kernels:

```text
horizontal morphology
 -> vertical morphology
```

## Roundness / circular structuring elements

A true disk is not separable in the same way as a square.

For a Photoshop-like roundness option, investigate directional/octagonal decomposition rather than brute-forcing every pixel inside a large disk.

Candidate idea:

```text
horizontal
vertical
diagonal +45 deg
diagonal -45 deg
```

with tuned radii, possibly more directions for high-quality modes.

This requires a visual/reference bake-off; do not claim mathematical exactness if using a polygonal approximation.

## Reuse

`MorphologyCore` will later be useful for:

- mask grow/shrink
- matte cleanup
- selection expansion/contraction
- edge cleanup
- local mask repair

Make it a first-class engine primitive.

---

# 11. Motion Blur — P0

Motion Blur is one of the P0 filters that should receive an explicit algorithm bake-off because the best approach changes strongly with blur length.

Photoshop exposes the concept as direction/angle plus distance.

Adobe reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Path A — short blur

For short kernels, direct directional convolution is likely fastest.

```text
for taps along direction:
    accumulate weighted sample
```

Use:

- symmetric sampling where possible
- paired bilinear taps
- stable normalized weights
- alpha-correct filtering

## Path B — medium blur

Still benchmark direct gather first.

Modern GPUs can handle a surprising number of coherent texture reads efficiently, particularly when adjacent pixels follow the same direction.

Do not introduce algorithmic complexity before measuring the actual crossover.

## Path C — very long blur

Hundreds of source samples per output pixel are not acceptable.

Candidate approaches:

### C1. Axis transform + running sum / moving average

Transform coordinates so the motion direction aligns with a filtering axis, apply a fast 1D window/running-sum style blur, then reconstruct.

Research carefully for quality at subpixel angles and boundaries.

### C2. Frequency-domain convolution

FFT convolution becomes increasingly attractive for very large kernels.

A WebGPU/WGPU FFT implementation exists as a useful ecosystem reference:
- https://docs.rs/wgsl-fft/latest

Do **not** automatically use FFT for normal blur distances. FFT setup/transforms can be far slower than direct taps until the kernel is sufficiently large.

## Required benchmark matrix

Test distances approximately:

```text
1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024 px
```

at several angles:

```text
0, 15, 30, 45, 75, 90, 135 deg
```

and multiple document sizes.

Use measured crossover thresholds.

---

# 12. Smart Sharpen — P0

Do not simply rename AMD CAS or NVIDIA NVSharpen to `Smart Sharpen`.

They are excellent low-cost sharpening references, but an image editor needs explicit frequency/radius control and stronger halo/noise management.

## Photoshop semantic baseline

Current Photoshop Smart Sharpen exposes:

- Amount
- Radius
- Reduce Noise
- Remove: Gaussian Blur / Lens Blur / Motion Blur

Adobe reference:
- https://helpx.adobe.com/ca/photoshop/desktop/effects-filters/smart-filters/sharpen-controls-with-smart-sharpen.html

Adobe specifically describes Lens Blur removal as targeting edges/details with fewer halos than basic Gaussian-style sharpening.

## Useful reference A — AMD CAS

AMD FidelityFX Contrast Adaptive Sharpening is a low-overhead adaptive sharpener intended to provide natural sharpening while limiting artifacts.

Source:
- https://gpuopen.com/manuals/fidelityfx_sdk/techniques/contrast-adaptive-sharpening/

Use CAS as a source of ideas for:

- local contrast adaptation
- cheap neighborhood analysis
- halo-resistant gain
- FP16/FP32 shader permutation thinking

Do not assume its exact output is appropriate for a photo editor.

## Useful reference B — NVIDIA NVSharpen

NVIDIA Image Scaling includes a dedicated adaptive directional sharpening-only mode, `NVSharpen`.

Primary repo:
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling

Core shader/source:
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling/blob/main/NIS/NIS_Scaler.h

The code/reference is especially useful for:

- directional edge analysis
- local contrast limiting
- USM-like detail terms
- ringing suppression
- shared-memory tiling
- vendor-aware block/thread tuning

The source header carries an MIT license notice; still preserve notices and independently verify the repository's current license before directly integrating source.

## Proposed LightTable Smart Sharpen architecture

```text
1. base/detail decomposition at user radius
2. edge/direction confidence
3. local noise confidence
4. adaptive gain
5. halo/ringing limiter
6. highlight/shadow optional controls later
```

Conceptual model:

```text
base   = blur(source, radius)
detail = source - base

edgeConfidence  = edge/directional analysis
noiseConfidence = estimateNoiseOrLocalVariance(...)

adaptiveGain =
    amount
    * edgeConfidence
    * noiseSuppression
    * haloLimiter

out = source + detail * adaptiveGain
```

## Remove modes

### Gaussian

Use adaptive Unsharp Mask-style detail extraction.

### Lens

Do **not** fake this with another Gaussian radius.

Investigate an edge-aware/detail-aware reconstruction path using directional analysis and local ringing suppression.

First target should be visibly lower haloing than the Gaussian mode at equal apparent sharpness.

### Motion

If a known line point-spread function is assumed, regularized deconvolution is a serious candidate.

Investigate:

- Wiener deconvolution as the first interactive HQ candidate
- Richardson-Lucy only as a later optional expensive mode if it offers meaningful quality gain without unacceptable ringing/noise

Do not block initial P0 Smart Sharpen on perfect deconvolution. Gaussian + Lens-quality mode can ship first if needed.

## Noise reduction interaction

Sharpening tends to amplify noise. `Reduce Noise` should not be a generic blur pasted afterward.

Prefer attenuating sharpening gain in locally noise-like regions.

A good result retains real edge/detail contrast while declining to boost unstructured high-frequency noise.

---

# 13. Reduce Noise / Denoise — P0

This is the most open P0 item. Do not lock the final production algorithm before benchmarking.

## Reference quality baseline

BM3D remains an important classical denoising baseline because it exploits non-local patch similarity and collaborative transform-domain filtering.

A useful modern variation is **G-BM3D**.

Paper:
- https://arxiv.org/abs/2103.10765

The authors report similar quality to the original BM3D approach while achieving large speedups in their implementation and restructure block matching / 3D filtering in ways intended to map more effectively to GPU computation.

The paper reports roughly 5–20x speed improvements over their original baseline implementation, but **do not translate those numbers directly into expected LightTable WGSL performance**.

## Candidate A — multiscale wavelet denoise

Build this first as a fast, controllable baseline.

Typical structure:

```text
source
 -> wavelet / multiscale decomposition
 -> estimate noise level
 -> scale-dependent coefficient shrinkage
 -> reconstruct
```

Advantages:

- highly parallel
- predictable memory use
- good interactive behavior
- easy to parameterize
- no neural model weights
- suitable for a portable WebGPU baseline

Potential disadvantages:

- can look less natural than strong non-local methods on repeating texture
- thresholding can create waxy/over-smoothed output if tuned poorly

## Candidate B — G-BM3D-inspired prototype

Implement a research prototype after the wavelet baseline.

Focus especially on:

- GPU-friendly block matching
- patch grouping representation
- batching transform-domain filtering
- minimizing random global memory access

Do not optimize only for PSNR. Inspect natural texture retention.

## Candidate C — GPU Non-Local Means

Useful intermediate research candidate, but naïve NLM is sampling-heavy.

Only keep it if a tiled/search-window optimized version offers a useful quality/performance point between wavelet and BM3D-like methods.

## Candidate D — lightweight neural restoration

Out of scope for the first core P0 implementation unless LightTable already has a model execution layer that makes this trivial.

P0 should have a high-quality non-neural path that is always available.

## Required denoise test corpus

Include:

- synthetic Gaussian noise at known sigma
- Poisson-like/image-dependent noise
- chroma-heavy shadow noise
- high ISO photographs
- fine fabric
- hair/fur
- grass/leaves
- skin
- stars/night sky
- text/line-art

Evaluate both:

- noise removal
- texture retention
- edge stability
- chroma artifacts
- temporal instability is irrelevant for still images, but deterministic output is required

## Current recommendation

Ship path should likely become:

```text
Fast / interactive:
    GPU multiscale wavelet denoise

High Quality candidate:
    G-BM3D-inspired GPU implementation
```

Do not decide whether G-BM3D replaces or complements the wavelet path until a real LightTable WebGPU prototype is measured.

---

# 14. Recommended implementation order inside P0

The public priority remains P0 for all items. This is only the engineering order that maximizes shared infrastructure early.

## Phase 1 — BlurCore

Implement:

1. Gaussian Blur
2. High Pass
3. Unsharp Mask

Why first:

- highly reusable
- very visible
- straightforward quality reference
- immediately enables Smart Sharpen work

## Phase 2 — WarpSampler

Implement:

4. Displace
5. Offset

Include:

- bilinear fast sampling
- HQ reconstruction
- boundary modes
- deformation-aware LOD research

## Phase 3 — MorphologyCore

Implement:

6. Maximum
7. Minimum

Use direct tiled path + large-radius vHGW path.

## Phase 4 — RankCore

Implement:

8. Median

Use recent hierarchical tiling research as the main design reference.

## Phase 5 — EdgeAwareCore

Implement:

9. Surface Blur

Build reference bilateral + Fast Guided + Bilateral Grid candidate and choose empirically.

## Phase 6 — Motion Blur

Implement:

10. Motion Blur

Benchmark kernel-length crossovers rather than assuming one universal method.

## Phase 7 — Smart Sharpen

Implement:

11. Smart Sharpen

Reuse BlurCore plus directional/adaptive ideas from NVSharpen/CAS.

## Phase 8 — Denoise bake-off

Implement:

12. Reduce Noise / Denoise

Wavelet baseline first, G-BM3D research path second.

---

# 15. Benchmark specification

Performance claims should be generated inside the actual LightTable renderer.

## GPUs

At minimum benchmark representative hardware from:

- NVIDIA high-end desktop
- NVIDIA mainstream
- AMD RDNA-class desktop
- Intel integrated/discrete where supported
- Apple Silicon if LightTable ships on macOS WebGPU/Metal

## Resolutions

At least:

- 1920x1080
- 2560x1440
- 3840x2160
- ~24 MP photo
- ~45 MP photo

## Timing

Measure separately:

- shader execution GPU timestamp if available
- dispatch overhead
- intermediate allocation/reuse overhead
- total render-graph latency

Warm shaders/pipelines before steady-state benchmark.

Also record cold-start cost separately.

## Cache strategy

Cache/reuse:

- pipelines per device + permutation
- Gaussian weights per discrete radius/sigma configuration where possible
- temporary textures from a renderer pool
- adapter tuning decisions

Avoid creating GPU pipelines or allocating large textures on every slider change.

---

# 16. Suggested shader permutation policy

Do not generate hundreds of permutations without evidence.

Reasonable dimensions may include:

```text
precision:
    f32
    f16-optimized

workgroup preset:
    vendor/generic presets

kernel class:
    small
    medium
    large

filter mode:
    blur
    high-pass
    unsharp
```

Dynamic uniform parameters are preferable for ordinary filter controls. Compile-time specialization is for code paths where it materially changes register usage, loop unrolling or memory layout.

---

# 17. Reference implementation policy

Every production optimization should have a slower CPU or straightforward GPU reference implementation for tests.

Examples:

| Filter | Reference |
|---|---|
| Gaussian | direct/separable high-precision convolution |
| Surface | brute bilateral |
| Median | CPU sorted window |
| Max/Min | CPU direct morphology |
| Displace | high-precision CPU bicubic reference |
| Motion | direct high-sample line integral |
| Unsharp | direct Gaussian + equation |
| Denoise | trusted offline/reference implementation where licensing permits |

Unit tests should generate small deterministic images where exact or tight numerical comparisons are possible.

---

# 18. Things the coding agent should explicitly avoid

1. **Do not** implement every Photoshop filter as an isolated shader architecture.
2. **Do not** use Dual Kawase as the final Gaussian Blur implementation just because it is fast.
3. **Do not** scale Gaussian cost linearly to absurd radii without an algorithm switch.
4. **Do not** brute-force large Surface Blur/bilateral kernels in production.
5. **Do not** implement Median as a generic full sort for all kernel sizes.
6. **Do not** implement large Maximum/Minimum as O(radius) comparisons per pixel forever.
7. **Do not** use bilinear mip-0 sampling as the only HQ Displace mode.
8. **Do not** sharpen RGB channels independently without evaluating chromatic artifacts.
9. **Do not** sharpen straight-alpha/gamma-space data accidentally.
10. **Do not** make `shader-f16` or subgroups mandatory.
11. **Do not** hard-code NVIDIA/AMD-specific workgroup assumptions globally.
12. **Do not** copy reference code into LightTable without verifying the exact current license of that code/file.
13. **Do not** quote third-party benchmark numbers as LightTable performance. Re-benchmark everything in WGSL and the real renderer.

---

# 19. Licensing / source-use notes

Treat papers, manuals and SDKs primarily as **research references** unless the exact source-file license has been checked.

## NVIDIA Image Scaling / NVSharpen

The published `NIS_Scaler.h` currently includes an MIT license notice.

References:
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling/blob/main/NIS/NIS_Scaler.h

## Bilateral Grid code

The historical project code page displays a permissive MIT-style license notice.

Reference:
- https://groups.csail.mit.edu/graphics/bilagrid/code.html

## AMD FidelityFX

AMD's current SDK has explicit licensing files and notices, and individual files/components can carry different terms. **Verify the exact file/version before code reuse.**

License reference:
- https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/blob/main/docs/license.md

Repository:
- https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK

For LightTable, it may be cleaner to reproduce the published algorithmic ideas in WGSL rather than directly transplant SDK integration code.

---

# 20. Primary research/reference sources

## Gaussian / blur

### AMD FidelityFX Blur 1.1
Highly optimized single-dispatch compute Gaussian blur; main architectural reference for `BlurCore`.

- https://gpuopen.com/manuals/fidelityfx_sdk/techniques/blur/

### Intel — Investigation of fast real-time GPU blur algorithms
Useful comparative engineering background for algorithm switching at large radii.

- https://www.intel.com/content/www/us/en/developer/articles/technical/an-investigation-of-fast-real-time-gpu-based-image-blur-algorithms.html

### Efficient Gaussian with hardware linear sampling
Useful explanation of pairing adjacent taps through linear filtering.

- https://www.rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling/

---

## Edge-aware / Surface Blur

### Fast Guided Filter — Kaiming He, Jian Sun
Primary candidate for fast edge-aware Surface Blur implementation.

- https://arxiv.org/abs/1505.00996

### Bilateral Grid — Chen, Paris, Durand
GPU-oriented real-time edge-aware filtering architecture.

- https://groups.csail.mit.edu/graphics/bilagrid/
- https://groups.csail.mit.edu/graphics/bilagrid/bilagrid_web.pdf

### Bilateral Grid source/license page

- https://groups.csail.mit.edu/graphics/bilagrid/code.html

### Fast bilateral filter background — Paris & Durand

- https://publications.csail.mit.edu/abstracts/abstracts07/sparis1/sparis1.html

### Domain Transform — Gastal & Oliveira
Alternative linear-time edge-aware filtering family.

- https://www.inf.ufrgs.br/~eslgastal/DomainTransform/

---

## Median

### A Fast Parallel Median Filtering Algorithm Using Hierarchical Tiling — Louis Sugy, 2025
Main modern GPU median reference.

- https://arxiv.org/abs/2507.19926

---

## Morphology

### Parallel van Herk/Gil-Werman image morphology on GPUs using CUDA
Useful GPU implementation reference for large-kernel min/max morphology.

- https://www.nvidia.com/content/GTC/posters/14_Domanski_Parallel_vanHerk.pdf

---

## Sharpening

### AMD FidelityFX Contrast Adaptive Sharpening 1.2
Low-overhead adaptive sharpening reference.

- https://gpuopen.com/manuals/fidelityfx_sdk/techniques/contrast-adaptive-sharpening/

### NVIDIA Image Scaling / NVSharpen
Directional adaptive sharpening source/reference.

- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling
- https://github.com/NVIDIAGameWorks/NVIDIAImageScaling/blob/main/NIS/NIS_Scaler.h

### Adobe Smart Sharpen current behavior
Useful semantic/UI reference for Photoshop compatibility expectations.

- https://helpx.adobe.com/ca/photoshop/desktop/effects-filters/smart-filters/sharpen-controls-with-smart-sharpen.html

### Adobe filter reference

- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

---

## Denoise

### G-BM3D — New Computational Techniques for a Faster Variation of BM3D Image Denoising
Main classical high-quality denoise research candidate for the HQ path.

- https://arxiv.org/abs/2103.10765

---

## WebGPU / WGSL

### WGSL current specification

- https://www.w3.org/TR/WGSL/

### WebGPU supported optional features
`shader-f16`, `subgroups`, etc.

- https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

### WGSL FFT ecosystem reference
Potentially useful for very large convolution/deconvolution experiments.

- https://docs.rs/wgsl-fft/latest

---

## Resampling / warp quality

### Bicubic texture interpolation using linear filtering
Useful Catmull-Rom/bicubic sampling implementation reference.

- https://rreusser.github.io/notebooks/bicubic-texture-interpolation-using-linear-filtering/

---

## Alpha/compositing correctness

### Premultiplied alpha explanation

- https://ciechanow.ski/alpha-compositing/

---

# 21. Final recommended P0 technical map

| Filter | Production direction | Main reference |
|---|---|---|
| Gaussian Blur | tiled single-dispatch separable Gaussian; large-radius alternate | AMD FidelityFX Blur |
| High Pass | fused `source - Gaussian` | BlurCore |
| Unsharp Mask | fused Gaussian detail + threshold/gain | BlurCore / Adobe semantics |
| Surface Blur | Fast Guided first; Bilateral Grid bake-off | He & Sun / Chen-Paris-Durand |
| Displace | WarpSampler + HQ Catmull-Rom + footprint-aware LOD | WGSL sampling + bicubic refs |
| Offset | render-graph coordinate transform; materialize only if required | internal architecture |
| Median | selection networks small; hierarchical tiling larger | Sugy 2025 |
| Maximum | tiled direct small; vHGW large | vHGW GPU reference |
| Minimum | tiled direct small; vHGW large | vHGW GPU reference |
| Motion Blur | direct gather short/medium; benchmark long-kernel alternative | benchmark-driven |
| Smart Sharpen | radius-aware detail + adaptive directional/noise/halo control | NVSharpen + CAS + Adobe semantics |
| Reduce Noise | wavelet realtime baseline + G-BM3D HQ prototype | G-BM3D paper |

---

# 22. Definition of done for each P0 filter

A filter is not done when it merely “looks correct.” It is done when:

- [ ] A deterministic reference implementation/test exists.
- [ ] Production WGSL implementation matches the quality target.
- [ ] Linear/premultiplied-alpha behavior is verified.
- [ ] Boundary conditions are explicitly tested.
- [ ] 16/32-bit/HDR working data does not clip unexpectedly.
- [ ] Slider updates do not allocate pipelines every frame.
- [ ] GPU intermediates use the shared texture pool.
- [ ] 4K and high-megapixel performance has been measured.
- [ ] NVIDIA/AMD/Intel behavior has been checked where hardware is available.
- [ ] Optional `shader-f16` path is compared against FP32 before enabling.
- [ ] No dependency on optional WebGPU subgroup features exists in the fallback path.
- [ ] Visual regression fixtures are committed.
- [ ] Benchmark results are committed with hardware/driver/backend metadata.
- [ ] Any copied/adapted source has an explicitly verified license and required attribution.

---

# 23. First concrete coding task

Start with **`BlurCore`**, not the Filter-menu UI.

Deliver:

1. CPU/reference separable Gaussian.
2. Basic WGSL separable Gaussian baseline.
3. Tiled/shared-memory single-dispatch prototype inspired by FidelityFX Blur architecture.
4. Benchmark harness across radii and image sizes.
5. Visual/numerical comparison versus reference.
6. `outputMode` support for:
   - Gaussian
   - High Pass
   - Unsharp Mask
7. Correct linear/premultiplied-alpha handling.
8. Cache shader pipelines and temporary textures.
9. Test FP16 permutation only after FP32 is correct.
10. Document crossover point where a large-radius alternate algorithm becomes preferable.

Only after this core is solid should the agent proceed to `WarpSampler`, `MorphologyCore`, `RankCore`, etc.

---

## Summary for the coding agent

The goal is **not to be lazy and recreate old Photoshop filters one-by-one**.

Build a small set of excellent GPU image-processing primitives, validate them against clean references, benchmark real WGSL performance, and then expose Photoshop-familiar filters on top.

The strongest immediate research directions are:

- **FidelityFX Blur-style tiled single-dispatch Gaussian** for the blur family.
- **Fast Guided Filter / Bilateral Grid bake-off** for Surface Blur.
- **Sugy 2025 hierarchical tiling** for Median.
- **vHGW** for large-radius Maximum/Minimum.
- **A reusable HQ WarpSampler** for Displace and future distortions.
- **CAS/NVSharpen ideas + LightTable radius-aware detail decomposition** for Smart Sharpen.
- **Wavelet realtime baseline + G-BM3D research path** for Reduce Noise.

Always prefer measured performance and visual quality over assumptions or third-party benchmark claims.
