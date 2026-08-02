

# Implement Depth Anything V2 Small depth-of-field integration

Integrate AI-generated depth-of-field into the existing WebGPU Lightroom-style image-processing application.

The application already has its own WebGPU rendering and color-processing pipeline. Preserve the current architecture, UI design, controls and visual styling. Do not replace the existing renderer or rebuild the interface.

## Goal

Use Depth Anything V2 Small to generate a relative depth map from the loaded source image. Use that depth map inside the existing WebGPU pipeline to drive a high-quality, depth-aware lens blur controlled by the existing controls shown in the UI:

- Apply
- Blur Amount
- Bokeh shape
- Cat Eye
- Bokeh Boost
- Focus Range
- existing focus picker/autofocus buttons
- existing Visualize Depth option, if already present

The depth model performs an analysis pass. It must not run continuously while sliders are adjusted.

## Model

Use:

- model: `onnx-community/depth-anything-v2-small-ONNX`
- runtime: `@huggingface/transformers`, backed by ONNX Runtime Web
- primary execution provider: WebGPU
- fallback: WASM
- license: Apache 2.0

Prefer the existing, verified Transformers.js preprocessing and postprocessing instead of manually reproducing the Depth Anything image processor.

Example initialization:

```ts
import { pipeline } from "@huggingface/transformers";

const supportsWebGPU = "gpu" in navigator;

const depthEstimator = await pipeline(
  "depth-estimation",
  "onnx-community/depth-anything-v2-small-ONNX",
  {
    device: supportsWebGPU ? "webgpu" : "wasm",
    dtype: supportsWebGPU ? "fp16" : "q8",
  }
);

If the selected model package does not contain the requested datatype, detect this cleanly and fall back to the available FP32 or quantized model.

Architecture

Implement the depth system as a separate analysis service:

interface DepthAnalysisResult {
  width: number;
  height: number;
  data: Float32Array;
  nearIsOne: true;
}

interface DepthEstimator {
  initialize(): Promise<void>;
  estimate(source: ImageBitmap): Promise<DepthAnalysisResult>;
  dispose(): Promise<void>;
}

Requirements:

Load the model only once.
Reuse the same model/session for subsequent images.
Run inference asynchronously, preferably in a dedicated worker.
Do not block UI interaction or the render loop.
Show progress through the application’s existing loading/progress mechanism.
Cache the calculated depth map for the current source image.
Do not rerun inference when blur or color controls change.
Invalidate the depth only when the source image or its geometry materially changes.
Crop, rotate and mirror operations should transform the cached depth using the same image-space transform whenever possible.
Run inference from the original decoded image, before grading and display transforms. Color adjustments must not continuously alter the estimated geometry.

It is acceptable for model inference to return a CPU Float32Array. Upload it to WebGPU once as an r32float texture. Avoid fragile attempts to share a GPUDevice between ONNX Runtime and the existing renderer unless the current architecture already supports that reliably.

Depth normalization

Depth Anything V2 produces relative depth, not reliable physical distances in metres.

Convert its output into a stable normalized working representation:

1.0 = near the camera
0.0 = far from the camera

Use robust percentile normalization instead of raw minimum and maximum values:

const low = percentile(rawDepth, 0.01);
const high = percentile(rawDepth, 0.99);

normalized = clamp((rawDepth - low) / (high - low), 0, 1);

Verify the model’s output orientation and invert it once if necessary. Do not expose inconsistent depth orientation to shaders or UI code.

Do not quantize working depth to 8-bit. Keep it as float data and store it in an r32float or, if memory requires, r16float texture.

Depth upscaling

Model inference does not need to run at the full source resolution.

Use a sensible analysis resolution that balances detail and memory. Preserve aspect ratio and use the model processor’s expected dimensions.

Upscale the resulting depth map to the current render resolution using an edge-aware method:

joint bilateral upsampling, or
guided upsampling using the original image

The guidance must be conservative. Do not imprint fine image texture, skin pores or noise into otherwise flat depth surfaces.

The depth texture must remain aligned pixel-for-pixel with the image after crop, resize, orientation and preview scaling.

WebGPU depth-of-field

Implement lens blur as a depth-aware WebGPU effect. A normal image blur followed by a depth mask is not sufficient.

Calculate a symmetric focus interval from the selected focus distance and depth of field, then calculate a signed circle of confusion:

let focusStart = max(0.0, focusDistance - depthOfField * 0.5);
let focusEnd   = min(1.0, focusDistance + depthOfField * 0.5);

let nearDistance = max(depth - focusEnd, 0.0);
let farDistance  = max(focusStart - depth, 0.0);

let signedCoC =
    select(-farDistance, nearDistance, nearDistance > 0.0);

let cocRadius =
    clamp(abs(signedCoC) * blurScale, 0.0, maxBlurRadius);

Adjust the formula to match the standardized internal depth direction. The important result is:

pixels inside the focus range remain sharp;
pixels in front of it receive foreground blur;
pixels behind it receive background blur;
blur increases smoothly with depth distance.

Use separate foreground and background processing or an equivalent occlusion-aware technique. Prevent:

blurred background leaking across foreground silhouettes;
sharp foreground color contaminating the background;
halos around hair, shoulders and object edges;
abrupt blur transitions at the focus-range boundaries.

Dilating the foreground CoC before compositing is acceptable and generally necessary.

Perform filtering and compositing in premultiplied alpha and preferably scene-linear color.

Performance

Large blur radii must not use a naive full-radius convolution.

Use an efficient multi-resolution approach:

create a downsample or mip pyramid;
select the appropriate level based on CoC radius;
gather a limited number of aperture samples;
combine foreground and background layers;
composite at full preview resolution.

Target smooth interactive updates when adjusting controls. Slider changes must only update uniforms and render passes, never restart depth inference.

Scale blur radius relative to output resolution so the visual result remains consistent between preview and full-resolution export.

Existing controls
Apply
Enables or bypasses the depth-of-field compositing passes.
Bypassing the effect must not delete the cached depth map.
Disabled mode should add almost no render overhead.
Blur Amount
Controls the maximum CoC/blur radius.
Use a perceptually useful nonlinear mapping if the existing 0–100 range feels compressed.
A value of zero must produce an exact visual bypass.
Focus Range

Treat this as a dual-handle depth interval:

left side of the UI represents near;
right side represents far;
the selected interval remains sharp;
areas outside the interval gradually blur.

Keep the existing visual histogram/range representation. If possible, generate its histogram from the normalized depth texture.

Avoid binary focus masks. Add an internal feather/falloff around both focus boundaries.

Focus picker

When the existing crosshair/picker is active:

allow the user to click the image;
sample the median depth from a small region, approximately 7×7 pixels;
reject invalid samples;
move the focus range so it is centred around the sampled depth;
preserve the existing focus-band width.

Median sampling is required to avoid single-pixel errors on depth boundaries.

If the existing person/autofocus button depends on a subject mask, reuse an existing mask or subject-detection facility. Do not silently add another large AI model. If no reliable subject information exists, leave that feature clearly unavailable instead of pretending that centre focus is subject detection.

Bokeh shape

Preserve the existing bokeh buttons, order and icons. Inspect the current code to determine the intended enum values.

Each selection should alter the aperture sampling kernel, not merely draw a shape over a Gaussian blur.

Possible mappings include:

circular;
soft circular/ring;
polygonal aperture;
donut/catadioptric;
anamorphic/oval.

Keep the aperture samples normalized so changing shape does not unexpectedly change exposure.

Cat Eye

Simulate optical cat-eye bokeh toward the edges of the image:

zero = normal centred aperture;
higher values progressively compress and shift the aperture radially;
effect strength increases smoothly with distance from image centre;
preserve the central bokeh shape;
avoid discontinuities and clipping at image edges.

Implement this as a deformation of the aperture sample positions, not as a post-process vignette.

Bokeh Boost

Boost bright out-of-focus highlights during the bokeh gather:

let highlight =
    smoothstep(highlightThreshold, highlightThreshold + softness, luminance);

let sampleWeight =
    apertureWeight * (1.0 + highlight * bokehBoost);

Normalize accumulated weights to prevent general exposure changes.

The boost should affect blurred highlights, not sharpened pixels or the entire image. Perform this before final tone mapping when the existing pipeline permits it.

Visualize Depth

If this control already exists:

show the normalized working depth;
near should display white;
far should display black;
bypass color grading while visualizing;
optionally show the selected focus interval as an overlay;
do not modify the cached source or render state.
State

Add a dedicated state object without mixing model lifecycle into UI components:

interface DepthOfFieldState {
  enabled: boolean;
  status: "idle" | "loading-model" | "estimating" | "ready" | "error";

  apertureSize: number;
  bokehShape: BokehShape;
  catEye: number;
  bokehBoost: number;

  focusDistance: number;
  depthOfField: number;
  transitionFeather: number;
}

Keep model state, depth texture state and UI state separate. In particular, the `Depth | Focus | Aperture | Result` display mode is session UI state and must not be persisted into an image recipe.

Failure behaviour

If WebGPU model inference fails:

cleanly retry with the WASM backend;
keep the existing image editor operational;
disable only the depth-dependent effect;
display a concise error through the existing notification system;
do not crash or recreate the main WebGPU renderer.

The WASM fallback may be slower, but slider interaction must still become realtime once depth estimation has completed.

Export

For full-resolution export:

reuse the existing normalized depth analysis;
apply edge-aware depth upscaling at export resolution;
scale blur radii relative to export dimensions;
render through the existing high-quality/export WebGPU path;
do not rerun the depth model at 4K unless a separate explicit quality mode is introduced later.
Deliverables
Depth estimator service with WebGPU and WASM fallback.
Worker-based asynchronous model inference.
Cached normalized float depth texture.
Edge-aware depth upscaling.
Occlusion-aware WebGPU depth-of-field passes.
Integration with every existing control in the marked UI area.
Loading and error states using existing application components.
Unit tests for normalization, depth direction and focus-range calculations.
Visual test cases covering:
portrait with hair;
foreground object crossing a background edge;
bright point lights;
large blur radius;
near foreground blur;
wide image;
flat wall or similarly low-texture surface.
Acceptance criteria
Depth inference runs once per source image.
All UI adjustments remain realtime after analysis.
The existing color pipeline remains unchanged outside the new effect.
Foreground silhouettes do not show obvious background bleeding.
Focus picking selects the visually correct depth layer.
Near and far orientation is consistent throughout the UI.
Bokeh shape, Cat Eye and Bokeh Boost produce genuinely different optical effects.
WebGPU is used when available and WASM works as a fallback.
Disabling Apply produces a clean bypass.
Full-resolution export visually matches the preview.

Mijn belangrijkste advies hierin: laat de agent niet alleen “Depth Anything toevoegen”. De kwaliteit gaat uiteindelijk vooral afhangen van de signed CoC, foreground/background-scheiding en occlusion handling. Zonder die drie zaken krijg je ondanks een goede depth map alsnog de typische goedkope AI-blur met halo’s rond het character.

Bekijk ook de darktable implementatie voor quality als we de depth enzo al rond hebben...

De vraag is of we dit allemaal in dezelfde shader moeten doen of dat het een 2e pass moet zijn?
Het iig los genoeg staan van de color en texture en andere effects dat dat snel blijft 
en dat dat niet stuk gaat, dit stuk moet enabled kunnen worden en mocht het traag zijn om te initten
pas initializen op moment van gebruik.

even goed onderzoek nodig => het effect zou indezelfde shader kunnen wellicht..
Maar de processing van de depth map en het uploaden maar ook bewaren voor die sessie enzo en aanlevern komt van een ander deel af?

let's discuss..

