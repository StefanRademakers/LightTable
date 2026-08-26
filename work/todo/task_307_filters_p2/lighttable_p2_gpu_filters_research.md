# LightTable P2 GPU Filters — Deep Research & Implementation Specification

**Status:** research / engineering specification  
**Target:** LightTable GPU image engine  
**Primary backend:** WebGPU / WGSL  
**Secondary/native reference backends:** wgpu/Vulkan/Metal/D3D12 where useful  
**Research date:** 2026-08-25  
**Priority:** P2 — creative/completeness filters after P0/P1 foundations

---

# 0. Purpose

This document is the implementation research pass for the **P2 LightTable filter roadmap**.

The objective is **not** to reproduce Photoshop's historical implementation details one-for-one. The objective is to preserve familiar user-facing semantics where valuable while building a modern, reusable GPU architecture that is:

- substantially faster than naive full-frame implementations;
- suitable for interactive, non-destructive smart filters;
- high quality at large radii and high-resolution documents;
- linear-light and alpha-correct;
- robust on large HDR / 16-bit documents;
- portable to WebGPU/WGSL;
- reusable by multiple filters rather than a collection of one-off shaders;
- benchmark-driven, with explicit fallbacks and cross-over thresholds;
- legally safe for a proprietary/commercial application.

This P2 pass assumes the P0 and P1 cores exist or are being implemented first.

---

# 1. Standing P2 worklist

The current P2 filters are organized in the same broad structure users know from Photoshop.

## Blur

- Shape Blur
- Smart Blur

## Blur Gallery

- Path Blur
- Spin Blur

## Distort

- Pinch
- Shear
- Glass

## Pixelate

- Crystallize
- Mezzotint
- Pointillize

## Render

- Difference Clouds
- Fibers

## Stylize

- Oil Paint
- Glowing Edges
- Diffuse
- Solarize

## Other

- Custom

## Filter Gallery — selected P2 effects

- Cutout
- Plastic Wrap
- Poster Edges
- Watercolor
- Photocopy
- Halftone Pattern
- Stamp
- Torn Edges
- Texturizer

---

# 2. Explicit exclusions and assumptions

The following are **not** part of this P2 implementation pass:

- Liquify — LightTable already has a better dedicated implementation path.
- Lens Correction — LightTable already handles this elsewhere.
- Film Grain / Add Noise — LightTable already has a better film-grain system.
- Camera Raw-style tonal/color corrections — already covered by LightTable's adjustment pipeline.
- Neural / AI filters — separate subsystem; do not mix model inference into this P2 raster-filter core.

P2 should also **reuse** P0/P1 primitives rather than reimplement them:

- `BlurCore`
- `EdgeAwareCore`
- `WarpSampler`
- `RankCore`
- `MorphologyCore`
- `Denoise/FrequencyCore`
- `VariableBlurCore`
- `AnalyticWarpCore`
- `ProceduralTextureCore`
- `EdgeDerivativeCore`
- `HalftoneCore`

---

# 3. Executive conclusion

P2 looks like a long list of unrelated old Photoshop effects, but it can be reduced to a small number of modern GPU cores.

The most important new P2 primitives are:

1. **ArbitraryKernelCore**  
   For Shape Blur and Custom; direct convolution for small kernels, low-rank/SVD decomposition for medium kernels, FFT only for genuinely large kernels.

2. **VectorMotionBlurCore**  
   For Path Blur and Spin Blur; integrates along a local vector field or analytic angular path, with correct LOD and bounded sample counts.

3. **CellularCore**  
   For Crystallize, Pointillize, rough-edge masks, and later creative procedural segmentation. Use analytic Worley/Voronoi for regular procedural cells and Jump Flooding for arbitrary seeded cells / distance fields.

4. **StylizationCore**  
   Structure tensor + anisotropic Kuwahara + XDoG + perceptual quantization. This one core can support Oil Paint, Cutout, Poster Edges and Watercolor.

5. **BlueNoisePatternCore**  
   For Mezzotint, stochastic diffusion and future dithering patterns. Prefer blue-noise distributions over naive white-noise speckle where the exact legacy look is not required.

6. **FilterGalleryCompositionCore**  
   Not a single algorithm. It is a lightweight graph-composition layer that assembles existing primitives into Photocopy, Stamp, Plastic Wrap, Torn Edges, etc. The correct architectural move is to avoid dedicated monolithic shaders for these effects.

The biggest research result is therefore:

> **Do not implement 26 P2 filters as 26 independent GPU pipelines.**
>
> Implement approximately six new reusable primitives and express most P2 filters as parameterized graphs on top of P0/P1/P2 cores.

---

# 4. Global rendering rules for all P2 filters

These rules are mandatory unless a filter explicitly requires a different interpretation.

## 4.1 Work in linear light

Convolution, blur, resampling, height reconstruction, specular lighting and blending should be performed in linear-light space.

Do not blur or convolve gamma-encoded RGB directly.

## 4.2 Premultiplied alpha

All neighborhood filters and resampling operations must use premultiplied alpha internally.

A transparent red pixel must not contaminate a blur around an opaque white object.

If a source texture is stored in straight alpha, premultiply at the boundary or ensure the render graph has a canonical premultiplied intermediate representation.

## 4.3 HDR-safe intermediates

Prefer `rgba16float` for filter intermediates where the LightTable pipeline already uses float HDR data.

Do not clamp to `[0,1]` inside creative filters unless the legacy operation mathematically requires it.

## 4.4 Deterministic procedural effects

All procedural filters must have an explicit deterministic `seed`.

The same document + parameters + seed must render identically across frames and ideally across GPU vendors, within reasonable floating-point tolerances.

Do not use frame index or undefined hash behavior for persistent document state.

## 4.5 Quality tiers are allowed, silent algorithm substitution is not

It is acceptable to expose internally:

- Preview
- Interactive
- High Quality

But a filter must not visibly jump to a fundamentally different visual model after mouse release unless the difference is intentionally tiny and tested.

Example: using a coarse blur pyramid for interactive Field Blur and a high-quality scatter-as-gather bokeh path for final render is acceptable only if the transition is perceptually stable.

## 4.6 Every expensive P2 filter needs an identity fast path

Examples:

- Shape Blur radius 0 -> identity.
- Spin Blur angle 0 -> identity.
- Pinch amount 0 -> identity.
- Solarize disabled -> identity.
- Custom kernel identity -> graph can remove node.

Graph compilation should eliminate identity filters before GPU submission.

---

# 5. Core architecture overview

Recommended new P2 engine layer:

```text
P0/P1 existing cores
│
├── BlurCore
├── EdgeAwareCore
├── WarpSampler
├── VariableBlurCore
├── AnalyticWarpCore
├── ProceduralTextureCore
├── EdgeDerivativeCore
└── HalftoneCore

P2 new cores
│
├── ArbitraryKernelCore
│   ├── Direct2DConvolution
│   ├── LowRankConvolution
│   └── LargeKernelFFT(optional / benchmark gated)
│
├── VectorMotionBlurCore
│   ├── PathVectorField
│   └── AnalyticSpinField
│
├── CellularCore
│   ├── Worley / hashed neighborhood path
│   ├── Blue-noise seeds
│   └── Jump Flooding / distance-field path
│
├── BlueNoisePatternCore
│
├── StylizationCore
│   ├── StructureTensor
│   ├── AnisotropicKuwahara
│   ├── XDoG
│   └── PerceptualQuantization
│
└── FilterGalleryCompositionCore
```

---

# 6. Blur → Shape Blur

## 6.1 User-facing semantics

Photoshop's Shape Blur uses a shape as the blur kernel. In signal-processing terms, this is a 2D convolution with an arbitrary point-spread function (PSF), usually derived from a grayscale or alpha shape.

The naive implementation is:

```text
for each output pixel:
    sum = 0
    weight = 0
    for each kernel pixel:
        sum += source(offset) * kernelWeight
        weight += kernelWeight
    output = sum / weight
```

That becomes catastrophically expensive for large kernels.

## 6.2 Recommended architecture: `ArbitraryKernelCore`

Use three execution paths.

### Path A — direct tiled 2D convolution

Best for small kernels.

Suggested initial search range:

- `3×3`
- `5×5`
- `7×7`
- `9×9`
- perhaps up to `15×15` / `21×21`, depending on GPU and kernel sparsity.

Use:

- workgroup/shared-memory tile + halo;
- static or bounded loops where practical;
- f16 weights if validated;
- zero-weight skipping for sparse kernels only when branch behavior is favorable;
- one output pixel per lane or small vectorized batches.

Do **not** assume the direct path crossover from desktop CUDA applies to WebGPU. Benchmark it.

### Path B — low-rank / SVD approximation

This is the most important P2 optimization.

