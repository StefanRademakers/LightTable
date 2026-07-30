# Lighttable — wasm-vips Ingest Spike and Implementation Plan

## Purpose

Evaluate whether `wasm-vips` is suitable as Lighttable's primary browser-side image I/O layer for high-bit-depth raster formats, without changing the existing WebGPU grading and compositing architecture.

The spike must prove that source precision, color metadata, alpha, orientation, memory usage and upload performance are acceptable for production use.

If the spike passes all required criteria, implement `wasm-vips` behind a format-agnostic image decoder interface that feeds Lighttable's existing linear `rgba16float` pipeline.

---

# 1. Existing Lighttable Pipeline

Assume the current pipeline behaves approximately as follows:

```text
Browser decode
    ↓
rgba8unorm source texture
    ↓
sRGB → linear conversion
    ↓
WebGPU correction/grading passes in rgba16float
    ↓
layer compositing / scopes / display transform
```

The grading pipeline itself must remain intact.

The issue to solve is that browser-native decoding may reduce high-bit-depth source files to 8-bit before they reach the GPU.

The intended future path is:

```text
File / Blob / ArrayBuffer
    ↓
Image I/O worker
    ↓
wasm-vips decode
    ↓
typed source pixels + metadata
    ↓
WebGPU ingest conversion pass
    ↓
linear rgba16float working texture
    ↓
existing Lighttable pipeline
```

---

# 2. Scope of the Technical Spike

Build an isolated test harness inside the Lighttable repository.

Do not integrate it deeply into the document model, layer system or production import flow yet.

The spike must answer the following questions:

1. Can `wasm-vips` decode JPEG, PNG, TIFF, WebP and AVIF reliably in the browser?
2. Can 16-bit integer source precision survive decoding without an 8-bit intermediate?
3. Can float TIFF data be decoded and transferred correctly?
4. Can ICC profiles, EXIF orientation and alpha metadata be retrieved reliably?
5. Can decoded data be uploaded and converted into Lighttable's `rgba16float` working texture?
6. Are memory use and import times acceptable for 24 MP, 50 MP and approximately 100 MP images?
7. Does `SharedArrayBuffer` / cross-origin isolation fit the current Storybuilder and Lighttable deployment setup?
8. Can all decoder-specific logic be hidden behind a clean adapter interface?

---

# 3. Required Test Formats

Test at minimum:

| Format | Required variants |
|---|---|
| JPEG | 8-bit sRGB, embedded ICC, EXIF orientation |
| PNG | 8-bit RGBA, 16-bit RGB, 16-bit RGBA |
| TIFF | 8-bit RGB, 16-bit RGB, 16-bit RGBA, float RGB if supported by the chosen build |
| WebP | lossy RGB, lossless RGBA |
| AVIF | 8-bit, 10-bit or 12-bit where supported, alpha where supported |

Optional but useful:

- JPEG XL
- UltraHDR JPEG
- animated WebP or GIF metadata detection

Explicitly out of scope for this spike:

- OpenEXR
- camera RAW
- HEIC/HEVC
- PSD/PSB
- multilayer TIFF

These should later use separate decoders behind the same common interface if necessary.

---

# 4. Test Assets

Create or collect deterministic test images with known pixel values.

Each format group should include:

1. A grayscale ramp.
2. An RGB gradient.
3. Near-black values.
4. Near-white values.
5. Saturated primary and secondary colors.
6. Alpha values at 0%, 25%, 50%, 75% and 100%.
7. An embedded ICC profile where applicable.
8. EXIF orientation cases where applicable.

For 16-bit tests, include values that cannot be represented exactly in 8-bit, such as:

```text
0
1
127
128
255
256
257
1023
4095
16384
32768
65534
65535
```

The test must prove that values such as `256` and `257` remain distinguishable after decode and GPU ingest.

For float tests, include:

```text
-0.25
0.0
0.0001
0.18
1.0
2.0
8.0
```

The test must explicitly report whether negative and above-one values are preserved, clamped or transformed.

