import { GRADIENT_MAP_WGSL } from './gradientMapShader';
import { PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_CODES } from './photoshopColorVibranceLut.generated';
import {
  PHOTOSHOP_BLEND_PROFILE_OFFSET,
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET,
  PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET,
  PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET,
  PHOTOSHOP_LEVELS_CHANNELS_OFFSET,
  PHOTOSHOP_PAYLOAD_OFFSET,
  PHOTOSHOP_VIBRANCE_OFFSET
} from './adjustmentUniform';

const PHOTOSHOP_BLEND_PROFILE_RELATIVE_OFFSET =
  PHOTOSHOP_BLEND_PROFILE_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
const PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_RELATIVE_OFFSET =
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
const PHOTOSHOP_LEVELS_CHANNELS_RELATIVE_OFFSET =
  PHOTOSHOP_LEVELS_CHANNELS_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
const PHOTOSHOP_HUE_SATURATION_RANGES_RELATIVE_OFFSET =
  PHOTOSHOP_HUE_SATURATION_RANGES_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
const PHOTOSHOP_DOCUMENT_BIT_DEPTH_RELATIVE_OFFSET =
  PHOTOSHOP_DOCUMENT_BIT_DEPTH_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
const PHOTOSHOP_VIBRANCE_RELATIVE_OFFSET =
  PHOTOSHOP_VIBRANCE_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
