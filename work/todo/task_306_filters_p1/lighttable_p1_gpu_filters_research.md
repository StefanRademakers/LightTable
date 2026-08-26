# LightTable P1 GPU Filters — Deep Research & Implementation Specification

**Status:** Working implementation spec  
**Date:** 2026-08-25  
**Scope:** P1 filters only  
**Target:** LightTable desktop renderer, WebGPU/WGSL-first, high image quality, very low latency  
**Companion spec:** `lighttable_p0_gpu_filters_research.md`

---

# 0. Goal

Implement the agreed **P1 filter set** after the P0 GPU primitives are stable.

The objective is not to reproduce Photoshop's old internal code. The objective is:

1. Preserve Photoshop-familiar menu semantics and expected controls.
2. Use modern GPU algorithms where they give better quality and/or lower cost.
3. Reuse P0 primitives aggressively.
4. Keep all filters deterministic and non-destructive.
5. Make the portable WebGPU/WGSL path the baseline.
6. Allow optional faster native/subgroup/FP16 paths without making them required.
7. Prefer a small set of reusable image-processing cores over one shader per menu item.

## Current P1 working list

### Blur
- Box Blur
- Radial Blur

### Blur Gallery
- Field Blur
- Iris Blur
- Tilt-Shift

### Distort
- Wave
- Ripple
- Twirl
- Spherize
- Polar Coordinates

### Noise
- Dust & Scratches
- Despeckle

### Pixelate
- Mosaic
- Color Halftone

### Render
- Clouds / Procedural Noise
- Lens Flare

### Stylize
- Find Edges
- Emboss

## Explicitly outside this P1 renderer pass

These were previously discussed but should **not** be duplicated here:

- Lens Correction — already handled better elsewhere in LightTable.
- Liquify — already handled better elsewhere in LightTable.
- Film Grain / Add Noise — already handled better elsewhere in LightTable.
- Camera Raw-like adjustments — already handled better elsewhere in LightTable.
- Neural / AI Filters — separate AI subsystem, not a deterministic raster-filter primitive.

---

# 1. Executive recommendation

Do not implement the P1 list as 18 unrelated filters.

Build roughly these reusable GPU cores:

| Core | P1 filters / future users |
|---|---|
| `BoxFilterCore` | Box Blur, future local means/integral-image operations |
| `VariableBlurCore` | Field Blur, Iris Blur, Tilt-Shift, later Path/Spin support helpers |
| `AnalyticWarpCore` | Wave, Ripple, Twirl, Spherize, Polar Coordinates |
| `ImpulseCleanupCore` | Dust & Scratches, Despeckle; reuses P0 Median/EdgeAware |
| `CellReductionCore` | Mosaic; later tile/statistics effects |
| `HalftoneCore` | Color Halftone; later Halftone Pattern/print effects |
| `ProceduralTextureCore` | Clouds; later Difference Clouds, Fibers, Texturizer |
| `LensFlareCore` | Lens Flare |
| `EdgeDerivativeCore` | Find Edges, Emboss; later Glowing Edges, Poster Edges, Plastic Wrap |

The key P1 architectural additions are therefore not “18 shaders” but mainly:

```text
BoxFilterCore
VariableBlurCore
AnalyticWarpCore
CellReductionCore
HalftoneCore
ProceduralTextureCore
LensFlareCore
EdgeDerivativeCore
```

with Dust & Scratches and Despeckle largely assembled from P0 pieces.

---

# 2. Global rules inherited from P0

The P0 spec remains authoritative for global renderer behavior. P1 must follow the same rules:

- Spatial filtering in linear-light working data unless an effect explicitly requires display-referred behavior.
- Correct premultiplied-alpha handling for blur/resampling.
- FP32 portable path first; optional `shader-f16` optimization after validation.
- Subgroups are optional acceleration, never a hard dependency.
- Adapter-specific workgroup tuning is allowed and encouraged.
- Optimized output must always be compared to a high-quality reference implementation.
- Avoid hidden quality switches that make the image visibly change after the interaction ends.
- Preserve deterministic seeds for procedural/stochastic effects.

WebGPU feature reference:
- https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

WGSL / texture-gradient reference:
- https://www.w3.org/TR/WGSL/
- https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl-function-reference.html

---

# 3. Box Blur — P1

## Photoshop semantic baseline

Photoshop exposes Box Blur as a traditional blur filter. The important semantic is a uniform rectangular averaging kernel, not a Gaussian approximation.

Adobe blur reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Implement an **exact box filter** with two internal paths.

### Path A — small/medium radius: tiled separable box

Because a box kernel is separable:

```text
2D box blur = horizontal 1D box -> vertical 1D box
```

For modest radii, use workgroup/shared-memory tiling with halo loads.

Unlike Gaussian, each tap has equal weight, so the arithmetic is extremely cheap; bandwidth dominates.

A rolling-sum formulation can update the window by adding the incoming texel and subtracting the outgoing texel.

Conceptually:

```text
sum[x+1] = sum[x] - src[x-r] + src[x+r+1]
```

Do not make a single GPU thread serially walk an entire image row. Use tiles/segments so enough work remains parallel.

### Path B — very large or spatially varying rectangles: summed-area table

A summed-area table (integral image) allows the sum over an arbitrarily large axis-aligned rectangle using only four table lookups after the SAT is built.

This is useful when:

- radius is very large;
- many different box radii are needed;
- the SAT can be reused by multiple nodes;
- future effects require local rectangular statistics.

GPU SAT references:

- Hensley et al., **Fast Summed-Area Table Generation and its Applications**  
  https://shaderwrangler.com/publications/sat/
