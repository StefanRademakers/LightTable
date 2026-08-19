# Lighttable — Apple ProRAW / DNG Support

## Goal

Add robust Apple ProRAW support to Lighttable without coupling the application to one RAW implementation.

Apple ProRAW should be treated as a specialized DNG workflow rather than as a normal Bayer/X-Trans RAW file.

The design should fit into the broader Lighttable RAW architecture:

```text
RawDecoder
   ├── LibRawDecoder
   ├── LinearDngDecoder
   └── AppleProRawDecoder
```

The rest of Lighttable should receive one normalized high-precision image representation and should not need to know which decoder produced it.

---

# 1. Apple ProRAW Is Not a Traditional Sensor RAW

Traditional camera RAW usually looks like:

```text
Sensor CFA data
   ↓
Bayer / X-Trans
   ↓
Demosaic
   ↓
Camera RGB
   ↓
Color transform
   ↓
Editable image
```

Apple ProRAW is different.

Conceptually:

```text
iPhone sensor data
   ↓
Apple computational photography
   ↓
multi-frame processing / fusion
   ↓
demosaiced scene-referred RGB
   ↓
DNG container
   ↓
Lighttable
```

ProRAW is therefore closer to a high-dynamic-range linear DNG than to a classic single-frame Bayer RAW.

Do not assume that every `.dng` file should go through the same decode path.

---

# 2. Detect DNG Type

Introduce an explicit RAW image kind:

```ts
export type RawImageKind =
  | "cfa-raw"
  | "linear-dng"
  | "apple-proraw";
```

Detection should be based on file metadata / DNG tags where possible, not only the file extension.

Example:

```ts
export interface RawSourceInfo {
  path: string;
  extension: string;

  container?: "dng" | "cr3" | "nef" | "arw" | "raf" | "other";

  cameraMake?: string;
  cameraModel?: string;

  isLinearDng?: boolean;
  isAppleProRaw?: boolean;
}
```

---

# 3. Decoder Abstraction

Do not hard-code the application around `libraw-wasm`.

Use a decoder interface:

```ts
export interface RawDecoder {
  readonly id: string;

  canDecode(source: RawSourceInfo): Promise<boolean>;

  decode(
    source: ArrayBuffer,
    options?: RawDecodeOptions
  ): Promise<DecodedRawImage>;
}
```

Suggested registry:

```text
RawDecoderRegistry

├── LibRawDecoder
├── LinearDngDecoder
└── AppleProRawDecoder
```

This gives Lighttable room to improve ProRAW support independently of normal camera RAW support.

---

# 4. Recommended Decoder Priority

Suggested priority:

```text
Apple ProRAW
   ↓
AppleProRawDecoder
   ↓
fallback: LinearDngDecoder
   ↓
fallback: LibRawDecoder
```

Generic DNG:

```text
DNG
   ↓
detect linear vs CFA
   ↓
LinearDngDecoder or LibRawDecoder
```

Traditional camera RAW:

```text
CR3 / NEF / ARW / RAF / RW2 / ORF / ...
   ↓
LibRawDecoder
```

---

# 5. LibRaw Role

Use LibRaw primarily for:

- file/container parsing
- camera RAW compatibility
- sensor metadata
- CFA information
- black / white levels
- embedded previews
- camera metadata
- traditional RAW decoding

LibRaw should not become the owner of Lighttable's final image look.

Preferred architecture:

```text
LibRaw
   ↓
decoded high-precision data
   ↓
Lighttable RAW normalization
   ↓
Lighttable WebGPU grade pipeline
```

Avoid:

```text
LibRaw
   ↓
8-bit rendered JPEG
   ↓
Lighttable
```

---

# 6. ProRAW / Linear DNG Path

For ProRAW, Lighttable should preserve the high-precision linear RGB content contained in the DNG.

Conceptually:

```text
Apple ProRAW DNG
   ↓
parse DNG metadata
   ↓
decode linear RGB payload
   ↓
apply required DNG linearization / gain metadata
   ↓
normalize scene-referred RGB
   ↓
convert to Lighttable working space
   ↓
rgba16float
   ↓
existing Grade stack
```

Do not run a Bayer demosaic stage when the DNG already contains linear/demosaiced RGB data.

---

# 7. Important DNG / ProRAW Metadata

The decoder should preserve relevant DNG metadata rather than discarding it.

Important categories include:

- black level
- white level
- baseline exposure
- linearization information
- color matrices / camera profile information
- orientation
- white balance metadata
- tone / gain metadata
- crop / active area
- camera model
- embedded preview
- auxiliary Apple metadata where relevant