export const FULLSCREEN_VERTEX_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var output: VertexOutput;
  let position = positions[index];
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}
`;
export const BASIC_CORRECTION_WGSL = /* wgsl */ `
struct Adjustments {
  temperature: f32,
  tint: f32,
  exposureEV: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,
  whites: f32,
  blacks: f32,
  clarity: f32,
  vibrance: f32,
  saturation: f32,
  texture: f32,
  dehaze: f32,
  vignette: f32,
  lift: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  curveActive: f32,
  padding1: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> adjustments: Adjustments;

fn srgbToLinearChannel(value: f32) -> f32 {
  return select(pow((value + 0.055) / 1.055, 2.4), value / 12.92, value <= 0.04045);
}

fn srgbToLinear(rgb: vec3f) -> vec3f {
  return vec3f(
    srgbToLinearChannel(rgb.r),
    srgbToLinearChannel(rgb.g),
    srgbToLinearChannel(rgb.b)
  );
}

fn linearRgbToXyz(rgb: vec3f) -> vec3f {
  return mat3x3f(
    vec3f(0.4124564, 0.2126729, 0.0193339),
    vec3f(0.3575761, 0.7151522, 0.1191920),
    vec3f(0.1804375, 0.0721750, 0.9503041)
  ) * rgb;
}

fn xyzToLinearRgb(xyz: vec3f) -> vec3f {
  return mat3x3f(
    vec3f(3.2404542, -0.9692660, 0.0556434),
    vec3f(-1.5371385, 1.8760108, -0.2040259),
    vec3f(-0.4985314, 0.0415560, 1.0572252)
  ) * xyz;
}

fn temperatureSliderToCct(temperature: f32) -> f32 {
  // Mireds (1,000,000 / Kelvin) make the warm/cool response much more even
  // than interpolating Kelvin directly. The UI range is deliberately
  // asymmetric to match the creative editing control: -150 cool, +100 warm.
  let d65Mired = 1000000.0 / 6504.0;
  var targetMired = d65Mired;
  if (temperature > 0.0) {
    let amount = pow(clamp(temperature / 100.0, 0.0, 1.0), 1.08);
    targetMired = mix(d65Mired, 1000000.0 / 2500.0, amount);
  } else if (temperature < 0.0) {
    let amount = pow(clamp(-temperature / 150.0, 0.0, 1.0), 1.08);
    targetMired = mix(d65Mired, 1000000.0 / 20000.0, amount);
  }
  return 1000000.0 / targetMired;
}

fn cctToChromaticity(cct: f32) -> vec2f {
  // Published approximations of the Planckian locus below 4000 K and the
  // CIE daylight locus above it. Both return a normalized CIE 1931 xy white.
  let t = clamp(cct, 1667.0, 25000.0);
  var x = 0.0;
  var y = 0.0;
  if (t < 4000.0) {
    x = ((-0.2661239e9 / t - 0.2343589e6) / t + 0.8776956e3) / t + 0.179910;
    if (t <= 2222.0) {
      y = ((-1.1063814 * x - 1.34811020) * x + 2.18555832) * x - 0.20219683;
    } else {
      y = ((-0.9549476 * x - 1.37418593) * x + 2.09137015) * x - 0.16748867;
    }
  } else {
    if (t <= 7000.0) {
      x = ((-4.6070e9 / t + 2.9678e6) / t + 0.09911e3) / t + 0.244063;
    } else {
      x = ((-2.0064e9 / t + 1.9018e6) / t + 0.24748e3) / t + 0.237040;
    }
    y = (-3.0 * x + 2.87) * x - 0.275;
  }
  return vec2f(x, y);
}

fn applyTintToChromaticity(xy: vec2f, cct: f32, tint: f32) -> vec2f {
  // Tint moves orthogonally to the Planckian locus instead of changing green
  // directly. This keeps Temperature and Tint perceptually independent.
  let x = xy.x;
  var normalSlope = 0.0;
  if (cct <= 2222.0) {
    normalSlope = (-3.3191442 * x - 2.69622040) * x + 2.18555832;
  } else if (cct <= 4000.0) {
    normalSlope = (-2.8648428 * x - 2.74837186) * x + 2.09137015;
  } else {
    normalSlope = (9.2452740 * x - 11.7467734) * x + 3.75112997;
  }
  let normalLength = sqrt(1.0 + normalSlope * normalSlope);
  let offset = clamp(tint / 100.0, -1.0, 1.0) * 0.035;
  return vec2f(
    xy.x + offset * normalSlope / normalLength,
    xy.y - offset / normalLength
  );
}

fn chromaticityToXyz(xy: vec2f) -> vec3f {
  let safeY = max(xy.y, 1e-5);
  return vec3f(xy.x / safeY, 1.0, (1.0 - xy.x - xy.y) / safeY);
}

fn applyChromaticAdaptation(rgb: vec3f, temperature: f32, tint: f32) -> vec3f {
  if (abs(temperature) < 0.00001 && abs(tint) < 0.00001) {
    return rgb;
  }

  let cct = temperatureSliderToCct(temperature);
  let sourceWhite = vec3f(0.95047, 1.0, 1.08883);
  let targetXy = applyTintToChromaticity(cctToChromaticity(cct), cct, tint);
  let targetWhite = chromaticityToXyz(targetXy);

  // CAT16 is a von Kries chromatic adaptation in a modern cone-response
  // space. It behaves better than Bradford for large shifts and saturated
  // cyan/purple while remaining a small matrix operation on the GPU.
  let cat16 = mat3x3f(
    vec3f(0.401288, -0.250268, -0.002079),
    vec3f(0.650173, 1.204414, 0.048952),
    vec3f(-0.051461, 0.045854, 0.953127)
  );
  let inverseCat16 = mat3x3f(
    vec3f(1.862068, 0.387520, -0.015841),
    vec3f(-1.011255, 0.621447, -0.034123),
    vec3f(0.149187, -0.008974, 1.049964)
  );
  let sourceLms = cat16 * sourceWhite;
  let targetLms = cat16 * targetWhite;
  let adaptedXyz = inverseCat16 * ((cat16 * linearRgbToXyz(rgb)) * targetLms / max(sourceLms, vec3f(1e-6)));
  return xyzToLinearRgb(adaptedXyz);
}

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn shadowsTonalMask(y: f32) -> f32 {
  // A logistic mask around scene-linear middle grey follows the useful part of
  // darktable's tonal-mask approach: strong deep-shadow coverage with an early,
  // smooth falloff instead of leaking through most of the display range.
  let middleGrey = 0.18;
  let normalizedDistance = (y - middleGrey) / middleGrey;
  let logisticFalloff = 1.0 / (1.0 + exp(normalizedDistance * 4.0));
  // The sigmoid is already small here; this final guard guarantees that upper
  // midtones and highlights are completely untouched by the Shadows control.
  let highlightGuard = 1.0 - smoothstep(0.24, 0.42, y);
  return logisticFalloff * highlightGuard;
}

fn applyToneControls(rgb: vec3f) -> vec3f {
  let epsilon = 1e-6;
  let y = max(luminance(rgb), epsilon);
  let logY = log2(y);
  let blacksMask = 1.0 - smoothstep(-6.5, -3.1, logY);
  let shadowsMask = shadowsTonalMask(y);
  let highlightsMask = smoothstep(-2.2, -0.55, logY) * (1.0 - smoothstep(0.15, 1.65, logY));
  let tonalStops =
    adjustments.blacks * 0.007 * blacksMask +
    adjustments.shadows * 0.009 * shadowsMask +
    adjustments.highlights * 0.008 * highlightsMask;
  var newLogY = logY + tonalStops;
  let contrastAmount = adjustments.contrast / 100.0;
  let contrastPivot = -1.45;
  let distance = newLogY - contrastPivot;
  let rolloff = 1.0 / (1.0 + 0.09 * distance * distance);
  newLogY = newLogY + distance * contrastAmount * 0.72 * rolloff;
  let newY = exp2(newLogY);
  return rgb * (newY / y);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let encoded = textureSample(sourceTexture, sourceSampler, input.uv);
  // padding1.x marks the layered editor's premultiplied linear composite.
  // The legacy single-image input remains supported for isolated shader tests.
  let alpha = max(encoded.a, 1e-6);
  var rgb = select(srgbToLinear(encoded.rgb), encoded.rgb / alpha, adjustments.padding1.x > 0.5);
  rgb = applyChromaticAdaptation(rgb, adjustments.temperature, adjustments.tint);
  rgb *= exp2(adjustments.exposureEV);
  rgb = applyToneControls(rgb);
  return vec4f(rgb, encoded.a);
}
`;

export const DOWNSAMPLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let pixel = 1.0 / dimensions;
  let a = textureSampleLevel(sourceTexture, sourceSampler, input.uv + pixel * vec2f(-0.5, -0.5), 0.0);
  let b = textureSampleLevel(sourceTexture, sourceSampler, input.uv + pixel * vec2f(0.5, -0.5), 0.0);
  let c = textureSampleLevel(sourceTexture, sourceSampler, input.uv + pixel * vec2f(-0.5, 0.5), 0.0);
  let d = textureSampleLevel(sourceTexture, sourceSampler, input.uv + pixel * vec2f(0.5, 0.5), 0.0);
  let y = (luminance(a.rgb) + luminance(b.rgb) + luminance(c.rgb) + luminance(d.rgb)) * 0.25;
  return vec4f(y, y, y, 1.0);
}
`;

export const GAUSSIAN_BLUR_WGSL = /* wgsl */ `
struct BlurUniforms {
  direction: vec2f,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> blur: BlurUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let texel = blur.direction / vec2f(textureDimensions(sourceTexture));
  var value = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0) * 0.227027;
  value += textureSampleLevel(sourceTexture, sourceSampler, input.uv + texel * 1.384615, 0.0) * 0.316216;
  value += textureSampleLevel(sourceTexture, sourceSampler, input.uv - texel * 1.384615, 0.0) * 0.316216;
  value += textureSampleLevel(sourceTexture, sourceSampler, input.uv + texel * 3.230769, 0.0) * 0.070270;
  value += textureSampleLevel(sourceTexture, sourceSampler, input.uv - texel * 3.230769, 0.0) * 0.070270;
  return value;
}
`;

export const CREATIVE_GRADE_WGSL = /* wgsl */ `
struct Adjustments {
  temperature: f32,
  tint: f32,
  exposureEV: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,
  whites: f32,
  blacks: f32,
  clarity: f32,
  vibrance: f32,
  saturation: f32,
  texture: f32,
  dehaze: f32,
  vignette: f32,
  lift: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  curveActive: f32,
  padding1: vec2f,
  mixerHue0: vec4f,
  mixerHue1: vec4f,
  mixerSaturation0: vec4f,
  mixerSaturation1: vec4f,
  mixerLuminance0: vec4f,
  mixerLuminance1: vec4f,
  gradingHue: vec4f,
  gradingSaturation: vec4f,
  gradingLuminance: vec4f,
  gradingControls: vec4f,
  gradientMapControls: vec4f,
  gradientMapColors: array<vec4f, 8>,
  gradientMapOpacity: array<vec4f, 8>,
  photoshop: array<vec4f, 60>,
}

@group(0) @binding(0) var correctedTexture: texture_2d<f32>;
@group(0) @binding(1) var blurredLuminanceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> adjustments: Adjustments;
@group(0) @binding(4) var curveLut: texture_2d<f32>;
@group(0) @binding(5) var colorLookupLut: texture_3d<f32>;
@group(0) @binding(6) var colorVibranceWhiteBalanceLut: texture_3d<f32>;
@group(0) @binding(7) var colorVibranceColorLut: texture_3d<f32>;
@group(0) @binding(8) var colorBalanceTransferLut: texture_2d<f32>;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn linearRgbToOklab(rgb: vec3f) -> vec3f {
  let lms = mat3x3f(
    vec3f(0.4122214708, 0.2119034982, 0.0883024619),
    vec3f(0.5363325363, 0.6806995451, 0.2817188376),
    vec3f(0.0514459929, 0.1073969566, 0.6299787005)
  ) * rgb;
  let root = sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0));
  return mat3x3f(
    vec3f(0.2104542553, 1.9779984951, 0.0259040371),
    vec3f(0.7936177850, -2.4285922050, 0.7827717662),
    vec3f(-0.0040720468, 0.4505937099, -0.8086757660)
  ) * root;
}

fn oklabToLinearRgb(lab: vec3f) -> vec3f {
  let root = mat3x3f(
    vec3f(1.0, 1.0, 1.0),
    vec3f(0.3963377774, -0.1055613458, -0.0894841775),
    vec3f(0.2158037573, -0.0638541728, -1.2914855480)
  ) * lab;
  let lms = root * root * root;
  return mat3x3f(
    vec3f(4.0767416621, -1.2684380046, -0.0041960863),
    vec3f(-3.3077115913, 2.6097574011, -0.7034186147),
    vec3f(0.2309699292, -0.3413193965, 1.7076147010)
  ) * lms;
}

fn applyPerceptualColor(rgb: vec3f) -> vec3f {
  if (abs(adjustments.saturation) < 0.00001 && abs(adjustments.vibrance) < 0.00001) {
    return rgb;
  }
  var lab = linearRgbToOklab(rgb);
  let chroma = length(lab.yz);
  let saturationScale = max(0.0, 1.0 + adjustments.saturation / 100.0);
  let lowChromaWeight = 1.0 - smoothstep(0.04, 0.32, chroma);
  let vibranceScale = max(0.0, 1.0 + (adjustments.vibrance / 100.0) * (0.35 + lowChromaWeight * 0.75));
  // Some Dawn/WGSL versions reject compound assignment on writable swizzles.
  // Rebuilding the vector is equivalent and portable across those implementations.
  let chromaScale = saturationScale * vibranceScale;
  lab = vec3f(lab.x, lab.y * chromaScale, lab.z * chromaScale);
  return oklabToLinearRgb(lab);
}

fn colorMixerMagnitude() -> f32 {
  let one = vec4f(1.0);
  return
    dot(abs(adjustments.mixerHue0), one) + dot(abs(adjustments.mixerHue1), one) +
    dot(abs(adjustments.mixerSaturation0), one) + dot(abs(adjustments.mixerSaturation1), one) +
    dot(abs(adjustments.mixerLuminance0), one) + dot(abs(adjustments.mixerLuminance1), one);
}

fn colorMixerNodeValue(first: vec4f, second: vec4f, index: u32) -> f32 {
  if (index < 4u) {
    return first[index];
  }
  return second[index - 4u];
}

fn colorMixerValues(hue: f32) -> vec3f {
  // Approximate perceptual OKLCH locations of the classic eight colour ranges.
  // Positive inverse chord-distance weights form a periodic interpolating
  // Shepard curve. Unlike normalized kernel smoothing, each range therefore
  // reaches its exact slider value at its own centre without overshoot.
  let centers = array<f32, 8>(
    0.5102, 0.9211, 1.9160, 2.4870,
    -2.8846, -1.6747, -1.0368, -0.2838
  );
  var weightedValue = vec3f(0.0);
  var totalWeight = 0.0;
  for (var index = 0u; index < 8u; index += 1u) {
    let nodeValue = vec3f(
      colorMixerNodeValue(adjustments.mixerHue0, adjustments.mixerHue1, index),
      colorMixerNodeValue(adjustments.mixerSaturation0, adjustments.mixerSaturation1, index),
      colorMixerNodeValue(adjustments.mixerLuminance0, adjustments.mixerLuminance1, index)
    );
    let distance = 1.0 - cos(hue - centers[index]);
    if (distance < 0.0000001) {
      return nodeValue;
    }
    let weight = 1.0 / max(distance, 0.0000001);
    weightedValue = weightedValue + nodeValue * weight;
    totalWeight += weight;
  }
  return weightedValue / max(totalWeight, 0.0000001);
}

fn colorMixerNodeRange(first: vec4f, second: vec4f) -> f32 {
  var minimum = colorMixerNodeValue(first, second, 0u);
  var maximum = minimum;
  for (var index = 1u; index < 8u; index += 1u) {
    let value = colorMixerNodeValue(first, second, index);
    minimum = min(minimum, value);
    maximum = max(maximum, value);
  }
  return maximum - minimum;
}

fn applyColorMixer(rgb: vec3f) -> vec3f {
  if (colorMixerMagnitude() < 0.00001) {
    return rgb;
  }

  let lab = linearRgbToOklab(rgb);
  let chroma = length(lab.yz);
  // Hue is unstable around neutral greys. Fade all selective colour work in
  // only once the pixel has enough perceptual chroma to identify a range.
  let chromaProtection = smoothstep(0.012, 0.055, chroma);

  let hue = atan2(lab.z, lab.y);
  // Evaluate the shared hue selection only once per pixel for H, S and L.
  let mixerValue = colorMixerValues(hue) / 100.0;
  let hueValue = mixerValue.x;
  let saturationValue = mixerValue.y;
  let luminanceValue = mixerValue.z;

  // When all saturation nodes have the same value this is a global operation,
  // not a hue selection. It therefore does not need low-chroma protection.
  // Fade the protection back in once the nodes start describing a selective
  // curve, avoiding a visible behaviour jump for tiny differences.
  let saturationSelection = smoothstep(
    0.0,
    5.0,
    colorMixerNodeRange(adjustments.mixerSaturation0, adjustments.mixerSaturation1)
  );
  let saturationProtection = mix(1.0, chromaProtection, saturationSelection);

  let adjustedHue = hue + hueValue * 0.7853981634 * chromaProtection;
  let adjustedChroma = chroma * max(0.0, 1.0 + saturationValue * saturationProtection);
  let adjustedLightness = max(0.0, lab.x * exp2(luminanceValue * 0.9 * chromaProtection));
  return oklabToLinearRgb(vec3f(
    adjustedLightness,
    cos(adjustedHue) * adjustedChroma,
    sin(adjustedHue) * adjustedChroma
  ));
}

fn colorGradingMagnitude() -> f32 {
  let one = vec4f(1.0);
  return dot(abs(adjustments.gradingSaturation), one) + dot(abs(adjustments.gradingLuminance), one);
}

fn colorGradingTint(index: u32) -> vec2f {
  let hue = adjustments.gradingHue[index] * 0.01745329252;
  let radius = clamp(adjustments.gradingSaturation[index] / 100.0, 0.0, 1.0);
  // Slightly compress the centre for precise subtle grades while retaining a
  // useful maximum creative range near the edge of the wheel.
  let chroma = pow(radius, 1.3) * 0.13;
  return vec2f(cos(hue), sin(hue)) * chroma;
}

fn colorGradingMasks(position: f32) -> vec3f {
  let blending = clamp(adjustments.gradingControls.x / 100.0, 0.0, 1.0);
  let balance = clamp(adjustments.gradingControls.y / 100.0, -1.0, 1.0);
  // Positive Balance gives Highlights more reach by moving the same source
  // luminance upward through the three fixed, overlapping tonal functions.
  let balancedPosition = clamp(position + balance * 0.22, 0.0, 1.0);
  let width = mix(0.14, 0.42, blending);
  let centers = vec3f(0.0, 0.5, 1.0);
  let widths = vec3f(width, width * 0.82, width);
  let distance = (vec3f(balancedPosition) - centers) / widths;
  let weights = exp(-distance * distance);
  // This partition-of-unity is an important invariant: identical local wheel
  // values produce one uniform tint regardless of Blending or Balance.
  return weights / max(dot(weights, vec3f(1.0)), 0.000001);
}

fn colorGradingEndpointGuard(position: f32) -> f32 {
  // Absolute black must not emit a coloured lift and display white must remain
  // neutral. Soft perceptual ramps avoid contours around either endpoint.
  let protectBlack = smoothstep(0.0, 0.045, position);
  let protectWhite = 1.0 - smoothstep(0.94, 1.0, position);
  return protectBlack * protectWhite;
}

fn applyColorGrading(rgb: vec3f) -> vec3f {
  if (colorGradingMagnitude() < 0.00001) {
    return rgb;
  }

  // Build every mask from one immutable pre-grade luminance snapshot. The
  // 0.41012 exponent places linear 18% grey close to perceptual position 0.5,
  // and clamping protects overrange highlights before the later shoulder.
  let sourceY = max(luminance(rgb), 0.0);
  let position = clamp(pow(sourceY, 0.4101205819), 0.0, 1.0);
  let masks = colorGradingMasks(position);
  let endpointGuard = colorGradingEndpointGuard(position);

  let localTint =
    colorGradingTint(1u) * masks.x +
    colorGradingTint(2u) * masks.y +
    colorGradingTint(3u) * masks.z;
  let tint = colorGradingTint(0u) + localTint;

  let localLuminance =
    adjustments.gradingLuminance.y * masks.x +
    adjustments.gradingLuminance.z * masks.y +
    adjustments.gradingLuminance.w * masks.z;
  let luminanceAmount = clamp(
    (adjustments.gradingLuminance.x + localLuminance) / 100.0,
    -1.0,
    1.0
  );
  // Luminance is an endpoint-protected EV adjustment on linear RGB. This stays
  // well-defined for values above 1.0 and remains independent from wheel tint.
  let luminanceAdjusted = rgb * exp2(luminanceAmount * 1.25 * endpointGuard);
  let lab = linearRgbToOklab(luminanceAdjusted);
  let protectedTint = tint * endpointGuard;
  return oklabToLinearRgb(vec3f(lab.x, lab.y + protectedTint.x, lab.z + protectedTint.y));
}

fn applyLift(rgb: vec3f) -> vec3f {
  // Lift is a pedestal, not another multiplier. It deliberately runs after
  // colour transforms so it can recover their signed low-end excursions.
  // Curves still follow it and can deliberately reshape either endpoint.
  let lift = clamp(adjustments.lift / 100.0, -1.0, 1.0) * 0.16;
  return vec3f(lift) + rgb * (1.0 - lift);
}

fn linearToCurveDomain(value: f32) -> f32 {
  // A signed extension of the sRGB shaper gives the familiar visual spacing
  // of Photoshop/ACR curves without destroying negative working values.
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

fn curveDomainToLinear(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn curveLutComponent(position: f32, component: u32) -> f32 {
  let width = textureDimensions(curveLut).x;
  let scaled = clamp(position, 0.0, 1.0) * f32(width - 1u);
  let left = u32(floor(scaled));
  let right = min(left + 1u, width - 1u);
  let fraction = scaled - f32(left);
  let leftValue = textureLoad(curveLut, vec2u(left, 0u), 0)[component];
  let rightValue = textureLoad(curveLut, vec2u(right, 0u), 0)[component];
  return mix(leftValue, rightValue, fraction);
}

fn applyCurveChannel(value: f32, component: u32) -> f32 {
  let shaped = linearToCurveDomain(value);
  let width = textureDimensions(curveLut).x;
  var mapped = 0.0;
  if (shaped < 0.0) {
    let first = textureLoad(curveLut, vec2u(0u, 0u), 0)[component];
    let second = textureLoad(curveLut, vec2u(1u, 0u), 0)[component];
    mapped = first + shaped * (second - first) * f32(width - 1u);
  } else if (shaped > 1.0) {
    let last = textureLoad(curveLut, vec2u(width - 1u, 0u), 0)[component];
    let previous = textureLoad(curveLut, vec2u(width - 2u, 0u), 0)[component];
    mapped = last + (shaped - 1.0) * (last - previous) * f32(width - 1u);
  } else {
    mapped = curveLutComponent(shaped, component);
  }
  return curveDomainToLinear(mapped);
}

fn applyCustomCurves(rgb: vec3f) -> vec3f {
  if (adjustments.curveActive < 0.5) {
    return rgb;
  }
  let activeMask = u32(adjustments.curveActive + 0.5);
  // Per-channel curves establish the balance; Master then shapes the combined
  // result conventionally. Identity channels are bypassed exactly rather than
  // taking an unnecessary shaper/LUT roundtrip when another channel is active.
  var curved = rgb;
  if ((activeMask & 2u) != 0u) { curved.r = applyCurveChannel(curved.r, 1u); }
  if ((activeMask & 4u) != 0u) { curved.g = applyCurveChannel(curved.g, 2u); }
  if ((activeMask & 8u) != 0u) { curved.b = applyCurveChannel(curved.b, 3u); }
  if ((activeMask & 1u) != 0u) {
    curved = vec3f(
      applyCurveChannel(curved.r, 0u),
      applyCurveChannel(curved.g, 0u),
      applyCurveChannel(curved.b, 0u)
    );
  }
  return curved;
}

fn photoshopValue(index: u32) -> f32 {
  return adjustments.photoshop[index / 4u][index % 4u];
}

fn preservePhotoshopLuminance(source: vec3f, adjusted: vec3f) -> vec3f {
  let sourceY = luminance(source);
  let adjustedY = max(luminance(adjusted), 0.000001);
  return adjusted * sourceY / adjustedY;
}

fn photoshopBlendLuminosity(color: vec3f) -> f32 {
  return dot(color, vec3f(0.30, 0.59, 0.11));
}

fn photoshopClipBlendColor(color: vec3f) -> vec3f {
  let luminosity = photoshopBlendLuminosity(color);
  let minimum = min(color.r, min(color.g, color.b));
  let maximum = max(color.r, max(color.g, color.b));
  var clipped = color;
  if (minimum < 0.0) {
    clipped = vec3f(luminosity) + (clipped - vec3f(luminosity))
      * luminosity / max(luminosity - minimum, 0.000001);
  }
  if (maximum > 1.0) {
    clipped = vec3f(luminosity) + (clipped - vec3f(luminosity))
      * (1.0 - luminosity) / max(maximum - luminosity, 0.000001);
  }
  return clipped;
}

fn photoshopSetBlendLuminosity(color: vec3f, targetLuminosity: f32) -> vec3f {
  return photoshopClipBlendColor(color + vec3f(targetLuminosity - photoshopBlendLuminosity(color)));
}

fn photoshopSelectiveColorRange(
  encoded: vec3f,
  scale: f32,
  rangeIndex: u32,
  relative: bool
) -> vec3f {
  let base = 59u + rangeIndex * 4u;
  let cmy = vec3f(
    photoshopValue(base),
    photoshopValue(base + 1u),
    photoshopValue(base + 2u)
  ) / 100.0;
  let black = photoshopValue(base + 3u) / 100.0;
  var correction = (-vec3f(1.0) - cmy) * black - cmy;
  correction = select(correction, correction * (vec3f(1.0) - encoded), relative);
  return clamp(correction, -encoded, vec3f(1.0) - encoded) * max(scale, 0.0);
}

fn photoshopLinearToEncodedChannel(value: f32) -> f32 {
  if (value <= 0.0031308) { return value * 12.92; }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

fn photoshopEncodedToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn photoshopLinearSrgbToEncodedDocument(rgb: vec3f) -> vec3f {
  if (photoshopValue(${PHOTOSHOP_BLEND_PROFILE_RELATIVE_OFFSET}u) > 0.5) {
    let adobe = vec3f(
      0.71516271 * rgb.r + 0.28483729 * rgb.g,
      rgb.g,
      0.04117054 * rgb.g + 0.95882946 * rgb.b
    );
    return pow(max(adobe, vec3f(0.0)), vec3f(256.0 / 563.0));
  }
  return vec3f(
    photoshopLinearToEncodedChannel(rgb.r),
    photoshopLinearToEncodedChannel(rgb.g),
    photoshopLinearToEncodedChannel(rgb.b)
  );
}

fn photoshopEncodedDocumentToLinearSrgb(encoded: vec3f) -> vec3f {
  if (photoshopValue(${PHOTOSHOP_BLEND_PROFILE_RELATIVE_OFFSET}u) > 0.5) {
    let adobe = pow(max(encoded, vec3f(0.0)), vec3f(563.0 / 256.0));
    return vec3f(
      1.39835574 * adobe.r - 0.39835574 * adobe.g,
      adobe.g,
      -0.0429288 * adobe.g + 1.0429288 * adobe.b
    );
  }
  return vec3f(
    photoshopEncodedToLinearChannel(encoded.r),
    photoshopEncodedToLinearChannel(encoded.g),
    photoshopEncodedToLinearChannel(encoded.b)
  );
}

fn photoshopLinearSrgbToLinearDocument(rgb: vec3f) -> vec3f {
  if (photoshopValue(${PHOTOSHOP_BLEND_PROFILE_RELATIVE_OFFSET}u) > 0.5) {
    return vec3f(
      0.71516271 * rgb.r + 0.28483729 * rgb.g,
      rgb.g,
      0.04117054 * rgb.g + 0.95882946 * rgb.b
    );
  }
  return rgb;
}

fn photoshopLinearDocumentToLinearSrgb(rgb: vec3f) -> vec3f {
  if (photoshopValue(${PHOTOSHOP_BLEND_PROFILE_RELATIVE_OFFSET}u) > 0.5) {
    return vec3f(
      1.39835574 * rgb.r - 0.39835574 * rgb.g,
      rgb.g,
      -0.0429288 * rgb.g + 1.0429288 * rgb.b
    );
  }
  return rgb;
}

fn photoshopVibranceHue(rgb: vec3f, maximum: f32, chroma: f32) -> f32 {
  if (chroma <= 0.000001) { return 0.0; }
  var hue = 0.0;
  if (maximum == rgb.r) { hue = ((rgb.g - rgb.b) / chroma) / 6.0; }
  else if (maximum == rgb.g) { hue = ((rgb.b - rgb.r) / chroma + 2.0) / 6.0; }
  else { hue = ((rgb.r - rgb.g) / chroma + 4.0) / 6.0; }
  return hue - floor(hue);
}

fn applyPhotoshopVibrance(source: vec3f) -> vec3f {
  let vibrance = clamp(photoshopValue(${PHOTOSHOP_VIBRANCE_RELATIVE_OFFSET}u), -100.0, 100.0);
  let saturation = clamp(photoshopValue(${PHOTOSHOP_VIBRANCE_RELATIVE_OFFSET + 1}u), -100.0, 100.0);
  if (abs(vibrance) < 0.00001 && abs(saturation) < 0.00001) { return source; }

  // The Photoshop oracle shows that Vibrance operates in linear document RGB,
  // preserves hue, and approaches a saturation-dependent endpoint. Positive
  // values protect both already-saturated colours and the magenta-to-orange
  // skin-tone arc. Negative values use a separate, gentler endpoint.
  var rgb = photoshopLinearSrgbToLinearDocument(source);
  if (abs(vibrance) >= 0.00001) {
    let maximum = max(rgb.r, max(rgb.g, rgb.b));
    let minimum = min(rgb.r, min(rgb.g, rgb.b));
    let chroma = maximum - minimum;
    let sourceSaturation = chroma / max(maximum, 0.000001);
    let hue = photoshopVibranceHue(rgb, maximum, chroma);
    let redArcDistance = min(hue, 1.0 - hue);
    let skinProtection = max(0.0, 1.0 - redArcDistance / (75.0 / 360.0));
    let endpointScale = select(
      1.0 + sourceSaturation * (1.0 - sourceSaturation) * (1.0 - 0.2 * skinProtection),
      0.34 + 0.4 * sourceSaturation,
      vibrance < 0.0
    );
    let endpoint = clamp(
      vec3f(maximum) + (rgb - vec3f(maximum)) * endpointScale,
      vec3f(0.0),
      vec3f(1.0)
    );
    rgb = mix(rgb, endpoint, abs(vibrance) / 100.0);
  }

  // Photoshop's Saturation control is not its Hue/Saturation adjustment.
  // Across the complete RGB lattice it is a linear-light chroma scale around
  // this measured document-space axis; Vibrance is evaluated first.
  if (abs(saturation) >= 0.00001) {
    let gray = 0.2882153 * rgb.r + 0.7127024 * rgb.g;
    rgb = clamp(rgb + (rgb - vec3f(gray)) * (saturation / 100.0), vec3f(0.0), vec3f(1.0));
  }
  return photoshopLinearDocumentToLinearSrgb(rgb);
}

fn photoshopLinearSrgbToD50Xyz(rgb: vec3f) -> vec3f {
  return vec3f(
    dot(rgb, vec3f(0.43607464, 0.38506491, 0.14308038)),
    dot(rgb, vec3f(0.22250452, 0.71687864, 0.06061694)),
    dot(rgb, vec3f(0.01393217, 0.09710450, 0.71417326))
  );
}

fn photoshopD50XyzToLinearSrgb(xyz: vec3f) -> vec3f {
  return vec3f(
    dot(xyz, vec3f(3.13385693, -1.61686703, -0.49061471)),
    dot(xyz, vec3f(-0.97876877, 1.91614159, 0.03345403)),
    dot(xyz, vec3f(0.07194530, -0.22899134, 1.40524274))
  );
}

fn photoshopRgbToHsl(rgb: vec3f) -> vec3f {
  let maximum = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let chroma = maximum - minimum;
  let lightness = (maximum + minimum) * 0.5;
  if (chroma <= 0.000001) { return vec3f(0.0, 0.0, lightness); }
  let saturation = chroma / max(0.000001, 1.0 - abs(2.0 * lightness - 1.0));
  var hue = 0.0;
  if (maximum == rgb.r) {
    hue = (rgb.g - rgb.b) / chroma;
  } else if (maximum == rgb.g) {
    hue = (rgb.b - rgb.r) / chroma + 2.0;
  } else {
    hue = (rgb.r - rgb.g) / chroma + 4.0;
  }
  return vec3f(fract(hue / 6.0), saturation, lightness);
}

fn photoshopHueToRgb(p: f32, q: f32, hue: f32) -> f32 {
  let wrapped = fract(hue);
  if (wrapped < 1.0 / 6.0) { return p + (q - p) * 6.0 * wrapped; }
  if (wrapped < 0.5) { return q; }
  if (wrapped < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - wrapped) * 6.0; }
  return p;
}

fn photoshopHslToRgb(hsl: vec3f) -> vec3f {
  if (hsl.y <= 0.000001) { return vec3f(hsl.z); }
  let q = select(hsl.z * (1.0 + hsl.y), hsl.z + hsl.y - hsl.z * hsl.y, hsl.z >= 0.5);
  let p = 2.0 * hsl.z - q;
  return vec3f(
    photoshopHueToRgb(p, q, hsl.x + 1.0 / 3.0),
    photoshopHueToRgb(p, q, hsl.x),
    photoshopHueToRgb(p, q, hsl.x - 1.0 / 3.0)
  );
}

fn photoshopHueRangeWeight(hueDegrees: f32, boundaries: vec4f) -> f32 {
  let position = fract((hueDegrees - boundaries.x) / 360.0) * 360.0;
  let beginSustain = fract((boundaries.y - boundaries.x) / 360.0) * 360.0;
  let endSustain = fract((boundaries.z - boundaries.x) / 360.0) * 360.0;
  let endRamp = fract((boundaries.w - boundaries.x) / 360.0) * 360.0;
  if (position > endRamp) { return 0.0; }
  if (position < beginSustain) { return position / max(beginSustain, 0.000001); }
  if (position <= endSustain) { return 1.0; }
  return (endRamp - position) / max(endRamp - endSustain, 0.000001);
}

fn photoshopApplyHueSaturation(
  encoded: vec3f,
  hueAmount: f32,
  saturationAmount: f32,
  lightnessAmount: f32,
  colorize: bool,
  localRange: bool
) -> vec3f {
  var lightAdjusted = select(
    encoded + (vec3f(1.0) - encoded) * lightnessAmount,
    encoded * (1.0 + lightnessAmount),
    lightnessAmount < 0.0
  );
  if (localRange) {
    let darkest = min(encoded.r, min(encoded.g, encoded.b));
    let lightest = max(encoded.r, max(encoded.g, encoded.b));
    lightAdjusted = select(
      mix(encoded, vec3f(lightest), lightnessAmount),
      mix(encoded, vec3f(darkest), -lightnessAmount),
      lightnessAmount < 0.0
    );
  }
  var hsl = photoshopRgbToHsl(clamp(lightAdjusted, vec3f(0.0), vec3f(1.0)));
  if (colorize) {
    hsl = vec3f(fract(hueAmount / 360.0), clamp(saturationAmount, 0.0, 1.0), hsl.z);
  } else {
    let saturated = select(
      hsl.y / max(0.000001, 1.0 - saturationAmount),
      hsl.y * (1.0 + saturationAmount),
      saturationAmount < 0.0
    );
    hsl = vec3f(fract(hsl.x + hueAmount / 360.0), clamp(saturated, 0.0, 1.0), hsl.z);
  }
  return photoshopHslToRgb(hsl);
}

fn photoshopMeasuredColorBalanceChannel(value: f32, tone: u32, amount: f32) -> f32 {
  let code = clamp(value, 0.0, 1.0) * 255.0;
  let parameterPosition = (clamp(amount, -100.0, 100.0) + 100.0) / 10.0;
  let row = f32(tone * 21u) + parameterPosition;
  return textureSampleLevel(
    colorBalanceTransferLut,
    sourceSampler,
    vec2f((code + 0.5) / 256.0, (row + 0.5) / 206.0),
    0.0
  ).r;
}

fn photoshopApplyMeasuredColorBalanceTone(color: vec3f, amounts: vec3f, tone: u32) -> vec3f {
  return vec3f(
    photoshopMeasuredColorBalanceChannel(color.r, tone, amounts.r),
    photoshopMeasuredColorBalanceChannel(color.g, tone, amounts.g),
    photoshopMeasuredColorBalanceChannel(color.b, tone, amounts.b)
  );
}

fn photoshopMeasuredPreserveColorBalanceChannel(value: f32, tone: u32, amount: f32) -> f32 {
  let code = clamp(value, 0.0, 1.0) * 255.0;
  var row = 63.0 + clamp(-amount, 0.0, 200.0) / 20.0;
  if (tone == 2u) {
    row = 74.0 + clamp(amount, 0.0, 200.0) / 20.0;
  }
  return textureSampleLevel(
    colorBalanceTransferLut,
    sourceSampler,
    vec2f((code + 0.5) / 256.0, (row + 0.5) / 206.0),
    0.0
  ).r;
}

fn photoshopSamplePreserveColorBalanceOverlapRow(value: f32, row: f32) -> f32 {
  let code = clamp(value, 0.0, 1.0) * 255.0;
  return textureSampleLevel(
    colorBalanceTransferLut,
    sourceSampler,
    vec2f((code + 0.5) / 256.0, (row + 0.5) / 206.0),
    0.0
  ).r;
}

fn photoshopMeasuredPreserveColorBalanceOverlapChannel(
  value: f32,
  shadowAmount: f32,
  highlightAmount: f32
) -> f32 {
  let shadowPosition = clamp(-shadowAmount, 0.0, 200.0) / 20.0;
  let highlightPosition = clamp(highlightAmount, 0.0, 200.0) / 20.0;
  let shadowLow = min(floor(shadowPosition), 9.0);
  let highlightLow = min(floor(highlightPosition), 9.0);
  let shadowFraction = shadowPosition - shadowLow;
  let highlightFraction = highlightPosition - highlightLow;
  let row00 = 85.0 + shadowLow * 11.0 + highlightLow;
  let low = mix(
    photoshopSamplePreserveColorBalanceOverlapRow(value, row00),
    photoshopSamplePreserveColorBalanceOverlapRow(value, row00 + 1.0),
    highlightFraction
  );
  let high = mix(
    photoshopSamplePreserveColorBalanceOverlapRow(value, row00 + 11.0),
    photoshopSamplePreserveColorBalanceOverlapRow(value, row00 + 12.0),
    highlightFraction
  );
  return mix(low, high, shadowFraction);
}

fn photoshopApplyMeasuredPreserveColorBalanceOverlap(
  color: vec3f,
  shadows: vec3f,
  highlights: vec3f
) -> vec3f {
  return vec3f(
    photoshopMeasuredPreserveColorBalanceOverlapChannel(color.r, shadows.r, highlights.r),
    photoshopMeasuredPreserveColorBalanceOverlapChannel(color.g, shadows.g, highlights.g),
    photoshopMeasuredPreserveColorBalanceOverlapChannel(color.b, shadows.b, highlights.b)
  );
}

fn photoshopApplyMeasuredPreserveColorBalanceTone(
  color: vec3f,
  amounts: vec3f,
  tone: u32
) -> vec3f {
  return vec3f(
    photoshopMeasuredPreserveColorBalanceChannel(color.r, tone, amounts.r),
    photoshopMeasuredPreserveColorBalanceChannel(color.g, tone, amounts.g),
    photoshopMeasuredPreserveColorBalanceChannel(color.b, tone, amounts.b)
  );
}

fn samplePhotoshopBrightnessContrastLut(value: f32) -> f32 {
  let code = clamp(value, 0.0, 1.0) * 255.0;
  var left = 63u;
  var fraction = (code - 252.0) / 3.0;
  if (code < 252.0) {
    let position = code / 4.0;
    left = u32(floor(position));
    fraction = position - f32(left);
  }
  return mix(
    photoshopValue(${PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_RELATIVE_OFFSET}u + left),
    photoshopValue(${PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_RELATIVE_OFFSET + 1}u + left),
    fraction
  );
}

fn applyPhotoshopLevelsChannel(value: f32, parameterOffset: u32) -> f32 {
  let black = photoshopValue(parameterOffset) / 255.0;
  let gamma = max(photoshopValue(parameterOffset + 1u), 0.01);
  let white = max(photoshopValue(parameterOffset + 2u) / 255.0, black + 0.000001);
  let outputBlack = photoshopValue(parameterOffset + 3u) / 255.0;
  let outputWhite = photoshopValue(parameterOffset + 4u) / 255.0;
  let normalized = clamp((value - black) / (white - black), 0.0, 1.0);
  return mix(outputBlack, outputWhite, pow(normalized, 1.0 / gamma));
}

fn sampleExternalColorLookup(source: vec3f) -> vec3f {
  let encoded = vec3f(
    photoshopLinearToEncodedChannel(source.r),
    photoshopLinearToEncodedChannel(source.g),
    photoshopLinearToEncodedChannel(source.b)
  );
  let domainMin = vec3f(photoshopValue(99u), photoshopValue(100u), photoshopValue(101u));
  let domainMax = vec3f(photoshopValue(102u), photoshopValue(103u), photoshopValue(104u));
  let position = clamp((encoded - domainMin) / max(domainMax - domainMin, vec3f(0.000001)), vec3f(0.0), vec3f(1.0));
  let dimensions = textureDimensions(colorLookupLut);
  let scaled = position * vec3f(dimensions - vec3u(1u));
  let lower = vec3u(floor(scaled));
  let upper = min(lower + vec3u(1u), dimensions - vec3u(1u));
  let fraction = scaled - vec3f(lower);
  let z0y0 = mix(
    textureLoad(colorLookupLut, vec3u(lower.x, lower.y, lower.z), 0).rgb,
    textureLoad(colorLookupLut, vec3u(upper.x, lower.y, lower.z), 0).rgb,
    fraction.x
  );
  let z0y1 = mix(
    textureLoad(colorLookupLut, vec3u(lower.x, upper.y, lower.z), 0).rgb,
    textureLoad(colorLookupLut, vec3u(upper.x, upper.y, lower.z), 0).rgb,
    fraction.x
  );
  let z1y0 = mix(
    textureLoad(colorLookupLut, vec3u(lower.x, lower.y, upper.z), 0).rgb,
    textureLoad(colorLookupLut, vec3u(upper.x, lower.y, upper.z), 0).rgb,
    fraction.x
  );
  let z1y1 = mix(
    textureLoad(colorLookupLut, vec3u(lower.x, upper.y, upper.z), 0).rgb,
    textureLoad(colorLookupLut, vec3u(upper.x, upper.y, upper.z), 0).rgb,
    fraction.x
  );
  let mapped = mix(mix(z0y0, z0y1, fraction.y), mix(z1y0, z1y1, fraction.y), fraction.z);
  return vec3f(
    photoshopEncodedToLinearChannel(mapped.r),
    photoshopEncodedToLinearChannel(mapped.g),
    photoshopEncodedToLinearChannel(mapped.b)
  );
}

fn sampleUnitColorLookup(lut: texture_3d<f32>, encoded: vec3f) -> vec3f {
  let dimensions = textureDimensions(lut);
  let scaled = clamp(encoded, vec3f(0.0), vec3f(1.0)) * vec3f(dimensions - vec3u(1u));
  let lower = vec3u(floor(scaled));
  let upper = min(lower + vec3u(1u), dimensions - vec3u(1u));
  let fraction = scaled - vec3f(lower);
  let z0y0 = mix(
    textureLoad(lut, vec3u(lower.x, lower.y, lower.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, lower.y, lower.z), 0).rgb,
    fraction.x
  );
  let z0y1 = mix(
    textureLoad(lut, vec3u(lower.x, upper.y, lower.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, upper.y, lower.z), 0).rgb,
    fraction.x
  );
  let z1y0 = mix(
    textureLoad(lut, vec3u(lower.x, lower.y, upper.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, lower.y, upper.z), 0).rgb,
    fraction.x
  );
  let z1y1 = mix(
    textureLoad(lut, vec3u(lower.x, upper.y, upper.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, upper.y, upper.z), 0).rgb,
    fraction.x
  );
  return mix(mix(z0y0, z0y1, fraction.y), mix(z1y0, z1y1, fraction.y), fraction.z);
}

fn sampleExtendedUnitColorLookup(lut: texture_3d<f32>, encoded: vec3f) -> vec3f {
  let dimensions = textureDimensions(lut);
  let scaled = encoded * vec3f(dimensions - vec3u(1u));
  let lowerFloat = clamp(
    floor(scaled),
    vec3f(0.0),
    vec3f(dimensions - vec3u(2u))
  );
  let lower = vec3u(lowerFloat);
  let upper = lower + vec3u(1u);
  let fraction = scaled - lowerFloat;
  let z0y0 = mix(
    textureLoad(lut, vec3u(lower.x, lower.y, lower.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, lower.y, lower.z), 0).rgb,
    fraction.x
  );
  let z0y1 = mix(
    textureLoad(lut, vec3u(lower.x, upper.y, lower.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, upper.y, lower.z), 0).rgb,
    fraction.x
  );
  let z1y0 = mix(
    textureLoad(lut, vec3u(lower.x, lower.y, upper.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, lower.y, upper.z), 0).rgb,
    fraction.x
  );
  let z1y1 = mix(
    textureLoad(lut, vec3u(lower.x, upper.y, upper.z), 0).rgb,
    textureLoad(lut, vec3u(upper.x, upper.y, upper.z), 0).rgb,
    fraction.x
  );
  return mix(mix(z0y0, z0y1, fraction.y), mix(z1y0, z1y1, fraction.y), fraction.z);
}

fn applyPhotoshopColorVibrance(source: vec3f) -> vec3f {
  var encoded = photoshopLinearSrgbToEncodedDocument(source);
  encoded = clamp(
    sampleUnitColorLookup(colorVibranceWhiteBalanceLut, encoded),
    vec3f(-${PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_CODES}.0 / 255.0),
    vec3f(${255 + PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_CODES}.0 / 255.0)
  );
  encoded = sampleExtendedUnitColorLookup(colorVibranceColorLut, encoded);
  return photoshopEncodedDocumentToLinearSrgb(encoded);
}

fn applyPhotoshopAdjustment(source: vec3f) -> vec3f {
  let kind = u32(photoshopValue(0u) + 0.5);
  if (kind == 0u) { return source; }
  var rgb = source;
  if (kind == 1u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    var adjusted = vec3f(
      samplePhotoshopBrightnessContrastLut(encoded.r),
      samplePhotoshopBrightnessContrastLut(encoded.g),
      samplePhotoshopBrightnessContrastLut(encoded.b)
    );
    if (photoshopValue(3u) > 0.5) {
      let brightness = photoshopValue(1u) / 255.0;
      let contrast = clamp(photoshopValue(2u), -100.0, 100.0);
      let pivot = 127.0 / 255.0;
      let contrastInput = select(encoded, encoded + vec3f(brightness), brightness >= 0.0);
      if (contrast >= 100.0) {
        adjusted = select(
          vec3f(0.0),
          vec3f(1.0),
          contrastInput >= vec3f(126.5 / 255.0)
        );
      } else {
        let factor = select(
          1.0 + contrast / 100.0,
          1.0 / max(1.0 - contrast / 100.0, 0.0001),
          contrast >= 0.0
        );
        adjusted = (contrastInput - vec3f(pivot)) * factor + vec3f(pivot);
      }
      if (brightness < 0.0) { adjusted = adjusted + vec3f(brightness); }
    }
    return photoshopEncodedDocumentToLinearSrgb(clamp(adjusted, vec3f(0.0), vec3f(1.0)));
  }
  if (kind == 2u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    var adjusted = vec3f(
      applyPhotoshopLevelsChannel(encoded.r, ${PHOTOSHOP_LEVELS_CHANNELS_RELATIVE_OFFSET}u),
      applyPhotoshopLevelsChannel(encoded.g, ${PHOTOSHOP_LEVELS_CHANNELS_RELATIVE_OFFSET + 5}u),
      applyPhotoshopLevelsChannel(encoded.b, ${PHOTOSHOP_LEVELS_CHANNELS_RELATIVE_OFFSET + 10}u)
    );
    adjusted = vec3f(
      applyPhotoshopLevelsChannel(adjusted.r, 4u),
      applyPhotoshopLevelsChannel(adjusted.g, 4u),
      applyPhotoshopLevelsChannel(adjusted.b, 4u)
    );
    return photoshopEncodedDocumentToLinearSrgb(adjusted);
  }
  if (kind == 3u) {
    // Photoshop Exposure uses a power-2.2 encoded-light bridge even in an
    // sRGB document. Exposure and Offset operate inside that bridge; Gamma
    // Correction operates on the encoded result. Keeping this node-specific
    // avoids changing LightTable's linear-light Grade pipeline.
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    let photoshopLinear = pow(max(encoded, vec3f(0.0)), vec3f(2.2));
    let exposed = photoshopLinear * exp2(photoshopValue(9u)) + vec3f(photoshopValue(10u));
    let gamma = max(photoshopValue(11u), 0.01);
    let correctedEncoded = pow(max(exposed, vec3f(0.0)), vec3f(1.0 / (2.2 * gamma)));
    return photoshopEncodedDocumentToLinearSrgb(correctedEncoded);
  }
  if (kind == 4u) {
    let hueAmount = photoshopValue(12u);
    let saturationAmount = photoshopValue(13u) / 100.0;
    let lightnessAmount = photoshopValue(14u) / 100.0;
    let colorize = photoshopValue(15u) > 0.5;
    if (!colorize && abs(hueAmount) < 0.00001 && abs(saturationAmount) < 0.00001 && abs(lightnessAmount) < 0.00001) {
      var rangesNeutral = true;
      for (var neutralIndex = 0u; neutralIndex < 6u; neutralIndex += 1u) {
        let neutralBase = ${PHOTOSHOP_HUE_SATURATION_RANGES_RELATIVE_OFFSET}u + neutralIndex * 7u;
        rangesNeutral = rangesNeutral
          && abs(photoshopValue(neutralBase + 4u)) < 0.00001
          && abs(photoshopValue(neutralBase + 5u)) < 0.00001
          && abs(photoshopValue(neutralBase + 6u)) < 0.00001;
      }
      if (rangesNeutral) { return rgb; }
    }
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    var adjusted = photoshopApplyHueSaturation(encoded, hueAmount, saturationAmount, lightnessAmount, colorize, false);
    if (!colorize) {
      let selectionHsl = photoshopRgbToHsl(clamp(encoded, vec3f(0.0), vec3f(1.0)));
      for (var rangeIndex = 0u; rangeIndex < 6u; rangeIndex += 1u) {
        let base = ${PHOTOSHOP_HUE_SATURATION_RANGES_RELATIVE_OFFSET}u + rangeIndex * 7u;
        let boundaries = vec4f(
          photoshopValue(base), photoshopValue(base + 1u),
          photoshopValue(base + 2u), photoshopValue(base + 3u)
        );
        let weight = photoshopHueRangeWeight(selectionHsl.x * 360.0, boundaries)
          * select(0.0, 1.0, selectionHsl.y > 0.000001);
        if (weight > 0.0) {
          adjusted = photoshopApplyHueSaturation(
            adjusted,
            photoshopValue(base + 4u) * weight,
            photoshopValue(base + 5u) / 100.0 * weight,
            photoshopValue(base + 6u) / 100.0 * weight,
            false,
            true
          );
        }
      }
    }
    return photoshopEncodedDocumentToLinearSrgb(adjusted);
  }
  if (kind == 5u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    var shadows = vec3f(photoshopValue(16u), photoshopValue(17u), photoshopValue(18u));
    var midtones = vec3f(photoshopValue(19u), photoshopValue(20u), photoshopValue(21u));
    var highlights = vec3f(photoshopValue(22u), photoshopValue(23u), photoshopValue(24u));
    if (photoshopValue(25u) > 0.5) {
      // Preserve Luminosity removes the neutral component before applying
      // the curves. Photoshop anchors shadows at the strongest authored
      // channel, highlights at the weakest, and midtones halfway between.
      // This keeps the useful tonal endpoint stable instead of repairing
      // luminance after clipping has already occurred.
      let shadowMaximum = max(shadows.r, max(shadows.g, shadows.b));
      shadows -= vec3f(shadowMaximum);
      let midtoneMinimum = min(midtones.r, min(midtones.g, midtones.b));
      let midtoneMaximum = max(midtones.r, max(midtones.g, midtones.b));
      midtones -= vec3f((midtoneMinimum + midtoneMaximum) * 0.5);
      let highlightMinimum = min(highlights.r, min(highlights.g, highlights.b));
      highlights -= vec3f(highlightMinimum);
    }
    var adjusted = encoded;
    if (photoshopValue(25u) > 0.5) {
      let shadowHighlightOverlap =
        (abs(shadows.r) > 0.000001 && abs(highlights.r) > 0.000001)
        || (abs(shadows.g) > 0.000001 && abs(highlights.g) > 0.000001)
        || (abs(shadows.b) > 0.000001 && abs(highlights.b) > 0.000001);
      if (shadowHighlightOverlap) {
        adjusted = photoshopApplyMeasuredPreserveColorBalanceOverlap(
          adjusted, shadows, highlights
        );
        adjusted = photoshopApplyMeasuredColorBalanceTone(adjusted, midtones, 1u);
      } else {
        adjusted = photoshopApplyMeasuredPreserveColorBalanceTone(adjusted, shadows, 0u);
        adjusted = photoshopApplyMeasuredPreserveColorBalanceTone(adjusted, highlights, 2u);
        adjusted = photoshopApplyMeasuredColorBalanceTone(adjusted, midtones, 1u);
      }
    } else {
      adjusted = photoshopApplyMeasuredColorBalanceTone(adjusted, shadows, 0u);
      adjusted = photoshopApplyMeasuredColorBalanceTone(adjusted, midtones, 1u);
      adjusted = photoshopApplyMeasuredColorBalanceTone(adjusted, highlights, 2u);
    }
    return photoshopEncodedDocumentToLinearSrgb(adjusted);
  }
  if (kind == 6u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    let maximum = max(encoded.r, max(encoded.g, encoded.b));
    let minimum = min(encoded.r, min(encoded.g, encoded.b));
    let chroma = maximum - minimum;
    var hue = 0.0;
    if (chroma > 0.000001) {
      if (maximum == encoded.r) { hue = ((encoded.g - encoded.b) / chroma) / 6.0; }
      else if (maximum == encoded.g) { hue = ((encoded.b - encoded.r) / chroma + 2.0) / 6.0; }
      else { hue = ((encoded.r - encoded.g) / chroma + 4.0) / 6.0; }
      hue = hue - floor(hue);
    }
    var authoredMix = 0.0;
    for (var index = 0u; index < 6u; index += 1u) {
      let center = f32(index) / 6.0;
      let distance = min(abs(hue - center), 1.0 - abs(hue - center));
      let weight = max(0.0, 1.0 - distance * 6.0);
      authoredMix += weight * photoshopValue(26u + index);
    }
    let gray = clamp(minimum + chroma * authoredMix / 100.0, 0.0, 1.0);
    var result = vec3f(gray);
    if (photoshopValue(32u) > 0.5) {
      let encodedTintSrgb = vec3f(photoshopValue(33u), photoshopValue(34u), photoshopValue(35u));
      let linearTintSrgb = vec3f(
        photoshopEncodedToLinearChannel(encodedTintSrgb.r),
        photoshopEncodedToLinearChannel(encodedTintSrgb.g),
        photoshopEncodedToLinearChannel(encodedTintSrgb.b)
      );
      let encodedTint = photoshopLinearSrgbToEncodedDocument(linearTintSrgb);
      result = photoshopSetBlendLuminosity(encodedTint, gray);
    }
    return photoshopEncodedDocumentToLinearSrgb(result);
  }
  if (kind == 7u) {
    let encodedFilter = vec3f(photoshopValue(37u), photoshopValue(38u), photoshopValue(39u));
    let linearFilter = photoshopEncodedDocumentToLinearSrgb(encodedFilter);
    let density = clamp(photoshopValue(41u) / 100.0, 0.0, 1.0);

    // Photoshop models the filter as physical transmittance in its D50 profile
    // connection space. Density interpolates each XYZ transmission from white;
    // this is why saturated source colors are coupled across RGB channels.
    let d50White = vec3f(0.96422, 1.0, 0.82521);
    let filterXyz = photoshopLinearSrgbToD50Xyz(linearFilter);
    let transmission = mix(vec3f(1.0), filterXyz / d50White, density);
    let filtered = photoshopD50XyzToLinearSrgb(
      photoshopLinearSrgbToD50Xyz(rgb) * transmission
    );
    if (photoshopValue(25u) <= 0.5) { return filtered; }

    // Preserve Luminosity is Photoshop's non-separable SetLum/ClipColor
    // operation in the encoded document space, not a linear-light scale.
    let encodedSource = photoshopLinearSrgbToEncodedDocument(rgb);
    let encodedFiltered = clamp(
      photoshopLinearSrgbToEncodedDocument(filtered),
      vec3f(0.0),
      vec3f(1.0)
    );
    let preserved = photoshopSetBlendLuminosity(
      encodedFiltered,
      photoshopBlendLuminosity(encodedSource)
    );
    return photoshopEncodedDocumentToLinearSrgb(preserved);
  }
  if (kind == 8u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    let red = dot(encoded, vec3f(photoshopValue(43u), photoshopValue(44u), photoshopValue(45u)) / 100.0) + photoshopValue(46u) / 100.0;
    let green = dot(encoded, vec3f(photoshopValue(47u), photoshopValue(48u), photoshopValue(49u)) / 100.0) + photoshopValue(50u) / 100.0;
    let blue = dot(encoded, vec3f(photoshopValue(51u), photoshopValue(52u), photoshopValue(53u)) / 100.0) + photoshopValue(54u) / 100.0;
    let mixed = select(vec3f(red, green, blue), vec3f(red), photoshopValue(55u) > 0.5);
    return photoshopEncodedDocumentToLinearSrgb(clamp(mixed, vec3f(0.0), vec3f(1.0)));
  }
  if (kind == 9u) {
    if (photoshopValue(56u) > 0.5) { return sampleExternalColorLookup(rgb); }
    let preset = u32(photoshopValue(98u) + 0.5);
    if (preset == 1u) {
      let mapped = vec3f(
        dot(rgb, vec3f(1.08, -0.03, -0.01)),
        dot(rgb, vec3f(-0.02, 1.03, 0.01)),
        dot(rgb, vec3f(0.01, -0.04, 0.94))
      );
      return pow(max(mapped, vec3f(0.0)), vec3f(0.94));
    }
    if (preset == 2u) {
      let y = luminance(rgb);
      return mix(rgb, vec3f(y * 0.62, y * 0.76, y * 1.08), 0.55);
    }
    if (preset == 3u) {
      let y = clamp(luminance(rgb), 0.0, 1.0);
      let shadows = vec3f(0.02, 0.14, 0.16) * (1.0 - y);
      let highlights = vec3f(0.18, 0.07, -0.03) * y;
      return rgb + shadows + highlights;
    }
    return rgb;
  }
  if (kind == 10u) {
    let encoded = clamp(photoshopLinearSrgbToEncodedDocument(rgb), vec3f(0.0), vec3f(1.0));
    let minimum = min(encoded.r, min(encoded.g, encoded.b));
    let maximum = max(encoded.r, max(encoded.g, encoded.b));
    let middle = encoded.r + encoded.g + encoded.b - minimum - maximum;
    let relative = photoshopValue(58u) < 0.5;
    var correction = vec3f(0.0);
    if (encoded.r == maximum) { correction += photoshopSelectiveColorRange(encoded, maximum - middle, 0u, relative); }
    if (encoded.b == minimum) { correction += photoshopSelectiveColorRange(encoded, middle - minimum, 1u, relative); }
    if (encoded.g == maximum) { correction += photoshopSelectiveColorRange(encoded, maximum - middle, 2u, relative); }
    if (encoded.r == minimum) { correction += photoshopSelectiveColorRange(encoded, middle - minimum, 3u, relative); }
    if (encoded.b == maximum) { correction += photoshopSelectiveColorRange(encoded, maximum - middle, 4u, relative); }
    if (encoded.g == minimum) { correction += photoshopSelectiveColorRange(encoded, middle - minimum, 5u, relative); }
    if (all(encoded > vec3f(0.5))) {
      correction += photoshopSelectiveColorRange(encoded, minimum * 2.0 - 1.0, 6u, relative);
    }
    if (any(encoded > vec3f(0.0)) && any(encoded < vec3f(1.0))) {
      let neutralScale = 1.0 - 0.5 * (abs(maximum * 2.0 - 1.0) + abs(minimum * 2.0 - 1.0));
      correction += photoshopSelectiveColorRange(encoded, neutralScale, 7u, relative);
    }
    if (all(encoded < vec3f(0.5))) {
      correction += photoshopSelectiveColorRange(encoded, 1.0 - maximum * 2.0, 8u, relative);
    }
    return photoshopEncodedDocumentToLinearSrgb(clamp(encoded + correction, vec3f(0.0), vec3f(1.0)));
  }
  if (kind == 11u) {
    let encoded = photoshopLinearSrgbToEncodedDocument(rgb);
    return photoshopEncodedDocumentToLinearSrgb(vec3f(1.0) - encoded);
  }
  if (kind == 12u) {
    let levels = max(2.0, photoshopValue(95u));
    let encoded = clamp(photoshopLinearSrgbToEncodedDocument(rgb), vec3f(0.0), vec3f(1.0));
    let buckets = clamp(ceil(encoded * levels) - vec3f(1.0), vec3f(0.0), vec3f(levels - 1.0));
    return photoshopEncodedDocumentToLinearSrgb(buckets / (levels - 1.0));
  }
  if (kind == 13u) {
    let level = photoshopValue(96u);
    let encoded = clamp(photoshopLinearSrgbToEncodedDocument(rgb), vec3f(0.0), vec3f(1.0));
    let luminosityCode = dot(encoded, vec3f(0.30, 0.59, 0.11)) * 255.0;
    let grayCode = select(
      luminosityCode,
      round(luminosityCode),
      photoshopValue(${PHOTOSHOP_DOCUMENT_BIT_DEPTH_RELATIVE_OFFSET}u) < 12.0
    );
    return vec3f(select(0.0, 1.0, grayCode >= level));
  }
  if (kind == 14u) {
    return applyPhotoshopVibrance(rgb);
  }
  if (kind == 15u) {
    return applyPhotoshopColorVibrance(rgb);
  }
  return rgb;
}

${GRADIENT_MAP_WGSL}

fn edgeAwareTextureSample(uv: vec2f, offset: vec2f, centerY: f32) -> vec2f {
  let sampleY = luminance(textureSample(correctedTexture, sourceSampler, uv + offset).rgb);
  // Keep real object edges out of the local detail estimate while allowing
  // normal surface variation to contribute to the texture band.
  let weight = exp(-abs(sampleY - centerY) * 11.0);
  return vec2f(sampleY * weight, weight);
}

fn textureScaleBase(uv: vec2f, centerY: f32) -> f32 {
  let dimensions = max(vec2f(textureDimensions(correctedTexture)), vec2f(1.0));
  // Texture belongs to a fine-to-medium detail band, not the single-pixel band.
  // Scale the radius with the source image so the control remains visible at
  // normal fit zoom on both 1K and 4K images. This follows darktable's use of
  // resolution-aware wavelet scales without bringing its full decomposition in.
  let radius = clamp(min(dimensions.x, dimensions.y) * 0.003, 2.5, 7.0);
  let outer = radius / dimensions;
  let inner = outer * 0.48;
  var accumulation = vec2f(centerY * 2.0, 2.0);
  accumulation += edgeAwareTextureSample(uv, inner * vec2f(-1.0, 0.0), centerY);
  accumulation += edgeAwareTextureSample(uv, inner * vec2f(1.0, 0.0), centerY);
  accumulation += edgeAwareTextureSample(uv, inner * vec2f(0.0, -1.0), centerY);
  accumulation += edgeAwareTextureSample(uv, inner * vec2f(0.0, 1.0), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(-1.0, 0.0), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(1.0, 0.0), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(0.0, -1.0), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(0.0, 1.0), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(-0.707, -0.707), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(0.707, -0.707), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(-0.707, 0.707), centerY);
  accumulation += edgeAwareTextureSample(uv, outer * vec2f(0.707, 0.707), centerY);
  return accumulation.x / max(accumulation.y, 0.0001);
}

fn localDarkChannel(uv: vec2f) -> f32 {
  let dimensions = max(vec2f(textureDimensions(correctedTexture)), vec2f(1.0));
  let radius = max(2.0, min(dimensions.x, dimensions.y) * 0.004);
  let texel = radius / dimensions;
  var dark = min(
    textureSample(correctedTexture, sourceSampler, uv).r,
    min(textureSample(correctedTexture, sourceSampler, uv).g, textureSample(correctedTexture, sourceSampler, uv).b)
  );
  let a = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(-1.0, -1.0)).rgb;
  let b = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(0.0, -1.0)).rgb;
  let c = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(1.0, -1.0)).rgb;
  let d = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(-1.0, 0.0)).rgb;
  let e = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(1.0, 0.0)).rgb;
  let f = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(-1.0, 1.0)).rgb;
  let g = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(0.0, 1.0)).rgb;
  let h = textureSample(correctedTexture, sourceSampler, uv + texel * vec2f(1.0, 1.0)).rgb;
  dark = min(dark, min(a.r, min(a.g, a.b)));
  dark = min(dark, min(b.r, min(b.g, b.b)));
  dark = min(dark, min(c.r, min(c.g, c.b)));
  dark = min(dark, min(d.r, min(d.g, d.b)));
  dark = min(dark, min(e.r, min(e.g, e.b)));
  dark = min(dark, min(f.r, min(f.g, f.b)));
  dark = min(dark, min(g.r, min(g.g, g.b)));
  dark = min(dark, min(h.r, min(h.g, h.b)));
  return clamp(dark, 0.0, 1.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let corrected = textureSample(correctedTexture, sourceSampler, input.uv);
  var rgb = corrected.rgb;
  var y = max(luminance(rgb), 1e-6);
  if (abs(adjustments.texture) > 0.00001) {
    let localFineBase = textureScaleBase(input.uv, y);
    let textureProtection = smoothstep(0.008, 0.08, y) * (1.0 - smoothstep(0.82, 1.45, y));
    let fineDifference = clamp((y - localFineBase) / max(localFineBase + 0.04, 0.04), -0.42, 0.42);
    let newY = max(0.0, y * exp2(fineDifference * (adjustments.texture / 100.0) * 1.65 * textureProtection));
    rgb *= newY / y;
    y = max(luminance(rgb), 1e-6);
  }
  if (abs(adjustments.clarity) > 0.00001) {
    let localBase = textureSample(blurredLuminanceTexture, sourceSampler, input.uv).r;
    let midtoneProtection = smoothstep(0.015, 0.12, y) * (1.0 - smoothstep(0.72, 1.35, y));
    let localDifference = (y - localBase) / max(localBase + 0.08, 0.08);
    let newY = max(0.0, y * exp2(localDifference * (adjustments.clarity / 100.0) * 0.85 * midtoneProtection));
    rgb *= newY / y;
    y = max(luminance(rgb), 1e-6);
  }
  if (abs(adjustments.dehaze) > 0.00001) {
    // This is a compact dark-channel-inspired creative Dehaze, not a RAW-stage
    // atmospheric solver. It intentionally works on the already-shaped LDR
    // signal so moving it earlier requires a separate pre-tone analysis pass.
    let localBase = textureSample(blurredLuminanceTexture, sourceSampler, input.uv).r;
    let hazeMask = localDarkChannel(input.uv) * smoothstep(0.04, 0.42, localBase);
    let strength = (adjustments.dehaze / 100.0) * 0.82;
    let transmission = clamp(1.0 - strength * hazeMask, 0.36, 1.82);
    // Keep signed channel excursions alive for later Lift/Curves and gamut
    // handling. Clamping here used to manufacture hard zero channels that no
    // subsequent multiplicative control could recover.
    rgb = (rgb - vec3f(1.0)) / transmission + vec3f(1.0);
  }
  rgb = applyColorMixer(rgb);
  // Global Saturation/Vibrance is the final colour balance. Keeping it after
  // the Mixer prevents global desaturation from changing hue classification.
  rgb = applyPerceptualColor(rgb);
  rgb = applyColorGrading(rgb);
  rgb = applyLift(rgb);
  rgb = applyCustomCurves(rgb);
  rgb = applyGradientMap(rgb, input.uv * vec2f(textureDimensions(correctedTexture)));
  rgb = applyPhotoshopAdjustment(rgb);
  return vec4f(rgb, corrected.a);
}
`;

export const OUTPUT_TRANSFORM_WGSL = /* wgsl */ `
struct OutputSettings {
  whites: f32,
  shoulderStrength: f32,
  enabled: f32,
  vignette: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  padding: vec2f,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: OutputSettings;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn displayShoulder(value: f32, strength: f32) -> f32 {
  let safeValue = max(value, 0.0);
  let safeStrength = clamp(strength, 0.0, 1.0);
  if (safeStrength <= 0.00000001) { return safeValue; }
  let headroom = 0.28 * pow(safeStrength, 0.65);
  let knee = 1.0 - headroom;
  if (safeValue <= knee) { return safeValue; }
  let distance = safeValue - knee;
  return knee + headroom * distance / (distance + headroom);
}

fn applyWhitesToDisplay(sceneY: f32, displayY: f32) -> f32 {
  let amount = settings.whites / 100.0;
  if (abs(amount) < 0.00001) { return displayY; }
  let whiteMask = smoothstep(0.42, 0.92, sceneY);
  if (amount > 0.0) {
    let strength = amount * amount * (3.0 - 2.0 * amount);
    return displayY + whiteMask * strength * (1.0 - displayY);
  }
  return displayY * exp2(-0.22 * -amount * whiteMask);
}

fn chromaFitForChannel(channel: f32, grey: f32) -> f32 {
  let chroma = channel - grey;
  if (chroma > 0.0) { return (1.0 - grey) / max(chroma, 1e-6); }
  if (chroma < 0.0) { return grey / max(-chroma, 1e-6); }
  return 1.0;
}

fn sceneToDisplay(rgb: vec3f) -> vec3f {
  if (settings.enabled < 0.5) { return rgb; }
  let sceneY = max(luminance(rgb), 0.0);
  if (sceneY <= 1e-7) { return vec3f(0.0); }
  let displayY = applyWhitesToDisplay(sceneY, displayShoulder(sceneY, settings.shoulderStrength));
  let exposureScaled = rgb * (displayY / sceneY);
  let fit = clamp(min(
    chromaFitForChannel(exposureScaled.r, displayY),
    min(chromaFitForChannel(exposureScaled.g, displayY), chromaFitForChannel(exposureScaled.b, displayY))
  ), 0.0, 1.0);
  let smoothFit = fit * (0.86 + 0.14 * fit);
  return vec3f(displayY) + (exposureScaled - vec3f(displayY)) * smoothFit;
}

fn applyVignette(rgb: vec3f, uv: vec2f) -> vec3f {
  if (abs(settings.vignette) < 0.00001) { return rgb; }
  let aspect = settings.sourceWidth / max(settings.sourceHeight, 1.0);
  let centered = (uv - vec2f(0.5)) * vec2f(2.0 * aspect, 2.0);
  let normalizedDistance = length(centered) / max(length(vec2f(aspect, 1.0)), 0.0001);
  let weight = smoothstep(0.48, 1.0, normalizedDistance);
  let edgeEV = (settings.vignette / 100.0) * 1.5;
  return rgb * exp2(edgeEV * weight);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let positive = max(value, 0.0);
  return select(1.055 * pow(positive, 1.0 / 2.4) - 0.055, positive * 12.92, positive <= 0.0031308);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(inputTexture));
  let coordinate = clamp(vec2i(floor(input.uv * vec2f(dimensions))), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(inputTexture, coordinate, 0);
  let vignetted = applyVignette(source.rgb, input.uv);
  let rgb = sceneToDisplay(vignetted);
  let encoded = vec3f(linearToSrgbChannel(rgb.r), linearToSrgbChannel(rgb.g), linearToSrgbChannel(rgb.b));
  return vec4f(clamp(encoded, vec3f(0.0), vec3f(1.0)), source.a);
}
`;

// Resolve the high-precision display-encoded grade to the final 8-bit output
// when Grain is disabled. A render pass is required because WebGPU texture
// copies cannot convert rgba16float to rgba8unorm.
export const DISPLAY_RESOLVE_WGSL = /* wgsl */ `
@group(0) @binding(0) var gradedTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(gradedTexture));
  let coordinate = clamp(vec2i(floor(input.uv * vec2f(dimensions))), vec2i(0), dimensions - vec2i(1));
  return clamp(textureLoad(gradedTexture, coordinate, 0), vec4f(0.0), vec4f(1.0));
}
`;

// rgba16unorm is exposed by texture-formats-tier1 as an unfilterable texture.
// Resolve it one-to-one into LightTable's filterable rgba16float source
// boundary before any layer, viewport, scope or correction pipeline samples it.
export const PRECISION_SOURCE_RESOLVE_WGSL = /* wgsl */ `
@group(0) @binding(0) var precisionSourceTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(precisionSourceTexture));
  let coordinate = clamp(
    vec2i(floor(input.uv * vec2f(dimensions))),
    vec2i(0),
    dimensions - vec2i(1)
  );
  return textureLoad(precisionSourceTexture, coordinate, 0);
}
`;

// The preferred canvas format is an unorm swapchain format (not *-srgb), so
// presentation colors are supplied as normalized display-sRGB values. Keep
// this exactly aligned with --lt-surface-workspace (#161718).
const VIEWPORT_PASTEBOARD_BACKGROUND = 'vec3f(0.086274510, 0.090196078, 0.094117647)';

export const VIEWPORT_BLIT_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32,
  viewportHeight: f32,
  rectX: f32,
  rectY: f32,
  rectWidth: f32,
  rectHeight: f32,
  checkerSize: f32,
  padding: f32,
}

