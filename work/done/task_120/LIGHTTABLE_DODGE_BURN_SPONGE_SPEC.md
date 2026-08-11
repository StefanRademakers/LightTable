# LightTable — Dodge, Burn & Sponge Tools
## Visual-Parity Implementation Specification

### Status
Implementation design / research specification

### Primary goal
Implement **Dodge**, **Burn**, and **Sponge** in LightTable so that they feel visually and interactively close to Photoshop, while allowing the coding agent to reuse LightTable's existing GPU brush engine, stroke model, pressure handling, undo system, layer system, render targets, and WebGPU architecture.

The goal is **not** to reproduce undocumented Photoshop internals pixel-for-pixel. The goal is to reproduce the user-visible behavior:

- predictable gradual buildup;
- tonal-range targeting that feels like Photoshop;
- natural preservation of color while dodging/burning;
- minimal highlight/shadow clipping when tone protection is enabled;
- smooth pressure/flow behavior;
- Sponge saturation/desaturation that remains controllable and does not immediately create ugly clipping;
- real-time 100% GPU execution.

### 2026-08-11 empirical calibration addendum

The implementation phase added a repeatable Photoshop black-box oracle instead of relying on the provisional equations in this design document. Its source ramps, Photoshop captures, LightTable captures, curve reports and visual comparisons are stored under `D:\mediavibe\LightTableTests\ToneBrush`.

Measured behavior supersedes any earlier speculative recommendation in this document:

- tonal ranges are broad, overlapping curves rather than hard thresholds;
- neutral and most colored Shadows/Midtones match a per-channel curve more closely than one shared Rec.709 luminance mask;
- high Exposure buildup is compressed non-linearly and is calibrated separately for Dodge and Burn;
- protected colored Highlights remain saturation/context dependent and must not be approximated with an unverified one-off patch.

The production shader keeps the measured curves together in one flat lookup table so the model remains inspectable, replaceable and cheap on the GPU. The shared brush engine remains responsible only for coverage and accumulation.

---

# 1. Research findings

Adobe documents Dodge and Burn as local exposure tools:

- **Dodge** lightens painted areas.
- **Burn** darkens painted areas.
- Both expose a **Range** selector:
  - Shadows
  - Midtones
  - Highlights
- **Exposure** controls effect strength.
- **Airbrush** provides gradual buildup.
- **Protect Tones** helps preserve color and reduces clipping in highlights and shadows.
- Repeated painting continues to increase the effect.

Adobe documents Sponge as a local saturation tool:

- **Saturate** increases local color saturation.
- **Desaturate** decreases local color saturation.
- **Flow** controls the rate of change.
- **Vibrance** reduces undesirable clipping at saturation extremes and gives less-saturated colors more room to change.
- Brush settings and pressure behavior are shared with Photoshop's painting system.

Important conclusion:

> Photoshop's public documentation describes the behavior and controls, but does not publish the exact current pixel equations or tonal weighting curves used internally.

Therefore LightTable should target **perceptual/behavioral parity**, using GPU-friendly math that can be calibrated against Photoshop reference renders.

---

# 2. First step: inspect existing LightTable brush infrastructure

Before writing a new tool pipeline, inspect the current implementation of:

- normal Brush;
- Eraser;
- Clone Stamp;
- Healing Brush;
- any adjustment/painting brushes already present;
- brush masks and dabs;
- hardness;
- spacing;
- flow;
- opacity/exposure accumulation;
- pen pressure;
- airbrush/timed accumulation if present;
- selections and layer masks;
- stroke snapshots / ping-pong textures;
- undo/redo;
- compositing color space;
- rgba16float / linear-light pipeline.

The preferred architecture is:

```text
Existing LightTable Brush Engine
             |
             v
      brush coverage
             |
             v
     adjustment operator
       /      |       \
    Dodge    Burn    Sponge
             |
             v
        GPU composite
```

Do **not** build three independent brush engines.

The brush engine should provide spatial coverage and accumulation.
The Dodge/Burn/Sponge operator should decide what pixel transformation occurs underneath that coverage.

---

# 3. Common tool behavior

These tools should behave like paint tools, not like one-shot image adjustments.

Each dab/stroke applies a small transformation proportional to:

```text
brushCoverage
× flow/exposure
× pressure modulation
× tonal eligibility
× optional protection
```