- Paper PDF  
  https://shaderwrangler.com/publications/sat/SAT_EG2005.pdf
- NVIDIA GPU Gems 3, parallel prefix scan and SAT discussion  
  https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda

## Do not use SAT blindly

Building a SAT itself costs multiple scans / global memory traffic. For a single 5–30 px blur, a direct tiled pass will generally be much cheaper.

Required benchmark crossover:

```text
radius 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
```

at 1080p, 4K, 8K and a 30 MP photo.

## Alpha behavior

Blur premultiplied color and alpha consistently. Do not average straight RGB behind transparent pixels.

## Verdict

**Build exact.**  
Primary production path: tiled separable box.  
Large-radius / reuse path: SAT.

---

# 4. Radial Blur — P1

Photoshop Radial Blur has two behaviors:

- **Spin** — samples along concentric circular arcs.
- **Zoom** — samples along radial lines toward/away from a center.

Adobe description:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Implement Radial Blur as an **analytic parametric gather**, sharing most infrastructure with P0 Motion Blur and WarpSampler.

### Spin mode

For output position `p` relative to center `c`:

```text
q(t) = c + R(theta(t)) * (p - c)
```

Integrate samples over the requested angular exposure interval.

### Zoom mode

For a zoom exposure:

```text
q(t) = c + scale(t) * (p - c)
```

The exact UI mapping from Photoshop Amount does not need to dictate internal math. Use a physically understandable exposure/scale interval and map the compatibility slider onto it.

## Quality tiers

### Small amount

Use deterministic symmetric samples around the current point.

```text
8–16 taps
```

is often enough.

### Medium amount

Use:

- 16–32 samples;
- bilinear sampling;
- sample placement distributed over the exposure interval;
- optionally pair nearby samples when the mapping makes this safe.

### Large amount

The source footprint becomes very long. Prevent undersampling by using the local mapping derivative to choose mip level / explicit gradients.

For zoom blur, the footprint grows with distance from the center. For spin blur it grows approximately with radius from the center.

Use mipmapped source textures and derivative-aware sampling rather than simply increasing taps to hundreds.

## Reference quality path

Create a slow reference implementation with 128–512 samples to validate the optimized path.

## Important artifact tests

- center of blur;
- high-contrast text;
- one-pixel lines;
- transparent edges;
- zoom center outside image;
- extremely large spin angle;
- corners at maximum radius.

## Future reuse

The exact same parametric-integration framework is useful for P2 Spin Blur and parts of Path Blur.

## Verdict

**Build as a generic parametric exposure sampler**, not as a special-case old Photoshop shader.

---

# 5. VariableBlurCore — foundation for Field / Iris / Tilt-Shift

This is one of the most important P1 additions.

Photoshop's Blur Gallery uses a spatially varying blur amount and offers bokeh controls. Adobe describes:

- Field Blur: multiple pins, each with a blur amount.
- Iris Blur: sharp inner region, feather/fade region, blurred exterior.
- Tilt-Shift: sharp band with fading blur at both sides.

Current Adobe Blur Gallery reference:
- https://helpx.adobe.com/photoshop/using/blur-gallery.html

## Do not implement these as “Gaussian blur + mask blend”

This naive method:

```text
mix(original, blurredFullImage, mask)
```

is not the same as a true spatially varying blur.

It fails especially when:

- blur radius changes rapidly;
- bright highlights should spread into neighboring pixels;
- bokeh should expand from the source pixel rather than just mix preblurred output.

## Recommended two-mode architecture

### Mode A — fast photographic variable Gaussian

For normal interaction and modest radii:

1. Build a blur pyramid / mip-like set of progressively blurred images.
2. Generate a per-pixel blur-radius field.
3. Select/interpolate neighboring blur levels.
4. Add an optional small corrective gather at full resolution.

This is extremely fast and stable.

It is appropriate for:

- Field Blur without strong bokeh;
- UI drag preview;
- Tilt-Shift where the artistic intent is mainly smooth focus falloff.

A classic GPU DoF family uses blurred pyramids / multiple blur levels and blends according to blur amount.

References:
- NVIDIA GPU Gems, Depth of Field survey  
  https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-23-depth-field-survey-techniques
- GPU Gems 3, Practical Post-Process Depth of Field  
  https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field

### Mode B — high-quality variable aperture blur / bokeh

For maximum quality or visible bokeh, use a variable-radius gather modeled after modern real-time DoF techniques.

AMD FidelityFX Depth of Field is a strong architectural reference because it uses:

- bilateral downsampling;
- tile min/max radius maps;
- tile dilation;
- classification;
- scatter-as-gather logic;
- near/far blur separation in the depth-based case.

LightTable's Field/Iris/Tilt-Shift case is simpler because the blur radius is artist-authored rather than derived from depth, but the acceleration ideas remain excellent.

Reference:
- AMD FidelityFX Depth of Field 1.1  
  https://gpuopen.com/manuals/fidelityfx_sdk/techniques/depth-of-field/

## Proposed `VariableBlurCore`

Inputs:

```text
sourceTexture
radiusField          // float radius per pixel
apertureShape        // optional circle/polygon/kernel
highlightBoost       // optional
highlightThreshold   // optional
qualityMode
edgeMode
```

Pipeline:

```text
source
  -> mip / blur pyramid
radius field
  -> tile min/max
  -> optional tile dilation
  -> classify tiles
  -> fast variable blur or HQ scatter-as-gather
  -> full-res resolve
```

## Blur-radius map representation

Use a single-channel float texture. A quarter/half-resolution map is often enough if the control field is smooth, but preserve full-resolution masks around hard transitions when needed.

---

# 6. Field Blur — P1

