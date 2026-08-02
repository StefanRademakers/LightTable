# LightTable core and effects architecture

Status: architectural direction for the alpha implementation.

## Decision

LightTable should stabilize its current correction workflow as the **core feature set**. New image effects should be implemented as separate, optional GPU passes around that core instead of continuing to grow one shader and one engine class.

This is a technical boundary, not necessarily a UI distinction. From a user's perspective, the existing controls are normal image corrections even when some of them use local sampling internally.

## Core feature set

The current core includes:

- sRGB decode and the linear RGB working image;
- Temperature and Tint;
- Exposure, Contrast, Highlights, Shadows, Whites, Blacks and Lift;
- Texture, Clarity and Dehaze;
- Vibrance and Saturation;
- Color Mixer;
- Color Grading;
- Master and per-channel Custom Curves;
- Vignette for the initial core release;
- highlight shoulder, display gamut fit and sRGB output encoding;
- recipes, local undo/redo, before/after, save and export;
- Histogram, RGB Parade and Vectorscope as output consumers.

These controls form one coherent correction and grading workflow. Their order is defined in `lighttable_operationorder.md` and must not change as a side effect of the architectural split.

## Effects

Effects are optional processors with their own settings, resources and execution cost. Initial and likely effects are:

- Grain;
- Halation;
- Chromatic Aberration;
- Lens Distortion;
- Lens Blur / depth of field;
- future bloom, glow, diffusion, sharpening or film-emulation modules.

Grain is the first effect migrated to the contract. It lives under `effects/grain`, owns its settings, uniforms, textures and generation/blur/composite passes, and bypasses without encoding those passes unless both `enabled` and Amount are active. It runs after display encoding and preserves a float intermediate until the final resolve.

Halation is the first linear-spatial implementation. It owns highlight extraction, two reduced-resolution separable diffusion cycles and linear additive compositing. Its exact bypass is controlled by persisted `enabled` state and Amount; Vignette and the shared output transform remain downstream.

Chromatic Aberration is the first source-geometry implementation. It owns a full-resolution encoded-float remap pass and returns the original source texture without encoding work when disabled. Running it before the correction core ensures local analysis, scopes and export all consume the same transformed pixels.

Lens Distortion is a separate source-geometry module directly before Chromatic Aberration. It owns its radial remap, automatic edge-safe scaling and persisted controls. Keeping the alpha implementations separate makes each effect independently bypassable and testable; combining both samplers is a later profiling optimization, not an architectural requirement.

Lens Blur implements the asynchronous-analysis boundary described below. `analysis/depth` owns a shared lazy worker, backend fallback, robust normalization and a small source cache. `effects/lensBlur` owns only persisted controls, the uploaded depth texture and its guided refinement/gather/composite GPU resources. Slider changes never call the model. Disabled Lens Blur returns its linear input without encoding any of its four passes.

An effect may still look like a normal panel in the UI. The important rule is that adding or removing it must not require editing the internal formulas of unrelated core corrections.

## Current pressure points

The image math is coherent, but the implementation is reaching structural limits:

- `gpu/shaders.ts` contains most correction, local-detail, output and post-processing shaders in one file.
- Creative grading and the display transform now have separate `rgba16float` boundaries, allowing linear-spatial effects to run without being folded into the correction shader.
- `WebGpuEngine` manually owns every texture, pipeline, bind group and dirty flag.
- the same packed `Adjustments` uniform layout is repeated by several shaders;
- `LightTableEditorOverlay` owns nearly every panel and interaction directly;
- changing one adjustment currently invalidates more of the pipeline than necessary.

This is acceptable for the current core, but Halation and Lens Blur would multiply temporary textures and passes and make those files fragile.

## Target pipeline boundaries

```text
encoded source
  -> optional source/geometry effects
  -> core primary correction
  -> core local analysis
  -> core creative grade
  -> optional linear spatial effects
  -> core output transform
  -> optional display effects
  -> viewport / scopes / export
```

### Source and geometry effects

Examples: Lens Distortion and corrective Chromatic Aberration.

These remap image coordinates before local analysis and grading. Any cached depth or masks must receive the same geometry transform or be sampled through the same mapping.

### Core primary correction

Temperature/Tint, Exposure and the regional tone controls create the linear working image. This remains a stable, deterministic core pass.

### Core local analysis

Downsampled luminance and other reusable analysis textures belong here. Texture, Clarity and Dehaze may consume these resources while remaining part of the user's core correction set.

The analysis layer can expose reusable primitives, but algorithms should not be forced to share an unsuitable blur merely because both need neighbourhood information.

### Core creative grade

Color Mixer, Saturation/Vibrance, Color Grading, Lift and Curves produce a graded linear float texture. This texture becomes the clean input boundary for expensive effects.

### Linear spatial effects

Examples: Lens Blur and Halation.

They operate after the grade but before the output transform so they can use linear light and highlight headroom. They must use separate passes; neither belongs inside the per-pixel grade shader.

Suggested order:

```text
graded linear image
  -> Lens Blur
  -> Halation
  -> Vignette
  -> output transform
```

