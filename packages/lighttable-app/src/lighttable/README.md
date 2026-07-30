# LightTable

LightTable is StoryBuilderOnline's portable, single-image WebGPU correction tool. It intentionally owns no board, project-media, S3, or upload state. The host passes an existing project image key into `LightTableEditorOverlay`; the editor returns one full-resolution PNG `File` and a correction recipe through `onSave`. The board, GenAI, and shots hosts then use their existing transformed-media upload flows.

Flattened results store `metadataJson.lighttable` on their central `ProjectMedia` row. The recipe contains the original source key and current slider settings. `LightTable` always starts a fresh correction on the selected image; `Edit LightTable filters` is only offered for a parseable recipe and reloads that original source. Recipe source keys are counted as live media references during cleanup. Version fields are intentionally deferred while the controls and shader behavior are still being tuned.

## Browser support

- Current Chromium-based desktop browser with WebGPU enabled.
- JPEG, PNG, and WebP input.
- There is deliberately no CSS-filter or Canvas 2D processing fallback. Unsupported browsers receive an explicit error.

## Processing pipeline

The canonical current order is documented in `docs/lighttable/lighttable_operationorder.md`.

In short: sRGB decode -> CAT16 Temperature/Tint -> Exposure -> tonal masks and Contrast -> Texture/Clarity/Dehaze -> Color Mixer -> Saturation/Vibrance -> Color Grading -> Lift -> Custom Curves -> Vignette -> conditional display shoulder and Whites -> gamut fit -> sRGB encode -> Grain. The linear working image and pre-grain grade use `rgba16float`; only the final display/export texture resolves to full-resolution `rgba8unorm`.

LightTable treats imported JPEG/PNG/WebP images as already-rendered, display-referred sRGB images. Linearization makes correction math well-behaved but does not reconstruct RAW scene data. The highlight shoulder is therefore reserved for controls that can create new luminance headroom; color-only edits retain source luminance and use only hue-preserving gamut safety where required.

The original GPU texture remains unchanged. Every adjustment render starts from that original texture. Slider updates write one packed uniform buffer and reuse all pipelines, textures, samplers, and bind groups.

## Scopes and export

Histogram, RGB Parade and Vectorscope follow the same Before/After texture as the viewport. The histogram uses 768 atomic bins and reads only that small counter buffer back for its Canvas 2D graph. Parade and Vectorscope use GPU-resident density buffers and WebGPU display passes, with no pixel or bin readback. Their details and pass counts are documented in `docs/lighttable/lighttable_scopes.md`.

PNG export copies the full-resolution corrected GPU texture to an aligned readback buffer. Canvas 2D is used only to encode those final pixels as PNG; it is never used for image correction.

## Module boundary

```text
features/lighttable/
  LightTableEditorOverlay.tsx  host-facing tool overlay
  lightTableRecipe.ts          persisted recipe contract and parser
  useLightTableRecipe.ts       active shot recipe lookup
  AdjustmentSlider.tsx        Basic-panel control
  Histogram.tsx               small histogram UI canvas
  types.ts                    immutable adjustment contract
  colorMath.ts                CPU reference math
  colorGrading.ts             grading state and CPU mask references
  ColorGradingWheel.tsx       accessible opponent-color wheel control
  CurvesEditor.tsx            Master/R/G/B curve editor
  curves.ts                   PCHIP interpolation and GPU LUT generation
  ScopesPanel.tsx             simultaneous scope column and controls
  scopes.ts                   scope settings and CPU reference math
  gpu/WebGpuEngine.ts         GPU lifecycle and orchestration
  gpu/WebGpuScopeEngine.ts    GPU scope analysis/display consumer
  gpu/scopeShaders.ts         scope compute and density display shaders
  gpu/shaders.ts              WGSL passes
```

## Validation

- `npm test` validates sRGB, EV, OKLab roundtrips, finite edge cases, and parses every WGSL module.
- `npm run build` performs the strict TypeScript and production Vite build.
- The initial implementation was also exercised through a real Chromium WebGPU smoke page: device creation, shader/pipeline validation, all correction groups, histogram dispatch, and PNG export.

## Known limitations

- The fast browser decoder is used for ordinary 8-bit sRGB images. The optional
  precision-preserving wasm-vips route converts embedded ICC profiles to sRGB
  through LittleCMS at the source bit depth; RAW decoding remains out of scope.
- The controls are coherent approximations, not Adobe Camera Raw or darktable equivalence.
- Temperature is a relative rendered-image correction, not Kelvin-based RAW white balance.
- The histogram is sampled for responsiveness on large images.
- PNG is the only output format; JPEG quality and metadata preservation are not implemented.
- No masks, layers, crop, rotate, perspective, denoise, sharpen, lens correction, or presets are included.