---

# 5. Spike Architecture

Create a dedicated worker-based prototype.

Suggested structure:

```text
src/
  image-io/
    contracts.ts
    imageIoWorker.ts
    wasmVipsDecoder.ts
    decodeImage.ts
    metadata.ts
    pixelFormat.ts
    errors.ts
  gpu/
    ingest/
      uploadDecodedImage.ts
      ingestConversion.wgsl
  devtools/
    imageIoSpike/
      ImageIoSpikePanel.tsx
      testAssets.ts
      metrics.ts
```

The spike UI may be simple, but must show:

- source filename;
- detected format;
- width and height;
- channel count;
- source pixel type;
- reported source bit depth;
- ICC profile presence;
- alpha presence;
- EXIF orientation;
- decode duration;
- conversion/upload duration;
- peak or estimated memory use;
- sampled CPU values;
- sampled GPU values;
- pass/fail result.

---

# 6. Common Decoder Contract

Use a decoder-independent interface.

```ts
export type DecodedPixelStorage = "u8" | "u16" | "f32";

export type DecodedColorInterpretation =
  | "srgb"
  | "rgb"
  | "scrgb"
  | "grey"
  | "cmyk"
  | "unknown";

export interface DecodedImageMetadata {
  sourceFormat: string;
  sourceBitDepth?: number;
  iccProfile?: Uint8Array;
  exifOrientation?: number;
  exif?: Readonly<Record<string, unknown>>;
  hasAlpha: boolean;
  premultipliedAlpha: boolean;
}

export interface DecodedImage {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  rowStrideBytes: number;
  storage: DecodedPixelStorage;
  interpretation: DecodedColorInterpretation;
  pixels: Uint8Array | Uint16Array | Float32Array;
  metadata: DecodedImageMetadata;
}

export interface ImageDecoder {
  readonly id: string;

  canDecode(input: Uint8Array, mimeType?: string): boolean;

  decode(
    input: Uint8Array,
    options?: Readonly<DecodeImageOptions>,
  ): Promise<DecodedImage>;
}

export interface DecodeImageOptions {
  applyExifOrientation?: boolean;
  preserveEmbeddedProfile?: boolean;
  targetChannels?: 3 | 4;
}
```

Do not expose raw `wasm-vips` objects outside `wasmVipsDecoder.ts`.

All Vips images and temporary allocations must be released deterministically.

---

# 7. Worker Requirements

Run `wasm-vips` in a dedicated worker.

The main UI thread must not perform decode operations.

Requirements:

- initialize the WASM module once;
- reuse the initialized decoder;
- support cancellation or stale-job rejection;
- transfer buffers instead of cloning them where possible;
- release Vips-side resources immediately after output extraction;
- never retain both unnecessary interleaved and converted copies;
- return structured errors to the caller;
- record decode timings using `performance.now()`.

Cross-origin isolation must be tested with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Create a report of any existing Lighttable or Storybuilder dependencies that stop working under these headers.

Pay special attention to:

- OAuth popups;
- external images;
- CDN resources;
- analytics;
- iframes;
- AI provider assets;
- remote thumbnails;
- development tooling and HMR.

---

# 8. Pixel and Bit-Depth Validation

For each deterministic test image:

1. Decode through `wasm-vips`.
2. Read exact CPU-side samples from the returned typed array.
3. Compare them with expected source values.
4. Upload the data to WebGPU.
5. Convert to the linear `rgba16float` working representation.
6. Read back selected GPU pixels into a buffer.
7. Compare GPU values with mathematically expected values.

Do not validate by visually inspecting only.

Generate a machine-readable result per sample:

```ts
interface PixelValidationResult {
  position: readonly [number, number];
  channel: "r" | "g" | "b" | "a";
  expectedSourceValue: number;
  decodedSourceValue: number;
  expectedWorkingValue: number;
  gpuWorkingValue: number;
  absoluteError: number;
  passed: boolean;
}
```

Suggested tolerances:

| Path | Maximum acceptable error |
|---|---:|
| 8-bit integer decode | exact |
| 16-bit integer decode | exact |
| float decode | format-dependent, document result |
| u8 → rgba16float | `<= 1 / 255 + epsilon` |
| u16 → rgba16float | `<= 1 / 65535 + half-float rounding tolerance` |
| f32 → rgba16float | expected float16 rounding tolerance |

The agent must calculate an appropriate float16 comparison tolerance rather than expecting exact equality.

---

# 9. WebGPU Ingest Conversion

Do not reinterpret unsigned 16-bit integer values as float16 bit patterns.

Implement an explicit conversion path.

Recommended paths:

```text
u8 source
  → storage buffer or rgba8unorm texture
  → compute/render conversion
  → linear rgba16float texture

u16 source
  → storage buffer
  → normalize by 65535.0
  → source transfer-function decode
  → linear rgba16float texture

f32 source
  → storage buffer
  → optional color transform
  → rgba16float texture
```

The shader must handle:

- 1, 2, 3 and 4 source channels;
- optional alpha;
- non-premultiplied alpha as the canonical internal representation unless Lighttable already requires another convention;
- configurable source transfer function;
- configurable channel ordering;
- correct row stride;
- source values above `1.0` for float input until the chosen working format clamps or rounds them.

Important: verify whether Lighttable's existing `rgba16float` textures and shader path preserve values above `1.0`. They should, unless a specific pass clamps them.

---

# 10. Color Management Validation

The spike does not need to implement the complete final color-management system, but it must determine what data is available and where conversion should occur.

Test:

- no embedded profile;
- embedded sRGB profile;
- Display P3 profile;
- Adobe RGB profile if a suitable test file is available;
- grayscale ICC profile if available.

The test report must answer:

1. Can the embedded ICC payload be extracted?
2. Can wasm-vips/LittleCMS convert to a chosen working color space?
3. Does conversion preserve high-bit-depth precision?
4. Is it faster and simpler to perform ICC conversion in WASM or in another color-management component?
5. Does conversion produce deterministic output across browsers?

For the spike, use one explicit working-space target.

Preferred initial target:

```text
Linear sRGB / linear Rec.709 primaries
```

Do not silently treat Display P3 or Adobe RGB samples as sRGB.

Record the source color interpretation and every applied transform.

---

# 11. Alpha Validation

Test alpha independently from RGB.

Verify:

- whether decoded alpha is straight or premultiplied;
- whether wasm-vips changes alpha during color conversion;
- whether RGB values under fully transparent pixels remain intact;
- whether the WebGPU ingest pass introduces premultiplication;
- whether existing Lighttable compositing expects straight or premultiplied alpha.

The spike report must recommend one canonical internal alpha convention.

Do not change the production compositor during the spike.

---

# 12. Orientation Validation

Test all relevant EXIF orientation values, especially:

- normal;
- rotate 90°;
- rotate 180°;
- rotate 270°;
- mirrored variants if test assets are available.

Decide whether orientation is:

1. baked into decoded pixels during import; or
2. represented as non-destructive document metadata.

For the first production implementation, prefer baking EXIF orientation into the imported pixel orientation unless Lighttable already has a robust source-transform model.

The result must be deterministic and must not apply orientation twice.

---

# 13. Performance Test Matrix

Run tests on at least these approximate image sizes:

| Class | Approximate dimensions | Megapixels |
|---|---:|---:|
| Medium | 6000 × 4000 | 24 MP |
| Large | 8688 × 5792 | 50 MP |
| Very large | 12000 × 8000 | 96 MP |

Test at least:

- JPEG 8-bit;
- PNG 16-bit;
- TIFF 16-bit;
- AVIF 10/12-bit if available.

Record:

- WASM initialization time;
- cold decode time;
- warm decode time;
- metadata extraction time;
- CPU-to-GPU transfer time;
- GPU conversion time;
- total time until first correct full-resolution texture;
- memory before decode;
- estimated raw image size;
- peak observed or estimated working memory;
- memory after cleanup;
- UI responsiveness;
- worker errors or browser crashes.