## Control field

Field Blur is conceptually:

```text
set of pins: (x, y, blurRadius)
        -> smooth scalar radius field
        -> VariableBlurCore
```

## Radius-field interpolation

Do not use a crude nearest-pin step map.

Recommended candidates:

### Candidate A — compact radial basis interpolation

A small number of pins is ideal for radial-basis-function interpolation. Solve coefficients on CPU when pins change; evaluate the smooth field on GPU.

Pros:
- smooth;
- deterministic;
- works with pins outside the image;
- cheap because pin count is small.

### Candidate B — triangulation + barycentric interpolation

Very stable and cheap for many pins. Build Delaunay triangulation on CPU and rasterize/interpolate blur values.

### Candidate C — inverse-distance weighting

Very cheap and simple, but can produce undesirable “bullseye” behavior and does not extrapolate as elegantly.

## Recommendation

Use **RBF or triangulated interpolation**, not IDW as final quality.

The exact Adobe interpolation is not publicly specified. Optimize for predictable artistic behavior instead of reverse-engineering undocumented details.

## Verdict

**High value P1.**  
Build radius-field generation separately from blur evaluation.

---

# 7. Iris Blur — P1

Iris Blur is primarily a **mask/control-field problem** layered onto `VariableBlurCore`.

Photoshop semantics include:

- editable ellipse/iris region;
- sharp inner zone;
- feather/falloff zone;
- blurred exterior;
- optional multiple focus regions.

Reference:
- https://helpx.adobe.com/photoshop/using/blur-gallery.html

## Recommended implementation

Compute an analytic signed-distance-like coordinate for the editable ellipse.

For a transformed ellipse:

```text
local = inverseEllipseTransform(pixel)
r = length(local)
```

Then map `r` through a user-controlled smooth falloff curve:

```text
0          -> sharp
0..1 fade  -> variable radius
1          -> maximum blur
```

Use a smooth Hermite / cubic profile by default, not linear, so the transition does not visibly kink.

Multiple iris regions can combine using the minimum blur radius / maximum focus influence, depending on the desired mental model.

## Quality

Use `VariableBlurCore` Mode B when bokeh/highlight behavior is enabled.

## Verdict

Cheap once VariableBlurCore exists. Most engineering is UI geometry + stable falloff semantics.

---

# 8. Tilt-Shift — P1

Tilt-Shift is likewise a radius-field generator.

Photoshop defines a central sharp region and two feather bands, rotatable on-canvas.

Reference:
- https://helpx.adobe.com/photoshop/using/blur-gallery.html

## Recommended control math

Represent the focus band with:

```text
origin
unit normal
sharpHalfWidth
fadeWidthNegative
fadeWidthPositive
maxBlur
```

For every output pixel:

```text
d = dot(pixel - origin, normal)
```

Map `abs(d)` or asymmetric positive/negative distances to a smooth blur-radius curve.

This makes the control map analytic and essentially free.

## Low-rank aperture alternative

If we later support explicit aperture shapes, note Tim McGraw's work on approximating 2D bokeh kernels with sums of low-rank/separable filters. The paper explicitly demonstrates tilt-shift and depth-of-field applications.

Reference:
- **Fast Bokeh Effects Using Low-Rank Linear Filters**  
  https://web.ics.purdue.edu/~tmcgraw/papers/dof_mcgraw_2014.pdf

This is especially relevant for P2 Shape Blur as well.

## Verdict

Build on VariableBlurCore. Very cheap additional filter after Field/Iris.

---

# 9. AnalyticWarpCore — P1 distortion foundation

P0 Displace created the high-quality `WarpSampler`. P1 should add a library of **analytic inverse-coordinate transforms** on top of it.

The common structure is:

```text
outputPixel -> inverseWarp(outputPixel, params) -> high-quality sample(source)
```

Never “push” pixels forward unless there is a specific reason. Inverse mapping avoids holes.

## High-quality sampling requirement

Strong warps can heavily minify the source in some regions. Bilinear sampling at LOD 0 aliases.

Use:

- local derivatives / Jacobian of the mapping;
- mip selection;
- `textureSampleGrad` where applicable;
- Catmull-Rom/bicubic reconstruction for magnification;
- optional EWA-like HQ path for severe anisotropy.

EWA reference:
- Mavridis & Papaioannou, **High Quality Elliptical Texture Filtering on GPU**  
  https://citeseerx.ist.psu.edu/document?doi=3788d4a1c152a68702293928bbc2406c1a5a839e&repid=rep1&type=pdf

GPU Pro practical follow-up:
- https://www.bloomsburyvisualarts.com/app/downloadpdf?cachepagetype=%24cachepagetype&chapterPdfId=9781351261524.ch-010.pdf

## Edge modes

All analytic distortions should share:

```text
Transparent
Clamp / Repeat Edge
Wrap
Mirror (optional LightTable extension)
```

---

# 10. Wave — P1

Photoshop Wave supports:

- multiple wave generators;
- wavelength range;
- amplitude/height range;
- sine / triangle / square waves;
- randomization;
- handling of undefined areas.

Adobe reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommended implementation

Generate a deterministic displacement function analytically in the shader.

A generator can be represented as:

```text
frequency
phase
amplitude
axis / direction
waveType
```

Then sum a small number of generators.

### Performance

No intermediate displacement texture is necessary for ordinary Wave. Evaluate the displacement while sampling.

For many generators, precompute coefficients into a small storage/uniform buffer.

### Determinism

Randomized generator values must come from a stored seed so Smart Filter rerenders are stable.

### Anti-aliasing

A square wave creates discontinuous coordinate derivatives. At high spatial frequency this aliases badly.