Apple ProRAW may rely on DNG metadata that describes the intended rendering.

The implementation should be able to retain unknown metadata blocks so future versions can use them.

---

# 8. ProfileGainTableMap

Apple ProRAW may contain DNG gain-map information such as `ProfileGainTableMap`.

Do not ignore this blindly.

Create an explicit representation:

```ts
export interface DngGainMap {
  width: number;
  height: number;
  channels: number;

  data: Float32Array;

  origin?: [number, number];
  spacing?: [number, number];
}
```

The initial implementation can support:

```text
none
basic application
preserve-only
```

but the metadata must not be lost during decode.

If proper application is not implemented yet, expose that clearly in diagnostics.

---

# 9. Linearization

Some DNGs use a `LinearizationTable`.

If present, apply it before normal Lighttable grading.

Conceptually:

```text
stored DNG sample
   ↓
LinearizationTable
   ↓
linear sample
```

Do not apply normal creative curves before this stage.

---

# 10. Baseline Exposure

DNG may specify `BaselineExposure`.

Treat this as part of RAW normalization, not as the user's creative Exposure slider.

Recommended separation:

```ts
interface RawNormalizationState {
  baselineExposureEv?: number;
}
```

versus:

```ts
grade.light.exposure
```

The RAW baseline should not visually appear as if the user manually moved Exposure.

---

# 11. White Balance

Keep RAW white balance separate from creative RGB temperature/tint adjustments.

Suggested state:

```ts
export interface RawWhiteBalance {
  mode: "as-shot" | "auto" | "custom";

  temperatureKelvin?: number;
  tint?: number;

  cameraMultipliers?: [number, number, number, number];
}
```

For ProRAW, the exact implementation may differ from traditional CFA RAW, but the saved state should still live in `rawDevelop`, not in the creative grade.

---

# 12. Output Contract

All RAW decoders should normalize to one shared structure.

```ts
export interface DecodedRawImage {
  kind: RawImageKind;

  width: number;
  height: number;

  channels: 1 | 3 | 4;

  data:
    | Uint16Array
    | Float32Array;

  colorSpace: RawColorSpace;

  metadata: RawMetadata;

  dng?: DngMetadata;

  embeddedPreview?: DecodedPreview;
}
```

Recommended:

```ts
export type RawColorSpace =
  | "sensor"
  | "camera-rgb"
  | "linear-rgb"
  | "lighttable-working";
```

For Apple ProRAW the expected output will generally already be RGB-based rather than CFA sensor data.

---

# 13. Lighttable Working Representation

After RAW normalization:

```text
DecodedRawImage
   ↓
working-space conversion
   ↓
Float32 CPU representation where needed
   ↓
WebGPU upload
   ↓
rgba16float
```

From this point onward, use the existing Lighttable image/grade pipeline.

The Grade stack should not care whether the source originated as:

- JPEG
- TIFF
- CR3
- NEF
- ARW
- DNG
- Apple ProRAW

---

# 14. macOS Native Fallback

On macOS, consider a native Apple decoder backend using:

- ImageIO
- Core Image

This can act as an optional compatibility backend for Apple ProRAW.

Suggested architecture:

```text
AppleProRawDecoder
   ├── native Apple backend     macOS
   └── portable DNG backend     Windows/macOS/Linux
```

This native path should remain behind the same `RawDecoder` interface.

Do not let platform-specific APIs leak into the editor or grade system.

---

# 15. Cross-Platform Requirement

Lighttable must not depend exclusively on Apple APIs for ProRAW.

Target:

```text
Windows
  portable ProRAW / DNG support

macOS
  portable support
  + optional native fallback

Linux
  portable support
```

The native Apple backend is a compatibility/performance enhancement, not the canonical file format.

---

# 16. Preview Strategy

Apple ProRAW files may contain embedded previews.

Use them for:

- Asset Browser thumbnails
- Photo Grid
- Filmstrip
- fast initial display

But do not use the embedded JPEG preview as the actual editing source.

Workflow:

```text
open ProRAW
   ↓
show embedded preview immediately
   ↓
decode full high-precision DNG asynchronously
   ↓
replace preview with exact developed render
```

This integrates naturally with the Lighttable document residency / hibernation architecture.

---

# 17. Caching

Cache expensive decode results separately from the user grade.

Suggested:

```text
ProRAW
   ↓ expensive decode / normalization
Linear working cache
   ↓
Grade
   ↓ cheap GPU rendering
```

Normal grade changes should not force the ProRAW container to be decoded again.