An arbitrary 2D kernel `K` can be decomposed with singular value decomposition:

```text
K ≈ Σ_i σ_i * u_i * v_i^T
```

Each rank-1 term becomes two 1D convolutions:

```text
horizontal(v_i)
vertical(u_i)
```

A low-rank kernel therefore transforms a costly `N×N` convolution into a small number of separable passes.

Use an energy threshold to choose rank:

```text
energy(r) = sum(σ_i², i < r) / sum(all σ_i²)
```

Candidate thresholds:

- Interactive: `99.0%` or perceptually tuned
- High Quality: `99.9%+`

Also cap rank to prevent pathological kernels from exploding in cost.

The McGraw bokeh work demonstrates the practical value of low-rank decompositions for non-separable aperture kernels. Bart Wronski provides an excellent practical explanation of using SVD for image filters.

**Sources:**

- T. McGraw, *Fast Bokeh Effects Using Low-Rank Linear Filters*  
  https://web.ics.purdue.edu/~tmcgraw/papers/dof_mcgraw_2014.pdf
- Bart Wronski, *Separate your filters! SVD and low-rank approximation of image filters*  
  https://bartwronski.com/2020/02/03/separate-your-filters-svd-and-low-rank-approximation-of-image-filters/
- Research on low-rank convolution acceleration:  
  https://www.sciencedirect.com/science/article/abs/pii/S0168927413000822

### Path C — FFT convolution for genuinely large kernels

Convolution theorem:

```text
IFFT( FFT(image) * FFT(kernel) )
```

This changes asymptotic behavior for huge kernels, but FFT has large constant costs:

- transforms;
- complex buffers;
- padding;
- extra memory bandwidth;
- kernel transform caching;
- edge handling.

Do **not** add FFT merely because it sounds advanced.

Benchmark direct vs low-rank vs FFT across realistic document sizes and kernels.

`VkFFT` is a valuable modern architectural/reference implementation and is MIT licensed, but it does not give LightTable a WebGPU/WGSL implementation directly. Treat it as a native/backend reference and benchmark inspiration, not copy-paste WebGPU code.

**Source:**

- VkFFT repository: https://github.com/DTolm/VkFFT
- VkFFT API guide: https://sources.debian.org/data/main/v/vkfft/1.3.4%2Bds2-1/documentation/VkFFT_API_guide.pdf

## 6.3 Kernel preprocessing

When the user selects a shape:

1. resample shape mask to requested support;
2. convert to linear kernel weights;
3. normalize total energy/weight;
4. optionally center kernel by centroid rather than bounding-box center;
5. compute SVD on CPU or a small GPU preprocessing step;
6. cache decomposition by `(shapeHash, radius, quality)`.

A shape-kernel decomposition changes only when the filter parameters change, not every frame.

## 6.4 Sparse shape optimization

Some kernels may be mostly zero.

For small sparse kernels, keep an alternative compact `(offset, weight)` list and benchmark:

```text
Dense tiled convolution
vs
Sparse gather list
```

Do not assume sparse is always faster; irregular texture access can lose badly on GPUs.

## 6.5 Edge handling

Support the same canonical modes as WarpSampler where appropriate:

- clamp
- mirror
- wrap
- transparent

Transparent mode requires correct premultiplied normalization semantics.

## 6.6 Acceptance test

Compare direct reference convolution against:

- rank 1
- rank 2
- rank 4
- rank 8
- automatic energy threshold

for:

- disk kernel
- hexagon
- star
- ring
- asymmetric custom alpha mask
- sparse cross
- irregular imported shape

Measure:

- PSNR / SSIM against direct reference;
- edge/halo differences;
- GPU time;
- memory traffic;
- temporal stability while radius changes.

---

# 7. Blur → Smart Blur

## 7.1 Do not create a new blur engine

Photoshop Smart Blur is conceptually an edge-preserving smoother controlled by radius, threshold and quality/mode options.

LightTable already needs a modern `EdgeAwareCore` for P0 Surface Blur.

Therefore:

> Smart Blur should be a compatibility/preset layer over the existing edge-aware engine, not an independent implementation.

## 7.2 Recommended production mapping

Candidate core:

- Fast Guided Filter for primary production path;
- bilateral-grid reference / alternative where its response better matches expected threshold behavior;
- optional exact bilateral reference for regression tests only.

Map:

```text
Radius -> spatial support
Threshold -> edge / intensity sensitivity
Quality -> internal subsampling / refinement settings
```

## 7.3 Edge-only modes

Photoshop Smart Blur historically includes edge-oriented modes.

Do not distort the edge-preserving smoother to produce those modes.

Use `EdgeDerivativeCore` / `XDoG` as explicit post paths.

Example:

```text
smartSmooth = EdgeAwareCore(...)
edgeMap = XDoG(smartSmooth or source)
output = composite according to mode
```

This keeps the implementation modular.

## 7.4 Sources

- Adobe Filter Effects Reference:  
  https://helpx.adobe.com/photoshop/using/filter-effects-reference.html
- Fast Guided Filter:  
  https://arxiv.org/abs/1505.00996
- Bilateral Grid:  
  https://groups.csail.mit.edu/graphics/bilagrid/

---

# 8. Blur Gallery → Path Blur

## 8.1 User-facing semantics

Path Blur simulates motion following a curved path rather than one globally constant line.

Conceptually, every output pixel has a local motion trajectory.

A high-quality implementation is a line/curve exposure integral:

```text
C_out(x) = ∫ C_source( trajectory(x, t) ) * shutter(t) dt
```

## 8.2 Recommended core: `VectorMotionBlurCore`

Represent motion as a 2D vector field plus optional curvature / path metadata.

For a user spline:

1. tessellate / rasterize the path influence into a low-to-medium-resolution vector field;
2. encode local tangent and speed;
3. optionally encode taper and endpoint behavior;
4. sample along the local streamline in the final gather shader.

Suggested field format:

```text
RG16F: velocity xy
B16F: optional local curvature / auxiliary
A16F: mask / influence
```

Or separate compact textures if bandwidth tests favor it.

## 8.3 Curved gather

A constant local vector is not enough for strongly curved paths.

Candidate strategies:

### A. Piecewise local linear approximation

Fastest.

At each output pixel, use the local tangent and gather along a line.

Good when curvature is low relative to blur length.

### B. Streamline integration

Integrate through the vector field:

```text
p0 = uv
for sample i:
    v = vectorField(p)
    p += v * step
    accumulate source(p)
```

Use RK2/midpoint integration rather than naive Euler when the path curves strongly.

A symmetric shutter should integrate in both forward and backward directions.

### C. Precomputed trajectory LUT

For stable editable paths, a coarse per-tile or per-pixel trajectory representation can reduce repeated integration cost, but memory can become excessive. Only consider after profiling.

## 8.4 Sample count control

Do not scale samples linearly forever with blur distance.

Use:

- paired bilinear taps;
- mip/LOD selection based on local footprint;
- stratified shutter samples;
- capped samples with reconstruction weighting for very long paths.

The P0 Motion Blur bake-off should inform this implementation.

## 8.5 Strobe behavior

Photoshop exposes strobe-like controls in Blur Gallery.

Implement strobe as a shutter distribution rather than a separate algorithm:

```text
continuous shutter -> smooth weights
strobe -> discrete peaks in shutter(t)
```

This generalization is reusable for Spin Blur too.

## 8.6 Quality issues to test

- line crossings / overlapping path influence;
- sharp path corners;
- endpoint taper;
- alpha edges;
- high-contrast text;
- long blur over repetitive textures;
- very thin objects;
- HDR highlights;
- strong curvature with long motion length.

## 8.7 Reference

Adobe current Blur Gallery documentation:  
https://helpx.adobe.com/photoshop/using/blur-gallery.html

---

# 9. Blur Gallery → Spin Blur

## 9.1 Do not implement as image rotation loops

Spin Blur is an analytic angular motion blur inside an editable ellipse.

For a pixel relative to center `c`:

```text
r = p - c
sample_i = c + R(theta_i) * r
```

where `theta_i` spans the shutter angle.

This is ideal for direct GPU gathering.

## 9.2 Elliptical domain

Photoshop allows a movable/resizable ellipse.

Transform world/sample coordinates into normalized ellipse space:

```text
q = inverseEllipseTransform * (p - center)
inside = dot(q, q) <= 1
```

Use analytic feathering around the boundary.

## 9.3 Adaptive sample density

Required angular samples depend on pixel radius:

```text
arcLength ≈ radius * angle
```

A point near the center needs far fewer samples than one near the ellipse edge.

Compute a capped sample count from estimated arc footprint.

For long arcs:

- use mip levels;
- stratified sample positions;
- optionally stochastic/blue-noise phase in preview only if temporal stability is guaranteed.