For HQ mode either:

- band-limit/soften the square/triangle waveform relative to output pixel footprint; or
- limit generated frequency based on current scale.

## Verdict

Very cheap once WarpSampler exists.

---

# 11. Ripple — P1

Ripple is a radial or directional periodic coordinate perturbation.

Implement as an analytic inverse warp, for example based on distance from center:

```text
r = length(p - center)
displacement = sin(r * frequency + phase) * amplitude
```

Do not hard-code this exact equation as Photoshop parity; expose compatibility mapping at the parameter layer.

## Quality

Use Jacobian-aware mip selection for high frequency / large amplitude.

## Optimization

Precompute reciprocal dimensions and normalized parameters. One `sin` per pixel is generally not a performance concern compared to texture sampling.

If many such procedural warps are chained, node fusion may become valuable.

---

# 12. Twirl — P1

Photoshop rotates pixels most strongly around the center and fades the rotation toward the boundary.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommended mapping

In polar coordinates around a center:

```text
r, theta = polar(p-center)
thetaSource = theta + angle * falloff(r)
```

Use a smooth radial falloff with zero derivative at the boundary to avoid a visible kink.

## Quality

This is a textbook case for derivative-aware sampling because angular compression can become strong near the center or at large twirl angles.

## Verdict

Very low implementation cost on top of WarpSampler.

---

# 13. Spherize — P1

Photoshop describes Spherize as wrapping the image/selection over a spherical form.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Treat this as a radial lens-like mapping inside a normalized circle/ellipse.

Important behavior:

- mapping is continuous at the boundary;
- amount can be positive/negative;
- center/ellipse can be generalized beyond Photoshop if useful;
- outside the effect region is unchanged.

## Sampling

Use WarpSampler with bicubic magnification and derivative-aware minification.

## Do not

Do not implement with a fixed coarse mesh rasterization. An analytic inverse mapping is cheaper, deterministic and resolution-independent.

---

# 14. Polar Coordinates — P1

Two directions:

```text
Rectangular -> Polar
Polar -> Rectangular
```

This is a pure coordinate mapping and should be almost entirely texture-bandwidth bound.

## Critical details

- exact wrap behavior at the seam;
- center convention;
- top/bottom orientation;
- alpha at undefined corners;
- avoid seam filtering across unrelated pixels unless wrap is desired.

## Sampling

Use explicit gradients because the mapping is highly anisotropic near the polar singularity.

## Singular center

Clamp the derivative footprint around the origin and use a stable averaged/mip sample rather than allowing extreme derivatives to produce undefined behavior.

---

# 15. Dust & Scratches — P1

Adobe's current description: the filter reduces noise by changing dissimilar pixels; Radius controls the searched neighborhood and Threshold controls how dissimilar a pixel must be before elimination.

References:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html
- older detailed workflow reference  
  https://helpx.adobe.com/pdf/cs6/photoshop_reference.pdf

## Strong LightTable implementation

Reuse P0 `MedianCore` / `RankCore`.

Proposed algorithm:

```text
m = median(neighborhood)
d = luminance/chroma-aware distance(center, m)

if d > threshold:
    replace/blend center toward m
else:
    keep center
```

This directly matches the useful semantics of “remove local outliers without blurring everything.”

## Better than a hard replace

A hard threshold can flicker or create harsh transitions when adjusting parameters.

Use a soft transition around threshold:

```text
w = smoothstep(thresholdLow, thresholdHigh, d)
out = mix(center, median, w)
```

Expose a Photoshop-compatible Threshold slider but internally use a small soft knee.

## RGB handling

Do not independently median R/G/B and then compare channels unless parity testing proves desirable. Independent channel medians can create colors that did not exist.

Preferred approach:

- compute outlier decision from luminance or perceptual color distance;
- choose a representative source pixel / vector median-like candidate when possible;
- or use luminance median while preserving chroma carefully.

## Performance

Because Median is already P0, this should be close to a wrapper node with one small decision pass, potentially fused into the median output shader.

## Verdict

Very cheap after P0. Implement early in P1.

---

# 16. Despeckle — P1

Adobe describes Despeckle as detecting significant edges and blurring everything except those edges.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Do not write a bespoke legacy approximation.

Build Despeckle from:

```text
EdgeDerivativeCore / local contrast
        +
small Gaussian or edge-aware smoothing
        +
edge protection mask
```

A practical version:

```text
edge = normalizedGradientMagnitude(luma)
blur = GaussianBlur(source, smallRadius)
protection = smoothstep(edgeLow, edgeHigh, edge)
out = mix(blur, source, protection)
```

Alternative higher-quality path:

Use one iteration of the P0 edge-aware/guided filter with conservative parameters.

## Find Edges reuse

The same gradient core built for P1 Find Edges should generate the protection map.

## Verdict

Very low marginal cost. Avoid tuning it until Find Edges and Gaussian are stable.

---

# 17. Mosaic — P1

Adobe Mosaic groups pixels into square blocks and assigns a single representative color to each block.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommended exact implementation

Do **not** simply sample the center texel of each block. Compute the block mean for high quality.

### Small/medium cell sizes

Dispatch one workgroup per mosaic cell:

```text
parallel load/reduce all pixels in cell
-> one mean RGBA
-> store compact cell-color texture
```

Then a second pass fills/output samples the cell texture.

For cell size <= a reasonable workgroup capacity this is straightforward.

### Large cells

Use either:

- hierarchical reduction; or
- a summed-area table if one is already available from BoxFilterCore.

SAT gives exact rectangular averages with four lookups per cell.

## Fast path

