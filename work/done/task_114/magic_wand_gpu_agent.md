# GPU Magic Wand Selection Tool — Implementation Brief

## Goal

Implement a **Photoshop-style Magic Wand selection tool** for the Lighttable editor.

The tool must be **GPU-first** and integrate with the existing selection/mask system. The primary goal is to match the familiar Photoshop interaction model and produce fast selections even on large images.

This document describes the intended UX, parameters, rendering behavior, GPU architecture, and recommended implementation strategy. Where Photoshop's exact internal color-distance math is unknown, the implementation should be designed so the comparison function can be swapped or tuned later through parity testing.

---

# 1. Photoshop-style parameters

The Magic Wand tool should expose the following toolbar parameters:

## Sample Size

Supported modes:

- `Point Sample`
- `3 by 3 Average`
- `5 by 5 Average`
- `11 by 11 Average`
- `31 by 31 Average`
- `51 by 51 Average`
- `101 by 101 Average`

The selected sample size determines the reference color used by the Magic Wand.

### Point Sample

Use the exact sampled pixel beneath the cursor.

### Averaged samples

Average the pixels inside a square region centered on the clicked position.

Examples:

```text
3 by 3 Average
=> 9 pixels

5 by 5 Average
=> 25 pixels

11 by 11 Average
=> 121 pixels
```

Large sample sizes must remain efficient and should **not** perform a naive NxN loop per click if a better GPU strategy is available.

Recommended options:

- mip-chain / reduction strategy
- summed-area table / integral image
- hierarchical compute reduction
- dedicated local reduction compute pass

The implementation should select the simplest performant approach consistent with the existing render architecture.

---

# 2. Tolerance

Expose:

```text
Tolerance: 0 ... 255
```

Default:

```text
20
```

Tolerance determines how far a pixel may differ from the reference color while still being considered a candidate.

Conceptually:

```text
distance(pixelColor, sampledColor) <= tolerance
```

Do **not** hard-code the exact color-distance implementation deeply into the tool.

Use an abstraction such as:

```ts
interface MagicWandColorComparator {
    evaluate(
        pixel: Color,
        reference: Color,
        tolerance: number
    ): number;
}
```

or equivalent GPU-side configuration.

The reason is Photoshop parity.

The exact modern Photoshop tolerance calculation should be considered an implementation detail that may need empirical testing.

Potential implementations to test include:

- per-channel RGB threshold
- max-channel delta
- average RGB delta
- weighted RGB distance
- Euclidean RGB distance
- luminance/chroma-derived distance

The architecture should make this easy to change without rewriting the selection system.

---

# 3. Anti-alias

Expose:

```text
Anti-alias: ON / OFF
```

Default:

```text
ON
```

When disabled:

```text
selection mask = binary
0.0 or 1.0
```

When enabled:

selection edges should support partial coverage.

Example:

```text
0.00
0.18
0.61
0.94
1.00
```

Do not treat anti-aliasing as a visual overlay-only feature.

The underlying selection mask should preserve fractional selection values because downstream operations such as:

- delete
- mask creation
- painting
- fill
- adjustments
- compositing

must use the same soft edge.

Recommended mask format:

```text
r8unorm
```

or another compact single-channel GPU format supported cleanly by the existing selection architecture.

If the current system already uses another format, reuse it.

---

# 4. Contiguous

Expose:

```text
Contiguous: ON / OFF
```

Default:

```text
ON
```

## Contiguous OFF

All pixels in the sampled source that satisfy the tolerance test become selected.

Conceptually:

```text
candidate = colorDistance(pixel, sample) <= tolerance

selection[pixel] = candidate
```

This should be implemented as a simple GPU compute pass over the image.

Complexity:

```text
O(width × height)
```

This path should be extremely fast.

---

## Contiguous ON

Only connected pixels belonging to the candidate region surrounding the clicked seed point are selected.

Pipeline:

```text
sample reference color
        ↓
build candidate mask
        ↓
seed clicked pixel
        ↓
connected-region propagation
        ↓
selection mask
```

Connectivity should initially use:

```text
4-connected pixels

left
right
up
down
```

Do not assume diagonal connectivity unless parity testing shows Photoshop behaves differently.

The connectivity rule should preferably remain configurable internally.

---

# 5. Sample All Layers

Expose:

```text
Sample All Layers: ON / OFF
```

Default:

```text
OFF
```

## OFF

Sampling and color comparison operate on the currently active raster/image layer.

## ON

Sampling operates on the current visible composited document result.

This must reuse the existing compositor where possible.

Do not read layers back to CPU.

The Magic Wand should receive a GPU texture representing the source being sampled.