Avoid fixed 64/128 samples for every pixel.

## 9.4 Strobe

Reuse the same shutter-weight model as Path Blur.

## 9.5 Fast path

Angle = 0 -> identity node elimination.

Outside ellipse -> source passthrough; use tile classification where ellipse occupies only a small region so unaffected tiles can skip expensive logic.

## 9.6 Source

Adobe Blur Gallery:  
https://helpx.adobe.com/photoshop/using/blur-gallery.html

---

# 10. Distort → Pinch

## 10.1 Reuse `AnalyticWarpCore`

Pinch is an analytic radial coordinate remap.

No new engine is required.

Canonical formulation:

```text
q = (uv - center) / radius
r = length(q)
r' = f(r, amount)
src = center + normalize(q) * r' * radius
```

The exact response curve should be tuned against Photoshop-like expectations, but the internal function should remain continuous with stable derivatives.

## 10.2 Quality requirement

Strong pinching causes severe minification near regions of the mapping.

Use P0/P1 `WarpSampler` with Jacobian-aware LOD / anisotropic footprint estimation where available.

Bilinear LOD 0 alone is not acceptable for high-frequency textures.

## 10.3 Edge behavior

Offer sensible modes:

- transparent
- clamp/repeat depending on filter semantics

Do not leave undefined sampling outside the source.

---

# 11. Distort → Shear

## 11.1 Reuse `AnalyticWarpCore`

Photoshop Shear uses a user-defined curve to horizontally/vertically offset rows or columns.

Represent the user curve as a 1D spline.

Precompute a compact LUT:

```text
LUT[y] = xOffset
```

Then:

```text
srcUV.x = uv.x + LUT(uv.y)
```

or orientation-swapped equivalent.

## 11.2 Curve representation

Recommended:

- cubic Hermite or monotone cubic interpolation in editor space;
- bake to 256–1024 sample 1D texture/buffer depending on document resolution and quality;
- linear interpolation in shader is adequate after sufficiently dense pre-bake.

## 11.3 Why LUT instead of evaluating spline per pixel

The curve is edited far less often than pixels are rendered.

Pre-baking:

- saves ALU;
- simplifies shader;
- guarantees consistent curve handling;
- lets the UI and renderer share a canonical spline definition.

## 11.4 Quality

Again use `WarpSampler` for reconstruction / LOD.

---

# 12. Distort → Glass

## 12.1 Treat Glass as displacement, not a special distortion engine

A modern Glass filter should be built on:

```text
texture/procedural height map
        ↓
gradient / normal extraction
        ↓
displacement vector field
        ↓
WarpSampler
```

This immediately reuses P0 Displace and P1 procedural textures.

## 12.2 Height-to-displacement

Given height `h`:

```text
dx = h(x+1) - h(x-1)
dy = h(y+1) - h(y-1)
displacement = scale * vec2(dx, dy)
```

Use Scharr/Farid derivatives when smoother direction fields are desirable.

Alternative legacy mode can map grayscale directly to XY displacement, but a gradient-derived refractive displacement generally produces more plausible glass.

## 12.3 Texture sources

Support:

- procedural frosted glass;
- blocks;
- canvas-like texture;
- custom user texture;
- seeded noise / cellular texture.

The texture source should be a reusable graph input, not hardcoded into one shader.

## 12.4 Optional physical improvement

An HQ mode can approximate refraction from a normal map:

```text
n = normalize(vec3(-dh/dx * sx, -dh/dy * sy, 1))
refractedOffset ≈ etaScale * n.xy / max(n.z, epsilon)
```

This is still cheap compared with full ray tracing and produces more natural results.

## 12.5 Antialiasing

Glass creates local minification and magnification. Use Jacobian-aware LOD through `WarpSampler`.

---

# 13. Pixelate → Crystallize

## 13.1 Correct conceptual model

Crystallize is essentially a Voronoi/cellular partition where each cell receives a representative color.

The important GPU decision is how cells are generated and how representative colors are obtained.

## 13.2 Recommended core: `CellularCore`

Support two generation paths.

### Path A — analytic hashed Voronoi / Worley neighborhood

For procedural roughly regular/random cells:

1. determine integer grid cell;
2. hash nearby cells to generate seed points;
3. evaluate nearest seed among a bounded neighborhood;
4. use seed ID to identify the cell.

This is extremely GPU-friendly and requires no large Voronoi texture.

Stefan Gustavson's GPU cellular-noise work is useful here.

**Source:**  
https://itn-web.it.liu.se/~stegu76/GLSL-cellular/GLSL-cellular-notes.pdf

### Path B — Jump Flooding Algorithm (JFA)

For arbitrary user/procedural seed distributions, JFA efficiently approximates Voronoi / nearest-seed propagation on the GPU.

Classic algorithm:

```text
initial seed texture
jump = highestPowerOfTwo(size)
while jump >= 1:
    sample neighbors at ±jump offsets
    keep nearest seed
    jump /= 2
```

JFA is highly parallel and well suited to GPU distance/Voronoi tasks.

**Source:**

- Rong & Tan, *Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform*  
  https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf
- Recent dynamic GPU Voronoi work:  
  https://arxiv.org/abs/2209.00117

## 13.3 Cell color

There are several quality/performance options.

### Fast

Sample source at the cell seed / centroid.

Advantages:

- nearly free;
- very stable;
- looks close to many crystallize effects.

### Better

Take a small stratified sample pattern around the seed, clamped to the cell.

### Exact-ish cell mean

True mean per irregular cell requires reduction by cell ID, which introduces atomics / sorting / segmented reductions and can be expensive in portable WebGPU.

Do **not** make exact cell mean the first implementation.

Bake-off visual quality first. Seed/centroid sampling may already match user expectations better than mathematical cell averaging.

## 13.4 Seed distribution

White random grid-jitter can create clumps.

For visually even crystals, support blue-noise/Poisson-like seed placement.

Sources:

- Bridson, *Fast Poisson Disk Sampling in Arbitrary Dimensions*  
  https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
- Fast approximate GPU blue noise:  
  https://web.ece.ucsb.edu/~psen/Papers/EGSR12_FastApproximateBlueNoise.pdf

---

# 14. Pixelate → Pointillize

## 14.1 Reuse CellularCore

Pointillize is essentially:

```text
cell generation
+
representative color
+
rendered point/disc shape
+
background between points
```

Do not write a separate nearest-cell algorithm.

## 14.2 Rendering

For each output pixel:

1. resolve nearest / owning cell;
2. obtain seed position and cell color;
3. compute normalized distance to seed;
4. render an anti-aliased disk or configurable blob via SDF.

```text
d = length(pixel - seed) / radius
coverage = smoothstep(1+aa, 1-aa, d)
```

Composite point color over configured gap/background color.

## 14.3 Better-than-legacy extension

Possible LightTable options:

- Circle
- Soft circle
- Square
- Hex
- Randomized size
- Blue-noise seed layout

Keep Photoshop-compatible defaults, but the primitive should be more general.

---

# 15. Pixelate → Mezzotint

## 15.1 Do not use raw white noise as the only implementation

Mezzotint is a stochastic dot/line texture, but naive independent white noise tends to produce ugly clustering and unstable visual density.

A modern implementation should have two paths:

- Legacy/random mode for Photoshop-like roughness.
- High-quality blue-noise-driven pattern mode for visually even texture.

## 15.2 `BlueNoisePatternCore`

Inputs:

- luminance / channel value;
- blue-noise threshold sample;
- pattern mode;
- scale;
- orientation;
- seed.

Binary-dot version:

```text
output = luma > blueNoiseThreshold ? white : black
```

But Mezzotint modes can be richer: short/medium/long dots and lines.

Use local SDF primitives whose density/length is modulated by image luminance.

## 15.3 Blue-noise sources

Possible strategies:

- ship a small carefully generated blue-noise tile and rotate/offset it deterministically;
- procedural generation cached per seed/size;
- scalar spatiotemporal blue noise techniques if animation/video support later matters.

Sources:

- Fast approximate blue noise on GPU:  
  https://web.ece.ucsb.edu/~psen/Papers/EGSR12_FastApproximateBlueNoise.pdf
- Scalar Spatiotemporal Blue Noise Masks:  
  https://arxiv.org/abs/2112.09629
- Blue-noise multitone dithering:  
  https://www.eecis.udel.edu/~arce/files/Publications/5-Multitone.pdf

## 15.4 Determinism

Pattern must not crawl when zooming or rerendering.

Anchor blue-noise coordinates in document pixel space, not screen space.

---

# 16. Render → Difference Clouds

## 16.1 Reuse ProceduralTextureCore

Difference Clouds is not a new procedural-noise algorithm.

Build it as:

```text
clouds = ProceduralTextureCore.fBm(...)
output = DifferenceBlend(source, clouds)
```

or the correct legacy-equivalent blend semantics.

## 16.2 Noise choice

Use the same deterministic gradient/simplex-noise family chosen for P1 Clouds.

For GPU efficiency, modern simplex/gradient-noise implementations avoid lookup textures and can compute noise entirely in ALU.

**Source:**

McEwan, Sheets, Gustavson, Richardson, *Efficient Computational Noise in GLSL*:  
https://arxiv.org/abs/1204.1461

## 16.3 Iteration behavior

Photoshop users historically repeat Difference Clouds to build complexity.

In a non-destructive graph, expose `octaves` / `iterations` rather than relying only on repeated menu invocation.

A compatibility repeat command can still stack/reapply nodes.

---

# 17. Render → Fibers

## 17.1 Procedural interpretation

Fibers can be generated as strongly anisotropic procedural noise.

A simple architecture:

```text
u = coordinate along fiber direction
v = coordinate across fiber direction

base = 1D/2D noise with high correlation along u
fiber = multi-octave warped noise(v + lowFreqWarp(u,v))
```

Then remap to foreground/background colors.

## 17.2 GPU strategy

This should be almost entirely ALU-bound with no large temporary buffers.

Use:

- simplex/gradient noise;
- directional coordinate scaling;
- fBm;
- optional domain warping;
- deterministic seed.

No reason for multi-pass simulation.

## 17.3 Controls

At minimum:

- variance
- strength
- direction
- scale
- roughness/octaves
- seed

Compatibility UI can reduce this to the classic controls while the internal generator remains more general.

## 17.4 Source

Efficient computational noise in GLSL:  
https://arxiv.org/abs/1204.1461

---

# 18. Stylize → Oil Paint

## 18.1 This deserves a serious implementation

Oil Paint is one of the few creative legacy filters still visibly emphasized by Adobe, and Photoshop's current implementation is GPU accelerated.

Adobe notes that starting with Photoshop 23.2 the Oil Paint filter was rewritten to use native GPU resources for faster performance, without changing behavior.

**Adobe source:**  
https://helpx.adobe.com/photoshop/using/oil-paint-filter.html

LightTable should therefore not implement Oil Paint as a cheap blur + edge hack.

## 18.2 Recommended core: anisotropic Kuwahara filtering

The strongest reusable classical basis found for this family is **anisotropic Kuwahara filtering (AKF)**.

Kuwahara filters smooth regions while preserving/sharpening edges by selecting or weighting low-variance sectors around each pixel.

The anisotropic form uses a local structure tensor to orient and elongate the kernel along image structure, producing painterly flow rather than blocky isotropic patches.

Key research:

- Kyprianidis, Kang, Döllner, *Image and Video Abstraction by Anisotropic Kuwahara Filtering*  
  https://onlinelibrary.wiley.com/doi/full/10.1111/j.1467-8659.2009.01574.x
- Project page:  
  https://www.kyprianidis.com/p/pg2009/
- GPU Pro material:  
  https://www.kyprianidis.com/p/gpupro/
- Polynomial weighting improvement:  
  https://diglib.eg.org/items/9865e5fe-3d23-470e-8cf6-e571bebafb9b
- Multi-scale anisotropic Kuwahara:  
  https://doi.org/10.1145/2024676.2024686

## 18.3 Critical licensing note

The public `gpuakf` repository is **GPL-3.0**:

https://github.com/jkyprian/gpuakf

For a proprietary LightTable codebase:

> **Do not copy shader/code from this repository.**
>
> Use the academic papers and mathematical descriptions to write an independent implementation, and have licensing reviewed before reusing any code beyond ideas/formulas that are not copyright-protected expression.

## 18.4 Proposed `StylizationCore`

### Stage 1 — structure tensor

Compute image gradients:

```text
Ix, Iy
```

Then local tensor:

```text
J = [ Ix²    IxIy
      IxIy   Iy² ]
```

Smooth tensor with a small Gaussian or guided filter.

Eigenanalysis gives:

- dominant orientation;
- anisotropy/coherence.

This orientation drives brush flow.

### Stage 2 — anisotropic sector sampling

Transform local neighborhood into oriented elliptical coordinates.

Divide into sectors.

For each sector estimate:

- weighted mean color;
- variance.

Combine sectors with low-variance preference instead of a hard winner to avoid discontinuities.

Polynomial weighting versions are attractive because they remove expensive convolution of sector kernels and are GPU-friendly.

### Stage 3 — multi-scale option

At high stylization values, use a multi-scale or larger-radius path rather than exploding one giant sample loop.

Potential options:

- downsampled AKF and edge-aware upsample;
- multi-scale AKF from the literature;
- radius tiers with adaptive sector sample counts.

## 18.5 Mapping Photoshop-like controls

Photoshop exposes concepts such as:

- Stylization
- Cleanliness
- Scale
- Bristle Detail
- Lighting Angle
- Shine

A plausible LightTable mapping:

```text
Stylization -> AKF radius + anisotropy strength
Cleanliness -> variance weighting / smoothing strength
Scale -> stroke/relief spatial frequency
Bristle Detail -> high-frequency relief / directional noise
Angle -> lighting direction
Shine -> specular strength/roughness
```

Do not force all controls into AKF itself. Separate color stylization from surface relief/lighting.

## 18.6 Surface relief and shine

After the color pass, construct a stroke-height field from:

- local detail;
- structure orientation;
- directional procedural/bristle noise.

Derive normals using Scharr/Farid gradients.

Apply a cheap physically plausible specular model:

```text
N = normalFromHeight(height)
L = userLightDirection
V = vec3(0,0,1)
H = normalize(L+V)
spec = pow(max(dot(N,H),0), shininess)
```

This reproduces the controllable glossy paint behavior without baking lighting into the smoothing algorithm.

## 18.7 Performance strategy

Potential major wins:

- structure tensor at half resolution when quality remains stable;
- shared-memory tile for local statistics;
- precomputed polynomial sector weights;
- f16 intermediates for tensor/statistics if validated;
- adaptive radius tiers;
- avoid divergent sector loops;
- use the same gradients for tensor and later relief where possible.

## 18.8 Acceptance tests

Use:

- portraits/skin;
- hair;
- foliage;
- architecture;
- typography;
- noisy low-light image;
- smooth gradients;
- transparent layer boundaries;
- HDR highlights.

Judge both painterly quality and edge stability.

---

# 19. Stylize → Glowing Edges

## 19.1 Reuse edge primitives

Do not build a dedicated edge detector.

Pipeline:

```text
source
→ optional small preblur
→ EdgeDerivativeCore (Scharr/Farid)
→ magnitude / orientation
→ nonlinear remap
→ optional thin/soft edge processing
→ color mapping
→ BlurCore for glow
→ composite
```

## 19.2 Suggested quality path

Use XDoG when a stylized thin edge response is desired; use Scharr/Farid magnitude for a more literal edge glow.

## 19.3 Why XDoG matters

The Extended Difference-of-Gaussians model gives a controllable abstraction/edge response and is a useful shared primitive for multiple Filter Gallery effects.

**Source:**

Winnemöller, Kyprianidis, Olsen, *XDoG: An eXtended difference-of-Gaussians compendium including advanced image stylization*:  
https://www.sciencedirect.com/science/article/pii/S009784931200043X

---

# 20. Stylize → Diffuse

## 20.1 Legacy interpretation

Diffuse randomly displaces pixels into neighboring positions, with modes that constrain how darker/lighter values spread; anisotropic mode follows image structure more smoothly.

## 20.2 Recommended architecture

### Normal mode

Use deterministic small-neighborhood stochastic displacement:

```text
offset = blueNoise/hash(documentPixel, seed) -> one of bounded neighbor offsets
output = source(uv + offset)
```

Prefer blue-noise-distributed decisions over visibly clustered white noise unless exact legacy matching requires white noise.

### Darken Only / Lighten Only

Sample candidate neighbor and compare luminance:

```text
candidate = source(uv + offset)
output = minByLuma(source, candidate) // darken
output = maxByLuma(source, candidate) // lighten
```

Preserve RGB coherently; do not min/max channels independently unless intentionally matching a legacy formula.

### Anisotropic

Use the structure tensor already required by `StylizationCore`.

Move/smooth primarily along the local tangent direction (direction of least intensity change), not across edges.

This can be implemented as a small oriented gather along the tangent.

## 20.3 Deterministic pattern

Anchor stochastic choices to document coordinates so the effect does not flicker during pan/zoom.

---

# 21. Stylize → Solarize

## 21.1 This should be trivial

Solarize is essentially a tonal transfer function combining positive and negative response.

A common form is equivalent to a V-shaped or piecewise inversion curve around a midpoint.