Invalidate the RAW cache only when RAW-develop parameters that affect the decode/normalization stage change.

---

# 18. Diagnostics

Expose internal diagnostics in development builds:

```text
RAW Kind:           Apple ProRAW
Container:          DNG
Decoder:            AppleProRawDecoder
Backend:            portable / native
Linear DNG:         yes
Gain Map:           present
Linearization:      present
Baseline Exposure:  +0.73 EV
Working Output:     linear RGB
GPU Format:         rgba16float
```

This will be extremely useful when testing different iPhone generations.

---

# 19. Test Matrix

Test actual ProRAW samples from multiple iPhone generations.

At minimum test:

- different iPhone generations
- 12 MP ProRAW
- 48 MP ProRAW
- different lenses
- normal exposure
- deep shadows
- clipped highlights
- mixed lighting
- extreme white balance
- portrait / skin
- saturated colors
- high ISO
- underexposed image

Compare against:

- Apple Photos
- Adobe Camera Raw / Lightroom

The goal is not pixel-for-pixel matching.

Validate:

- no channel clipping caused by decode
- correct orientation
- reasonable initial exposure
- correct color interpretation
- preserved highlight latitude
- stable white balance
- no obvious gain-map artifacts

---

# 20. Failure Handling

If Lighttable identifies Apple ProRAW but the active decoder cannot fully support required metadata:

Do not silently flatten to an 8-bit JPEG.

Preferred behavior:

```text
ProRAW detected
↓
try portable decoder
↓
try platform fallback
↓
if still unsupported:
  show clear unsupported RAW message
  optionally show embedded preview read-only
```

Diagnostics should say why the decoder rejected the file.

---

# 21. Implementation Phases

## Phase 1 — Infrastructure

- Add `RawDecoder` abstraction
- Add `RawDecoderRegistry`
- Add `RawImageKind`
- Detect DNG / Linear DNG / ProRAW
- Normalize decoder output into `DecodedRawImage`

## Phase 2 — Basic ProRAW

- Decode Apple ProRAW high-precision RGB
- Preserve DNG metadata
- orientation / crop
- baseline exposure
- white balance
- working-space conversion
- upload to `rgba16float`

## Phase 3 — Rendering Fidelity

- LinearizationTable
- ProfileGainTableMap
- improved camera/profile transforms
- highlight behavior
- improved starting appearance

## Phase 4 — macOS Native Backend

- ImageIO / Core Image bridge
- same `RawDecoder` contract
- use as fallback / validation path

## Phase 5 — Validation

- cross-iPhone test set
- performance tests
- memory tests
- compare against Apple Photos / Lightroom
- hibernation / restore tests

---

# 22. Integration With Photo Workflow

ProRAW should behave like every other photo inside the Lighttable photography workflow.

```text
Photos/
├── IMG_0001.CR3
├── IMG_0002.NEF
├── IMG_0003.ARW
└── IMG_0004.DNG   ← Apple ProRAW
```

The Asset Browser / Grid / Filmstrip only sees:

```ts
PhotoAsset
```

The RAW decoder implementation remains below that level.

Users can therefore:

- rate
- pick / reject
- copy grade
- paste grade
- sync grade
- apply presets
- edit in the normal Grade workspace
- promote to a layered document

exactly like any other supported RAW file.

---

# 23. Architectural Rule

Do not write ProRAW-specific behavior into:

- Properties UI
- Grade panels
- Photo Grid
- Filmstrip
- Layer system
- export system

ProRAW-specific handling belongs to:

```text
RAW ingestion
DNG interpretation
RAW normalization
```

After normalization, it becomes a normal high-precision Lighttable image source.

---

# 24. Recommended Final Architecture

```text
                    PhotoAsset
                        │
                        ▼
                RawDecoderRegistry
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
 LibRawDecoder    LinearDngDecoder   AppleProRawDecoder
      │                 │                 │
      │                 │          ┌──────┴──────┐
      │                 │          │             │
      │                 │      Portable       Apple
      │                 │       backend      native
      │                 │                    backend
      └─────────────────┴──────────────┬────────┘
                                       ▼
                              DecodedRawImage
                                       │
                              RAW normalization
                                       │
                              working-space RGB
                                       │
                                  rgba16float
                                       │
                                       ▼
                              Existing Lighttable
                                grading pipeline
```

The important principle:

> **Apple ProRAW is a specialized high-precision DNG source, not a separate editing workflow. Decode it correctly, normalize it once, and let the existing Lighttable WebGPU/Grade architecture handle everything after that.**