Repeated passes must accumulate naturally.

This buildup is critical to the Photoshop feel.

A low setting such as 5–15% should allow users to gradually sculpt an image without obvious stepping or sudden tonal jumps.

Avoid applying one large global adjustment merely masked by the brush. The perceived response should feel incremental.

---

# 4. Dodge Tool

## User-visible behavior

Dodge makes painted pixels lighter.

Controls should initially mirror the important Photoshop controls:

```text
Range:
- Shadows
- Midtones
- Highlights

Exposure:
0–100%

Protect Tones:
On / Off

Airbrush:
if already supported by LightTable's brush engine
```

Other standard brush controls should come from the existing brush system.

## 4.1 Tonal Range

The Range setting is essential.

It should not be implemented as a hard luminance threshold.

Instead, compute a **smooth luminance-dependent weighting mask**.

Conceptually:

```text
pixel luminance
      |
      v
tonal weighting curve
      |
      +---- Shadows
      +---- Midtones
      +---- Highlights
```

Expected visual behavior:

### Shadows
Strongest effect on dark tones.

Influence should smoothly fall toward midtones/highlights.

### Midtones
Strongest around the middle of the luminance range.

Very dark blacks and very bright highlights should receive substantially less effect.

### Highlights
Strongest on bright tones.

Influence should smoothly decrease toward shadows.

The exact Photoshop curves are not publicly documented.

Do not overfit arbitrary constants initially. Implement these curves as configurable functions/constants so they can later be calibrated from Photoshop comparison images.

---

# 5. Dodge brightness transformation

Do not simply add a fixed RGB value:

```text
rgb += amount
```

That produces poor highlight behavior and hue/saturation shifts.

The operation should act primarily as a **luminance/exposure change**, while preserving chromatic relationships as much as possible.

Recommended design direction:

```text
RGB
 |
 v
derive luminance / exposure representation
 |
 v
apply progressive lighten operation
 |
 v
reconstruct RGB while retaining chroma
 |
 v
tone protection / gamut handling
```

Because LightTable already has a linear floating-point grading pipeline, investigate applying the operation in the same scene/working color space used by the rest of the editor rather than inventing an isolated sRGB brush path.

The exact representation is deliberately left open to the coding agent.

Candidate approaches may include:

- multiplicative exposure adjustment;
- luminance-domain curves;
- perceptual lightness adjustment;
- a hybrid designed specifically to match Photoshop reference output.

The acceptance criterion is the visual behavior, not a specific equation.

---

# 6. Burn Tool

Burn should share virtually the entire implementation with Dodge.

The major difference is the direction of the tonal adjustment.

```text
Dodge → progressively lighter
Burn  → progressively darker
```

It should use the same:

- brush masks;
- range weighting;
- exposure control;
- Protect Tones logic;
- pressure;
- flow/accumulation;
- selections;
- undo architecture.

Prefer a shared internal operator such as:

```text
ToneBrushOperation
    mode = Dodge | Burn
```

rather than separate pipelines.

---

# 7. Burn visual behavior

Avoid naïve multiplication such as:

```text
rgb *= 1.0 - amount
```

as the complete implementation.

A naïve multiply often:

- crushes shadows too quickly;
- changes perceived saturation;
- makes repeated passes visually harsh;
- does not behave naturally near black.

The desired response is progressive and photographic.

At low Exposure values, a user should be able to make many passes and slowly build depth.

---

# 8. Exposure and accumulation

Photoshop presents **Exposure** rather than normal brush Opacity for Dodge/Burn.

Treat Exposure as the strength/rate of tonal transformation.

It should interact with:

- brush coverage;
- pressure;
- repeated dabs;
- repeated strokes.

A useful conceptual model is:

```text
effectiveAmount =
    Exposure
    × brushCoverage
    × pressure
    × tonalRangeWeight
```

However, do not necessarily use this amount as a simple linear interpolation factor.

Repeated applications should remain smooth and stable.

Test especially:

```text
1 × 100%
10 × 10%
20 × 5%
```

These do not need to be mathematically identical, but the low-exposure variants should feel naturally buildable rather than producing a fundamentally different effect.

---

# 9. Protect Tones

This is one of the most important quality features.

Adobe describes Protect Tones as minimizing:

- clipping in shadows;
- clipping in highlights;
- unwanted hue/color shifts.

