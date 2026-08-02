# LightTable advanced image I/O implementation checklist

Status: active implementation plan  
Primary rule: ordinary 8-bit images must keep the existing fast path.

## Non-negotiable fast path

- [x] Default `loadImage()` behavior still starts `createImageBitmap()` immediately.
- [x] Opening ordinary 8-bit PNG, JPEG or WebP does not import or initialize wasm-vips.
- [x] Opening ordinary 8-bit PNG, JPEG or WebP does not create an image-I/O worker.
- [x] No WASM file is fetched until precision-preserving decode is actually requested.
- [x] No full `Blob.arrayBuffer()` copy is made on the native path.
- [x] Native-path GPU upload remains `copyExternalImageToTexture`.
- [ ] Native-path startup and median decode time stay within 5% of the current baseline.
- [x] Failure of advanced image I/O never disables ordinary image loading.

The first production API uses an explicit decode mode:

```ts
type ImageDecodeMode =
  | "fast"
  | "preserve-precision";
```

`fast` is the default. Automatic routing may be added later only when it can be
proven not to delay the ordinary path. File extensions alone are not sufficient
to decide whether precision-preserving decode is required.

## Existing working contract

All decoder output is normalized at the ingest boundary to LightTable's current
working representation:

```text
linear sRGB / Rec.709 primaries
premultiplied alpha
rgba16float
```

Downstream grading, layers, effects, scopes and export must not know which
decoder produced the source.

## Phase 0 - Baseline and safety gates

- [ ] Add native decode timing instrumentation behind a development flag.
- [ ] Record cold and warm timings for representative 8-bit PNG/JPEG/WebP.
- [ ] Record peak memory for 24 MP and 50 MP sources.
- [x] Confirm current Hetzner headers and reverse-proxy behavior.
- [x] Audit obvious external fonts and OAuth popup flows for COEP/COOP blockers.
- [x] Do not enable COOP/COEP globally until that audit passes.
- [x] Add an advanced-I/O capability result with a human-readable reason.

Acceptance:

- Native behavior is measured before routing changes.
- Cross-origin isolation cannot accidentally ship as a side effect of this work.

## Phase 1 - Decoder boundary

- [x] Add `image-io` types independent from wasm-vips.
- [x] Wrap the current `createImageBitmap` path in `NativeImageDecoder`.
- [x] Add explicit source color, transfer and alpha metadata.
- [x] Make ownership and cleanup of `ImageBitmap` or pixel buffers explicit.
- [x] Route current `WebGpuEngine.loadImage()` through the native decoder.
- [x] Keep wasm-vips implementation bytes out of the initial application chunk.
- [x] Add unit tests for routing, cleanup and error propagation.

Acceptance:

- Existing LightTable images are pixel-identical.
- The default path performs no extra asynchronous work.
- All existing LightTable tests remain green.

## Phase 2 - Isolated wasm-vips spike

- [x] Pin reviewed wasm-vips version 0.0.18 exactly.
- [x] Load wasm-vips only inside a dedicated, lazily-created worker.
- [x] Verify Vite emits the worker, vips JavaScript and WASM as separate assets.
- [x] Verify wasm-vips implementation bytes do not occur in the initial application chunk.
- [x] Detect `crossOriginIsolated`, `SharedArrayBuffer`, WebAssembly SIMD and
      worker support before loading the package.
- [ ] Add useful progress reporting if wasm-vips exposes meaningful decode progress.
- [x] Implement request IDs, cancellation and worker termination.
- [x] Decode an 8-bit PNG as a control.
- [x] Decode a synthetic 16-bit PNG without reducing it to 8-bit.
- [x] Decode 16-bit TIFF.
- [x] Inspect embedded ICC and EXIF orientation.
- [x] Test alpha and row layout numerically.
- [ ] Measure cold initialization, warm decode and peak memory.
- [x] Write a `GO`, `CONDITIONAL GO` or `NO-GO` result into this document.