@group(0) @binding(0) var imageTexture: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (pixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  let checkerIndex = vec2u(floor(pixel / max(view.checkerSize, 2.0)));
  let checker = select(0.115, 0.17, ((checkerIndex.x + checkerIndex.y) & 1u) == 0u);
  let canvasBackground = vec3f(checker);
  let pasteboardBackground = ${VIEWPORT_PASTEBOARD_BACKGROUND};
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(pasteboardBackground, 1.0);
  }
  // Explicit LOD is valid even though the image bounds branch varies per fragment.
  let image = textureSampleLevel(imageTexture, imageSampler, imageUv, 0.0);
  return vec4f(mix(canvasBackground, image.rgb, image.a), 1.0);
}
`;

/** Presentation-neutral final-composite reduction used for document tabs. */
export const DOCUMENT_THUMBNAIL_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
}
`;

// Presentation-only view of the active layer mask. The source remains the
// document-owned mask texture, so painting updates this view without creating
// a second mask or passing through grade, Lens Fx, alpha compositing or scopes.
export const MASK_VIEWPORT_BLIT_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32,
  viewportHeight: f32,
  rectX: f32,
  rectY: f32,
  rectWidth: f32,
  rectHeight: f32,
  checkerSize: f32,
  padding: f32,
}

struct MaskPresentationUniforms {
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  canvasSize: vec2f,
  padding: vec2f,
}