It is enabled by default in current Photoshop documentation.

LightTable should therefore treat **Protect Tones = ON** as the normal high-quality path.

Conceptually:

```text
raw dodge/burn result
         |
         v
tone/chroma protection
         |
         +-- resist white clipping
         +-- resist black clipping
         +-- preserve hue
         +-- avoid extreme saturation changes
         |
         v
final result
```

Do not interpret tone protection as merely:

```text
clamp(rgb, 0, 1)
```

That is clipping, not protection.

Protection should cause the adjustment strength to roll off gracefully as a pixel approaches a problematic tonal/color boundary.

For example:

### Dodge
As luminance approaches the upper usable range:

```text
effective dodge strength ↓
```

rather than allowing channels to slam individually into white.

### Burn
As luminance approaches the lower usable range:

```text
effective burn strength ↓
```

rather than collapsing chroma/detail into black.

Also investigate maintaining hue/chroma separately from luminance so an exposure operation does not unnecessarily alter color.

---

# 10. Color-space considerations

LightTable is GPU-based and already has a higher-precision image pipeline.

The coding agent should determine where these operations belong relative to:

- encoded image values;
- linear working RGB;
- document color management;
- display transform.

The tools should preferably operate in a space where:

- exposure changes are well behaved;
- HDR/float values remain possible;
- hue does not shift unexpectedly;
- results remain stable under repeated strokes.

Do not automatically assume Photoshop performs the current tool internally in simple gamma-encoded RGB. Adobe does not publicly document enough detail to justify that assumption.

Use Photoshop as the **visual reference**, not an assumed formula.

---

# 11. Sponge Tool

Sponge should reuse the same brush infrastructure but alter **color saturation rather than luminance**.

Primary controls:

```text
Mode:
- Saturate
- Desaturate

Flow:
0–100%

Vibrance:
On / Off
```

Size, hardness, pressure, spacing etc. should come from the standard LightTable brush engine.

---

# 12. Sponge — Desaturate

Desaturate should progressively reduce chroma while keeping perceived luminance as stable as possible.

Conceptually:

```text
RGB
 |
 v
separate lightness/luminance from chroma
 |
 v
reduce chroma according to brush amount
 |
 v
reconstruct color
```

A repeated low-flow stroke should gradually move toward neutral gray.

Avoid simply averaging RGB channels unless tests demonstrate that this reproduces the desired appearance.

Preserving perceived brightness is important.

---

# 13. Sponge — Saturate

Saturate progressively increases chroma.

The important requirement is graceful buildup.

Poor implementations tend to quickly produce:

- neon colors;
- channel clipping;
- hue shifts;
- posterized-looking saturated areas.

The Saturate mode should increase colorfulness while keeping lightness relatively stable.

---

# 14. Sponge — Vibrance mode

Adobe explicitly exposes **Vibrance** for Sponge and states that it helps minimize clipping at fully saturated/desaturated colors.

Adobe's broader Vibrance documentation also describes the behavior as increasing saturation more strongly for colors that are currently less saturated, while reducing excessive saturation.

Therefore LightTable should implement Vibrance as **saturation-dependent protection** rather than just another fixed multiplier.

Conceptually:

```text
current saturation
        |
        v
remaining saturation headroom
        |
        v
vibrance weighting
        |
        v
requested sponge amount
```

Example behavior:

```text
Low saturation color:
stronger response

Already strongly saturated color:
weaker response

Near gamut/saturation limit:
strong roll-off
```

This should make Sponge substantially safer for skin, skies, gradients, and already-colorful objects.

Do not hard-code a skin detector simply because Adobe's general Vibrance adjustment is documented as being conservative with skin tones. For the Sponge tool, prioritize the documented local behavior first and only add explicit hue-sensitive protection if black-box testing demonstrates it is needed.

---

# 15. Brush buildup model

Dodge/Burn/Sponge are unusually sensitive to stroke accumulation.

The coding agent should compare the existing LightTable brush behavior to Photoshop before implementing custom accumulation.

Investigate:

```text
Flow
Opacity
Exposure
Pressure
Airbrush
dab spacing
stroke overlap
```

Photoshop's normal brush documentation distinguishes Flow from Opacity:

- Flow determines how quickly paint accumulates while moving.
- Airbrush allows buildup while the pointer is held in place.