Conceptually:

```text
active layer texture
```

or:

```text
visible composited texture
```

depending on the option.

---

# 6. Selection operation modes

The Magic Wand must integrate with the existing Photoshop-style selection modifiers.

Support:

```text
New selection
Add to selection
Subtract from selection
Intersect with selection
```

Suggested hotkey behavior:

```text
click
    new selection

Shift + click
    add

Alt + click
    subtract

Shift + Alt + click
    intersect
```

Reuse Lighttable's existing selection modifier conventions if they are already standardized.

Do not duplicate selection-combine logic inside the Magic Wand tool.

The Magic Wand should produce a temporary mask and pass it to the general selection-combination system.

Conceptually:

```text
magicWandResultMask
        ↓
SelectionCombineOperation
        ↓
documentSelectionMask
```

---

# 7. Recommended GPU architecture

Suggested pipeline:

```text
Pointer click
      │
      ▼
Sample source texture
      │
      ▼
Compute reference color
      │
      ▼
Candidate Mask Compute Pass
      │
      ├──────── Contiguous OFF ────────┐
      │                                │
      ▼                                ▼
Connected Component Pass          Result Mask
      │                                │
      ▼                                │
Region Mask                            │
      └──────────────┬─────────────────┘
                     ▼
             Edge / AA processing
                     │
                     ▼
             Selection Combine
                     │
                     ▼
              Selection Mask
```

Everything after pointer input should remain GPU-side.

Avoid:

```text
GPU → CPU pixel readback
CPU flood fill
CPU → GPU mask upload
```

except possibly tiny diagnostic/debug paths.

---

# 8. Reference color sampling

The clicked location needs to be transformed correctly through the entire viewport/document transform.

Account for:

- zoom
- pan
- document offsets
- canvas bounds
- layer transform
- DPI / device pixel ratio
- cropped images
- transformed layers if relevant

Sampling coordinates must ultimately resolve to image/document pixel coordinates.

Do not derive sampling from the displayed UI framebuffer if that introduces scaling/filtering artifacts.

Prefer sampling the actual source texture.

---

# 9. Averaged sample implementation

For averaged samples, calculate the reference color in the source image's native pixel domain.

Do not average already display-transformed/sRGB-screen pixels if the editor internally works in another color domain.

The agent should inspect the existing Lighttable color pipeline and determine the correct sampling stage.

For Photoshop-like behavior, initial parity testing should compare both:

- image/native encoded RGB sampling
- working-space / linear sampling

Do not prematurely assume which is correct.

The implementation should make the sampling domain explicit.

---

# 10. Candidate mask pass

Recommended compute shader responsibility:

```text
for each image pixel:

    sourceColor = sourceTexture[pixel]
    delta = compare(sourceColor, referenceColor)

    candidateMask[pixel] =
        delta <= tolerance
        ? 1
        : 0
```

Output:

```text
CandidateMask
```

Suggested texture:

```text
r8unorm
```

or compact integer equivalent.

This mask can also be useful for debugging.

---

# 11. Contiguous region extraction

This is the most important GPU algorithmic part.

Do not implement a naive CPU flood fill.

Possible GPU strategies include:

## Option A — Iterative propagation

Start with:

```text
regionMask[seed] = 1
```

Then repeatedly propagate into neighboring candidate pixels:

```text
region(x,y) =
    candidate(x,y)
    AND
    (
        region(x-1,y)
        OR region(x+1,y)
        OR region(x,y-1)
        OR region(x,y+1)
    )
```

Repeat until no pixels change.

Advantages:

- simple
- reliable
- easy to implement
- good first version

Disadvantages:

- worst-case iteration count may approach image dimensions
- large flat regions can require many passes

This is acceptable for a first implementation if performance remains interactive.

---

## Option B — GPU connected component algorithm

For better scalability, investigate:

- connected-component labeling
- jump flooding style propagation
- union-find variants suitable for GPU
- block/tile flood fill
- scanline-based GPU flood fill

A tiled/connected-component solution may become preferable for:

- 8K images
- huge flat areas
- repeated Magic Wand operations
- very high-resolution documents

The implementation can initially use iterative propagation if designed behind an abstraction that permits replacement later.

---

# 12. Optimization opportunity: tiled propagation

A strong approach for Lighttable may be:

```text
candidate mask
      ↓
tile occupancy / connectivity analysis
      ↓
propagate connected tiles
      ↓
resolve pixels inside active tiles
```

Example tile sizes:

```text
8×8
16×16
32×32
```

This can dramatically reduce work when the image contains large areas that fail the tolerance test.

