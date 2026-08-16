# Photoshop adjustment layers: UX, LightTable reuse and parity plan

Status: active development reference, researched 2026-08-15.

This document indexes the current Photoshop adjustment-layer experience and
maps it to LightTable's existing non-destructive processing system. It is not
an instruction to build a second adjustment framework. Current code and tests
remain authoritative when this document becomes stale.

## Executive decision

LightTable already has the architectural pieces needed for adjustment layers:

- explicit `AdjustmentLayer` document nodes;
- ordered, serializable `AdjustmentStack` modules;
- local, non-destructive grade stacks on raster layers;
- Grade and Lens Fx adjustment layers;
- masks, undo/redo, persistence and per-layer GPU resources;
- module scopes for layers, adjustment layers, groups, smart filters and the
  document;
- PSD adjustment import with preservation of original Photoshop descriptors.

The next step is therefore **productization through specialized adjustment
layer variants**, backed by the existing stack. Keep `Grade` as LightTable's
compound correction layer, and add focused variants such as Curves or
Gradient Map whose properties expose only their relevant module.

Do not introduce a parallel renderer, document node, mask model, history model
or persistence format for these variants.

## Current Photoshop model

Photoshop adjustment layers store color or tone instructions separately from
image pixels and apply them to the layers below. They can be reordered,
hidden, masked, clipped to the layer directly below, and tuned with layer
opacity and blend mode. Fill layers are related but generate Solid Color,
Gradient or Pattern content instead of transforming the layers below.

The current Adobe desktop documentation lists the traditional adjustment
families plus the newer Color and Vibrance layer. Photoshop 27.3 added
Clarity and Dehaze and Grain as non-destructive adjustment layers in early
2026. That brings the current adjustment inventory used by this document to
18 families, plus three fill-layer families.

Primary Adobe references:

- [Adjustment and fill layers overview](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-and-fill-layers-overview.html)
- [Adjustment layer options](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html)
- [Create adjustment layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/create-adjustment-layers.html)
- [Use masks to target an adjustment](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/use-layer-masks-to-target-adjustment-or-fill-layers.html)
- [Photoshop desktop release notes](https://helpx.adobe.com/au/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html)

### Shared Photoshop interaction and visual anatomy

The individual panels vary, but the recurring design is compact and stable:

1. The user creates an adjustment from the half-filled-circle menu in Layers
   or from the Adjustments panel.
2. Photoshop inserts a named adjustment layer with an adjustment thumbnail
   and a separate white mask thumbnail.
3. Selecting the adjustment thumbnail shows its controls in Properties;
   selecting the mask thumbnail shows mask controls instead.
4. Simple adjustments use one to four full-width sliders with their numeric
   values adjacent to the tracks.
5. Complex tonal adjustments give most of the panel to a histogram, curve,
   gradient or color-range visualization.
6. A preset selector appears near the top when the adjustment supports
   presets.
7. Common actions such as preview/toggle, clipping, reset and delete remain
   secondary to the adjustment controls.
8. The canvas updates continuously during manipulation; there is no Apply
   button for an adjustment layer.

The visual lesson for LightTable is not to copy Photoshop chrome pixel for
pixel. It is to keep the selected layer's properties direct and quiet: one
title, one dominant editor when needed, then a small number of standard
controls. Avoid enclosing every control group in a separate visual card.

## Photoshop adjustment inventory and UI

### 1. Color and Vibrance

Purpose: white balance and global color intensity.

Properties:

- Temperature slider;
- Tint slider;
- Vibrance slider;
- Saturation slider.

Appearance: four ordinary horizontal sliders in a narrow Properties panel.
This is a new Photoshop layer and is an unusually close match for LightTable's
existing `lt.white-balance` and `lt.global-color` modules.

Adobe reference: [Correct color balance with Color and Vibrance](https://helpx.adobe.com/ca/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/correct-color-balance-with-color-and-vibrance.html).

### 2. Brightness/Contrast

Purpose: simple nonlinear tonal adjustment.

Properties:

- Brightness slider;
- Contrast slider;
- Use Legacy checkbox for documents authored with the old transfer behavior.

Appearance: two sliders and one quiet compatibility option. Photoshop's
normal Brightness behavior is not equivalent to adding exposure EV.

Adobe reference: [Brightness/Contrast adjustment](https://helpx.adobe.com/ca/photoshop/using/apply-brightness-contrast-adjustment.html).

### 3. Levels

Purpose: black point, white point, gamma and output-range control.

Properties:

- preset and channel selectors;
- histogram as the dominant visual;
- black, gamma and white Input Levels handles and numeric fields;
- black and white Output Levels handles and numeric fields;
- black, gray and white eyedroppers;
- Auto and clipping preview.

Appearance: a histogram with three input markers directly below it, followed
by a black-to-white output ramp with two endpoint markers. RGB and individual
channels use the same control.

Adobe reference: [Levels adjustment](https://helpx.adobe.com/sg/photoshop/using/levels-adjustment.html).

### 4. Curves

Purpose: arbitrary tonal and per-channel mapping.

Properties:

- preset and RGB/channel selector;
- large square curve graph over a histogram and grid;
- point editing and freehand/pencil modes;
- targeted on-image adjustment tool;
- black, gray and white eyedroppers;
- black and white input point handles;
- selected-point Input and Output fields;
- Auto and clipping preview.

Appearance: the graph is the panel. Tool icons sit around it; secondary
numeric fields sit below it. A steeper curve section increases local contrast,
while a flatter section reduces it.

Adobe reference: [Curves adjustment](https://helpx.adobe.com/photoshop/using/curves-adjustment.html).

### 5. Exposure

Purpose: linear-light exposure correction, originally aimed at HDR work.

Properties:

- Exposure;
- Offset;
- Gamma Correction;
- preset and eyedroppers in applicable Photoshop versions.

Appearance: three stacked sliders. Exposure behaves as gain; Offset moves the
baseline and Gamma reshapes midtones.

Adobe reference: [High dynamic range images and Exposure](https://helpx.adobe.com/photoshop/using/high-dynamic-range-images.html).

### 6. Vibrance legacy PSD adjustment

Purpose: increase muted colors more than already-saturated colors while
protecting skin tones.

Properties:

- Vibrance;
- Saturation.

Appearance: two sliders. Current Photoshop also offers these inside the newer
Color and Vibrance adjustment, but legacy PSDs still contain the established
`vibrance` descriptor supported by `ag-psd`.

Adobe reference: [Vibrance adjustment](https://helpx.adobe.com/photoshop/using/adjust-vibrance.html).

### 7. Hue/Saturation

Purpose: global or color-range hue, saturation and lightness changes.

Properties:

- master or named color-range selector;
- Hue, Saturation and Lightness sliders;
- targeted on-image adjustment and eyedroppers;
- two color bars showing before/after range behavior;
- inner range handles and outer falloff handles;
- Colorize checkbox.

Appearance: three primary sliders above a double color-range strip. Modern
Photoshop also exposes prominent colors as larger swatches or a pinwheel; the
range handles remain the precise model for PSD Hue/Saturation semantics.

Adobe reference: [Hue/Saturation adjustment](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/apply-a-hue-or-saturation-adjustment.html).

### 8. Color Balance

Purpose: opponent-color corrections in shadows, midtones or highlights.

Properties:

- Shadows, Midtones and Highlights tone-range selection;
- Cyan/Red slider;
- Magenta/Green slider;
- Yellow/Blue slider;
- Preserve Luminosity.

Appearance: a compact tonal-range selector followed by three opponent-color
sliders. This is conceptually close to LightTable Color Grading but is not the
same transfer function.

Adobe reference: [Color Balance adjustment](https://helpx.adobe.com/ca/photoshop/using/applying-color-balance-adjustment.html).

### 9. Black & White

Purpose: controlled grayscale conversion based on source colors.

Properties:

- preset and Auto;
- Reds, Yellows, Greens, Cyans, Blues and Magentas sliders;
- targeted on-image adjustment;
- Tint checkbox and tint color swatch.

Appearance: six color-coded tonal sliders form the main body. Tint adds one
color swatch below them.

Adobe reference: [Convert an image to Black & White](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html).

### 10. Photo Filter

Purpose: simulate a colored optical filter while optionally preserving
luminosity.

Properties:

- Filter preset or custom Color mode;
- filter dropdown or color swatch;
- Density slider;
- Preserve Luminosity.

Appearance: a radio/mode choice, one dropdown or swatch, one strength slider
and one checkbox.

Adobe reference: [Photo Filter adjustment](https://helpx.adobe.com/ca/photoshop/using/applying-color-balance-adjustment.html#change_color_balance_using_photo_filter).

### 11. Channel Mixer

Purpose: construct each output channel from weighted source channels.

Properties:

- preset;
- Output Channel dropdown;
- Red, Green and Blue source contribution sliders from -200% to +200%;
- Constant slider;
- source Total with warning above 100%;
- Monochrome mode.

Appearance: one output selector over four sliders, with Total as feedback.
Changing Output Channel swaps the edited matrix row rather than creating a
new effect.

Adobe reference: [Channel Mixer](https://helpx.adobe.com/ie/photoshop/using/color-monochrome-adjustments-using-channels.html).

### 12. Color Lookup

Purpose: apply a color lookup table as a creative look or color transform.

Properties:

- 3D LUT File selector;
- Abstract profile selector;
- Device Link profile selector.

Appearance: three category dropdowns with one active lookup source. Creative
strength is usually refined with the layer's opacity and blend mode rather
than a dedicated Amount slider.

Adobe reference: [Color Lookup adjustment](https://helpx.adobe.com/lt/photoshop/how-to/edit-photo-color-lookup-adjustment.html).

### 13. Selective Color

Purpose: adjust CMYK components within perceptual color families.

Properties:

- preset;
- Colors dropdown: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites,
  Neutrals and Blacks;
- Cyan, Magenta, Yellow and Black sliders;
- Relative or Absolute method.

Appearance: one target-range dropdown, four repeated sliders and a two-option
method control.

Adobe reference: [Selective Color adjustment](https://helpx.adobe.com/photoshop/using/mix-colors.html).

### 14. Invert

Purpose: replace each channel value with its inverse.

Properties: none beyond common adjustment-layer controls.

Appearance: selecting the layer shows essentially an empty adjustment body.
The effect is binary and can be reduced through layer opacity or constrained
with its mask.

Adobe reference: [Invert colors](https://helpx.adobe.com/ca/photoshop/using/applying-special-color-effects-images.html).

### 15. Posterize

Purpose: quantize each channel to a selected number of tonal levels.

Properties:

- Levels slider;
- numeric Levels field.

Appearance: one slider. This is one of the smallest useful specialized
adjustments.

Adobe reference: [Posterize adjustment](https://helpx.adobe.com/ca/photoshop/using/applying-special-color-effects-images.html#posterize_an_image).

### 16. Threshold

Purpose: convert luminance to two-valued black and white.

Properties:

- luminance histogram;
- one Threshold Level handle/slider and numeric value.

Appearance: a histogram with a single marker immediately below it.

Adobe reference: [Threshold adjustment](https://helpx.adobe.com/ca/photoshop/using/applying-special-color-effects-images.html#create_a_two-valued_black_and_white_image).

### 17. Gradient Map

Purpose: map input luminance to an editable color and opacity gradient.

Properties:

- gradient preset/ramp;
- full Gradient Editor on ramp activation;
- Dither;
- Reverse.

Appearance: the gradient ramp is the main control. Shadows map to its left,
highlights to its right, and midtones to the transition between them.

Adobe reference: [Gradient Map adjustment](https://helpx.adobe.com/ca/photoshop/using/applying-special-color-effects-images.html#apply_a_gradient_map_to_an_image).

### 18. Clarity and Dehaze

Purpose: adjust midtone contrast/definition and atmospheric haze.

Properties:

- Clarity slider;
- Dehaze slider.

Appearance: two standard sliders. Added as a non-destructive adjustment layer
in Photoshop 27.3.

Adobe reference: [Clarity and Dehaze adjustment](https://helpx.adobe.com/uk/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjust-contrast-with-clarity-and-dehaze.html).

### 19. Grain

Photoshop's traditional adjustment list plus the three new families above
contains 18 current menu families because Color and Vibrance supersedes the
standalone Vibrance choice in the current menu. `Vibrance` remains listed
separately here because it is still a distinct legacy PSD descriptor and a
LightTable interchange target.

Purpose: add editable film-like texture non-destructively.

Properties:

- Amount;
- Size;
- Roughness.

Appearance: three standard sliders. Added as a non-destructive adjustment
layer in Photoshop 27.3.

Adobe reference: [Grain adjustment](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/enhance-texture-with-grain.html).

## Photoshop fill layers

Fill layers belong in the same creation menu but have different compositing
semantics: they generate content rather than processing the existing stack.

### Solid Color

- one color swatch/Color Picker;
- normal layer opacity, blend mode, clipping and mask;
- no geometry editor because the fill covers the document.

### Gradient

- gradient ramp and preset selector;
- style/type, angle, scale and related placement options;
- on-canvas line and stops in current Photoshop;
- editable color stops, opacity stops and midpoints.

### Pattern

- pattern preset;
- scale and linking/alignment options;
- requires retained pattern resources in PSD and LightTable documents.

Adobe references:

- [Fill-layer overview](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-and-fill-layers-overview.html)
- [Edit gradients on desktop](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/edit-a-gradient.html)

## LightTable current implementation index

### Document and persistence

| Capability | Current implementation |
| --- | --- |
| Explicit adjustment node | `AdjustmentLayer` in `editor/document/documentTypes.ts` |
| Local non-destructive raster grade | `RasterLayer.adjustmentStack` |
| Adjustment-layer masks | `AdjustmentLayer.mask` and mask-only persisted assets |
| Create/update commands | `createAdjustmentLayer`, `setAdjustmentLayerStack` |
| Native file persistence | `editor/persistence/layeredDocumentFormat.ts` |
| Multiple ordered adjustment layers | Covered by layered document roundtrip tests |

### Processing and GPU

| LightTable module | Current controls or effect |
| --- | --- |
| `lt.white-balance` | Temperature, Tint |
| `lt.light` | Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Lift |
| `lt.global-color` | Vibrance, Saturation |
| `lt.color-mixer` | Hue, Saturation, Luminance across eight perceptual ranges |
| `lt.color-grading` | Global, Shadows, Midtones, Highlights, Blending, Balance |
| `lt.curves` | Master, Red, Green, Blue curves and LUT |
| `lt.gradient-map` | Color/opacity stops, midpoint, Reverse, Dither |
| `lt.detail` | Texture, Clarity, Dehaze |
| `lt.vignette` | Vignette |
| `lt.lens-distortion` | Distortion, Midpoint, Zoom |
| `lt.chromatic-aberration` | Amount, Falloff, Balance |
| `lt.lens-blur` | Depth-aware lens blur controls |
| `lt.halation` | Amount, Radius, Threshold, Warmth |
| `lt.grain` | Amount, Size, Softness, Color, response, Blend, Seed |

The registry and allowed scopes are in
`lighttable/processing/moduleDefinitions.ts`. Stack bridging is in
`lighttable/processing/adjustmentStack.ts`. Per-layer rendering is in
`lighttable/gpu/adjustmentLayerRenderer.ts` and
`lighttable/gpu/adjustmentLayerGpuResources.ts`.

## Current Photoshop import and export status

The PSD importer currently creates native LightTable adjustment layers for or
approximates these established `ag-psd` descriptors:

| Photoshop descriptor | Current LightTable mapping | Fidelity |
| --- | --- | --- |
| Exposure | `lt.light.exposureEV` | Partial when Offset or Gamma differs |
| Brightness/Contrast | Exposure plus Contrast | Approximate |
| Vibrance | Vibrance plus Saturation | Strong candidate for calibration |
| Hue/Saturation | Global Saturation plus Color Mixer | Approximate range behavior |
| Curves | Master/R/G/B Curves | Strong candidate |
| Levels | Converted to Curves | Editable approximation |
| Invert | Reversed master Curve | Semantically simple |
| Black & White | Desaturation plus optional tint | Channel weights missing |
| Color Balance | Color Grading tonal wheels | Approximate transfer |
| Photo Filter | Global Color Grading tint | Approximate transfer |
| Gradient Map | Native `lt.gradient-map` | Strong; classic interpolation only |

These established Photoshop descriptors are preserved but evaluate as a no-op
today:

- Channel Mixer;
- Color Lookup;
- Posterize;
- Threshold;
- Selective Color.

The current `ag-psd` dependency does not expose the 2025/2026 Photoshop
Color and Vibrance, Clarity and Dehaze, or Grain descriptors in its standard
`AdjustmentLayer` TypeScript union. Treat native PSD support for those new
families as **unverified** until fixtures prove their resource keys and
roundtrip behavior.

Export has a narrower authoring boundary than import:

- an unchanged imported adjustment can reuse its preserved Photoshop
  descriptor;
- an edited Gradient Map can be regenerated as a native Photoshop descriptor;
- other edited LightTable adjustments currently warn because they have no
  verified reverse adapter.

Relevant code:

- `lighttable/editor/psd/psdDocumentAdapter.ts`
- `lighttable/application/documents/psdExportProjection.ts`
- `lighttable/image-io/psd.worker.ts`

## Reuse matrix and recommended priority

| Specialized LightTable layer | Existing implementation reuse | LightTable effort | PSD roundtrip effort |
| --- | --- | ---: | ---: |
| Color and Vibrance | White Balance + Global Color + standard sliders | Very low | Unknown/new Photoshop descriptor |
| Clarity and Dehaze | `lt.detail` + standard sliders | Very low | Unknown/new Photoshop descriptor |
| Grain | `lt.grain` + Lens Fx controls | Very low | Unknown/new Photoshop descriptor |
| Gradient Map | Existing editor, GPU and import/export adapter | Very low | Low |
| Curves | Existing editor, LUT, importer | Low | Low/medium reverse adapter |
| Exposure | Existing EV control and shader | Low | Low for EV-only; medium for Offset/Gamma |
| Vibrance | Existing sliders and shader | Very low | Low after calibration |
| Invert | Existing Curves evaluator | Very low | Low |
| Posterize | New tiny processing module and one slider | Low | Low |
| Threshold | New tiny processing module and histogram marker | Low | Low |
| Levels | Existing Curves can render imports | Medium for dedicated exact parameters/UI | Medium |
| Photo Filter | Existing tint/color controls | Low UI, medium calibration | Medium |
| Color Balance | Existing Color Grading UI/rendering | Low UI, medium calibration | Medium |
| Black & White | Mixer-like UI exists | Medium; exact six-channel weights needed | Medium |
| Hue/Saturation | Color Mixer is reusable | Medium/high for exact range/falloff semantics | Medium/high |
| Channel Mixer | Standard sliders reusable | Medium; new 3x3+constant evaluator | Medium |
| Selective Color | Range selector and sliders reusable | High; new CMYK-relative evaluator | High |
| Color Lookup | Asset/preset UI partly reusable | High; retained LUT asset/runtime needed | High |

## Control, binding and evaluator gap audit

The Style Guide specimens prove that LightTable can compose the visible shape
of every current Photoshop adjustment from shared controls. That is different
from having a production editor and an exact evaluator. Use these terms:

- **Control**: a reusable visual primitive already exists.
- **Binding**: a production panel reads/writes a typed stack module with
  preview, history, reset and persistence.
- **Evaluator**: the GPU/CPU pipeline implements the intended adjustment.
- **Adapter**: PSD import and edited export retain the same semantics.

| Adjustment | Shared controls | Production binding/evaluator | What genuinely remains |
| --- | --- | --- | --- |
| Color and Vibrance | Complete: sliders | Existing White Balance and Global Color modules | Photoshop calibration and new-descriptor PSD fixtures/adapters |
| Brightness/Contrast | Complete: sliders, checkbox | Contrast exists; Brightness is only approximated through Exposure | Photoshop Brightness transfer and Use Legacy mode |
| Levels | Mostly complete: histogram, sliders, number fields, channel select | Imported Levels are sampled into Curves | A semantic Levels module and a synchronized five-handle histogram editor |
| Curves | Complete: Curves editor, channel select | Native editor, LUT and evaluator exist | Presets/Auto/eyedroppers where wanted and edited PSD export evidence |
| Exposure | Complete: sliders, preset/select fields | Exposure EV exists | Offset and Gamma evaluators/bindings; calibration and export |
| Hue/Saturation | Mostly complete: sliders, selects, color-range specimen | Color Mixer gives a useful but different result | Exact Photoshop ranges/falloff, Colorize and semantic adapter |
| Color Balance | Complete: segments, sliders, checkbox | Color Grading is a useful approximation | Opponent-axis transfer and Preserve Luminosity calibration |
| Black & White | Complete: sliders, checkbox, swatch | Desaturation and tint are partial | Six channel-weight monochrome evaluator and Auto behavior |
| Photo Filter | Complete: segments, select, swatch, slider, checkbox | Global tint is an approximation | Density/filter transfer and Preserve Luminosity behavior |
| Channel Mixer | Complete from selects, sliders and checkbox | No native evaluator | Typed 3x3 channel matrix, constant, monochrome and total validation |
| Color Lookup | Select fields exist | No retained LUT adjustment | LUT asset picker/import, 3D LUT evaluator and retained asset lifecycle |
| Selective Color | Complete from select, sliders and segments | No native evaluator | CMYK family model plus Relative/Absolute transfer |
| Invert | No special control required | Native result can use a reversed master Curve | Typed presentation plus verified edited PSD export |
| Posterize | Complete: one slider/number field | No native evaluator | Small channel-quantization module and adapter |
| Threshold | Mostly complete: histogram and slider | No native evaluator | Threshold module and a semantic histogram marker binding |
| Gradient Map | Complete: production gradient editor | Native module/evaluator and strongest current adapter | Noise gradients and exact non-classic interpolation methods |
| Clarity and Dehaze | Complete: sliders | Native Detail module/evaluator | Photoshop calibration and new-descriptor PSD fixtures/adapters |
| Grain | Complete: sliders and advanced Lens Fx controls | Native Grain module/evaluator | Map Photoshop Roughness semantics and add descriptor fixtures/adapters |

Assessment:

- Approximately **90-95% of the generic visual primitives** are already
  available. Do not create eighteen new control sets.
- The genuinely specialized UI gaps are a production-quality Levels editor,
  a precise Hue/Saturation range editor and an integrated retained-LUT asset
  picker. Channel Mixer and Selective Color need layouts composed from current
  controls, not new primitives.
- Roughly half the families can already produce a useful native LightTable
  result, but only Curves and Gradient Map currently approach a complete
  type-specific editing path. A Style Guide specimen is not a production
  binding.
- The largest parity gap is evaluator semantics and edited PSD export, not CSS
  or control availability.

## Recommended product plan without a new system

### Track A: immediate LightTable product value

Expose variants that are almost direct views over current modules:

1. Color and Vibrance;
2. Clarity and Dehaze;
3. Grain;
4. Curves;
5. Gradient Map;
6. Exposure;
7. Invert.

These should use one `AdjustmentLayer` type and one `AdjustmentStack`. The
variant determines the initial module inventory, layer name/icon and visible
Properties controls; it must not determine a different rendering path.

### Track B: verified PSD authoring

Prioritize descriptors already supported by the current PSD library:

1. Gradient Map;
2. Curves;
3. Exposure with Photoshop defaults for Offset/Gamma;
4. Vibrance;
5. Invert;
6. Posterize;
7. Threshold.

Each slice is complete only when it supports create, select, edit, mask,
reorder, save/reopen, PSD import, PSD export and Photoshop reopen evidence.

### Track C: calibrated semantic adapters

Do not call an approximate mapping native merely because its UI looks alike.
Use golden fixtures before enabling reverse export for:

- Brightness/Contrast;
- Levels;
- Hue/Saturation;
- Color Balance;
- Black & White;
- Photo Filter.

Channel Mixer, Selective Color and Color Lookup require new evaluators or
retained assets, but they still fit the existing module/stack architecture.

## Proposed LightTable UX

### One contextual Properties shell, not a second Smart Properties panel

The visible Grade panel is already registered internally as
`lighttable.inspector`. Evolve that dock into the single contextual
**Properties** shell. Do not keep a full Grade panel beside a new Smart
Properties panel: both would appear to own the selected layer's corrections,
and users would have to guess where an adjustment lives.

Also avoid the name **Smart Properties**. In Photoshop, Smart Objects retain
source content and transformations, while Smart Filters are listed beneath
the Smart Object in Layers and open their own editable settings. “Smart” would
therefore promise a larger object model than LightTable currently exposes.

The Properties shell should project the selected target instead:

| Selection | Properties content |
| --- | --- |
| Raster layer without attached processing | Compact layer properties and an Add adjustment action |
| Raster layer with attached grade | Layer properties plus a collapsed, ordered Attached processing list; selecting an item opens that editor |
| Compound Grade layer | The current full Grade experience |
| Specialized adjustment layer | Exactly one type-specific editor, such as Curves, Levels or Grain |
| Mask thumbnail | Mask properties, not the adjustment editor |
| Attached module/filter | That one module's editor, with its local scope made explicit |

Suggested header and scope treatment:

```text
Properties  >  Background  >  Curves
                         [Attached to layer]

Properties  >  Curves
                     [Affects layers below]
```

Both routes edit the same module definitions and settings components. The
scope badge and layer-tree placement explain the difference:

- **Attached to layer** is LightTable's closest analogue to a Smart Filter:
  it changes one owning raster layer non-destructively.
- **Affects layers below** is a Photoshop-style adjustment layer: it is an
  independent, maskable layer in the composition stack.
- **Grade** remains LightTable's compound creative workflow, able to host
  several modules together. It is a presentation/preset over the stack, not
  the generic home of every specialized adjustment dialog.

Do not render all eighteen dialogs expanded underneath each other. For a
raster layer, show a compact ordered summary and expand or navigate to only
the selected module. This preserves the current Grade workflow without
turning routine layer selection into a very long inspector.

This follows Photoshop's useful separation without copying its modal details:
adjustment-layer settings live in Properties, Smart Object metadata also lives
in Properties, and Smart Filters remain explicit child entries in Layers with
individually editable settings.

Adobe references:

- [Smart Objects overview and benefits](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/smart-objects-overview-and-benefits.html)
- [View linked Smart Object properties](https://helpx.adobe.com/uk/photoshop/desktop/create-manage-layers/smart-objects/view-linked-smart-object-properties.html)
- [Apply Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)

Keep the current `New fill or processing layer` menu, but group it clearly:

```text
Adjustments
  Grade
  Color and Vibrance
  Light
  Curves
  Gradient Map
  Clarity and Dehaze
  Grain
  Invert

Fill Layers
  Solid Color
  Gradient
  Pattern            (disabled until retained pattern assets exist)

Effects
  Lens Fx
```

Selecting a specialized adjustment layer should route the existing Properties
or Grade surface to a compact view:

```text
Color and Vibrance
  Temperature   -----o------  0
  Tint          -----o------  0
  Vibrance      -----o------  0
  Saturation    -----o------  0
```

Complex controls remain dominant:

```text
Curves
  [Preset] [RGB] [Auto]
  +--------------------+
  | histogram + curve  |
  |                /   |
  |             o/     |
  |           /        |
  +--------------------+
  Input  [128]  Output [142]
```

Reuse `AdjustmentSlider`, `CurvesEditor`, `GradientAssetEditor`,
`SegmentedControl`, standard selects, switches and color swatches. Add new
controls to the UI Style Guide before using them in an adjustment panel.

## Necessary enabling work

The smallest useful implementation seam is a presentation descriptor, not a
new processing abstraction. It should define:

- stable variant id and display name;
- initial module types and settings;
- layer icon;
- Properties view/component;
- PSD import/export adapter id where verified.

Creation then becomes a parameterized version of the existing
`createProcessingLayer('grade' | 'lens-fx')` flow. The renderer continues to
evaluate the stack by scope.

Before broadening the menu, verify these existing compositing behaviors for
all specialized variants:

- layer order and group boundaries;
- mask density, feather and enable/bypass;
- clipping to the layer below;
- adjustment opacity;
- blend modes once recursive adjustment compositing supports them;
- no hidden document-global correction state;
- exact bypass for disabled or neutral modules;
- GPU resource release after delete, close and undo-history disposal.

## Definition of done per adjustment family

A family is **current** only when all applicable items are evidenced:

1. A user can create it from the shared creation menu.
2. Selection opens a compact, type-specific Properties view.
3. Preview updates continuously and one drag produces one history entry.
4. Visibility, opacity, masks, clipping and ordering behave predictably.
5. `.lighttable` save/reopen preserves semantic settings and layer identity.
6. PSD import maps a verified descriptor without discarding unknown fields.
7. PSD export regenerates a descriptor after edits or fails closed with a
   precise warning.
8. Photoshop reopen retains layer editability and accepted visual fidelity.
9. Memory/lifecycle audits show bounded resources after repeated create,
   edit, delete, undo and document close cycles.

Until items 6-8 pass, label the feature as native LightTable support rather
than Photoshop roundtrip parity.

## Current Photoshop-alternative usability score

**Overall: 6.5/10 - already useful as a focused, non-destructive Photoshop
alternative, but not yet a general Photoshop replacement.**

This is a directional product assessment, not a compatibility-test result. It
scores the current implementation and documented verification state. Face Warp
is excluded because it is explicitly still in development.

| Area | Score | Assessment |
| --- | ---: | --- |
| Non-destructive photo grading | 8/10 | Strong existing Grade/adjustment-stack architecture, masks, curves, color mixer, color grading, Gradient Map and lens effects. |
| Layer and compositing workflow | 7/10 | Native layers, groups, masks, blend behavior, history and GPU composition cover substantial everyday work. |
| Vector, shape, text and paint editing | 6/10 | Broad foundations exist, but Photoshop-level breadth, polish and verified edge-case behavior are incomplete. |
| PSD opening and visual preservation | 7/10 | Progressive semantic import plus preserved descriptors/previews make many real files useful and avoid silent data loss. |
| Editable PSD roundtrip | 5/10 | Several semantic families roundtrip or are preserved, but edited adjustments and unsupported Photoshop constructs still require verified reverse adapters. |
| Reliability and professional workflow | 5.5/10 | The test surface is extensive, but desktop recovery and the complete release soak still contain known failures. |
| UX coherence and discoverability | 7/10 | The shared controls and compact property-bar direction are strong; remaining panels and controls still need consolidation. |

Interpretation:

- **Today:** credible for photographers and designers whose work fits the
  implemented raster, grading, masking, vector and PSD subset.
- **Not yet:** a safe drop-in replacement for arbitrary client PSDs, complex
  adjustment-heavy documents or workflows that demand exact Photoshop
  roundtripping.
- **After Track A:** approximately **7.5/10**, because existing processing code
  becomes directly available as focused, discoverable adjustment layers.
- **After Tracks B and C plus recovery/soak closure:** approximately **8.5/10**
  for the deliberately supported Photoshop workflow. The remaining gap would
  mainly be Photoshop's very broad long-tail feature and plugin ecosystem.

Recalculate this score only from shipped behavior and recorded gates. Do not
raise it merely because a module, adapter or UI mock-up exists in source.