Dodge/Burn expose **Exposure**, so LightTable should map this onto its existing accumulation model in whatever manner gives the closest perceived result.

Do not duplicate accumulation code if the current GPU brush engine already solves this well.

---

# 16. GPU architecture

All image processing must remain GPU-side.

Suggested high-level path:

```text
Input layer / paint target
        |
        v
existing GPU brush rasterization
        |
        v
brush coverage texture / dab coverage
        |
        v
read destination pixel
        |
        +---------------------------+
        |                           |
     Dodge/Burn                   Sponge
        |                           |
 tonal eligibility             chroma operation
        |                           |
 exposure adjustment           vibrance protection
        |                           |
 tone protection                   |
        +-------------+-------------+
                      |
                      v
               write/composite
```

There should be no CPU pixel loops.

A WebGPU fragment pass or compute pass are both acceptable. Choose whichever integrates best with the current paint architecture.

---

# 17. Recommended shared abstraction

If it fits the existing architecture, consider a generic:

```text
Adjustment Brush
```

where the existing brush engine produces coverage and a shader/operator modifies the destination.

Possible users:

```text
AdjustmentBrush
├── Dodge
├── Burn
├── Sponge
├── future Blur/Sharpen
├── local Exposure
├── local Saturation
└── other pixel adjustments
```

This is only an architectural direction.

Do not refactor stable brush code purely to satisfy this abstraction if the existing LightTable architecture already offers a cleaner path.

---

# 18. Photoshop visual-parity calibration

Because the exact Photoshop equations are undocumented, build a small black-box comparison suite.

Create identical test images in Photoshop and LightTable.

Recommended targets:

## Grayscale ramp

```text
0 → 1 luminance gradient
```

Apply a single large soft brush stroke with:

```text
Dodge:
Shadows / Midtones / Highlights
Exposure 10%, 50%, 100%

Burn:
same combinations

Protect Tones:
On and Off
```

Compare the output curve.

This allows the tonal weighting functions to be inferred visually/numerically without assuming Photoshop's implementation.

## Color patches

Test:

- red;
- green;
- blue;
- cyan;
- magenta;
- yellow;
- neutral gray;
- skin-like colors;
- weakly saturated colors;
- highly saturated colors.

Check:

```text
Dodge:
hue preservation
highlight clipping
saturation drift

Burn:
hue preservation
shadow clipping
saturation drift

Sponge:
lightness preservation
hue stability
saturation buildup
Vibrance protection
```

## Photographic tests

Use actual photographs with:

- skin;
- hair;
- clouds;
- dark fabrics;
- shiny highlights;
- soft shadows;
- highly saturated objects.

The implementation should be tuned to the Photoshop **feel**, not only synthetic ramps.

---

# 19. Important visual acceptance criteria

## Dodge

At low Exposure:

- gradual;
- smooth;
- controllable;
- does not immediately wash color out;
- Shadows/Midtones/Highlights clearly target different luminance regions.

With Protect Tones ON:

- highlights roll off rather than clip abruptly;
- hue remains substantially stable.

## Burn

At low Exposure:

- gradual;
- natural;
- retains local detail;
- does not instantly create dirty/crushed blacks;
- Range options behave clearly differently.

With Protect Tones ON:

- shadows approach black gently;
- colors do not shift dramatically.

## Sponge

Desaturate:

- color fades smoothly;
- brightness remains visually stable.

Saturate:

- saturation builds progressively;
- hue remains stable;
- brightness should not jump strongly.

Vibrance ON:

- low/medium saturation colors respond clearly;
- already saturated areas resist over-processing;
- clipping is substantially reduced.

---

# 20. Recommended defaults

For Photoshop-like UX, investigate defaults close to the current Photoshop behavior rather than inventing LightTable-specific defaults.

Suggested starting direction:

```text
Dodge/Burn:
Range: Midtones
Protect Tones: ON
Exposure: conservative default

Sponge:
Mode: Desaturate or retain last used mode
Vibrance: ON
Flow: conservative default
```

Verify actual UI defaults against the installed/reference Photoshop version during parity testing.

---

# 21. Tool grouping / shortcut

Photoshop groups:

```text
Dodge
Burn
Sponge
```

under the same toolbar group and uses **O** for this tool family.

LightTable may mirror this if consistent with its current Photoshop-compatible shortcut strategy.