@group(0) @binding(0) var maskTexture: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;
@group(0) @binding(3) var<uniform> maskPresentation: MaskPresentationUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (pixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  let pasteboardBackground = ${VIEWPORT_PASTEBOARD_BACKGROUND};
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(pasteboardBackground, 1.0);
  }
  let destinationPixel = imageUv * maskPresentation.canvasSize;
  let maskPixel = vec2f(
    dot(maskPresentation.inverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(maskPresentation.inverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let maskInside = all(maskPixel >= vec2f(0.0)) && all(maskPixel < maskPresentation.canvasSize);
  let maskUv = clamp(maskPixel / maskPresentation.canvasSize, vec2f(0.0), vec2f(1.0));
  let coverage = select(
    0.0,
    textureSampleLevel(maskTexture, imageSampler, maskUv, 0.0).r,
    maskInside
  );
  return vec4f(vec3f(coverage), 1.0);
}
`;

// Presentation-only monochrome view of one reconstructed RGB component. The
// display-domain result is intentional: Channels reflects the pixels users
// currently see, including the document compositor, rather than a stale source
// or Photoshop's embedded compatibility preview.
export const CHANNEL_VIEWPORT_BLIT_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32,
  viewportHeight: f32,
  rectX: f32,
  rectY: f32,
  rectWidth: f32,
  rectHeight: f32,
  checkerSize: f32,
  padding: f32,
}

struct ChannelUniforms {
  channel: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var imageTexture: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;
@group(0) @binding(3) var<uniform> channelSettings: ChannelUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (pixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  let pasteboardBackground = ${VIEWPORT_PASTEBOARD_BACKGROUND};
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(pasteboardBackground, 1.0);
  }
  let image = textureSampleLevel(imageTexture, imageSampler, imageUv, 0.0);
  let straight = select(vec3f(0.0), image.rgb / max(image.a, 1e-6), image.a > 1e-6);
  var value = straight.r;
  if (channelSettings.channel == 1u) { value = straight.g; }
  if (channelSettings.channel == 2u) { value = straight.b; }
  return vec4f(vec3f(value), 1.0);
}
`;

// Pixel-accurate display-domain comparison between the Photoshop embedded
// composite/reference and LightTable's reconstructed result. Black means an
// exact match; the fixed gain makes small but meaningful style/blend errors
// visible without changing either source image.
export const VIEWPORT_DIFFERENCE_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32,
  viewportHeight: f32,
  rectX: f32,
  rectY: f32,
  rectWidth: f32,
  rectHeight: f32,
  checkerSize: f32,
  padding: f32,
}

@group(0) @binding(0) var referenceTexture: texture_2d<f32>;
@group(0) @binding(1) var reconstructedTexture: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
@group(0) @binding(3) var<uniform> view: ViewUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (pixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  let pasteboardBackground = ${VIEWPORT_PASTEBOARD_BACKGROUND};
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(pasteboardBackground, 1.0);
  }
  let reference = textureSampleLevel(referenceTexture, imageSampler, imageUv, 0.0);
  let reconstructed = textureSampleLevel(reconstructedTexture, imageSampler, imageUv, 0.0);
  let alphaDifference = abs(reference.a - reconstructed.a);
  let rgbDifference = abs(reference.rgb - reconstructed.rgb);
  return vec4f(clamp(max(rgbDifference, vec3f(alphaDifference)) * 4.0, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// Quantitative companion to the visual PSD difference view. Values are
// accumulated as 8-bit display-domain deltas so the report describes what a
// user actually sees. The caller limits the sample count to avoid u32
// overflow on very large documents.
export const REFERENCE_DIFFERENCE_METRICS_WGSL = /* wgsl */ `
struct DifferenceUniforms {
  width: u32,
  height: u32,
  stride: u32,
  threshold: u32,
}

struct DifferenceMetrics {
  sampledPixels: atomic<u32>,
  differingPixels: atomic<u32>,
  absoluteRgbSum: atomic<u32>,
  maximumChannelDifference: atomic<u32>,
  absoluteAlphaSum: atomic<u32>,
  maximumAlphaDifference: atomic<u32>,
}

@group(0) @binding(0) var referenceTexture: texture_2d<f32>;
@group(0) @binding(1) var reconstructedTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> metrics: DifferenceMetrics;
@group(0) @binding(3) var<uniform> info: DifferenceUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coordinate = id.xy * info.stride;
  if (coordinate.x >= info.width || coordinate.y >= info.height) {
    return;
  }

  let reference = clamp(textureLoad(referenceTexture, vec2i(coordinate), 0), vec4f(0.0), vec4f(1.0));
  let reconstructed = clamp(textureLoad(reconstructedTexture, vec2i(coordinate), 0), vec4f(0.0), vec4f(1.0));
  let rgbDifference = vec3u(abs(reference.rgb - reconstructed.rgb) * 255.0 + 0.5);
  let alphaDifference = u32(abs(reference.a - reconstructed.a) * 255.0 + 0.5);
  let maximumRgb = max(rgbDifference.r, max(rgbDifference.g, rgbDifference.b));
  let maximumDifference = max(maximumRgb, alphaDifference);

  atomicAdd(&metrics.sampledPixels, 1u);
  atomicAdd(&metrics.absoluteRgbSum, rgbDifference.r + rgbDifference.g + rgbDifference.b);
  atomicMax(&metrics.maximumChannelDifference, maximumRgb);
  atomicAdd(&metrics.absoluteAlphaSum, alphaDifference);
  atomicMax(&metrics.maximumAlphaDifference, alphaDifference);
  if (maximumDifference > info.threshold) {
    atomicAdd(&metrics.differingPixels, 1u);
  }
}
`;

export const HISTOGRAM_WGSL = /* wgsl */ `
struct HistogramUniforms {
  width: u32,
  height: u32,
  stride: u32,
  padding: u32,
}

struct HistogramBins {
  values: array<atomic<u32>, 768>,
}

@group(0) @binding(0) var imageTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: HistogramBins;
@group(0) @binding(2) var<uniform> info: HistogramUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coordinate = id.xy * info.stride;
  if (coordinate.x >= info.width || coordinate.y >= info.height) {
    return;
  }
  let color = textureLoad(imageTexture, vec2i(coordinate), 0);
  if (color.a <= 0.001) {
    return;
  }
  let indices = vec3u(clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * 255.0 + 0.5);
  atomicAdd(&bins.values[indices.r], 1u);
  atomicAdd(&bins.values[256u + indices.g], 1u);
  atomicAdd(&bins.values[512u + indices.b], 1u);
}
`;