If the output is directly displayed and not consumed as a full-res intermediate, the resolve pass can simply map each output pixel to its compact cell color.

## Alpha

Average premultiplied RGBA.

## Verdict

Build `CellReductionCore`; it will be useful again for P2 cell-based effects.

---

# 18. Color Halftone — P1

Photoshop semantics:

- image divided into screen cells;
- each channel gets a halftone screen angle;
- each cell becomes a circle/dot;
- dot size is proportional to channel brightness;
- maximum radius is user controlled.

Adobe references:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html
- https://helpx.adobe.com/uk/photoshop/using/applying-specific-filters.html

## Recommendation

Implement analytically as a periodic signed-distance screen, not by rasterizing thousands of circles.

For each color channel:

1. Transform image coordinates into the rotated screen coordinate system.
2. Determine cell center.
3. Read/estimate the source channel tone for that cell.
4. Convert tone to dot area/radius.
5. Evaluate distance from pixel to the dot shape.
6. Convert signed distance to coverage with antialiasing.

## Cell tone

For quality, use **cell average**, not a single source sample.

Options:

- use `CellReductionCore` for normal/large cells;
- use a suitable mip level for very small screens;
- use SAT if already available.

## Anti-aliasing

A binary step creates horrible stair-stepping and moiré.

Use analytic coverage / smooth transition around the dot edge.

In a render/fragment pipeline, derivatives (`fwidth`-style logic) are ideal. In compute, estimate the screen-space footprint analytically from the known transform or use a small multisample only at the dot boundary.

## Channel space

Photoshop applies channel-specific screens. LightTable should support:

```text
RGB mode
CMYK-style artistic mode
Monochrome mode
```

Even if the document's working space is RGB, a CMYK-style simulation can be an artistic option.

## Default screen angles

Do not claim Photoshop-identical defaults unless verified. Store our own documented presets and allow custom angles.

## Verdict

Build as a reusable print-screen primitive. It will later power P2 Halftone Pattern and parts of Mezzotint.

---

# 19. Clouds / Procedural Noise — P1

Photoshop Clouds generates a soft random cloud pattern between foreground/background colors. Difference Clouds and Fibers later build on related procedural ideas.

Adobe reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Build a proper `ProceduralTextureCore` rather than a Photoshop-only Clouds shader.

Base noise candidates:

- classic/improved Perlin;
- simplex noise;
- cellular/Worley for future effects;
- value/gradient noise for specialized looks.

Strong GPU reference:
- McEwan, Sheets, Gustavson, Richardson, **Efficient computational noise in GLSL**  
  https://arxiv.org/abs/1204.1461

The paper is specifically useful because the implementations are computation-only and avoid texture lookup tables.

Additional procedural-shading reference:
- Gustavson, **No more texels, no more facets: Emerging trends in GPU procedural shading**  
  https://www.diva-portal.org/smash/get/diva2%3A661790/FULLTEXT01.pdf

## Clouds recipe

A modern Clouds implementation should use fractal synthesis:

```text
n = sum over octaves:
    amplitude_i * noise(position * frequency_i)
```

with:

```text
frequency *= lacunarity
amplitude *= persistence/gain
```

Then normalize/map between foreground/background colors.

## Required controls

Even if Photoshop compatibility starts simpler, internal node parameters should include:

```text
Seed
Scale
Octaves
Lacunarity
Gain / Persistence
Contrast
Turbulence / absolute mode
Offset
Foreground color
Background color
```

Some can remain hidden initially.

## Determinism

Seed must be stored in the smart-filter node. Re-rendering must never change the cloud pattern unless the user explicitly randomizes it.

## Tileability

Worth designing now. A periodic/tileable noise mode will be valuable for textures, 3D work and generated assets.

## Precision

Use FP32 for coordinate generation at large zoom levels; FP16 coordinate noise can show repeating/precision artifacts.

## Verdict

High architectural value beyond one Photoshop filter.

---

# 20. Lens Flare — P1

This is the P1 effect where “fast but high quality” requires an explicit choice between a cheap artistic flare and a physically plausible lens simulation.

Adobe's Lens Flare simulates reflections/refraction from a bright source entering a lens.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Primary research reference

Hullin et al., **Physically-Based Real-Time Lens Flare Rendering**, SIGGRAPH 2011.

Paper:
- https://matthias.hullin.net/publications/HullinEtAl-LensflareRendering-SIGGRAPH2011.pdf

Alternative hosted PDF:
- https://publications.graphics.tudelft.nl/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBcjRNIiwiZXhwIjpudWxsLCJwdXIiOiJibG9iX2lkIn19--2c7b8031fceb5f15c009ffb9efbcce4ec5c7eb33/flare.pdf

The paper models:

- ghost reflections between lens surfaces;
- anti-reflective coatings;
- chromatic/geometric aberrations;
- aperture/starburst effects;
- spectral effects;
- acceleration/precomputation for interactive rendering.

## LightTable recommendation: lens-profile architecture

Do not ray trace a full optical system from scratch every frame just to expose a Photoshop-like Lens Flare filter.

Instead:

### Offline / preset stage

For each lens profile, precompute or author:

```text
lens surfaces / ghost paths
relative ghost position transforms
relative scale
spectral/color response
vignetting response
aperture/starburst profile
coating parameters or artistic approximation
```

### Runtime stage

Given a bright source position/intensity:

```text
for each ghost primitive:
    compute position/scale/color
    rasterize/additive composite

render starburst/diffraction component
apply chromatic aberration / clipping / vignette as defined
```

This gets much closer to convincing optical behavior than a static sprite chain while remaining extremely fast.

## Two quality modes

### Artistic Fast