Switching between related tools should preserve shared brush settings wherever practical.

---

# 22. What NOT to do

Avoid:

```text
Dodge = rgb + constant
Burn = rgb - constant
Sponge = naive RGB saturation
```

These may technically lighten/darken/change color, but they will not provide Photoshop-like retouching quality.

Also avoid:

- hard tonal thresholds;
- repeated CPU readbacks;
- separate brush engines per tool;
- arbitrary clipping after adjustment;
- assuming exact undocumented Adobe formulas;
- making Protect Tones merely a final RGB clamp.

---

# 23. Implementation order

### Phase 1 — architecture review
Inspect existing LightTable brush/stroke/GPU systems and determine maximum reuse.

### Phase 2 — shared adjustment-brush path
Allow a brush mask to drive a GPU pixel-adjustment operator if this capability does not already exist.

### Phase 3 — Dodge/Burn baseline
Implement:

- Dodge;
- Burn;
- Exposure;
- Shadows/Midtones/Highlights;
- accumulation.

### Phase 4 — Protect Tones
Add highlight/shadow and chroma/hue protection.

This should be treated as a quality feature, not an optional afterthought.

### Phase 5 — Sponge
Implement:

- Saturate;
- Desaturate;
- Flow.

### Phase 6 — Sponge Vibrance
Add saturation-dependent/gamut-aware rolloff.

### Phase 7 — Photoshop comparison
Build reference images and tune:

- range curves;
- exposure response;
- accumulation;
- tone protection;
- saturation response.

---

# 24. Priority

The most important requirement is:

> A Photoshop user should be able to select Dodge, Burn, or Sponge in LightTable, use the same general settings and brushing technique, and immediately receive the kind of visual result they expect.

Matching interaction and perceived result is more important than reproducing hypothetical undocumented Adobe math.

The implementation should remain:

- fast;
- GPU-native;
- compatible with LightTable's existing high-bit-depth pipeline;
- reusable;
- nondestructive where LightTable architecture permits;
- suitable for tablet pressure and high-frequency brush updates.

---

# Research references

## Adobe — Dodge and Burn

Adobe Photoshop Help — **Dodge or burn image areas**  
https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html

Documents:

- Shadows / Midtones / Highlights ranges;
- Exposure;
- Airbrush;
- Protect Tones;
- gradual repeated application.

Adobe Photoshop Help — **Adjust exposure in your images with Dodge and Burn (iPad)**  
https://helpx.adobe.com/photoshop/ipad/retouch-and-adjust-images/dodge-burn-ipad.html

Especially useful because Adobe explicitly states that Protect Tones minimizes shadow/highlight clipping and prevents hue shifts.

## Adobe — Sponge

Adobe Photoshop Help — **Change color saturation with the Sponge tool**  
https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html

Documents:

- Saturate;
- Desaturate;
- Flow;
- Vibrance;
- gradual local saturation modification.

Adobe Photoshop Help — **Sponge tool**  
https://helpx.adobe.com/photoshop/using/tool-techniques/sponge-tool.html

Adobe Photoshop Help — **Sponge tool on iPad**  
https://helpx.adobe.com/photoshop/ipad/retouch-and-adjust-images/sponge-tool-ipad.html

## Adobe — Vibrance

Adobe Photoshop Help — **Adjust Vibrance**  
https://helpx.adobe.com/photoshop/using/adjust-vibrance.html

Useful behavioral reference:

- less-saturated colors receive proportionally stronger saturation increase;
- saturation clipping is minimized;
- highly saturated colors are protected more strongly.

## Adobe — Brush accumulation

Adobe Photoshop Help — **Painting tools**  
https://helpx.adobe.com/photoshop/using/painting-tools.html

Useful reference for:

- Flow;
- Opacity accumulation;
- Airbrush;
- pressure behavior.

---

# Final note for the coding agent

Do not treat the equations suggested in this document as fixed requirements.

Adobe's public material provides the expected behavior but not the exact current internal equations. The correct engineering strategy is:

```text
Research documented behavior
        +
reuse LightTable brush engine
        +
GPU-native adjustment operators
        +
Photoshop black-box reference tests
        =
high visual parity
```

If LightTable already contains suitable luminance, vibrance, gamut-protection, exposure, brush accumulation, or color-space utilities, reuse those before adding duplicate implementations.