Do not optimize only for the fastest development workstation.

At minimum test:

- Chromium desktop with a discrete GPU;
- Chromium desktop with a weaker or integrated GPU if available;
- Safari if wasm-vips and required browser features permit it;
- a mobile browser only as an exploratory test, not necessarily a launch requirement.

---

# 14. Success Criteria

The spike is a **GO** only when all required criteria pass.

## Functional requirements

- JPEG, PNG, TIFF, WebP and AVIF decode successfully for the agreed test variants.
- 16-bit PNG and TIFF values remain distinguishable and are not reduced to 8-bit.
- ICC profile bytes can be detected and extracted where present.
- EXIF orientation is handled correctly.
- Alpha is preserved correctly.
- The resulting pixels can be converted into an `rgba16float` WebGPU texture.
- The resulting texture can enter the existing Lighttable shader pipeline without architectural changes.

## Correctness requirements

- 8-bit and 16-bit integer CPU decode tests pass exactly.
- GPU readback is within documented half-float tolerance.
- No hidden clamping occurs before the working texture unless explicitly intended.
- No accidental gamma double-conversion occurs.
- No accidental alpha premultiplication or unpremultiplication occurs.

## Architecture requirements

- All wasm-vips code is isolated behind `ImageDecoder`.
- Decode work runs outside the main thread.
- Resources can be released deterministically.
- Existing browser-native decode remains available as a fallback during migration.
- Cross-origin isolation does not break critical Lighttable/Storybuilder functionality, or every incompatibility has a realistic remediation.

## Performance requirements

Initial target, not a universal hard real-time guarantee:

- 24 MP image imports without UI blocking or memory failure.
- 50 MP image imports reliably on the target desktop environment.
- approximately 100 MP test images either import successfully or fail gracefully with a clear resource error.
- no browser tab crash during the standard matrix.
- repeated imports do not show unbounded memory growth.

The agent must report actual measurements rather than claiming performance qualitatively.

---

# 15. Failure Criteria

Return **NO-GO** or **CONDITIONAL GO** if any of the following occur:

- 16-bit data is silently reduced to 8-bit;
- cross-origin isolation breaks essential application flows without a practical fix;
- memory cannot be reclaimed between imports;
- 50 MP files regularly crash the browser on target hardware;
- ICC or alpha behavior is inconsistent or cannot be made deterministic;
- the build size or startup cost is unacceptable and cannot be lazy-loaded;
- browser support is too narrow for the intended product requirements;
- wasm-vips objects leak into unrelated application code;
- integration requires replacing the existing WebGPU grading pipeline.

For a conditional result, list each blocker, severity and proposed mitigation.

---

# 16. Required Spike Deliverables

The coding agent must produce:

1. A working browser test page or Lighttable dev panel.
2. A worker-based wasm-vips decoder prototype.
3. A WebGPU ingest conversion shader.
4. CPU and GPU pixel validation tests.
5. A deterministic set of test images or a script to generate them.
6. Automated test output in JSON.
7. A human-readable Markdown report.
8. A compatibility report for cross-origin isolation.
9. Bundle-size and startup-cost measurements.
10. A final verdict: `GO`, `CONDITIONAL GO` or `NO-GO`.

The report must include exact library versions, browser versions and hardware used.

---

# 17. Production Implementation Plan — Execute Only After GO

## Phase 1 — Establish Image I/O Boundary

Create a dedicated image I/O module that owns all raster decode and encode behavior.

```text
src/image-io/
  contracts.ts
  registry.ts
  sniffFormat.ts
  decodeImage.ts
  encodeImage.ts
  workers/
  decoders/
    browserBitmapDecoder.ts
    wasmVipsDecoder.ts
  encoders/
    wasmVipsEncoder.ts
```

Responsibilities:

- format sniffing;
- decoder selection;
- metadata normalization;
- typed pixel output;
- cancellation;
- errors;
- telemetry;
- future decoder plugins.

