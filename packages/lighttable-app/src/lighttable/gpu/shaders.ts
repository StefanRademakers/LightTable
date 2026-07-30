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
}

@group(0) @binding(0) var correctedTexture: texture_2d<f32>;
@group(0) @binding(1) var blurredLuminanceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> adjustments: Adjustments;
@group(0) @binding(4) var curveLut: texture_2d<f32>;

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
  let pasteboardBackground = vec3f(0.031, 0.039, 0.047);
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(pasteboardBackground, 1.0);
  }
  // Explicit LOD is valid even though the image bounds branch varies per fragment.
  let image = textureSampleLevel(imageTexture, imageSampler, imageUv, 0.0);
  return vec4f(mix(canvasBackground, image.rgb, image.a), 1.0);
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
  let pasteboardBackground = vec3f(0.031, 0.039, 0.047);
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