- 5–20 ghost primitives;
- procedural rings/discs/polygons;
- precomputed starburst texture;
- spectral color shifts;
- one/few passes.

### Physically Inspired HQ

- preset derived from optical lens prescription;
- more ghost paths;
- wavelength bands;
- physically motivated intensity and aperture clipping;
- high-resolution starburst/diffraction.

## Bright-source extraction

If Lens Flare is applied to the image rather than a manually placed point, optionally extract bright sources via:

```text
threshold
-> downsample
-> local maxima
```

But keep manual source placement as the deterministic primary behavior.

## Important

Do not copy the SIGGRAPH implementation code unless its license explicitly allows it. Reimplement the published method/ideas.

## Verdict

Build a **lens-profile renderer**, not “Photoshop four lens presets.” This gives LightTable a much more future-proof result.

---

# 21. EdgeDerivativeCore — P1 foundation

Find Edges and Emboss should share a high-quality gradient/derivative primitive.

## Candidate A — Scharr 3x3

Compared with Sobel, Scharr coefficients are designed for better rotational behavior at the same compact 3x3 footprint.

Practical references:
- scikit-image edge operators / rotational invariance discussion  
  https://scikit-image.org/docs/0.21.x/auto_examples/edges/plot_edge_filter.html
- NVIDIA cuCIM/skimage derivative references  
  https://docs.rapids.ai/api/cucim/stable/api/

## Candidate B — Farid & Simoncelli 5x5

Farid/Simoncelli derivative filters are more rotationally invariant but require a 5x5 footprint.

Paper citation:
- Farid & Simoncelli, **Differentiation of discrete multidimensional signals**, IEEE TIP 2004, DOI 10.1109/TIP.2004.823819

## Recommendation

Use:

```text
Fast/default: Scharr 3x3
HQ: Farid 5x5
```

Both are tiny compared with most P1 effects.

## Shader fusion

Compute useful outputs in one pass:

```text
Gx
Gy
magnitude
orientation
optional luminance
```

Pack only what subsequent filters actually need.

---

# 22. Find Edges — P1

Photoshop Find Edges identifies areas of significant transitions and emphasizes them.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Recommendation

Build on `EdgeDerivativeCore`.

### Normal Photoshop-like output

```text
luma -> gradient magnitude -> tone mapping/inversion
```

Then use the source hue/color if compatibility tests indicate that users expect colored edge behavior.

### Better LightTable modes

The underlying filter node can support hidden/internal outputs:

```text
Magnitude
Signed X
Signed Y
Orientation
Edge mask
```

These can later be exposed to masks/compositing without duplicating compute.

## Scale

A single 3x3 derivative only detects very fine edges. A modern node should optionally support pre-blur radius / scale:

```text
Gaussian(sigma)
-> derivative
```

This also makes it useful for stylization and masks.

## Verdict

Very cheap, very reusable. Implement early.

---

# 23. Emboss — P1

Photoshop Emboss exposes direction/angle, height and amount.

Reference:
- https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

## Better implementation

Treat the image luminance as a height field and compute a directional derivative.

Using gradient `G = (Gx, Gy)` and a light/direction vector `d`:

```text
slope = dot(G, d)
```

Then map to a neutral midpoint:

```text
emboss = 0.5 + slope * strength
```

This produces a much more rotationally stable result than selecting one of a few hard-coded 3x3 emboss kernels.

## Height parameter

Use Height to control the prefilter scale / sample distance, not merely multiply contrast. For larger “height”, compute gradients over a broader spatial scale.

## Optional physically richer mode

Derive a normal from the height field:

```text
N = normalize(vec3(-Gx * scale, -Gy * scale, 1))
lighting = max(dot(N, L), 0)
```

This becomes useful later for:

- Plastic Wrap;
- Texturizer relief;
- bump-like stylization.

Keep compatibility mode available if needed.

## Verdict

Implement as a wrapper over EdgeDerivativeCore with optional normal/lighting mode.

---

# 24. Recommended P1 implementation order

## Phase 1 — low-cost reuse of P0

1. Dust & Scratches
2. Despeckle

These should leverage Median, Gaussian/EdgeAware and require little new infrastructure.

## Phase 2 — EdgeDerivativeCore

3. Find Edges
4. Emboss

Creates reusable edge/gradient infrastructure for P2 stylization.

## Phase 3 — AnalyticWarpCore

5. Twirl
6. Ripple
7. Wave
8. Spherize
9. Polar Coordinates

All should use the already high-quality P0 WarpSampler.

## Phase 4 — Cell/filter primitives

10. Box Blur
11. Mosaic
12. Color Halftone

At this point consider whether a reusable GPU summed-area-table/scan core is justified by benchmarks.

## Phase 5 — ProceduralTextureCore

13. Clouds / Procedural Noise

This becomes the base of multiple P2 Render/Texture effects.

## Phase 6 — VariableBlurCore

14. Field Blur
15. Iris Blur
16. Tilt-Shift

This is more engineering-heavy but has high user value.

## Phase 7 — Radial Blur

17. Radial Blur

Shares integration ideas with P0 Motion Blur and later P2 Spin Blur.

## Phase 8 — LensFlareCore

18. Lens Flare

Treat as a small subsystem with lens profiles rather than a one-off shader.

---

# 25. Performance / quality bake-offs required

## 25.1 Box Blur

Compare:

```text
tiled direct separable
rolling-sum tiled
SAT
```

Across radii 1–512.

## 25.2 Variable blur

Compare:

```text
blur pyramid interpolation
low-rank aperture filtering
HQ variable-radius scatter-as-gather
```

Test both smooth and abrupt radius maps.

## 25.3 Warp sampling

Compare:

```text
bilinear + explicit LOD
9-tap Catmull-Rom + LOD
EWA-like HQ
```

on severe Wave/Twirl/Polar cases.

## 25.4 Edge derivative

Compare Scharr 3x3 vs Farid 5x5 on:

- diagonal lines;
- circular shapes;
- fine text;
- noise;
- 8K content.

## 25.5 Halftone

Compare:

- source tone sampled at center;
- mip average;
- exact/reduced block average;
- analytic coverage vs 2x2/4x supersampling.

## 25.6 Lens flare

Measure CPU setup and GPU rendering separately. Runtime cost should scale with number of ghost primitives, not full physical ray count.

---

# 26. Reference-image test set

Every P1 filter should be validated against at least:

1. checkerboard at Nyquist frequencies;
2. one-pixel RGB lines;
3. black/white text on transparent background;
4. smooth HDR gradient;
5. saturated neon-like highlights;
6. skin/hair photograph;
7. architecture with straight lines;
8. random noise image;
9. alpha feather/soft shadow;
10. 30 MP photo;
11. extremely wide panorama;
12. repeated/tile texture.

Additional per-filter fixtures:

- Warp: polar grid, radial spokes, fine checkerboard.
- Halftone: gray ramps and RGB/CMYK test wedges.
- Variable blur: isolated white point lights on black, focus ramps.
- Lens flare: isolated HDR point source and multiple source candidates.

---

# 27. Renderer fusion opportunities

P1 creates many opportunities for the graph compiler.

Examples:

```text
Find Edges -> threshold mask
```

can fuse edge magnitude + threshold.

```text
Emboss -> Blend
```

can potentially generate final composited result without storing an intermediate gray image.

```text
Wave -> color transform
```

can sample the source at warped coordinates and immediately apply the next per-pixel transform.

```text
Mosaic -> display
```

can keep compact cell colors and resolve directly rather than materializing an unnecessary full-res mosaic texture early.

```text
Clouds -> blend mode
```

can procedurally generate and composite in one pass when the node graph allows it.

---

# 28. Things the coding agent should explicitly avoid

- Do not implement Field/Iris/Tilt-Shift as a simple mix of original + one globally blurred image.
- Do not brute-force huge Box Blur kernels with hundreds of taps per pixel.
- Do not let strong analytic warps always sample mip level 0.
- Do not build each distortion as a separate resampler; share WarpSampler.
- Do not make procedural noise nondeterministic between renders.
- Do not center-sample Mosaic blocks if a block mean is affordable.
- Do not render Color Halftone dots as aliased binary circles.
- Do not copy an old Sobel implementation and call it best-quality edge detection.
- Do not implement Lens Flare as a fixed PNG sprite chain if we are aiming for a premium editor.
- Do not copy GPL/reference code into LightTable merely because a paper's demo repository is available.
- Do not sacrifice premultiplied-alpha correctness to save one instruction.

---

# 29. Licensing / source-use notes

## Research papers

Algorithms described by academic papers can be independently implemented, but patents may exist around particular techniques. Before shipping a direct reproduction of any patented technique, perform the project's normal legal review.

## GPU SDK samples

AMD/NVIDIA sample code and SDKs have their own licenses. Use them as architectural/performance references unless the exact license has been reviewed for incorporation.

## Kyprianidis repositories

The public `gpuakf` implementation is GPL-3.0. Do not copy its GLSL into proprietary LightTable code unless the licensing strategy explicitly permits that.

Repository/reference:
- https://github.com/jkyprian/gpuakf

## Lens flare

The Hullin et al. paper is an excellent algorithmic reference. Do not assume the paper PDF grants a code license.

---

# 30. Primary research/reference sources

## Photoshop behavior

### Adobe filter effects reference
https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

### Adobe Blur Gallery
https://helpx.adobe.com/photoshop/using/blur-gallery.html

### Adobe specific filter application / Color Halftone
https://helpx.adobe.com/uk/photoshop/using/applying-specific-filters.html

### Adobe current filters overview
https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filters-overview.html

## Box / variable-radius filtering

### Hensley et al. — Fast Summed-Area Table Generation and its Applications
https://shaderwrangler.com/publications/sat/

PDF:
https://shaderwrangler.com/publications/sat/SAT_EG2005.pdf

### NVIDIA GPU Gems 3 — Parallel Prefix Sum (Scan)
https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda

### GPU Gems — Depth of Field survey
https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-23-depth-field-survey-techniques

### GPU Gems 3 — Practical Post-Process Depth of Field
https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field

### AMD FidelityFX Depth of Field 1.1
https://gpuopen.com/manuals/fidelityfx_sdk/techniques/depth-of-field/

### Kosloff et al. — Fast Filter Spreading and its Applications
Search/publication copy:
https://www.researchgate.net/publication/228528480_Fast_Filter_Spreading_and_its_Applications

### McGraw — Fast Bokeh Effects Using Low-Rank Linear Filters
https://web.ics.purdue.edu/~tmcgraw/papers/dof_mcgraw_2014.pdf

## Resampling / warp quality

### High Quality Elliptical Texture Filtering on GPU
https://citeseerx.ist.psu.edu/document?doi=3788d4a1c152a68702293928bbc2406c1a5a839e&repid=rep1&type=pdf

### Practical Elliptical Texture Filtering on the GPU
https://www.bloomsburyvisualarts.com/app/downloadpdf?cachepagetype=%24cachepagetype&chapterPdfId=9781351261524.ch-010.pdf

### WGSL texture functions / gradients
https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl-function-reference.html

## Edge detection

### Farid & Simoncelli — Differentiation of discrete multidimensional signals
DOI: https://doi.org/10.1109/TIP.2004.823819