No new core is needed.

Implement as one tiny compute/render pass or fuse into adjacent color operations.

Example conceptual mapping:

```text
solarize(x) = abs(2*x - 1)
```

Do not assume this exact formula matches Photoshop numerically; create a reference test and tune the curve if compatibility matters.

## 21.2 Fusion

If the render graph already has a per-pixel grading/color pass nearby, Solarize should be fusible into it.

It should not require a dedicated intermediate texture in common chains.

---

# 22. Other → Custom

## 22.1 Share `ArbitraryKernelCore`

Photoshop Custom exposes a user-entered convolution matrix plus scale/offset.

This is exactly the generic convolution problem solved for Shape Blur.

Therefore:

```text
Custom filter UI
    ↓
validated kernel + divisor + offset
    ↓
ArbitraryKernelCore
```

## 22.2 Small matrices

For typical custom kernels (`3×3`, `5×5`), compile/use direct shared-memory convolution.

For user-provided large matrices, route through the same low-rank/FFT decision logic.

## 22.3 Safety / numerical handling

- validate finite weights;
- guard divisor near zero;
- avoid NaN propagation;
- preserve HDR unless user explicitly clamps;
- allow signed kernels;
- allow negative results in float pipeline;
- apply offset after convolution.

## 22.4 Presets

Useful built-in presets can include:

- edge detect
- emboss variants
- Laplacian
- directional sharpen
- Sobel-like kernels

But do not duplicate actual dedicated filters in the UI unless useful.

---

# 23. Filter Gallery architecture

The selected P2 Filter Gallery effects should be implemented as **graphs composed from reusable primitives**, not as independent monolithic historical shaders.

Recommended internal representation:

```text
FilterGalleryPreset {
    graph: FilterNodeGraph
    exposedParameters: ...
    compatibilityDefaults: ...
}
```

This makes it possible to:

- share code;
- expose advanced controls later;
- cache common subgraphs;
- fuse passes;
- keep legacy names without legacy architecture.

---

# 24. Filter Gallery → Cutout

## 24.1 Desired visual structure

Cutout reduces an image to broad, flat color regions with simplified edges.

A modern pipeline:

```text
edge-preserving smoothing
→ perceptual color quantization
→ optional region cleanup
```

## 24.2 Edge-preserving simplification

Candidates:

- Fast Guided Filter
- Bilateral Grid
- Anisotropic Kuwahara for more painterly region flow

For a Photoshop-like default, Guided/Bilateral simplification may be closer and cheaper than AKF.

## 24.3 Perceptual quantization

Avoid quantizing independently in RGB.

Use a perceptual working representation such as OKLab/Lab-like space if the existing color pipeline supports it efficiently.

Two options:

### Fast scalar/channel quantization

Quantize lightness/chroma with fixed steps.

Very fast but can create unnatural palette boundaries.

### Small K-means / palette quantization

For higher quality:

1. build/downsample representative color sample set;
2. run small K-means on CPU or GPU;
3. assign each pixel to nearest palette color;
4. optionally regularize assignments using the smoothed image.

Since LightTable already has palette-related work, reuse that machinery if appropriate.

## 24.4 Region cleanup

Small isolated regions can be removed with morphology/majority operations, but keep it optional because over-cleaning changes the classic look.

---

# 25. Filter Gallery → Poster Edges

## 25.1 Composition

Recommended graph:

```text
source
→ edge-preserving smoothing
→ soft posterization / color quantization
→ XDoG or Scharr/Farid edge map
→ threshold/thickness control
→ dark edge composite
```

This is much more controllable than trying to create posterization and edge extraction in one shader.

## 25.2 Edge thickness

Use:

- blur before XDoG for scale;
- morphology (`Maximum`) for controlled thickening;
- smooth threshold for antialiasing.

Reuse P0 `MorphologyCore`.

## 25.3 Sources

- XDoG:  
  https://www.sciencedirect.com/science/article/pii/S009784931200043X
- Real-Time Video Abstraction:  
  https://research.adobe.com/publication/real-time-video-abstraction/
- PDF:  
  https://cs.colby.edu/courses/S19/cs365/papers/winnemoller-videoAbstraction-SIG06.pdf

The Real-Time Video Abstraction work is particularly relevant because it combines edge-preserving smoothing, Difference-of-Gaussians line extraction and soft color quantization in a GPU-friendly stylization pipeline.

---

# 26. Filter Gallery → Watercolor

## 26.1 Do not fake it with only blur + noise

Watercolor needs at least three perceptual ingredients:

1. large coherent color simplification;
2. edge/pigment accumulation;
3. paper/pigment granulation.

## 26.2 Proposed graph

```text
source
→ multi-scale edge-preserving / anisotropic smoothing
→ color/pigment simplification
→ edge-darkening / flow accumulation
→ granulation texture modulation
→ optional paper texture
```

## 26.3 Smoothing core

AKF is a strong candidate for painterly coherent regions, but Fast Guided/Bilateral may be better for subtle watercolor.

Implement both as presets on the same graph rather than one hardcoded method.

## 26.4 Pigment granulation

Use procedural noise / blue-noise modulation tied to local luminance/chroma and optionally paper height.

Granulation should be spatially coherent and document-anchored.

## 26.5 Edge darkening

Approximate pigment pooling by combining:

- edge magnitude;
- local smoothed-vs-original difference;
- low-frequency procedural modulation.

Avoid simply multiplying black outlines; that looks cartoonish rather than watercolor.

## 26.6 Paper texture

Reuse `Texturizer` core. Keep paper texture optional and composable.

---

# 27. Filter Gallery → Photocopy

## 27.1 Recommended graph

```text
source luminance
→ slight adaptive smoothing
→ DoG/XDoG edge/detail response
→ local/global threshold shaping
→ black/white or two-tone output
```

## 27.2 Why XDoG

XDoG offers a smooth continuum between hard threshold, sketch-like edge and tone retention.

It is better as a modern internal model than stacking arbitrary contrast curves.

## 27.3 Controls

Map compatibility controls to:

- detail -> preblur / DoG scale
- darkness -> threshold / black level

Possible advanced controls later:

- edge softness
- tone retention
- paper/background color

---

# 28. Filter Gallery → Stamp

## 28.1 Simpler than Photocopy

Stamp is essentially a strong two-tone simplification.

Graph:

```text
luminance
→ preblur / guided smoothing
→ threshold or adaptive threshold
→ optional edge bias
→ two-color mapping
```

## 28.2 Adaptive threshold

A local threshold can preserve details across uneven lighting better than one global threshold.

Reuse `BoxFilterCore` / summed-area-table local mean if available.

Conceptual:

```text
threshold(x) = localMean(x) + bias
binary = luma(x) > threshold(x)
```

For compatibility, allow a global threshold-like response as default if visual matching demands it.

---

# 29. Filter Gallery → Halftone Pattern

## 29.1 Reuse P1 HalftoneCore

No new engine.

P1 Color Halftone already requires:

- rotated screen coordinates;
- analytic SDF dots;
- anti-aliasing;
- cell-average / local tone input.

Halftone Pattern extends that with monochrome pattern types:

- dots
- lines
- circles

## 29.2 Analytic pattern SDFs

### Dot

Distance to cell center.

### Line

Distance to periodic line center.

### Circle

Distance to ring radius.

Coverage via `smoothstep` / derivative-aware antialiasing.

Avoid raster pattern textures at arbitrary scale because they alias badly.

---

# 30. Filter Gallery → Torn Edges

## 30.1 Proposed graph

```text
luminance / threshold mask
→ procedural roughness displacement
→ morphology / distance transform
→ irregular edge darkening / cleanup
```

## 30.2 JFA distance field

Once a binary mask exists, Jump Flooding can generate an approximate signed/unsigned distance field efficiently.

That distance allows controlled torn-edge width, feather and roughness independent of document resolution.

## 30.3 Procedural roughness

Use multi-octave noise to perturb threshold or distance:

```text
roughDistance = distance + noise(position * scale) * amount
```

Anchor seed in document coordinates.

## 30.4 Why distance field is better than repeated dilation/erosion

A distance representation gives continuous control over:

- edge width;
- irregularity;
- feather;
- inner/outer treatment;

without stacking many morphology passes.

Source for JFA:  
https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf

---

# 31. Filter Gallery → Plastic Wrap

## 31.1 Treat as a height/normal lighting effect

Plastic Wrap is best interpreted as a synthetic height field with glossy specular lighting.

Graph:

```text
source luminance/detail
→ smoothed height field
→ local relief enhancement
→ normal extraction
→ glossy/specular lighting
→ composite with source
```

## 31.2 Height construction

Candidate:

```text
base = edge-aware smooth(luma)
detail = luma - base
height = remap(detail + edgeMagnitude * edgeWeight)
```