Do not over-engineer this before profiling the simpler implementation.

---

# 13. Detecting convergence

If using iterative propagation, avoid an unnecessary CPU readback every iteration.

Possible strategies:

- GPU atomic change counter
- indirect dispatch
- ping-pong masks + changed flag
- fixed maximum batches followed by sparse convergence checks

A tiny single-value GPU → CPU readback may be acceptable if needed, but avoid synchronizing the whole texture.

Investigate whether WebGPU indirect dispatch can help keep the loop GPU-driven.

---

# 14. Mask ping-pong

A simple contiguous implementation may use:

```text
regionMaskA
regionMaskB
```

Per iteration:

```text
read  A
write B

swap

read  B
write A
```

CandidateMask remains read-only.

Once converged, the current region mask becomes the selection result.

---

# 15. Anti-alias strategy

Photoshop parity should ultimately determine the exact behavior.

For the initial implementation:

1. build the hard candidate/connected mask
2. identify boundary pixels
3. calculate soft coverage based on color distance near the tolerance boundary
4. optionally apply a very small edge-aware smoothing step

Do not blur the entire selection indiscriminately.

A simple full-mask Gaussian blur is likely to produce visibly incorrect results.

The anti-alias result should remain localized near the selection boundary.

Potential basis:

```text
coverage = smoothstep(
    tolerance + edgeWidth,
    tolerance - edgeWidth,
    colorDistance
)
```

then constrain this to the selected connected region.

This is only a starting point and should be adjusted through parity testing.

---

# 16. Selection preview

Reuse the existing Lighttable selection visualization.

Potential display:

```text
marching ants
```

The visualization must be independent from the underlying mask representation.

Do not continuously regenerate the Magic Wand mask simply to animate marching ants.

---

# 17. Responsiveness

Target interaction:

```text
click
→ visible selection result nearly immediately
```

Ideal target on modern desktop GPUs:

```text
1080p / 1440p:
< 16 ms where practical

4K:
preferably < 50 ms

large contiguous worst-case:
progressive result or modest delay acceptable
```

Do not block the UI thread.

A single difficult selection should never freeze the application.

---

# 18. Color management

The agent must inspect the current Lighttable color pipeline before implementing the comparator.

Important question:

```text
At which color stage does Photoshop effectively evaluate Magic Wand tolerance?
```

Potential domains:

- encoded document RGB
- working color space
- linear RGB
- display RGB
- luminance/chroma space

Do not casually use rendered monitor RGB values.

Keep comparator logic centralized so parity testing can switch models easily.

---

# 19. Alpha handling

Define explicit behavior for transparent pixels.

Suggested starting rule:

- RGB comparison uses source RGB
- alpha can participate separately
- fully transparent pixels should not automatically behave like arbitrary black pixels

Investigate Photoshop behavior with:

```text
opaque RGB
partially transparent RGB
fully transparent pixels
```

Include these in parity tests.

---

# 20. Layer behavior

Magic Wand must respect:

- active layer
- layer visibility
- transformed layers
- masks
- clipping where relevant
- Sample All Layers

The implementation should be based on the same logical rendered source users see, depending on toolbar settings.

Do not create a separate inconsistent rendering path.

---

# 21. Undo

A completed Magic Wand click should become one selection-history operation.

Example:

```text
Magic Wand selection
→ Undo
→ previous selection restored
```

Do not record internal GPU propagation iterations in undo history.

---

# 22. Cancellation

If the user clicks again or switches tools while a large selection is still computing:

```text
cancel / invalidate previous operation
```

Use an operation generation ID or equivalent mechanism.

Old GPU results must not overwrite a newer selection.

---

# 23. Photoshop parity test suite

Create a dedicated Magic Wand parity fixture.

Use synthetic images with exact known RGB values.

Example seed:

```text
RGB(100, 100, 100)
```

Surround it with patches such as:

```text
100,100,100
101,100,100
105,100,100
110,100,100
120,100,100

100,101,100
100,105,100
100,110,100

100,100,101
100,100,105
100,100,110

105,105,105
110,110,110
120,90,100
90,120,100
```

Test Photoshop with:

```text
Tolerance:
0
1
2
5
10
20
32
64
128
255
```

Test each with:

```text
Anti-alias OFF
Anti-alias ON

Contiguous OFF
Contiguous ON

Point Sample
3×3
5×5
11×11
31×31
51×51
101×101
```

Export or capture the resulting selection masks and compare them against Lighttable.

---

# 24. Regression testing

The Magic Wand should have deterministic GPU regression tests.

Recommended fixtures:

```text
solid colors
gradients
checker patterns
isolated islands
thin 1px bridges
diagonal connections
transparent edges
noise
large uniform areas
color-managed test images
```

Compare generated masks against known-good masks.

Prefer direct mask comparisons instead of screenshot comparisons when possible.

Metrics may include:

```text
exact matching for hard masks

or

max pixel error
mean pixel error
SSIM-like comparison

for anti-aliased masks
```

---

# 25. Edge-case tests

Explicitly test:

```text
click outside canvas
click exact canvas border
single-pixel image
fully transparent layer
empty layer
hidden layer
locked layer
1×1 selection region
whole-image region
8K image
very large uniform image
tolerance 0
tolerance 255
```

Also test regions connected by:

```text
1 pixel horizontal bridge
1 pixel vertical bridge
diagonal-only contact
```

---

# 26. Tool state

Suggested state:

```ts
type MagicWandSampleSize =
    | 1
    | 3
    | 5
    | 11
    | 31
    | 51
    | 101;

interface MagicWandOptions {
    sampleSize: MagicWandSampleSize;
    tolerance: number;
    antiAlias: boolean;
    contiguous: boolean;
    sampleAllLayers: boolean;
}
```

Default:

```ts
{
    sampleSize: 1,
    tolerance: 20,
    antiAlias: true,
    contiguous: true,
    sampleAllLayers: false
}
```

Adapt naming to the existing Lighttable codebase conventions.

---

# 27. GPU resources

Potential resources:

```text
SourceTexture
ReferenceColorBuffer
CandidateMask
RegionMaskA
RegionMaskB
FinalMask
ChangeCounter
```

Avoid allocating these textures on every click.

Reuse pooled GPU resources where practical.

Size-dependent resources should be recreated only when document dimensions change.

---

# 28. Performance rules

The implementation should follow these principles:

1. Keep image data on GPU.
2. Avoid full-resolution CPU readbacks.
3. Reuse GPU textures/buffers.
4. Use compute shaders for candidate generation.
5. Use GPU connectivity propagation.
6. Avoid recreating bind groups/pipelines unnecessarily.
7. Cache averaged-sampling support structures if beneficial.
8. Profile before implementing complex algorithms.
9. Design the connectivity implementation so it can be upgraded later.
10. Keep UI responsiveness independent from GPU completion.

---

# 29. Integration architecture

Prefer something structurally similar to:

```text
MagicWandTool
    │
    ├── MagicWandSampler
    │
    ├── MagicWandCandidatePass
    │
    ├── MagicWandConnectivityPass
    │
    ├── MagicWandAntiAliasPass
    │
    └── SelectionSystem
```

The Magic Wand must **not** become responsible for:

- selection history
- marching ants
- general selection combination
- mask persistence
- layer compositing

Those belong to shared systems.

---

# 30. Implementation phases

## Phase 1

Implement:

```text
Point Sample
Tolerance
Contiguous OFF
Anti-alias OFF
active layer only
```

This validates the color comparator and GPU mask path.

---

## Phase 2

Add:

```text
Contiguous ON
GPU connected region
```

---

## Phase 3

Add:

```text
Sample All Layers
```

---

## Phase 4

Add:

```text
3×3
5×5
11×11
31×31
51×51
101×101 averaging
```

---

## Phase 5

Add:

```text
Anti-alias
```

and tune against Photoshop.

---

## Phase 6

Run Photoshop parity tests and adjust:

```text
color-distance math
sampling domain
connectivity
anti-alias behavior
alpha handling
```

---

# 31. Completion criteria

The implementation is considered production-ready when:

- all toolbar parameters work
- interaction matches Photoshop expectations
- no CPU image-processing path is required
- 4K selections are comfortably interactive
- contiguous selection works on large regions
- sample averaging works at all specified sizes
- Sample All Layers uses the real compositor
- selection modifiers work
- undo/redo works
- anti-aliased masks are supported
- regression tests exist
- Photoshop parity tests have been performed
- known parity differences are documented

---

# 32. Important instruction to the coding agent

Before implementation, inspect the existing Lighttable systems for:

```text
selection masks
GPU compute infrastructure
document transforms
layer compositing
color management
history/undo
selection modifiers
GPU resource pooling
render scheduling
```

Reuse those systems rather than constructing parallel implementations.

The goal is not merely to create a standalone Magic Wand algorithm.

The goal is to implement a **native Lighttable selection tool that behaves like Photoshop's Magic Wand while fitting cleanly into the existing GPU architecture**.

Where exact Photoshop behavior is uncertain, isolate the uncertain part and implement it in a way that can be adjusted from parity tests rather than spreading assumptions throughout the codebase.