The application must call `decodeImage()` rather than a specific codec.

---

## Phase 2 — Add Decoder Registry

Use a registry so formats such as EXR and RAW can be added later.

```ts
export interface DecoderRegistration {
  id: string;
  priority: number;
  decoder: ImageDecoder;
}

export class ImageDecoderRegistry {
  register(registration: DecoderRegistration): void;
  findDecoder(input: Uint8Array, mimeType?: string): ImageDecoder | undefined;
}
```

Initial order:

1. wasm-vips for supported professional and high-bit-depth formats;
2. browser-native decoder as fallback for simple 8-bit images;
3. future specialized decoders.

Do not select a decoder only from the file extension.

Use content sniffing where practical.

---

## Phase 3 — Introduce Source Image Description

Separate source representation from working GPU representation.

```ts
export interface SourceImageDescriptor {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  storage: DecodedPixelStorage;
  colorSpace: SourceColorSpace;
  transferFunction: SourceTransferFunction;
  alphaMode: "none" | "straight" | "premultiplied";
  orientationApplied: boolean;
  sourceBitDepth?: number;
}
```

This descriptor must accompany the upload job so the GPU conversion pass knows how to interpret the buffer.

---

## Phase 4 — Production WebGPU Ingest Pass

Create one production ingest subsystem that converts source buffers to the existing working texture.

```text
DecodedImage
    ↓
GPU staging/upload buffer
    ↓
source-format-specific unpack
    ↓
transfer function decode
    ↓
optional matrix or color transform
    ↓
alpha normalization
    ↓
rgba16float working texture
```

Prefer one shared conversion shader with specialization constants or a small set of explicit shader variants.

Avoid generating many ad-hoc WGSL strings at runtime.

Cache pipelines by:

- storage type;
- channel count;
- transfer function;
- alpha mode.

Integrate the result at the same point where the current browser-decoded source texture enters the correction pipeline.

Do not rewrite downstream grading shaders.

---

## Phase 5 — Color Management

Implement color management in a separate layer.

Initial production target:

- extract embedded ICC;
- assign sensible defaults when missing;
- convert source to a defined linear working space;
- retain original ICC metadata for export;
- store transform provenance in document metadata.

Recommended first working space:

```text
Linear sRGB / Rec.709 primaries
```

This matches the existing pipeline most closely and minimizes initial disruption.

Possible later working spaces:

- linear Display P3;
- linear Rec.2020;
- ACEScg.

Do not move to ACEScg as part of the initial wasm-vips integration unless the complete display and export pipeline is ready for it.

---

## Phase 6 — Import Integration

Replace the existing import flow incrementally.

Suggested order:

1. PNG 16-bit.
2. TIFF 16-bit.
3. AVIF high-bit-depth.
4. JPEG/WebP through wasm-vips where metadata or consistency benefits justify it.
5. Keep browser decode as fallback.

Feature-flag the new path:

```ts
const useAdvancedImageIo = featureFlags.advancedImageIo;
```

Allow side-by-side comparison during development.

Do not switch all users to the new path until telemetry and cleanup behavior are validated.

---

## Phase 7 — Metadata and Document Model

Store normalized import metadata in the Lighttable document or layer source record.

```ts
export interface ImportedImageSource {
  assetId: string;
  originalFilename: string;
  mimeType?: string;
  detectedFormat: string;
  width: number;
  height: number;
  sourceBitDepth?: number;
  embeddedIccProfileId?: string;
  exifOrientationApplied: boolean;
  alphaMode: "none" | "straight" | "premultiplied";
  importPipelineVersion: number;
}
```

Do not store large ICC byte arrays repeatedly per layer.

Deduplicate them through an asset or profile store.

---

## Phase 8 — Export Integration

After import is stable, use wasm-vips for selected export formats.

Initial export targets:

- JPEG 8-bit;
- PNG 8-bit;
- PNG 16-bit;
- WebP;
- AVIF;
- TIFF 8/16-bit.

Export flow:

```text
final WebGPU working texture
    ↓
export transform / output color space
    ↓
GPU readback or tiled export buffer
    ↓
worker
    ↓
wasm-vips encode
    ↓
Blob
```

Do not read back more intermediate GPU textures than necessary.

For large files, investigate tiled or scanline-based export to avoid a full float32 duplicate in JS memory.

---

## Phase 9 — Cache and Memory Policy

Define ownership rules explicitly.

At any moment, identify which component owns:

- original compressed bytes;
- decoded CPU pixels;
- GPU upload buffer;
- working texture;
- thumbnail;
- export buffer.

Recommended lifecycle:

1. Retain original compressed asset where the document system requires it.
2. Decode in worker.
3. Transfer decoded pixels to upload owner.
4. Upload and convert to GPU.
5. Release CPU decoded pixels unless required for another feature.
6. Retain a smaller preview or thumbnail separately.
7. Re-decode from original asset when necessary rather than retaining every full-resolution CPU representation.

Add development counters for active decoded bytes and active GPU texture bytes.

---

## Phase 10 — Error Handling

Introduce typed errors:

```ts
export type ImageIoErrorCode =
  | "unsupported-format"
  | "decode-failed"
  | "invalid-metadata"
  | "out-of-memory"
  | "gpu-upload-failed"
  | "color-transform-failed"
  | "cancelled";
```

User-facing behavior must distinguish:

- unsupported format;
- damaged file;
- too-large file;
- unavailable browser capability;
- internal decoder error.

Never leave a partially created layer in the document after a failed import.

---

## Phase 11 — Testing

Add automated coverage for:

- format sniffing;
- decoder selection;
- exact 16-bit preservation;
- ICC presence and routing;
- EXIF orientation;
- alpha convention;
- GPU conversion;
- repeated import cleanup;
- cancellation;
- corrupt inputs;
- very large dimensions;
- unsupported formats.

Keep the deterministic spike assets as permanent regression fixtures where licensing permits.

Add golden numeric tests, not only image snapshots.

---

## Phase 12 — Observability

Add development and optional production telemetry for:

- format;
- megapixels;
- source bit depth;
- decoder chosen;
- decode duration;
- upload duration;
- failure code;
- peak estimated decoded bytes;
- browser and platform class.

Do not record image contents or sensitive EXIF fields.

---

# 18. Future Decoder Extensions

After the production abstraction is stable:

## OpenEXR

Use a specialized EXR decoder behind `ImageDecoder`.

Requirements later:

- half and float channels;
- linear values above `1.0`;
- optional arbitrary channel selection;
- alpha;
- eventually multipart or multilayer support.

## Camera RAW

Use a separate LibRaw/RawSpeed-based decoder, likely WASM or server-assisted depending on performance and package size.

RAW import needs its own pipeline for:

- demosaic;
- camera white balance;
- black and white levels;
- camera color matrices;
- highlight recovery;
- lens metadata;
- embedded preview handling.

Do not treat RAW as merely another RGB raster decoder.

## HEIC

Add only when product need justifies the codec, licensing and bundle implications.

Prefer an optional lazy-loaded decoder.

## PSD/PSB

Treat as a document import problem, not merely flat image decode.

---

# 19. Non-Goals

Do not use this project to:

- replace the WebGPU grading pipeline with libvips operations;
- implement RAW processing prematurely;
- introduce ACES across the entire application;
- redesign the layer document model;
- solve PSD compatibility;
- add every possible libvips dependency to one giant WASM bundle;
- retain all full-resolution decoded images permanently in CPU memory;
- rely on visual comparisons instead of numeric validation.

---

# 20. Final Agent Instruction

Implement the technical spike first.

Do not begin the production migration until the spike report returns `GO` or an explicitly accepted `CONDITIONAL GO`.

Favor correctness and measurable evidence over a broad but shallow integration.

The main architectural rule is:

> wasm-vips owns browser-side raster I/O and metadata normalization; WebGPU remains responsible for interactive grading, compositing, scopes and final image processing.