Optional procedural low-frequency modulation avoids uniform embossed edges.

## 31.3 Normal derivation

Use shared derivative core:

- Scharr default
- Farid/SIMONCELLI HQ if desired

Sources:

- Farid & Simoncelli derivative design:  
  https://doi.org/10.1109/TIP.2004.823819
- scikit-image comparison noting Scharr's improved rotational invariance:  
  https://scikit-image.org/docs/0.21.x/auto_examples/edges/plot_edge_filter.html

## 31.4 Specular

Use a compact Blinn-Phong or GGX-like model.

For this stylized effect, Blinn-Phong is likely adequate and cheaper.

Controls:

- highlight strength
- detail
- smoothness
- light direction
- relief scale

Reuse Oil Paint's lighting helper rather than duplicate code.

---

# 32. Filter Gallery → Texturizer

## 32.1 Generalize instead of hardcoding sandstone/canvas/etc.

Build a `TextureReliefCore` that accepts:

- procedural texture or user texture;
- scale;
- relief amount;
- light direction;
- contrast;
- invert.

Pipeline:

```text
texture grayscale
→ height
→ normals
→ directional relief lighting
→ blend with source
```

## 32.2 Texture sampling

For repeating textures:

- use correct mipmaps;
- support wrap;
- avoid moiré at small scale;
- use anisotropic footprint if a transformed texture is supported.

## 32.3 Procedural texture inputs

Reuse P1/P2 generators:

- simplex/fBm
- fibers
- cellular
- paper noise

This gives much more flexibility than fixed legacy presets.

---

# 33. Shared `StylizationCore` design

This core is central to multiple P2 effects.

Recommended modules:

```text
StylizationCore
├── Luma / perceptual preparation
├── GradientCore
├── StructureTensor
├── Orientation/coherence
├── AnisotropicKuwahara
├── DoG / XDoG
├── SoftQuantization
├── ReliefFromDetail
└── StyleComposite
```

Used by:

- Oil Paint
- Poster Edges
- Watercolor
- Cutout (optional)
- Glowing Edges
- Diffuse anisotropic mode
- Photocopy
- Plastic Wrap relief helper

This is a far better investment than individual legacy shaders.

---

# 34. Structure tensor implementation notes

## 34.1 Gradient

Use a rotationally stable derivative filter.

Scharr is an excellent default because it improves rotational symmetry over Sobel for small kernels.

Farid & Simoncelli derivative filters are an HQ candidate.

## 34.2 Tensor

For each pixel:

```text
Jxx = Ix * Ix
Jxy = Ix * Iy
Jyy = Iy * Iy
```

Smooth each component locally.

## 34.3 Eigenanalysis without expensive general matrix solver

For symmetric 2×2 matrix:

```text
trace = Jxx + Jyy
diff  = Jxx - Jyy
disc  = sqrt(diff*diff + 4*Jxy*Jxy)
l1 = 0.5 * (trace + disc)
l2 = 0.5 * (trace - disc)
```

Orientation:

```text
theta = 0.5 * atan2(2*Jxy, Jxx - Jyy)
```

Coherence:

```text
coherence = (l1 - l2) / max(l1 + l2, eps)
```

Store compactly if used by multiple downstream passes.

## 34.4 Resolution

Benchmark half-resolution tensor fields. Orientation often varies slowly enough that bilinear upsampling is visually stable, reducing cost substantially.

Do not assume quarter-resolution is safe around thin text and line art.

---

# 35. XDoG implementation notes

Difference-of-Gaussians:

```text
D = G_sigma(source) - tau * G_(k*sigma)(source)
```

XDoG adds a smooth threshold/nonlinearity such as:

```text
E = 1                       if D >= epsilon
    1 + tanh(phi*(D-eps))   otherwise
```

Exact formulation should follow the paper / verified implementation math, not this shorthand alone.

Reuse `BlurCore` for the two Gaussian scales.

Optimization opportunity:

- compute both scales through a blur pyramid;
- share intermediate downsample/blur work for larger sigma;
- fuse subtraction + threshold into final blur pass where graph scheduling allows.

**Source:**  
https://www.sciencedirect.com/science/article/pii/S009784931200043X

---

# 36. Arbitrary convolution benchmark plan

This benchmark is mandatory before freezing the `ArbitraryKernelCore` dispatch policy.

## 36.1 Kernel sizes

Test:

```text
3, 5, 7, 9, 15, 21, 31, 51, 81, 127, 255, 511, 1023
```

where practical.

## 36.2 Kernel families

- disk
- hexagon
- gaussian-like but non-separable perturbation
- ring
- star
- asymmetric shape
- sparse kernel
- random dense kernel

## 36.3 Methods

- direct global gather
- direct shared-memory tiled
- SVD rank 1
- rank 2
- rank 4
- rank 8
- auto energy rank
- FFT convolution where backend exists

## 36.4 Document sizes

At minimum:

- 1920×1080
- 3840×2160
- ~24 MP photo
- ~45 MP photo
- 8192×8192 synthetic

## 36.5 GPUs

Test representative hardware classes:

- high-end NVIDIA desktop
- midrange NVIDIA/AMD desktop
- Apple Silicon
- integrated GPU if LightTable supports it

The dispatch policy should be cached by adapter/vendor/device class when necessary.

---

# 37. Path/Spin blur benchmark plan

Measure:

- blur length: 4, 8, 16, 32, 64, 128, 256, 512 px
- curve curvature: straight, gentle, strong S-turn
- image sizes as above
- samples: 8, 12, 16, 24, 32, 48, 64
- paired taps on/off
- LOD strategy on/off
- vector field resolution: full, half, quarter
- Euler vs midpoint/RK2 integration

Quality references should use a very high sample count offline/reference implementation.

Metrics:

- PSNR/SSIM only as sanity checks;
- edge ghosting;
- aliasing;
- energy preservation;
- highlight streak quality;
- curved trajectory fidelity.

---

# 38. Cellular benchmark plan

Compare:

### Analytic hashed Worley

- nearest seed only
- 3×3 neighbor search
- larger search only if seed jitter requires it

### JFA

- standard jump sequence
- JFA+1 refinement
- arbitrary seed textures

Test cell sizes:

```text
2, 4, 8, 16, 32, 64, 128 px
```

Measure:

- GPU time;
- seed accuracy / nearest-cell errors;
- temporal/deterministic stability;
- memory footprint;
- edge precision.

Choose analytic Worley as default for procedural cells if it gives the desired style; use JFA for arbitrary seed layouts / distance fields.

---

# 39. Oil Paint / AKF benchmark plan

Variables:

- radius
- sector count: 4, 8 and possibly more
- polynomial weighting variants
- tensor resolution: full / half
- tensor smoothing radius
- coherence mapping
- color space used for variance
- f16 vs f32 statistics
- multi-scale on/off

Reference images:

- high-frequency foliage
- skin/portrait
- hair/fur
- text/UI screenshot
- architecture
- colorful illustration
- monochrome photo
- alpha-edged object

Metrics:

- GPU time;
- edge displacement;
- texture flattening;
- directional flow continuity;
- haloing;
- variance stability;
- parameter monotonicity.

Important: judge visually. PSNR is not meaningful for intentionally stylized output.

---

# 40. Color-space strategy for stylization

Many creative effects make decisions based on distance/variance between colors.

RGB Euclidean distance is not perceptually uniform.

Recommended:

- use linear luminance for edge/structure math;
- use a perceptual-ish space for clustering/quantization when quality justifies it;
- avoid expensive repeated conversions inside large sample loops.

Potential design:

```text
precompute compact working channels:
    Y or luma
    optional OKLab a/b or chroma channels
```

Then AKF statistics can perhaps operate on linear RGB for speed while palette/quantization uses perceptual distance.

Benchmark whether OKLab conversion cost is material relative to the neighborhood filter itself.

---

# 41. Pass fusion opportunities

P2 is especially vulnerable to death by intermediate textures.

The graph compiler should look for these fusions.

## 41.1 XDoG

Fuse:

```text
second blur output
+ DoG subtraction
+ threshold/remap
```

where possible.

## 41.2 Oil Paint relief

Reuse gradient/tensor information for relief orientation if compatible rather than recomputing gradients.

## 41.3 Plastic Wrap / Texturizer

Fuse:

```text
height gradient
→ normal
→ lighting
```

into one pass if the height field is already available.

## 41.4 Solarize

Fuse into adjacent color transform.

## 41.5 Difference Clouds

Fuse procedural generation + Difference blend when the procedural texture is not needed elsewhere.

## 41.6 Pointillize

Resolve cell + SDF rendering in one pass for analytic Worley mode.

---

# 42. Tile classification