Acceptance:

- The worker is never created by native image loads.
- Unsupported deployments return a capability error before downloading WASM.
- Worker failures are contained and the native path still works.

## Phase 3 - Precision-preserving GPU ingest

- [x] Define `DecodedPixelStorage` for `u8`, `u16` and `f32`.
- [x] Define channel count, tightly packed row layout, transfer function and alpha mode.
- [x] Upload decoded `u8`/`u16` buffers without Canvas2D or an 8-bit intermediate.
- [x] Request `texture-formats-tier1` when available and reject unsupported
      16-bit GPU upload before texture creation with an actionable error.
- [x] Resolve unfilterable `rgba16unorm` staging data one-to-one into the
      filterable `rgba16float` LightTable source boundary before layers,
      viewport rendering and scopes consume it.
- [ ] Add an explicit `f32` unpack/conversion pipeline.
- [x] Convert supported sRGB transfer to linear light on GPU.
- [x] Normalize straight/none alpha to premultiplied alpha.
- [x] Produce the same `rgba16float` working texture as the native path.
- [x] Release transferred CPU buffers after GPU submission.
- [ ] Add numeric GPU round-trip fixtures.

Acceptance:

- Adjacent 16-bit values that collapse in 8-bit remain distinguishable.
- Neutral 8-bit fixtures match the native ingest within the agreed tolerance.

## Phase 4 - Color and metadata

- [x] Preserve source bit depth, libvips format and interpretation at the decoder boundary.
- [x] Preserve embedded ICC bytes through the decoder result for import provenance.
- [x] Apply orientation exactly once during advanced decode.
- [x] Implement missing-profile defaults explicitly (`assumed sRGB` is carried
      through decoder metadata and shown in the image status).
- [x] Convert embedded ICC profiles through LittleCMS to 8/16-bit sRGB before
      the existing GPU sRGB-to-linear ingest.
- [x] Keep embedded ICC and unsupported source interpretations diagnosable; never silently guess.
- [x] Store normalized import provenance with the document and round-trip it in
      layered LightTable files.

Acceptance:

- ICC, orientation and alpha fixtures have numeric expected results.
- Reopening a layered document does not reinterpret already-normalized pixels.

## Phase 5 - Product integration

- [x] Add an explicit precision-preserving open/import action.
- [x] Show why advanced decode is unavailable when capability checks fail.
- [ ] Align advanced import failures with the global error conventions; saved
      output already continues through the global upload manager.
- [x] Support cancellation when LightTable closes or another image opens.
- [x] Prevent stale native or worker results from replacing a newer document.
- [x] Show decoder, source bit depth/format and decode duration after advanced import.
- [ ] Consider automatic routing only after native-path performance gates pass.

Acceptance:

- Users pay the WASM startup/decode cost only when using advanced import.
- A normal image and an advanced image can be opened consecutively without
  leaked workers, buffers or GPU textures.

## Phase 6 - Validation matrix

- [x] PNG: synthetic 8-bit RGBA and 16-bit RGBA controls.
- [ ] JPEG: 8-bit, ICC and EXIF orientation variants.
- [ ] TIFF: 8-bit, supported float variants.
- [x] TIFF: synthetic 16-bit RGBA control.
- [ ] WebP: 8-bit RGB/RGBA.
- [ ] AVIF: 8/10/12-bit where the selected build supports it.
- [ ] Dimensions: small, 24 MP, 50 MP and approximately 100 MP.
- [ ] Alpha: opaque, straight alpha edges and fully transparent colored pixels.
- [ ] Cancellation during initialization and decode.
- [ ] Malformed, truncated and unsupported files.
- [ ] Repeated open/close memory stability.

## Current technical decision

**Result: PRODUCTION TEST CANDIDATE (limited scope).**