Lens Blur precedes Halation so defocused highlights can produce coherent halation. This can be revisited through visual testing without changing the core correction order.

### Core output transform

The highlight shoulder, Whites, chroma/gamut fit and sRGB encoding remain one controlled boundary. Effects must not each invent their own final clamp or transfer function.

### Display effects

Grain stays last and display-referred. Other genuinely display-referred finishing effects can use the same stage, but Grain should not be merged into the core output shader.

## Effect pass contract

Do not build a generic node editor or arbitrary render graph. Use a small explicit registry of known passes.

Conceptually, an effect module owns:

```ts
interface LightTableEffectPass<Settings> {
  id: string;
  stage: 'source-geometry' | 'linear-spatial' | 'display-post';
  isEnabled(settings: Settings): boolean;
  resize(width: number, height: number): void;
  render(input: GPUTexture, context: EffectRenderContext): GPUTexture;
  destroy(): void;
}
```

Async effects can additionally own a separate analysis service. The serialized recipe, UI state, GPU runtime state and model lifecycle must remain distinct.

Every effect must provide:

- an exact bypass at its neutral/default setting;
- an enabled predicate so disabled passes consume no meaningful render time;
- its own uniforms instead of extending one global struct indefinitely;
- explicit input/output color-domain documentation;
- resize and cleanup behavior;
- a dirty dependency definition;
- matching preview and full-resolution export behavior.

## State boundaries

Serializable recipe state should become conceptually grouped:

```text
core
  light
  color
  detail
  colorMixer
  colorGrading
  curves

effects
  grain
  halation
  optics
  lensBlur
```

Runtime-only data must not enter the recipe:

- GPU textures and buffers;
- pipeline and bind-group instances;
- depth-model sessions;
- loading/error/progress state;
- cached analysis results.

Lens Blur settings belong in the recipe, while its generated depth map belongs in a session cache keyed by source identity and geometry.

## Dirty-stage scheduling

The engine should eventually track stages instead of one broad correction flag:

```text
sourceDirty
geometryDirty
primaryDirty
analysisDirty
gradeDirty
spatialEffectsDirty
outputDirty
displayEffectsDirty
scopesDirty
```

A downstream dependency becomes dirty when an upstream stage changes. A downstream-only edit must not rerun upstream work.

Examples:

- changing Grain must not rerun core grading;
- changing a curve must not rerun depth inference;
- changing Lens Blur focus reruns its GPU passes, not its AI analysis;
- changing trace brightness rerenders scopes only;
- changing Lens Distortion invalidates geometry-aligned analysis and depth sampling.

## Proposed module layout

```text
features/lighttable/
  core/
    adjustments.ts
    recipe.ts
    operationOrder.ts
  effects/
    grain/
    halation/
    optics/
    lensBlur/
  analysis/
    luminance/
    depth/
  gpu/
    WebGpuEngine.ts
    resources/
    passes/
      BasicCorrectionPass.ts
      LocalAnalysisPass.ts
      CreativeGradePass.ts
      OutputTransformPass.ts
    shaders/
  panels/
```

This is a target direction, not a request to move every file immediately. Split modules when an actual feature needs the boundary.

## Migration sequence

1. Freeze the current visual core with shader-order, neutral-path and ramp tests.
2. Split WGSL strings into pass-specific files without changing behavior or operation order.
3. Separate Creative Grade output from the display/output transform using a linear float intermediate texture.
4. Introduce stage-level dirty tracking.
5. Extract Grain as the first registered effect to prove the contract with an already-working implementation.
6. Add Halation as the first new multi-pass linear spatial effect.
7. Add source-geometry effects for Chromatic Aberration and Lens Distortion. Keep their resources independent while their controls are still alpha; combine sampling only after visual behavior is stable and profiling proves the extra pass material.
8. Add Lens Blur last, with its depth-analysis service and cached depth resource kept outside the renderer's normal adjustment loop. Implemented in the alpha pipeline; visual acceptance on representative portrait, hair, foreground-crossing and point-light images remains an explicit release gate.

## Invariants

- WebGPU remains the only correction/effect renderer; there is no Canvas/CSS processing fallback.
- Core corrections preserve signed and above-one working values until the output boundary where mathematically possible.
- No effect silently clamps or changes color space for the next stage.
- Disabled effects are true bypasses.
- Scopes read the same final texture shown and exported.
- Preview and export execute the same ordered operations, with quality differences limited to documented sampling/resolution choices.
- AI analysis never runs continuously while sliders are dragged.
- Adding an effect must not contaminate Mediaboard, Shots, uploads or other host integrations; those continue to consume one flattened output plus its LightTable recipe.

## What not to build

- no arbitrary node graph;
- no plugin marketplace or dynamic third-party shader loading;
- no single mega-shader containing every future effect;
- no separate visual logic for preview and export;
- no model lifecycle inside React panels;
- no attempt to share an ONNX WebGPU device with the renderer unless that path becomes explicitly supported and reliably testable.

The intended result is a small stable correction core with a deliberate sequence of independent effect modules, not a monolith and not a general-purpose compositor.