Several P2 filters affect only a bounded region or have variable cost.

Useful examples:

- Spin Blur ellipse
- Path Blur influence mask
- local Glass displacement
- sparse Shape Blur if kernel/support small

Use a lightweight tile classification stage where the saved work exceeds dispatch overhead.

For Spin Blur:

```text
tile outside ellipse -> copy/alias source
boundary tile -> full logic
inside tile -> full logic without repeated boundary tests if specialized
```

Do not introduce classification for every filter automatically; benchmark.

---

# 43. Mipmaps and LOD for warps

Every strong P2 warp can create minification:

- Pinch
- Shear
- Glass
- Path Blur sampling
- Spin Blur sampling

Sampling everything at mip 0 creates aliasing.

The `WarpSampler` should expose a consistent API for:

- explicit LOD;
- gradient-based sampling (`textureSampleGrad` where applicable);
- Catmull-Rom/bicubic reconstruction for magnification;
- optional EWA-like HQ footprint for extreme transforms.

EWA references:

- GPU EWA filtering research:  
  https://citeseerx.ist.psu.edu/document?doi=3788d4a1c152a68702293928bbc2406c1a5a839e&repid=rep1&type=pdf
- Practical GPU Pro treatment:  
  https://www.bloomsburyvisualarts.com/app/downloadpdf?cachepagetype=%24cachepagetype&chapterPdfId=9781351261524.ch-010.pdf

EWA is likely too expensive as the default for every filter, but valuable as an HQ reference / extreme-minification option.

---

# 44. WebGPU/WGSL implementation strategy

## 44.1 Portable baseline

All filters must have a path using standard WebGPU features:

- compute shaders;
- storage buffers/textures;
- workgroup memory;
- texture sampling;
- standard 32-bit float/int operations.

## 44.2 Optional `shader-f16`

Use `shader-f16` where supported and validated for:

- tensor fields;
- blur intermediates;
- vector fields;
- procedural noise intermediates;
- weights.

Do not use f16 for numerically fragile reductions without error testing.

## 44.3 Optional subgroups

Subgroup operations can accelerate reductions/scans, but should remain optional until availability is sufficiently broad for LightTable's deployment targets.

Do not architect `ArbitraryKernelCore` or JFA around mandatory subgroup support.

Sources:

- MDN `GPUSupportedFeatures`:  
  https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures
- WGSL specification:  
  https://www.w3.org/TR/WGSL/
- WebGPU WGSL function reference:  
  https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl-function-reference.html

---

# 45. Avoid these tempting shortcuts

## 45.1 Do not call every arbitrary blur “FFT”

For small/medium kernels, direct or low-rank convolution can be much faster and simpler.

## 45.2 Do not approximate Shape Blur with repeated Gaussian blur

That destroys the user-selected kernel shape.

## 45.3 Do not implement Oil Paint as bilateral blur + emboss only

It misses orientation-aware painterly structure.

## 45.4 Do not copy GPL `gpuakf` code into LightTable

Use the papers and independently implement.

## 45.5 Do not use white noise everywhere

Mezzotint, diffusion, point placement and granulation often benefit from blue-noise / Poisson distributions.

## 45.6 Do not implement Filter Gallery effects as isolated shaders

Most are compositions of edge-aware smoothing, edge extraction, quantization, procedural texture and relief lighting.

## 45.7 Do not ignore alpha during convolution/stylization

Premultiplied alpha is mandatory.

## 45.8 Do not process neighborhood filters in gamma space

Use linear-light data.

## 45.9 Do not use screen-space random seeds

Effects must be anchored to document space.

## 45.10 Do not blindly increase sample count with blur radius

Use LOD, low-rank decomposition, pyramids or alternative algorithms.

---

# 46. Licensing / source-use notes

This section matters because LightTable is a commercial product.

## 46.1 Academic papers

Papers describe algorithms, but paper availability does not automatically grant permission to copy associated source code.

Implement from mathematical descriptions and check the license of any reference code separately.

## 46.2 gpuakf

Repository:  
https://github.com/jkyprian/gpuakf

License: GPL-3.0.

Do not incorporate source/shaders into proprietary LightTable without compatible licensing/legal review.

## 46.3 VkFFT

Repository:  
https://github.com/DTolm/VkFFT

MIT license at time of research. Verify current repository license before shipping.

VkFFT supports native GPU APIs, not WebGPU as the primary path. It is a useful architectural/performance reference and may be relevant to a future native backend.

## 46.4 AMD/NVIDIA samples

GPUOpen / NVIDIA reference implementations may have their own licenses. Verify individual repository/sample license before code reuse.

Use public algorithmic ideas freely where legally appropriate, but do not assume sample code is automatically compatible with LightTable's distribution.

---

# 47. Suggested implementation order inside P2

The P2 label remains the roadmap priority; this is the engineering order that maximizes reuse.

## Phase P2-A — generic convolution

1. `ArbitraryKernelCore`
2. Shape Blur
3. Custom

This gives a general-purpose engine with future value beyond these two filters.

## Phase P2-B — cheap reuse filters

4. Smart Blur on `EdgeAwareCore`
5. Pinch on `AnalyticWarpCore`
6. Shear on `AnalyticWarpCore`
7. Glass on `WarpSampler + ProceduralTextureCore`
8. Solarize as fused color operation

## Phase P2-C — motion field

9. `VectorMotionBlurCore`
10. Spin Blur
11. Path Blur

Implement Spin first because the analytic reference is simpler; then generalize to path vector fields.

## Phase P2-D — cellular / stochastic

12. `CellularCore`
13. Crystallize
14. Pointillize
15. `BlueNoisePatternCore`
16. Mezzotint

## Phase P2-E — procedural render extensions

17. Difference Clouds
18. Fibers

These should be relatively cheap once P1 procedural noise exists.

## Phase P2-F — stylization

19. `StylizationCore` structure tensor
20. anisotropic Kuwahara
21. XDoG
22. Oil Paint
23. Glowing Edges
24. Diffuse anisotropic mode

## Phase P2-G — Filter Gallery composition

25. Poster Edges
26. Photocopy
27. Stamp
28. Halftone Pattern
29. Cutout
30. Plastic Wrap
31. Torn Edges
32. Texturizer
33. Watercolor

This order deliberately implements the more reusable/diagnosable compositions first.

---

# 48. Definition of done for every P2 filter

A filter is not complete just because it visually “works”.

Every filter must have:

## Functional

- correct parameter behavior;
- deterministic render;
- identity fast path;
- documented edge handling;
- alpha-safe behavior;
- HDR-safe behavior where relevant.

## Performance

- GPU timing on representative GPUs;
- no obvious radius/sample-count blowups;
- memory allocations cached/reused;
- no unnecessary full-frame intermediate when fusion is possible;
- benchmarked workgroup size or justified default.

## Quality

- reference image comparisons;
- zoomed edge tests;
- gradients;
- text/line art;
- alpha edges;
- high-frequency photo;
- HDR/highlight case where relevant.

## Architecture

- uses shared core rather than duplicated logic;
- clean parameter schema;
- serializable non-destructive node state;
- no hidden dependence on UI state;
- reusable shader/pipeline cache keys.

## Legal

- source/research attribution in internal documentation;
- licenses checked before code reuse;
- no incompatible copied code.

---

# 49. Performance targets

Exact targets depend on LightTable's current engine, but use these as engineering goals for a 4K image on a high-end desktop GPU:

- trivial single-pass filters (Solarize): comfortably sub-millisecond when not fused;
- analytic warps (Pinch/Shear): low single-digit milliseconds or better;
- procedural clouds/fibers: low single-digit milliseconds;
- Pointillize/Crystallize procedural mode: low single-digit milliseconds;
- Shape Blur small/medium kernels: interactive at slider rate;
- Spin Blur moderate angle: interactive;
- Oil Paint moderate radius: target interactive preview, HQ may take longer but should not become a multi-second operation on modern discrete GPUs.

Do not hardcode these as release gates until baseline measurements on LightTable's actual renderer exist.

The correct metric is end-to-end frame latency including graph intermediates, not isolated shader nanoseconds alone.

---

# 50. Recommended benchmark harness

Every P2 core should expose a repeatable benchmark mode.

Record:

```text
adapter name
vendor/device IDs if available
WebGPU feature set
resolution
format
filter parameters
warmup count
run count
min / median / p95 / max GPU time
allocated transient bytes
persistent cache bytes
pass count
texture reads/writes estimate if instrumentable
```

Do at least five warm runs after pipeline creation.

Keep pipeline compilation/cold start separate from steady-state filtering.

Store canonical test images and parameter presets in the repository.

---

# 51. Recommended visual regression set

Create a compact but nasty filter test suite containing:

1. RGB color bars + gradients
2. linear-light grayscale ramp
3. one-pixel black/white checkerboard
4. diagonal thin lines
5. text at multiple font sizes
6. transparent colored object on transparent background
7. high-frequency foliage photo
8. portrait with skin/hair
9. architecture with straight lines
10. saturated illustration
11. HDR-ish bright highlights / values > 1.0
12. noisy low-light photo
13. smooth sky gradient
14. procedural frequency sweep / zone plate
15. displacement grid

Every filter should have at least one golden/reference render for regression.

---

# 52. Source list — primary and highly relevant references

## Adobe behavior / user-facing semantics

- Adobe Filter Effects Reference  
  https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

- Adobe current Blur Gallery  
  https://helpx.adobe.com/photoshop/using/blur-gallery.html

- Adobe filters overview  
  https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filters-overview.html

- Adobe Oil Paint  
  https://helpx.adobe.com/photoshop/using/oil-paint-filter.html

- Adobe specific filter application / Color Halftone reference  
  https://helpx.adobe.com/uk/photoshop/using/applying-specific-filters.html

- Photoshop CS6 reference PDF for older detailed legacy semantics  
  https://helpx.adobe.com/pdf/cs6/photoshop_reference.pdf

## Arbitrary kernels / low-rank / convolution

- McGraw, *Fast Bokeh Effects Using Low-Rank Linear Filters*  
  https://web.ics.purdue.edu/~tmcgraw/papers/dof_mcgraw_2014.pdf

- Bart Wronski, *SVD and low-rank approximation of image filters*  
  https://bartwronski.com/2020/02/03/separate-your-filters-svd-and-low-rank-approximation-of-image-filters/

- Low-rank convolution acceleration research  
  https://www.sciencedirect.com/science/article/abs/pii/S0168927413000822

- NVIDIA VPI separable convolution documentation  
  https://docs.nvidia.com/vpi/algo_sep_convolution.html

- Hensley et al., *Fast Summed-Area Table Generation and its Applications*  
  https://shaderwrangler.com/publications/sat/
  
  PDF: https://shaderwrangler.com/publications/sat/SAT_EG2005.pdf

- GPU Gems 3 parallel scan / summed-area-table foundations  
  https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda

## FFT reference

- VkFFT  
  https://github.com/DTolm/VkFFT

- VkFFT API guide  
  https://sources.debian.org/data/main/v/vkfft/1.3.4%2Bds2-1/documentation/VkFFT_API_guide.pdf

## Edge-preserving filtering

- Fast Guided Filter  
  https://arxiv.org/abs/1505.00996

- Bilateral Grid  
  https://groups.csail.mit.edu/graphics/bilagrid/

## Variable / bokeh blur references

- GPU Gems 3, *Practical Post-Process Depth of Field*  
  https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field

- GPU Gems, *Depth of Field: A Survey of Techniques*  
  https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-23-depth-field-survey-techniques

- AMD FidelityFX Depth of Field  
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/depth-of-field/

## Derivatives / edge quality

- Farid & Simoncelli, *Differentiation of discrete multidimensional signals*  
  https://doi.org/10.1109/TIP.2004.823819

- scikit-image edge operator comparison / Scharr rotational invariance  
  https://scikit-image.org/docs/0.21.x/auto_examples/edges/plot_edge_filter.html

## Stylization / Kuwahara / XDoG

- Kyprianidis, Kang, Döllner, *Image and Video Abstraction by Anisotropic Kuwahara Filtering*  
  https://onlinelibrary.wiley.com/doi/full/10.1111/j.1467-8659.2009.01574.x

- AKF project page  
  https://www.kyprianidis.com/p/pg2009/

- GPU Pro AKF material  
  https://www.kyprianidis.com/p/gpupro/

- Polynomial weighting AKF  
  https://diglib.eg.org/items/9865e5fe-3d23-470e-8cf6-e571bebafb9b

- Multi-scale anisotropic Kuwahara  
  https://doi.org/10.1145/2024676.2024686

- `gpuakf` reference repository — **GPL-3.0, do not copy into proprietary LightTable**  
  https://github.com/jkyprian/gpuakf

- Winnemöller, Kyprianidis, Olsen, *XDoG*  
  https://www.sciencedirect.com/science/article/pii/S009784931200043X

- Winnemöller et al., *Real-Time Video Abstraction*  
  https://research.adobe.com/publication/real-time-video-abstraction/
  
  PDF: https://cs.colby.edu/courses/S19/cs365/papers/winnemoller-videoAbstraction-SIG06.pdf

## Procedural noise / cellular / blue noise

- McEwan et al., *Efficient Computational Noise in GLSL*  
  https://arxiv.org/abs/1204.1461

- Gustavson GPU procedural shading thesis/material  
  https://www.diva-portal.org/smash/get/diva2%3A661790/FULLTEXT01.pdf

- Gustavson cellular noise notes  
  https://itn-web.it.liu.se/~stegu76/GLSL-cellular/GLSL-cellular-notes.pdf

- Jump Flooding / Voronoi / distance transform  
  https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf

- Dynamic GPU Voronoi  
  https://arxiv.org/abs/2209.00117

- Bridson Poisson disk sampling  
  https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf

- Fast approximate blue noise on GPU  
  https://web.ece.ucsb.edu/~psen/Papers/EGSR12_FastApproximateBlueNoise.pdf

- Scalar Spatiotemporal Blue Noise Masks  
  https://arxiv.org/abs/2112.09629

- Blue-noise multitone dithering  
  https://www.eecis.udel.edu/~arce/files/Publications/5-Multitone.pdf

## Resampling / EWA

- GPU EWA filtering reference  
  https://citeseerx.ist.psu.edu/document?doi=3788d4a1c152a68702293928bbc2406c1a5a839e&repid=rep1&type=pdf

- Practical EWA filtering, GPU Pro  
  https://www.bloomsburyvisualarts.com/app/downloadpdf?cachepagetype=%24cachepagetype&chapterPdfId=9781351261524.ch-010.pdf

## WebGPU / WGSL

- MDN `GPUSupportedFeatures`  
  https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

- WGSL specification  
  https://www.w3.org/TR/WGSL/

- WebGPU Fundamentals WGSL function reference  
  https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl-function-reference.html

---

# 53. Coding-agent instruction — first concrete task

Do **not** begin by implementing all P2 filters.

Start with **`ArbitraryKernelCore`**, because it is the highest-leverage new primitive in this pass.

## Task A — reference implementation

Build a correct CPU or simple GPU reference convolution supporting:

- arbitrary signed 2D kernels;
- normalization/divisor;
- offset;
- clamp/mirror/wrap/transparent edges;
- premultiplied alpha;
- linear-light float input.

This exists for correctness only.

## Task B — direct GPU path

Implement a tiled WGSL compute shader for small kernels.

Benchmark multiple workgroup/tile sizes.

Do not prematurely specialize only for 3×3.

## Task C — SVD preprocessing

Implement kernel SVD/decomposition on CPU first.

Produce rank-1 terms:

```text
sigma_i, horizontalVector_i, verticalVector_i
```

Normalize and validate reconstruction.

## Task D — low-rank GPU path

Reuse the best 1D/separable convolution primitive from P0/P1.

Support rank `1..N` with ping-pong/reduction strategy chosen to minimize full-frame writes.

Do not blindly write one full texture per rank if a better accumulation scheme is available.

## Task E — benchmark crossover

Create benchmark table by:

- resolution;
- kernel size;
- rank;
- GPU adapter.

Only after this table exists should the engine freeze automatic dispatch thresholds.

## Task F — expose first two filters

Once the core is validated:

1. implement **Custom** as the simplest UI/API wrapper;
2. implement **Shape Blur** with kernel-mask preprocessing and cached SVD.

After those are stable, proceed to Spin Blur / Path Blur and then CellularCore.

---

# 54. Final architectural recommendation

P2 should not be treated as “legacy cleanup.” It contains several primitives with substantial future value:

- arbitrary convolution supports user kernels, bokeh kernels and future plugin filters;
- vector-field blur supports motion-design and future directional effects;
- Voronoi/JFA supports selections, masks, distance fields and procedural graphics;
- structure tensors and AKF support broad non-photorealistic rendering;
- XDoG supports outlines, sketch, poster and abstraction;
- blue-noise patterns support dithering, stochastic sampling and procedural rendering;
- relief/normal lighting supports Plastic Wrap, Texturizer and future material effects.

The recommended strategy is therefore:

> **Preserve Photoshop's discoverable menu structure, but build LightTable around reusable GPU image-processing primitives rather than Photoshop's historical collection of independent filters.**

That produces a smaller engine, lower maintenance cost, better cache/fusion opportunities, and gives LightTable room to surpass the legacy effects in both quality and performance.