### scikit-image edge operators comparison
https://scikit-image.org/docs/0.21.x/auto_examples/edges/plot_edge_filter.html

## Procedural noise

### McEwan et al. — Efficient computational noise in GLSL
https://arxiv.org/abs/1204.1461

### Gustavson — procedural GPU shading / cellular references
https://www.diva-portal.org/smash/get/diva2%3A661790/FULLTEXT01.pdf

## Lens flare

### Hullin et al. — Physically-Based Real-Time Lens Flare Rendering
https://matthias.hullin.net/publications/HullinEtAl-LensflareRendering-SIGGRAPH2011.pdf

Alternative PDF:
https://publications.graphics.tudelft.nl/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBcjRNIiwiZXhwIjpudWxsLCJwdXIiOiJibG9iX2lkIn19--2c7b8031fceb5f15c009ffb9efbcce4ec5c7eb33/flare.pdf

## WebGPU feature detection

### MDN GPUSupportedFeatures
https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures

### WGSL specification
https://www.w3.org/TR/WGSL/

---

# 31. Final P1 technical map

| Filter | Recommended production implementation | Main reused core |
|---|---|---|
| Box Blur | tiled separable exact box; SAT for huge/reused radii | `BoxFilterCore` |
| Radial Blur | analytic spin/zoom exposure gather + mip/LOD | motion/warp sampling |
| Field Blur | smooth pin -> radius field -> variable blur | `VariableBlurCore` |
| Iris Blur | analytic iris radius field -> variable blur | `VariableBlurCore` |
| Tilt-Shift | analytic band radius field -> variable blur | `VariableBlurCore` |
| Wave | analytic displacement + HQ WarpSampler | `AnalyticWarpCore` |
| Ripple | analytic periodic radial warp | `AnalyticWarpCore` |
| Twirl | polar angular warp | `AnalyticWarpCore` |
| Spherize | analytic radial lens/sphere warp | `AnalyticWarpCore` |
| Polar Coordinates | explicit rect/polar inverse mapping | `AnalyticWarpCore` |
| Dust & Scratches | median outlier replacement with soft threshold | P0 `RankCore` |
| Despeckle | edge mask + small blur/edge-aware smoothing | P0 blur + `EdgeDerivativeCore` |
| Mosaic | per-cell mean reduction + compact resolve | `CellReductionCore` |
| Color Halftone | analytic rotated dot screen + cell averages | `HalftoneCore` |
| Clouds | deterministic simplex/gradient fBm | `ProceduralTextureCore` |
| Lens Flare | runtime lens-profile ghost renderer | `LensFlareCore` |
| Find Edges | Scharr default / Farid HQ | `EdgeDerivativeCore` |
| Emboss | directional gradient / optional normal-lighting | `EdgeDerivativeCore` |

---

# 32. Definition of done for a P1 filter

A filter is not “done” because the UI produces a recognizable effect.

For every P1 filter the coding agent must provide:

1. non-destructive node representation;
2. deterministic parameter serialization;
3. portable WGSL implementation;
4. correct alpha behavior;
5. linear/display-domain decision documented;
6. reference implementation or reference render path;
7. GPU timing at representative resolutions;
8. visual difference fixtures;
9. large-image test;
10. extreme-parameter test;
11. cancellation / parameter-drag stability;
12. no leaked GPU resources;
13. no validation errors;
14. documented fallback when optional GPU features are unavailable.

For filters that are only wrappers around an existing core, benchmark the full end-to-end node, not only the core primitive.

---

# 33. First concrete coding tasks

Do these only after the P0 spec's core primitives are working and measured.

## Task 1 — EdgeDerivativeCore

Implement:

```text
Scharr 3x3 gradients
Farid 5x5 optional HQ gradients
magnitude + orientation
Find Edges wrapper
Emboss wrapper
```

Run rotational test fixtures.

## Task 2 — P0 reuse wrappers

Implement:

```text
Dust & Scratches
Despeckle
```

using the existing Median/Blur/EdgeAware infrastructure.

## Task 3 — AnalyticWarpCore

Implement one shared WGSL/resampling framework and add:

```text
Twirl
Ripple
Wave
Spherize
Polar Coordinates
```

Do not move on until strong-minification aliasing is solved.

## Task 4 — BoxFilterCore + CellReductionCore

Implement small/medium exact box and Mosaic. Prototype SAT only after the direct path is benchmarked.

## Task 5 — HalftoneCore

Implement Color Halftone with correct cell-average tone and analytic antialiasing.

## Task 6 — ProceduralTextureCore

Implement deterministic textureless simplex/gradient noise + fBm and expose Clouds.

## Task 7 — VariableBlurCore

Prototype:

```text
A: blur-pyramid variable Gaussian
B: HQ scatter-as-gather / aperture path
```

Then build Field, Iris, Tilt-Shift on top.

## Task 8 — Radial Blur

Reuse the P0 motion integration infrastructure and validate Spin/Zoom against a high-sample reference.

## Task 9 — LensFlareCore

Start with lens-profile data structures and a physically-inspired ghost renderer, not hard-coded Photoshop sprites.

---

# 34. Summary for the coding agent

The P1 pass should add **capabilities**, not just menu entries.

The most important new capabilities are:

```text
variable-radius/aperture blur
analytic distortion with derivative-aware reconstruction
cell reduction/statistics
analytic print/halftone screening
procedural deterministic textures
high-quality edge derivatives
profile-driven optical flare rendering
```

If these cores are implemented well, a large part of the P2/P3 Photoshop-style effect list becomes a thin composition layer rather than new renderer engineering.