wasm-vips 0.0.18 is approximately 12.5 MB unpacked and its browser build
requires `SharedArrayBuffer`, therefore cross-origin isolation. The worker spike
preserves adjacent 16-bit PNG and TIFF values, keeps its roughly 5 MB base WASM
asset lazy, and contains failure/cancellation away from native loading.

The production scope is limited to explicit `u8`/`u16` sRGB/RGB/gray import.
Embedded ICC sources are transformed to sRGB through LittleCMS at their source
bit depth before the existing GPU sRGB-to-linear ingest. Float data, missing
profile inference and automatic routing remain disabled. This is ready for
controlled Hetzner testing, not yet a general-purpose replacement for normal
browser image loading.

### Deployment audit findings

- Production is Caddy -> client Nginx. Client Nginx now emits
  `COOP: same-origin` and `COEP: credentialless`.
- Inter is bundled locally; production no longer depends on Google Fonts.
- Higgsfield and OpenArt completion now use authenticated, state-aware backend
  polling. `postMessage` remains as a fast compatible path.
- `credentialless` was chosen so existing presigned S3 image/video URLs remain
  usable without requiring CORP headers from the storage service.
- Development/preview isolation remains opt-in with
  `LIGHTTABLE_ADVANCED_IMAGE_IO_ISOLATION=1`.
- The File menu and OS file picker expose the exact enabled masks: JPEG, PNG
  and WebP for fast loading; PNG, TIFF, JPEG and WebP for preserve-precision.

## Progress log

- [x] Existing LightTable ingest and working color/alpha contract inspected.
- [x] Current wasm-vips package requirements and browser constraints verified.
- [x] Native fast-path requirement made explicit.
- [x] Phase 1 complete: native routing tests and the production build pass.
- [x] Browser worker spike: 8-bit PNG, 16-bit PNG and 16-bit TIFF decode successfully.
- [x] Numeric fixture retains adjacent values including 0/1, 1024/1025 and 65533/65534.
- [x] Vite build emits vips worker/JS/WASM separately; base WASM is 5.08 MB
      (2.01 MB gzip) and is fetched only after the explicit advanced action.
- [x] Capability and decoder controllers are separate lazy chunks (0.69 kB and
      1.78 kB); the default native route does not execute them.
- [x] Full client suite: 25 test files / 134 tests pass; production build passes.
- [x] Production isolation blockers addressed: local fonts, OAuth polling and
      S3-compatible `credentialless` COEP.
- [x] Preserve COOP/COEP/CORP on immutable `/assets/` responses; Nginx does
      not inherit server-level `add_header` directives inside that location
      because it defines its own cache header.
- [x] Current validation: 27 client test files / 144 tests pass; the client
      production build passes.
- [ ] Verify the deployed response headers and `window.crossOriginIsolated`
      on Hetzner after deployment.
- [ ] Run the production smoke matrix below before calling the feature stable.

## Controlled production smoke test

1. Deploy both client and server from the same revision.
2. Hard-refresh the application and verify in DevTools:
   `window.crossOriginIsolated === true`.
3. Open LightTable and confirm normal `File > Open image` still opens JPEG,
   PNG and WebP immediately. No `vips.wasm` request should occur.
4. Use `File > Open image (preserve precision)` and verify the system dialog
   lists PNG, TIFF, JPEG and WebP.
5. Open the included 16-bit PNG and TIFF fixtures. The bottom status must show
   `16-bit`, `wasm-vips` and a decode duration.
6. Verify `vips.wasm` is fetched only on the first preserve-precision action.
7. Reopen a normal 8-bit image, save it through the normal global upload flow,
   then repeat with an advanced image.
8. Test direct S3 thumbnails/video/audio on Boards, Shots and GenAI.
9. As a global admin, reconnect both Higgsfield and OpenArt. Completion must
   be detected even though the isolated popup has no usable `window.opener`.
10. Repeat open/cancel/open and close-during-decode to check stale results and
    worker cleanup.
