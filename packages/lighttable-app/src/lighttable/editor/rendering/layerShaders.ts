export const LAYER_EXPORT_WGSL = /* wgsl */ `
struct ExportSettings {
  maskChannel: f32,
  transformed: f32,
  sourceIsStraightSrgb: f32,
  padding2: f32,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  sourceSize: vec2f,
  outputSize: vec2f,
}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: ExportSettings;

fn linearToSrgbChannel(value: f32) -> f32 {
  return select(value * 12.92, 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055, value > 0.0031308);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let destinationPixel = input.uv * settings.outputSize;
  let sourcePixel = vec2f(
    dot(settings.inverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let sourceInside = select(
    0.0,
    1.0,
    all(sourcePixel >= vec2f(0.0)) && all(sourcePixel < settings.sourceSize)
  );
  let transformedUv = clamp(sourcePixel / settings.sourceSize, vec2f(0.0), vec2f(1.0));
  let sourceUv = select(input.uv, transformedUv, settings.transformed > 0.5);
  let transformCoverage = select(1.0, sourceInside, settings.transformed > 0.5);
  let sampled = textureSample(sourceTexture, sourceSampler, sourceUv) * transformCoverage;
  if (settings.maskChannel > 0.5) {
    let value = clamp(sampled.r, 0.0, 1.0);
    return vec4f(value, value, value, 1.0);
  }
  // Final display textures have already been converted to straight-alpha
  // sRGB. Copy Merged must preserve those encoded RGB values verbatim; doing
  // the canonical layer conversion again visibly lifts and desaturates color,
  // and dividing straight RGB by selection coverage creates bright fringes.
  if (settings.sourceIsStraightSrgb > 0.5) {
    return clamp(sampled, vec4f(0.0), vec4f(1.0));
  }
  let straight = sampled.rgb / max(sampled.a, 1e-6);
  let encoded = vec3f(
    linearToSrgbChannel(straight.r),
    linearToSrgbChannel(straight.g),
    linearToSrgbChannel(straight.b)
  );
  return vec4f(clamp(encoded, vec3f(0.0), vec3f(1.0)), clamp(sampled.a, 0.0, 1.0));
}
`;

export const LAYER_BLEND_FUNCTIONS_WGSL = /* wgsl */ `
fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.30, 0.59, 0.11));
}

fn saturation(color: vec3f) -> f32 {
  return max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
}

fn clipColor(color: vec3f) -> vec3f {
  let l = luminance(color);
  let minimum = min(color.r, min(color.g, color.b));
  let maximum = max(color.r, max(color.g, color.b));
  var result = color;
  if (minimum < 0.0) { result = vec3f(l) + (result - vec3f(l)) * l / max(l - minimum, 1e-6); }
  if (maximum > 1.0) { result = vec3f(l) + (result - vec3f(l)) * (1.0 - l) / max(maximum - l, 1e-6); }
  return result;
}

fn setLuminance(color: vec3f, targetValue: f32) -> vec3f {
  return clipColor(color + vec3f(targetValue - luminance(color)));
}

fn setSaturation(color: vec3f, targetValue: f32) -> vec3f {
  let minimum = min(color.r, min(color.g, color.b));
  let maximum = max(color.r, max(color.g, color.b));
  if (maximum - minimum < 1e-6) { return vec3f(0.0); }
  return (color - vec3f(minimum)) * targetValue / (maximum - minimum);
}

fn linearToBlendChannel(value: f32) -> f32 {
  return select(value * 12.92, 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055, value > 0.0031308);
}

fn blendToLinearChannel(value: f32) -> f32 {
  return select(value / 12.92, pow((value + 0.055) / 1.055, 2.4), value > 0.04045);
}

fn linearSrgbToLinearAdobeRgb(color: vec3f) -> vec3f {
  return vec3f(
    0.71516271 * color.r + 0.28483729 * color.g,
    color.g,
    0.04117054 * color.g + 0.95882946 * color.b
  );
}

fn linearAdobeRgbToLinearSrgb(color: vec3f) -> vec3f {
  return vec3f(
    1.39835574 * color.r - 0.39835574 * color.g,
    color.g,
    -0.0429288 * color.g + 1.0429288 * color.b
  );
}

fn linearAdobeRgbToEncoded(color: vec3f) -> vec3f {
  return pow(max(color, vec3f(0.0)), vec3f(256.0 / 563.0));
}

fn encodedAdobeRgbToLinear(color: vec3f) -> vec3f {
  return pow(max(color, vec3f(0.0)), vec3f(563.0 / 256.0));
}

fn colorDodgeChannel(background: f32, foreground: f32) -> f32 {
  if (background <= 1e-5) { return 0.0; }
  if (foreground >= 1.0 - 1e-5) { return 1.0; }
  return min(1.0, background / (1.0 - foreground));
}

fn colorBurnChannel(background: f32, foreground: f32) -> f32 {
  if (background >= 1.0 - 1e-5) { return 1.0; }
  if (foreground <= 1e-5) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - background) / foreground);
}

fn vividLightChannel(background: f32, foreground: f32) -> f32 {
  // Photoshop saturates pure Vivid Light source endpoints independently of
  // the backdrop. A small tolerance retains those authored 8/16-bit endpoints
  // after their roundtrip through the linear rgba16float working texture.
  if (foreground <= 1e-5) { return 0.0; }
  if (foreground >= 1.0 - 1e-5) { return 1.0; }
  if (foreground < 0.5) {
    return 1.0 - min(1.0, (1.0 - background) / (2.0 * foreground));
  }
  return min(1.0, background / (2.0 * (1.0 - foreground)));
}

fn vividLight(background: vec3f, foreground: vec3f) -> vec3f {
  return vec3f(
    vividLightChannel(background.r, foreground.r),
    vividLightChannel(background.g, foreground.g),
    vividLightChannel(background.b, foreground.b)
  );
}

fn hardMixChannel(background: f32, foreground: f32) -> f32 {
  let sum = background + foreground;
  // Photoshop's 8-bit Hard Mix threshold is binary around a channel sum of
  // 255. On the exact boundary the backdrop decides the result: 128..255 is
  // white and 0..127 is black. The tolerance preserves that boundary after
  // the encoded values have made a roundtrip through rgba16float storage.
  let boundaryTolerance = 1e-3;
  if (sum > 1.0 + boundaryTolerance) { return 1.0; }
  if (sum < 1.0 - boundaryTolerance) { return 0.0; }
  return select(0.0, 1.0, background >= 0.5);
}

fn hardMix(background: vec3f, foreground: vec3f) -> vec3f {
  return vec3f(
    hardMixChannel(background.r, foreground.r),
    hardMixChannel(background.g, foreground.g),
    hardMixChannel(background.b, foreground.b)
  );
}

fn colorDodge(background: vec3f, foreground: vec3f) -> vec3f {
  return vec3f(
    colorDodgeChannel(background.r, foreground.r),
    colorDodgeChannel(background.g, foreground.g),
    colorDodgeChannel(background.b, foreground.b)
  );
}

fn colorBurn(background: vec3f, foreground: vec3f) -> vec3f {
  return vec3f(
    colorBurnChannel(background.r, foreground.r),
    colorBurnChannel(background.g, foreground.g),
    colorBurnChannel(background.b, foreground.b)
  );
}

fn blendColorEncoded(background: vec3f, foreground: vec3f, mode: i32, quantization: f32) -> vec3f {
  if (mode == 1) { return background * foreground; }
  if (mode == 2) { return vec3f(1.0) - (vec3f(1.0) - background) * (vec3f(1.0) - foreground); }
  if (mode == 3) {
    return select(2.0 * background * foreground, vec3f(1.0) - 2.0 * (vec3f(1.0) - background) * (vec3f(1.0) - foreground), background > vec3f(0.5));
  }
  if (mode == 4) {
    let polynomial = ((16.0 * background - 12.0) * background + 4.0) * background;
    let d = select(polynomial, sqrt(max(background, vec3f(0.0))), background > vec3f(0.25));
    return select(
      background - (vec3f(1.0) - 2.0 * foreground) * background * (vec3f(1.0) - background),
      background + (2.0 * foreground - vec3f(1.0)) * (d - background),
      foreground > vec3f(0.5)
    );
  }
  if (mode == 5) {
    return select(2.0 * background * foreground, vec3f(1.0) - 2.0 * (vec3f(1.0) - background) * (vec3f(1.0) - foreground), foreground > vec3f(0.5));
  }
  if (mode == 6) { return min(background, foreground); }
  if (mode == 7) { return max(background, foreground); }
  if (mode == 8) { return colorDodge(background, foreground); }
  if (mode == 9) { return colorBurn(background, foreground); }
  if (mode == 10) { return min(vec3f(1.0), background + foreground); }
  if (mode == 11) { return abs(background - foreground); }
  if (mode == 12) { return setLuminance(setSaturation(foreground, saturation(background)), luminance(background)); }
  if (mode == 13) { return setLuminance(setSaturation(background, saturation(foreground)), luminance(background)); }
  if (mode == 14) { return setLuminance(foreground, luminance(background)); }
  if (mode == 15) { return setLuminance(background, luminance(foreground)); }
  if (mode == 16) { return max(vec3f(0.0), background + foreground - vec3f(1.0)); }
  if (mode == 17) {
    return select(foreground, background, luminance(background) < luminance(foreground));
  }
  if (mode == 18) {
    return select(foreground, background, luminance(background) > luminance(foreground));
  }
  if (mode == 19) {
    return vividLight(background, foreground);
  }
  if (mode == 20) { return clamp(background + vec3f(2.0) * foreground - vec3f(1.0), vec3f(0.0), vec3f(1.0)); }
  if (mode == 21) {
    return select(
      min(background, vec3f(2.0) * foreground),
      max(background, vec3f(2.0) * foreground - vec3f(1.0)),
      foreground >= vec3f(0.5)
    );
  }
  if (mode == 22) {
    return hardMix(background, foreground);
  }
  if (mode == 23) { return background + foreground - vec3f(2.0) * background * foreground; }
  if (mode == 24) { return max(vec3f(0.0), background - foreground); }
  if (mode == 25) { return min(vec3f(1.0), background / max(foreground, vec3f(1e-6))); }
  return foreground;
}

fn linearStraightToBlend(color: vec3f, profile: f32, quantization: f32) -> vec3f {
  let srgb = vec3f(
    linearToBlendChannel(color.r),
    linearToBlendChannel(color.g),
    linearToBlendChannel(color.b)
  );
  let adobeRgb = linearAdobeRgbToEncoded(linearSrgbToLinearAdobeRgb(color));
  let encoded = select(srgb, adobeRgb, profile > 0.5);
  return select(encoded, round(clamp(encoded, vec3f(0.0), vec3f(1.0)) * quantization) / quantization, quantization > 0.5);
}

fn blendStraightToLinear(color: vec3f, profile: f32) -> vec3f {
  let srgb = vec3f(
    blendToLinearChannel(color.r),
    blendToLinearChannel(color.g),
    blendToLinearChannel(color.b)
  );
  let adobeRgb = linearAdobeRgbToLinearSrgb(encodedAdobeRgbToLinear(color));
  return select(srgb, adobeRgb, profile > 0.5);
}

fn compositeBlend(background: vec4f, foreground: vec4f, mode: i32, profile: f32, quantization: f32) -> vec4f {
  let backgroundStraight = background.rgb / max(background.a, 1e-6);
  let foregroundStraight = foreground.rgb / max(foreground.a, 1e-6);
  let backgroundEncoded = linearStraightToBlend(backgroundStraight, profile, quantization);
  let foregroundEncoded = linearStraightToBlend(foregroundStraight, profile, quantization);
  let blendedEncoded = clamp(
    blendColorEncoded(backgroundEncoded, foregroundEncoded, mode, quantization),
    vec3f(0.0),
    vec3f(1.0)
  );
  let outputAlpha = foreground.a + background.a * (1.0 - foreground.a);
  let outputPremultipliedEncoded =
    backgroundEncoded * background.a * (1.0 - foreground.a) +
    foregroundEncoded * foreground.a * (1.0 - background.a) +
    blendedEncoded * background.a * foreground.a;
  let outputStraightEncoded = outputPremultipliedEncoded / max(outputAlpha, 1e-6);
  return vec4f(blendStraightToLinear(outputStraightEncoded, profile) * outputAlpha, outputAlpha);
}
`;

export const LAYER_COMPOSITE_WGSL = /* wgsl */ `
struct LayerSettings {
  opacity: f32,
  maskEnabled: f32,
  blendMode: f32,
  clippingEnabled: f32,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  sourceSize: vec2f,
  canvasSize: vec2f,
  maskDensity: f32,
  maskFeather: f32,
  maskPadding: vec2f,
  maskInverseRow0: vec4f,
  maskInverseRow1: vec4f,
}

@group(0) @binding(0) var backgroundTexture: texture_2d<f32>;
@group(0) @binding(1) var foregroundTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: LayerSettings;
@group(0) @binding(4) var maskTexture: texture_2d<f32>;
@group(0) @binding(5) var clippingTexture: texture_2d<f32>;

${LAYER_BLEND_FUNCTIONS_WGSL}

fn evaluatedMask(uv: vec2f) -> f32 {
  var value = textureSample(maskTexture, sourceSampler, uv).r;
  if (settings.maskFeather > 0.01) {
    let texel = vec2f(1.0) / vec2f(textureDimensions(maskTexture));
    let radius = settings.maskFeather * texel;
    var sum = 0.0;
    let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
    for (var y = 0; y < 5; y += 1) {
      for (var x = 0; x < 5; x += 1) {
        let offset = vec2f(f32(x - 2), f32(y - 2)) * radius * 0.5;
        sum += textureSample(maskTexture, sourceSampler, clamp(uv + offset, vec2f(0.0), vec2f(1.0))).r
          * weights[x] * weights[y];
      }
    }
    value = sum / 256.0;
  }
  return mix(1.0, clamp(value, 0.0, 1.0), clamp(settings.maskDensity, 0.0, 1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let background = textureSample(backgroundTexture, sourceSampler, input.uv);
  let destinationPixel = input.uv * settings.canvasSize;
  let sourcePixel = vec2f(
    dot(settings.inverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let sourceInside = select(
    0.0,
    1.0,
    all(sourcePixel >= vec2f(0.0)) && all(sourcePixel < settings.sourceSize)
  );
  let sourceUv = clamp(sourcePixel / settings.sourceSize, vec2f(0.0), vec2f(1.0));
  let sampledForeground = textureSample(foregroundTexture, sourceSampler, sourceUv) * sourceInside;
  let maskPixel = vec2f(
    dot(settings.maskInverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.maskInverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let maskInside = select(
    0.0,
    1.0,
    all(maskPixel >= vec2f(0.0)) && all(maskPixel < settings.canvasSize)
  );
  let maskUv = clamp(maskPixel / settings.canvasSize, vec2f(0.0), vec2f(1.0));
  let transformedMask = evaluatedMask(maskUv) * maskInside;
  let mask = select(1.0, transformedMask, settings.maskEnabled > 0.5);
  let clipping = select(
    1.0,
    clamp(textureSample(clippingTexture, sourceSampler, input.uv).a, 0.0, 1.0),
    settings.clippingEnabled > 0.5
  );
  let foreground = sampledForeground * settings.opacity * mask * clipping;
  return compositeBlend(background, foreground, i32(settings.blendMode + 0.5), settings.maskPadding.x, settings.maskPadding.y);
}
`;

/**
 * Materializes one raster layer in document space for Layer Style evaluation.
 *
 * This is deliberately separate from the document compositor. A style shape
 * is source content plus its mask, not a blend against a synthetic background.
 * Keeping this pass direct also guarantees that transparent pixels remain
 * transparent before an outer effect such as Drop Shadow expands the alpha.
 */
export const LAYER_STYLE_SHAPE_WGSL = /* wgsl */ `
struct LayerStyleShapeSettings {
  header: vec4f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  sourceSize: vec2f,
  canvasSize: vec2f,
  maskInverseRow0: vec4f,
  maskInverseRow1: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: LayerStyleShapeSettings;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;

fn evaluatedMask(uv: vec2f) -> f32 {
  var value = textureSample(maskTexture, sourceSampler, uv).r;
  if (settings.header.z > 0.01) {
    let texel = vec2f(1.0) / vec2f(textureDimensions(maskTexture));
    let radius = settings.header.z * texel;
    var sum = 0.0;
    let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
    for (var y = 0; y < 5; y += 1) {
      for (var x = 0; x < 5; x += 1) {
        let offset = vec2f(f32(x - 2), f32(y - 2)) * radius * 0.5;
        sum += textureSample(maskTexture, sourceSampler, clamp(uv + offset, vec2f(0.0), vec2f(1.0))).r
          * weights[x] * weights[y];
      }
    }
    value = sum / 256.0;
  }
  return mix(1.0, clamp(value, 0.0, 1.0), clamp(settings.header.y, 0.0, 1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let destinationPixel = input.uv * settings.canvasSize;
  let sourcePixel = vec2f(
    dot(settings.inverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let sourceInside = all(sourcePixel >= vec2f(0.0))
    && all(sourcePixel < settings.sourceSize);
  let sourceUv = clamp(sourcePixel / settings.sourceSize, vec2f(0.0), vec2f(1.0));
  let sampled = textureSample(sourceTexture, sourceSampler, sourceUv);
  let maskPixel = vec2f(
    dot(settings.maskInverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.maskInverseRow1.xyz, vec3f(destinationPixel, 1.0))
  );
  let maskInside = all(maskPixel >= vec2f(0.0))
    && all(maskPixel < settings.canvasSize);
  let maskUv = clamp(maskPixel / settings.canvasSize, vec2f(0.0), vec2f(1.0));
  let mask = select(
    1.0,
    evaluatedMask(maskUv) * select(0.0, 1.0, maskInside),
    settings.header.x > 0.5
  );
  let coverage = select(0.0, mask, sourceInside);
  return sampled * coverage;
}
`;

const LAYER_STYLE_BLUR_DIRECTION_COUNT = 64;
const LAYER_STYLE_BLUR_DIRECTIONS = Array.from(
  { length: LAYER_STYLE_BLUR_DIRECTION_COUNT },
  (_, index) => {
    const angle = index * Math.PI * 2 / LAYER_STYLE_BLUR_DIRECTION_COUNT;
    return `vec2f(${Math.cos(angle).toFixed(7)}, ${Math.sin(angle).toFixed(7)})`;
  }
).join(', ');
const LAYER_STYLE_MORPH_DIRECTION_COUNT = 128;
const LAYER_STYLE_MORPH_DIRECTIONS = Array.from(
  { length: LAYER_STYLE_MORPH_DIRECTION_COUNT },
  (_, index) => {
    const angle = index * Math.PI * 2 / LAYER_STYLE_MORPH_DIRECTION_COUNT;
    return `vec2f(${Math.cos(angle).toFixed(7)}, ${Math.sin(angle).toFixed(7)})`;
  }
).join(', ');

export const LAYER_STYLE_EFFECT_WGSL = /* wgsl */ `
struct StyleSettings {
  header: vec4f,
  color0: vec4f,
  color1: vec4f,
  params0: vec4f,
  params1: vec4f,
  canvas: vec4f,
  gradientColors: array<vec4f, 8>,
  gradientOpacity: array<vec4f, 8>,
  gradientMidpoints: array<vec4f, 8>,
  contourPoints: array<vec4f, 8>,
  colorTransform: vec4f,
}

@group(0) @binding(0) var currentTexture: texture_2d<f32>;
@group(0) @binding(1) var shapeTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: StyleSettings;
@group(0) @binding(4) var patternTexture: texture_2d<f32>;
@group(0) @binding(5) var blurredShapeTexture: texture_2d<f32>;
@group(0) @binding(6) var bevelFieldTexture: texture_2d<f32>;
@group(0) @binding(7) var bevelHeightTexture: texture_2d<f32>;
@group(0) @binding(8) var bevelHeightTextureSecondary: texture_2d<f32>;

${LAYER_BLEND_FUNCTIONS_WGSL}

fn over(foreground: vec4f, background: vec4f) -> vec4f {
  return compositeBlend(background, foreground, 0, settings.colorTransform.x, settings.colorTransform.y);
}

fn styleOverCurrent(current: vec4f, color: vec3f, alpha: f32, mode: i32) -> vec4f {
  let effectAlpha = clamp(alpha, 0.0, 1.0);
  let currentStraight = current.rgb / max(current.a, 1e-6);
  let currentEncoded = linearStraightToBlend(currentStraight, settings.colorTransform.x, settings.colorTransform.y);
  let colorEncoded = linearStraightToBlend(color, settings.colorTransform.x, settings.colorTransform.y);
  let blendedEncoded = blendColorEncoded(
    currentEncoded,
    colorEncoded,
    mode,
    settings.colorTransform.y
  );
  // Interior styles operate inside the source coverage. Using Porter-Duff
  // Porter-Duff over here would make an antialiased edge more opaque every time another
  // overlay is added. Preserve the strongest existing coverage and replace
  // only the proportional straight-color contribution instead.
  let outputAlpha = max(current.a, effectAlpha);
  let mixAmount = effectAlpha / max(outputAlpha, 1e-6);
  let outputEncoded = mix(currentEncoded, blendedEncoded, mixAmount);
  return vec4f(blendStraightToLinear(outputEncoded, settings.colorTransform.x) * outputAlpha, outputAlpha);
}

fn alphaAt(uv: vec2f, pixelOffset: vec2f) -> f32 {
  let sampleUv = uv + pixelOffset / settings.canvas.xy;
  let inside = all(sampleUv >= vec2f(0.0)) && all(sampleUv <= vec2f(1.0));
  // Explicit LOD is required here: radius/noise can make callers
  // non-uniform per fragment, so implicit derivative sampling is invalid WGSL.
  let sampled = textureSampleLevel(
    shapeTexture,
    sourceSampler,
    clamp(sampleUv, vec2f(0.0), vec2f(1.0)),
    0.0
  ).a;
  return select(0.0, clamp(sampled, 0.0, 1.0), inside);
}

fn blurredAlpha(uv: vec2f, centerOffset: vec2f, radius: f32) -> f32 {
  if (radius <= 0.01) { return alphaAt(uv, centerOffset); }
  if (settings.canvas.w < 0.0) {
    let documentPixel = uv * settings.canvas.xy + centerOffset;
    let fieldBounds = settings.gradientMidpoints[2];
    let documentUv = documentPixel / settings.canvas.xy;
    let fieldUv = (documentPixel - fieldBounds.xy) / max(fieldBounds.zw, vec2f(1.0));
    let kind = i32(settings.header.x + 0.5);
    let usesRetainedShadowField = (
      kind == 2 || kind == 3 || kind == 4 || kind == 5 || kind == 11 || kind == 12 || kind == 14
    )
      && fieldBounds.z > 0.0;
    let sampleUv = select(documentUv, fieldUv, usesRetainedShadowField);
    let inside = all(sampleUv >= vec2f(0.0)) && all(sampleUv <= vec2f(1.0));
    let sampled = textureSampleLevel(
      blurredShapeTexture,
      sourceSampler,
      clamp(sampleUv, vec2f(0.0), vec2f(1.0)),
      0.0
    ).a;
    return select(0.0, clamp(sampled, 0.0, 1.0), inside);
  }
  let directions = array<vec2f, ${LAYER_STYLE_BLUR_DIRECTION_COUNT}>(
    ${LAYER_STYLE_BLUR_DIRECTIONS}
  );
  let sampleCount = u32(clamp(
    settings.canvas.w,
    1.0,
    f32(${LAYER_STYLE_BLUR_DIRECTION_COUNT})
  ) + 0.5);
  var value = alphaAt(uv, centerOffset) * 4.0;
  for (var sampleIndex = 0u; sampleIndex < sampleCount; sampleIndex += 1u) {
    // Lower budgets remain evenly distributed around the complete ring,
    // keeping the effect centered and its geometry invariant across tiers.
    let index = (sampleIndex * ${LAYER_STYLE_BLUR_DIRECTION_COUNT}u) / sampleCount;
    value += alphaAt(uv, centerOffset + directions[index] * radius * 0.35) * 2.0;
    value += alphaAt(uv, centerOffset + directions[index] * radius * 0.72);
    value += alphaAt(uv, centerOffset + directions[index] * radius);
  }
  return clamp(value / (4.0 + f32(sampleCount) * 4.0), 0.0, 1.0);
}

fn noiseAt(pixel: vec2f) -> f32 {
  return fract(sin(dot(pixel, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn contourAt(position: f32) -> f32 {
  let count = u32(settings.canvas.z + 0.5);
  if (count == 0u) { return position; }
  var lower = 0u;
  var upper = count - 1u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.contourPoints[index].x <= position) {
      lower = index;
    }
  }
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.contourPoints[index].x >= position) {
      upper = min(upper, index);
    }
  }
  let first = settings.contourPoints[lower];
  let second = settings.contourPoints[upper];
  let amount = select(
    clamp((position - first.x) / max(second.x - first.x, 1e-6), 0.0, 1.0),
    0.0,
    lower == upper
  );
  return mix(first.y, second.y, amount);
}

fn bevelFieldAt(uv: vec2f, pixelOffset: vec2i) -> vec4f {
  let roi = settings.gradientMidpoints[2];
  let documentPixel = vec2i(floor(uv * settings.canvas.xy)) + pixelOffset;
  let localPixel = documentPixel - vec2i(floor(roi.xy));
  let size = vec2i(textureDimensions(bevelFieldTexture));
  let inside = all(localPixel >= vec2i(0)) && all(localPixel < size);
  return select(
    vec4f(0.0, 0.0, select(-1.0, 1.0, alphaAt(uv, vec2f(pixelOffset)) >= 0.5), 0.0),
    textureLoad(bevelFieldTexture, clamp(localPixel, vec2i(0), size - vec2i(1)), 0),
    inside
  );
}

fn bevelDistanceAt(uv: vec2f, pixelOffset: vec2i) -> f32 {
  let field = bevelFieldAt(uv, pixelOffset);
  return select(field.z * 100000.0, field.z * length(field.xy), field.w > 0.5);
}

fn chiselHeight(distance: f32, radius: f32, style: i32, technique: f32) -> f32 {
  let extent = max(radius, 0.5);
  var height = clamp(distance / extent, 0.0, 1.0);
  if (style == 0) { height = clamp(1.0 + distance / extent, 0.0, 1.0); }
  if (style == 2 || style == 4) {
    height = clamp(0.5 + distance / (2.0 * extent), 0.0, 1.0);
  }
  // Chisel Soft is still distance based, but rounds the otherwise linear
  // chamfer. Smooth owns the separate blurred-matte height source.
  return select(height, height * height * (3.0 - 2.0 * height), technique > 1.5);
}

fn smoothHeightAt(uv: vec2f, texelOffset: vec2i) -> f32 {
  let roi = settings.gradientMidpoints[2];
  let size = vec2i(textureDimensions(bevelHeightTexture));
  let scale = max(settings.gradientMidpoints[3].x, 1.0);
  let documentPixel = floor(uv * settings.canvas.xy) + vec2f(texelOffset) + vec2f(0.5);
  let position = (documentPixel - roi.xy) / scale - vec2f(0.5);
  let base = vec2i(floor(position));
  let fraction = fract(position);
  let tx2 = fraction.x * fraction.x;
  let tx3 = tx2 * fraction.x;
  let ty2 = fraction.y * fraction.y;
  let ty3 = ty2 * fraction.y;
  let wx = array<f32, 4>(
    -0.5 * fraction.x + tx2 - 0.5 * tx3,
    1.0 - 2.5 * tx2 + 1.5 * tx3,
    0.5 * fraction.x + 2.0 * tx2 - 1.5 * tx3,
    -0.5 * tx2 + 0.5 * tx3
  );
  let wy = array<f32, 4>(
    -0.5 * fraction.y + ty2 - 0.5 * ty3,
    1.0 - 2.5 * ty2 + 1.5 * ty3,
    0.5 * fraction.y + 2.0 * ty2 - 1.5 * ty3,
    -0.5 * ty2 + 0.5 * ty3
  );
  var sampled = 0.0;
  for (var y = 0; y < 4; y += 1) {
    for (var x = 0; x < 4; x += 1) {
      let point = base + vec2i(x - 1, y - 1);
      let inside = all(point >= vec2i(0)) && all(point < size);
      let value = select(
        0.0,
        textureLoad(bevelHeightTexture, clamp(point, vec2i(0), size - vec2i(1)), 0).a,
        inside
      );
      sampled += value * wx[x] * wy[y];
    }
  }
  return clamp(sampled, 0.0, 1.0);
}

// Catmull-Rom reconstruction and its analytic document-space derivatives in
// one 4x4 neighborhood. This replaces eight separately reconstructed Sobel
// samples (128 loads) with sixteen loads for the complete Smooth normal.
fn smoothHeightGradientAtLod(uv: vec2f, secondary: bool) -> vec3f {
  let roi = settings.gradientMidpoints[2];
  var size = vec2i(textureDimensions(bevelHeightTexture));
  var scale = max(settings.gradientMidpoints[3].x, 1.0);
  if (secondary) {
    size = vec2i(textureDimensions(bevelHeightTextureSecondary));
    scale = max(settings.gradientMidpoints[3].y, 1.0);
  }
  let documentPixel = floor(uv * settings.canvas.xy) + vec2f(0.5);
  let position = (documentPixel - roi.xy) / scale - vec2f(0.5);
  let base = vec2i(floor(position));
  let fraction = fract(position);
  let tx2 = fraction.x * fraction.x;
  let tx3 = tx2 * fraction.x;
  let ty2 = fraction.y * fraction.y;
  let ty3 = ty2 * fraction.y;
  let wx = array<f32, 4>(
    -0.5 * fraction.x + tx2 - 0.5 * tx3,
    1.0 - 2.5 * tx2 + 1.5 * tx3,
    0.5 * fraction.x + 2.0 * tx2 - 1.5 * tx3,
    -0.5 * tx2 + 0.5 * tx3
  );
  let wy = array<f32, 4>(
    -0.5 * fraction.y + ty2 - 0.5 * ty3,
    1.0 - 2.5 * ty2 + 1.5 * ty3,
    0.5 * fraction.y + 2.0 * ty2 - 1.5 * ty3,
    -0.5 * ty2 + 0.5 * ty3
  );
  let dx = array<f32, 4>(
    -0.5 + 2.0 * fraction.x - 1.5 * tx2,
    -5.0 * fraction.x + 4.5 * tx2,
    0.5 + 4.0 * fraction.x - 4.5 * tx2,
    -fraction.x + 1.5 * tx2
  );
  let dy = array<f32, 4>(
    -0.5 + 2.0 * fraction.y - 1.5 * ty2,
    -5.0 * fraction.y + 4.5 * ty2,
    0.5 + 4.0 * fraction.y - 4.5 * ty2,
    -fraction.y + 1.5 * ty2
  );
  var height = 0.0;
  var gradient = vec2f(0.0);
  for (var y = 0; y < 4; y += 1) {
    for (var x = 0; x < 4; x += 1) {
      let point = base + vec2i(x - 1, y - 1);
      let inside = all(point >= vec2i(0)) && all(point < size);
      var value = 0.0;
      if (inside) {
        let safePoint = clamp(point, vec2i(0), size - vec2i(1));
        if (secondary) {
          value = textureLoad(bevelHeightTextureSecondary, safePoint, 0).a;
        } else {
          value = textureLoad(bevelHeightTexture, safePoint, 0).a;
        }
      }
      height += value * wx[x] * wy[y];
      gradient.x += value * dx[x] * wy[y];
      gradient.y += value * wx[x] * dy[y];
    }
  }
  return vec3f(clamp(height, 0.0, 1.0), gradient / scale);
}

fn smoothHeightGradientAt(uv: vec2f) -> vec3f {
  let primary = smoothHeightGradientAtLod(uv, false);
  let blend = clamp(settings.gradientMidpoints[3].z, 0.0, 1.0);
  if (blend <= 0.0) { return primary; }
  return mix(primary, smoothHeightGradientAtLod(uv, true), blend);
}

fn bevelHeightAt(uv: vec2f, pixelOffset: vec2i, radius: f32, style: i32, technique: f32) -> f32 {
  if (technique < 0.5) { return smoothHeightAt(uv, pixelOffset); }
  return chiselHeight(bevelDistanceAt(uv, pixelOffset), radius, style, technique);
}

fn bevelCoverageAt(uv: vec2f, radius: f32, style: i32, technique: f32) -> f32 {
  let center = alphaAt(uv, vec2f(0.0));
  // Smooth derives both height and support from the blurred matte. Restricting
  // it to the chisel distance field would make a missing/evicted field flatten
  // an otherwise valid smooth bevel. The matte gradient itself limits the
  // visible lighting band; this branch only enforces inner/outer semantics.
  if (technique < 0.5) {
    if (style == 0) { return 1.0 - center; }
    if (style == 1 || style == 3) { return center; }
    return 1.0;
  }
  let distance = bevelDistanceAt(uv, vec2i(0));
  let extent = max(radius, 0.5);
  let innerBand = (1.0 - smoothstep(extent - 0.75, extent + 0.75, max(distance, 0.0))) * center;
  let outerBand = (1.0 - smoothstep(extent - 0.75, extent + 0.75, max(-distance, 0.0))) * (1.0 - center);
  if (style == 0) { return outerBand; }
  if (style == 1 || style == 3) { return innerBand; }
  return max(innerBand, outerBand);
}

fn shapedCoverage(
  value: f32,
  choke: f32,
  noise: f32,
  pixel: vec2f,
  hardenTails: bool
) -> f32 {
  // Exterior glow choke removes its low tail while saturating the dense core.
  // Shadow spread uses Photoshop's broader solid-core response instead.
  let amount = clamp(choke, 0.0, 1.0);
  let lower = amount * 0.25;
  let upper = max(lower + 1e-4, 1.0 - amount * 0.75);
  let hardened = smoothstep(lower, upper, clamp(value, 0.0, 1.0));
  let glowChoke = mix(clamp(value, 0.0, 1.0), hardened, clamp(amount * 2.0, 0.0, 1.0));
  let shadowSpread = pow(clamp(value, 0.0, 1.0), max(0.05, 1.0 - amount * 1.7));
  let tightened = select(glowChoke, shadowSpread, hardenTails);
  return clamp(contourAt(tightened) + (noiseAt(pixel) - 0.5) * noise, 0.0, 1.0);
}

fn linearToSrgb(color: vec3f) -> vec3f {
  return select(
    color * 12.92,
    1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055,
    color > vec3f(0.0031308)
  );
}

fn srgbToLinear(color: vec3f) -> vec3f {
  return select(
    color / 12.92,
    pow((color + 0.055) / 1.055, vec3f(2.4)),
    color > vec3f(0.04045)
  );
}

fn gradientColorAt(position: f32, count: u32, interpolationMethod: f32) -> vec3f {
  if (count == 0u) { return vec3f(0.0); }
  var lower = 0u;
  var upper = count - 1u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.gradientColors[index].w <= position) {
      lower = index;
    }
  }
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.gradientColors[index].w >= position) {
      upper = min(upper, index);
    }
  }
  let first = settings.gradientColors[lower];
  let second = settings.gradientColors[upper];
  var amount = select(
    clamp((position - first.w) / max(second.w - first.w, 1e-6), 0.0, 1.0),
    0.0,
    lower == upper
  );
  let midpoint = clamp(settings.gradientMidpoints[lower].x, 0.01, 0.99);
  amount = select(
    0.5 * amount / midpoint,
    0.5 + 0.5 * (amount - midpoint) / (1.0 - midpoint),
    amount >= midpoint
  );
  let linear = mix(first.rgb, second.rgb, amount);
  if (i32(interpolationMethod + 0.5) == 2) {
    return srgbToLinear(mix(linearToSrgb(first.rgb), linearToSrgb(second.rgb), amount));
  }
  return linear;
}

fn gradientOpacityAt(position: f32, count: u32) -> f32 {
  if (count == 0u) { return 1.0; }
  var lower = 0u;
  var upper = count - 1u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.gradientOpacity[index].x <= position) {
      lower = index;
    }
  }
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && settings.gradientOpacity[index].x >= position) {
      upper = min(upper, index);
    }
  }
  let first = settings.gradientOpacity[lower];
  let second = settings.gradientOpacity[upper];
  var amount = select(
    clamp((position - first.x) / max(second.x - first.x, 1e-6), 0.0, 1.0),
    0.0,
    lower == upper
  );
  // A midpoint of 0.5 is linear. Other values move the perceptual halfway
  // point without introducing a discontinuity.
  let midpoint = clamp(first.z, 0.01, 0.99);
  amount = select(
    0.5 * amount / midpoint,
    0.5 + 0.5 * (amount - midpoint) / (1.0 - midpoint),
    amount >= midpoint
  );
  return mix(first.y, second.y, clamp(amount, 0.0, 1.0));
}

fn gradientPositionAt(
  uv: vec2f,
  angleDegrees: f32,
  style: i32,
  scale: f32,
  offset: vec2f,
  reverse: bool,
  bounds: vec4f,
  alignWithLayer: bool
) -> f32 {
  let direction = vec2f(cos(radians(angleDegrees)), -sin(radians(angleDegrees)));
  let canvasBounds = vec4f(0.0, 0.0, settings.canvas.x, settings.canvas.y);
  let activeBounds = select(canvasBounds, bounds, alignWithLayer);
  let pixel = uv * settings.canvas.xy;
  let center = activeBounds.xy + activeBounds.zw * 0.5;
  let centered = pixel - center - offset * activeBounds.zw * 0.5;
  // Photoshop keeps Scale independent of angle; rotating a linear gradient
  // must not lengthen it by the projected bounding-box diagonal.
  let extent = max(max(activeBounds.z, activeBounds.w), 1.0) * max(scale, 0.01);
  var position = dot(centered, direction) / extent + 0.5;
  if (style == 1) {
    position = length(centered) / max(extent * 0.5, 1e-6);
  }
  if (style == 2) {
    position = fract(atan2(centered.y, centered.x) / 6.28318531 + 1.0);
  }
  if (style == 3) {
    position = abs(dot(centered, direction)) / max(extent * 0.5, 1e-6);
  }
  if (style == 4) {
    let rotated = vec2f(dot(centered, direction), dot(centered, vec2f(-direction.y, direction.x)));
    position = (abs(rotated.x) + abs(rotated.y)) / max(extent * 0.5, 1e-6);
  }
  position = clamp(position, 0.0, 1.0);
  return select(position, 1.0 - position, reverse);
}

fn patternColorAt(uv: vec2f, angleDegrees: f32, scale: f32, offset: vec2f) -> vec4f {
  let dimensions = vec2f(textureDimensions(patternTexture));
  let canvasPixel = uv * settings.canvas.xy;
  let centered = canvasPixel - settings.canvas.xy * 0.5;
  let angle = radians(angleDegrees);
  let rotated = vec2f(
    centered.x * cos(angle) - centered.y * sin(angle),
    centered.x * sin(angle) + centered.y * cos(angle)
  );
  let scaledDimensions = max(dimensions * max(scale, 0.01), vec2f(1.0));
  let patternUv = fract(rotated / scaledDimensions + vec2f(0.5) + offset);
  return textureSampleLevel(patternTexture, sourceSampler, patternUv, 0.0);
}

fn expandedAlpha(uv: vec2f, radius: f32) -> f32 {
  if (radius <= 0.01) { return alphaAt(uv, vec2f(0.0)); }
  let directions = array<vec2f, ${LAYER_STYLE_MORPH_DIRECTION_COUNT}>(
    ${LAYER_STYLE_MORPH_DIRECTIONS}
  );
  let sampleCount = u32(clamp(settings.gradientMidpoints[1].w, 1.0,
    f32(${LAYER_STYLE_MORPH_DIRECTION_COUNT})) + 0.5);
  var coverage = alphaAt(uv, vec2f(0.0));
  for (var sampleIndex = 0u; sampleIndex < sampleCount; sampleIndex += 1u) {
    let index = (sampleIndex * ${LAYER_STYLE_MORPH_DIRECTION_COUNT}u) / sampleCount;
    let direction = directions[index] * radius;
    coverage = max(coverage, alphaAt(uv, direction * 0.35));
    coverage = max(coverage, alphaAt(uv, direction * 0.72));
    coverage = max(coverage, alphaAt(uv, direction));
  }
  return coverage;
}

fn contractedAlpha(uv: vec2f, radius: f32) -> f32 {
  if (radius <= 0.01) { return alphaAt(uv, vec2f(0.0)); }
  let directions = array<vec2f, ${LAYER_STYLE_MORPH_DIRECTION_COUNT}>(
    ${LAYER_STYLE_MORPH_DIRECTIONS}
  );
  let sampleCount = u32(clamp(settings.gradientMidpoints[1].w, 1.0,
    f32(${LAYER_STYLE_MORPH_DIRECTION_COUNT})) + 0.5);
  var coverage = alphaAt(uv, vec2f(0.0));
  for (var sampleIndex = 0u; sampleIndex < sampleCount; sampleIndex += 1u) {
    let index = (sampleIndex * ${LAYER_STYLE_MORPH_DIRECTION_COUNT}u) / sampleCount;
    let direction = directions[index] * radius;
    coverage = min(coverage, alphaAt(uv, direction * 0.35));
    coverage = min(coverage, alphaAt(uv, direction * 0.72));
    coverage = min(coverage, alphaAt(uv, direction));
  }
  return coverage;
}

fn strokeCoverageAt(uv: vec2f, radius: f32, position: f32) -> f32 {
  let centerAlpha = textureSampleLevel(shapeTexture, sourceSampler, uv, 0.0).a;
  // Photoshop's center stroke size is its total width: half is inside and
  // half outside. Inside/outside strokes consume the full authored size.
  let morphologyRadius = select(radius, radius * 0.5, position >= 1.5);
  if (position < 0.5) {
    return max(0.0, expandedAlpha(uv, max(morphologyRadius, 0.5)) - centerAlpha);
  }
  let contracted = contractedAlpha(uv, max(morphologyRadius, 0.5));
  if (position < 1.5) { return max(0.0, centerAlpha - contracted); }
  return max(0.0, expandedAlpha(uv, max(morphologyRadius, 0.5)) - contracted);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let kind = i32(settings.header.x + 0.5);
  let opacity = settings.header.y;
  let mode = i32(settings.header.z + 0.5);
  let fillOpacity = settings.header.w;
  let current = textureSampleLevel(currentTexture, sourceSampler, input.uv, 0.0);
  let shape = textureSampleLevel(shapeTexture, sourceSampler, input.uv, 0.0);
  let pixel = input.uv * settings.canvas.xy;

  // Base pass: preserve the unfilled alpha in shapeTexture while materializing
  // only the layer content into the ordered style result.
  if (kind == 0) {
    return shape * fillOpacity;
  }

  if (kind == 1) {
    return styleOverCurrent(current, settings.color0.rgb, shape.a * opacity, mode);
  }

  let angle = radians(settings.params0.x);
  let distance = settings.params0.y;
  let radius = settings.params0.z;
  let choke = settings.params0.w;
  let offset = vec2f(cos(angle), -sin(angle)) * distance;
  let noise = settings.params1.w;

  if (kind == 2) {
    // Photoshop stores the light angle, while the cast shadow travels away
    // from that light. alphaAt samples at uv + offset, which shifts the
    // visible coverage by -offset and therefore implements that convention.
    let coverage = shapedCoverage(blurredAlpha(input.uv, offset, radius), choke, noise, pixel, true);
    let knockout = clamp(settings.params1.x, 0.0, 1.0);
    let alpha = clamp(coverage * opacity * mix(1.0, 1.0 - shape.a, knockout), 0.0, 1.0);
    let shadow = vec4f(settings.color0.rgb * alpha, alpha);
    return over(current, shadow);
  }
  if (kind == 3) {
    // Inner Shadow uses the same Photoshop light-angle convention. Sampling
    // toward the light leaves the inward-facing edge in shadow.
    let absent = 1.0 - blurredAlpha(input.uv, offset, radius);
    let alpha = shape.a * shapedCoverage(absent, choke, noise, pixel, true) * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 4) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let raw = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let ranged = pow(clamp(raw, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let expanded = shapedCoverage(ranged, choke, noise, pixel, false);
    let alpha = max(0.0, expanded - shape.a) * opacity;
    let glow = vec4f(settings.color0.rgb * alpha, alpha);
    return over(current, glow);
  }
  if (kind == 11) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let raw = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let ranged = pow(clamp(raw, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let expanded = shapedCoverage(ranged, choke, noise, pixel, false);
    let alphaCoverage = max(0.0, expanded - shape.a);
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let gradientAlpha = gradientOpacityAt(alphaCoverage, opacityCount);
    let alpha = clamp(alphaCoverage * opacity * gradientAlpha, 0.0, 1.0);
    let glow = vec4f(gradientColorAt(alphaCoverage, colorCount, 1.0) * alpha, alpha);
    return over(current, glow);
  }
  if (kind == 5) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let blurred = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let sourceCenter = settings.params1.x;
    let ranged = pow(clamp(blurred, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let coverage = select(1.0 - ranged, ranged, sourceCenter > 0.5);
    let alpha = shapedCoverage(coverage, choke, noise, pixel, false) * shape.a * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 12) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let blurred = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let sourceCenter = settings.params1.x;
    let ranged = pow(clamp(blurred, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let coverage = select(1.0 - ranged, ranged, sourceCenter > 0.5);
    let shaped = shapedCoverage(coverage, choke, noise, pixel, false) * shape.a;
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let alpha = shaped * opacity * gradientOpacityAt(coverage, opacityCount);
    return styleOverCurrent(current, gradientColorAt(coverage, colorCount, 1.0), alpha, mode);
  }
  if (kind == 6) {
    let position = settings.params1.x;
    let coverage = strokeCoverageAt(input.uv, radius, position);
    let alpha = coverage * opacity;
    if (position < 0.5) {
      return over(current, vec4f(settings.color0.rgb * alpha, alpha));
    }
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 7) {
    let style = i32(settings.params1.y + 0.5);
    let position = gradientPositionAt(
      input.uv,
      settings.params0.x,
      style,
      settings.params0.z,
      vec2f(settings.params0.y, settings.params0.w),
      settings.params1.x > 0.5,
      vec4f(settings.gradientMidpoints[0].yzw, settings.gradientMidpoints[1].y),
      settings.gradientMidpoints[1].z > 0.5
    );
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let color = gradientColorAt(position, colorCount, settings.params1.w);
    let gradientOpacity = gradientOpacityAt(position, opacityCount);
    let dither = select(0.0, (noiseAt(pixel) - 0.5) / 255.0, settings.params1.z > 0.5);
    return styleOverCurrent(current, color + vec3f(dither), shape.a * opacity * gradientOpacity, mode);
  }
  if (kind == 10) {
    let strokePosition = settings.params1.x;
    let coverage = strokeCoverageAt(input.uv, fillOpacity, strokePosition);
    let position = gradientPositionAt(
      input.uv,
      settings.params0.x,
      i32(settings.params1.y + 0.5),
      settings.params0.z,
      vec2f(settings.params0.y, settings.params0.w),
      settings.params1.w > 0.5,
      vec4f(settings.gradientMidpoints[0].yzw, settings.gradientMidpoints[1].y),
      settings.gradientMidpoints[1].z > 0.5
    );
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let gradientOpacity = gradientOpacityAt(position, opacityCount);
    let dither = select(0.0, (noiseAt(pixel) - 0.5) / 255.0, settings.params1.z > 0.5);
    let alpha = coverage * opacity * gradientOpacity;
    let color = gradientColorAt(position, colorCount, 1.0) + vec3f(dither);
    if (strokePosition < 0.5) {
      return over(current, vec4f(color * alpha, alpha));
    }
    return styleOverCurrent(current, color, alpha, mode);
  }
  if (kind == 13) {
    let pattern = patternColorAt(
      input.uv,
      settings.params0.x,
      settings.params0.z,
      vec2f(settings.params0.y, settings.params0.w)
    );
    return styleOverCurrent(
      current,
      pattern.rgb / max(pattern.a, 1e-6),
      shape.a * pattern.a * opacity,
      mode
    );
  }
  if (kind == 14) {
    let strokePosition = settings.params1.x;
    let coverage = strokeCoverageAt(input.uv, fillOpacity, strokePosition);
    let pattern = patternColorAt(input.uv, settings.params0.x, settings.params0.z, vec2f(0.0));
    let alpha = coverage * pattern.a * opacity;
    let color = pattern.rgb / max(pattern.a, 1e-6);
    if (strokePosition < 0.5) {
      return over(current, vec4f(color * alpha, alpha));
    }
    return styleOverCurrent(current, color, alpha, mode);
  }
  if (kind == 8) {
    let first = blurredAlpha(input.uv, offset, radius);
    let second = blurredAlpha(input.uv, -offset, radius);
    let coverage = contourAt(abs(first - second)) * shape.a;
    let invert = settings.params1.x;
    let alpha = mix(coverage, shape.a - coverage, invert) * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 9) {
    let soften = max(settings.params1.z, 0.0);
    let technique = fillOpacity;
    let style = i32(settings.params1.w + 0.5);
    var normal = vec2f(0.0);
    if (technique < 0.5) {
      normal = smoothHeightGradientAt(input.uv).yz;
    } else {
      let tl = bevelHeightAt(input.uv, vec2i(-1, -1), radius, style, technique);
      let tc = bevelHeightAt(input.uv, vec2i( 0, -1), radius, style, technique);
      let tr = bevelHeightAt(input.uv, vec2i( 1, -1), radius, style, technique);
      let ml = bevelHeightAt(input.uv, vec2i(-1,  0), radius, style, technique);
      let mr = bevelHeightAt(input.uv, vec2i( 1,  0), radius, style, technique);
      let bl = bevelHeightAt(input.uv, vec2i(-1,  1), radius, style, technique);
      let bc = bevelHeightAt(input.uv, vec2i( 0,  1), radius, style, technique);
      let br = bevelHeightAt(input.uv, vec2i( 1,  1), radius, style, technique);
      normal = vec2f(
        (-tl - 2.0 * ml - bl + tr + 2.0 * mr + br) / 8.0,
        (-tl - 2.0 * tc - tr + bl + 2.0 * bc + br) / 8.0
      );
    }
    let depth = max(settings.params0.w, 0.01) * select(1.0, -1.0, settings.params1.x > 0.5);
    // Height-field derivatives are measured per pixel. Scale the normalized
    // unit-height slope into the authored Layer Style depth range; the legacy
    // radius-sized derivative implicitly supplied a much larger baseline.
    let surfaceNormal = normalize(vec3f(-normal * depth * 64.0, 1.0));
    let altitude = radians(clamp(settings.params0.y, 0.0, 90.0));
    let light = normalize(vec3f(
      cos(angle) * cos(altitude),
      -sin(angle) * cos(altitude),
      sin(altitude)
    ));
    // A flat layer is the neutral baseline. Layer Styles add only the relief
    // response; retaining the light's Z term would highlight the entire bevel
    // band and leave almost no room for the opposing Photoshop shadow lobe.
    var lighting = dot(surfaceNormal, light) - sin(altitude);
    let textureSettings = settings.gradientColors[0];
    if (textureSettings.x > 0.5) {
      let textureSampleValue = patternColorAt(
        input.uv,
        0.0,
        max(textureSettings.y, 0.01),
        vec2f(0.0)
      );
      var textureHeight = dot(
        textureSampleValue.rgb / max(textureSampleValue.a, 1e-6),
        vec3f(0.2126, 0.7152, 0.0722)
      ) - 0.5;
      textureHeight = select(textureHeight, -textureHeight, textureSettings.w > 0.5);
      lighting += textureHeight * textureSettings.z;
    }
    var coverage = bevelCoverageAt(input.uv, max(radius + soften, 0.5), style, technique);
    if (style == 3) {
      lighting = -lighting;
    }
    let highlight = contourAt(max(lighting, 0.0)) * coverage * settings.color0.a;
    let shadow = contourAt(max(-lighting, 0.0)) * coverage * settings.color1.a;
    var result = styleOverCurrent(current, settings.color1.rgb, shadow * opacity, i32(settings.params1.y + 0.5));
    result = styleOverCurrent(result, settings.color0.rgb, highlight * opacity, mode);
    return result;
  }

  return current;
}
`;

/**
 * Initializes an anti-aliased distance field from effective layer alpha.
 * Relative seed vectors keep rgba16float precision local even on 10K canvases.
 */
export const LAYER_STYLE_BEVEL_SEED_WGSL = /* wgsl */ `
struct BevelSeedSettings {
  canvasSize: vec2f,
  roiOrigin: vec2f,
  roiSize: vec2f,
  maximumDistance: f32,
  padding: f32,
}

@group(0) @binding(0) var shapeTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: BevelSeedSettings;

fn alphaAtDocumentPixel(point: vec2i) -> f32 {
  let size = vec2i(settings.canvasSize);
  let inside = all(point >= vec2i(0)) && all(point < size);
  return select(
    0.0,
    clamp(textureLoad(shapeTexture, clamp(point, vec2i(0), size - vec2i(1)), 0).a, 0.0, 1.0),
    inside
  );
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let localPixel = clamp(
    vec2i(floor(input.uv * settings.roiSize)),
    vec2i(0),
    vec2i(settings.roiSize) - vec2i(1)
  );
  let point = vec2i(settings.roiOrigin) + localPixel;
  var alpha = array<f32, 9>();
  var low = 1.0;
  var high = 0.0;
  var index = 0u;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let value = alphaAtDocumentPixel(point + vec2i(x, y));
      alpha[index] = value;
      low = min(low, value);
      high = max(high, value);
      index += 1u;
    }
  }
  let center = alpha[4];
  let signValue = select(-1.0, 1.0, center >= 0.5);
  if (!(low <= 0.5 && high >= 0.5) || high - low < 1e-5) {
    return vec4f(0.0, 0.0, signValue, 0.0);
  }

  // Gustavson/Strand-style subpixel initialization: alpha supplies edge
  // coverage and a Sobel gradient supplies the edge direction. A binary seed
  // would discard the most valuable information in antialiased text/vectors.
  let gradient = vec2f(
    -alpha[0] - 2.0 * alpha[3] - alpha[6] + alpha[2] + 2.0 * alpha[5] + alpha[8],
    -alpha[0] - 2.0 * alpha[1] - alpha[2] + alpha[6] + 2.0 * alpha[7] + alpha[8]
  );
  let magnitude = length(gradient);
  let direction = select(vec2f(1.0, 0.0), gradient / magnitude, magnitude > 1e-5);
  let coverageDistance = clamp((0.5 - center) / max(magnitude, 1.0), -0.75, 0.75);
  return vec4f(direction * coverageDistance, signValue, 1.0);
}
`;

/** Relative-vector jump flooding, bounded to the authored effect radius. */
export const LAYER_STYLE_BEVEL_FLOOD_WGSL = /* wgsl */ `
struct BevelFloodSettings {
  roiSize: vec2f,
  stepSize: f32,
  maximumDistance: f32,
  padding: vec4f,
}

@group(0) @binding(0) var sourceField: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: BevelFloodSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(settings.roiSize);
  let point = clamp(vec2i(floor(input.uv * settings.roiSize)), vec2i(0), size - vec2i(1));
  let center = textureLoad(sourceField, point, 0);
  var bestVector = center.xy;
  var bestSquared = select(1e20, dot(bestVector, bestVector), center.w > 0.5);
  let step = max(1, i32(settings.stepSize + 0.5));
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let delta = vec2i(x, y) * step;
      let candidatePoint = point + delta;
      let inside = all(candidatePoint >= vec2i(0)) && all(candidatePoint < size);
      if (inside) {
        let candidateSeed = textureLoad(sourceField, candidatePoint, 0);
        if (candidateSeed.w > 0.5) {
          let candidate = vec2f(delta) + candidateSeed.xy;
          let squared = dot(candidate, candidate);
          if (squared < bestSquared && squared <= settings.maximumDistance * settings.maximumDistance) {
            bestSquared = squared;
            bestVector = candidate;
          }
        }
      }
    }
  }
  return vec4f(bestVector, center.z, select(0.0, 1.0, bestSquared < 1e19));
}
`;

/**
 * Bounded sampled blur used by shadows, glows and satin. Keep this pipeline
 * independent from Bevel: those effects intentionally use a dense, exact
 * height-field blur and must not silently change the look or cost of every
 * other Layer Style.
 */
export const LAYER_STYLE_GAUSSIAN_BLUR_WGSL = /* wgsl */ `
struct LayerStyleBlurSettings {
  outputSize: vec2f,
  sourceSize: vec2f,
  sourceOrigin: vec2f,
  direction: vec2f,
  radius: f32,
  outputToSourceScale: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: LayerStyleBlurSettings;

const gaussianKernel = array<vec2f, 17>(
  vec2f(0.00000000, 0.074947560), vec2f(0.06250000, 0.073641634),
  vec2f(0.12500000, 0.069858807), vec2f(0.18750000, 0.063980960),
  vec2f(0.25000000, 0.056573386), vec2f(0.31250000, 0.048295362),
  vec2f(0.37500000, 0.039804348), vec2f(0.43750000, 0.031672872),
  vec2f(0.50000000, 0.024331910), vec2f(0.56250000, 0.018046658),
  vec2f(0.62500000, 0.012922580), vec2f(0.68750000, 0.008933744),
  vec2f(0.75000000, 0.005962791), vec2f(0.81250000, 0.003842355),
  vec2f(0.87500000, 0.002390437), vec2f(0.93750000, 0.001435783),
  vec2f(1.00000000, 0.000832592)
);

fn alphaSample(sourcePixel: vec2f) -> f32 {
  let uv = sourcePixel / settings.sourceSize;
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
  return select(
    0.0,
    textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).a,
    inside
  );
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let radius = max(settings.radius, 0.0);
  let center = settings.sourceOrigin
    + input.uv * settings.outputSize * settings.outputToSourceScale;
  var result = alphaSample(center) * gaussianKernel[0].y;
  for (var tap = 1u; tap < 17u; tap += 1u) {
    let kernel = gaussianKernel[tap];
    let sampleOffset = settings.direction * radius * kernel.x;
    result += (alphaSample(center + sampleOffset) + alphaSample(center - sampleOffset)) * kernel.y;
  }
  return vec4f(clamp(result, 0.0, 1.0));
}
`;

/**
 * Dense separable alpha Gaussian used by production shadow fields. This uses
 * the same radius/3 sigma contract as Filter BlurCore, while retaining the
 * Layer Style renderer's adaptive working resolution. Unlike the legacy
 * 17-position approximation, every working pixel inside the support is
 * sampled, so large soft shadows do not acquire bands or rectangular steps.
 */
export const LAYER_STYLE_DENSE_GAUSSIAN_BLUR_WGSL = /* wgsl */ `
struct LayerStyleBlurSettings {
  outputSize: vec2f,
  sourceSize: vec2f,
  sourceOrigin: vec2f,
  direction: vec2f,
  radius: f32,
  outputToSourceScale: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: LayerStyleBlurSettings;

fn alphaLoad(point: vec2i) -> f32 {
  let size = vec2i(textureDimensions(sourceTexture));
  let inside = all(point >= vec2i(0)) && all(point < size);
  return select(0.0, textureLoad(sourceTexture, clamp(point, vec2i(0), size - vec2i(1)), 0).a, inside);
}

fn alphaSample(sourcePixel: vec2f) -> f32 {
  let scale = max(1, i32(round(settings.outputToSourceScale)));
  if (scale == 1) { return alphaLoad(vec2i(floor(sourcePixel))); }
  let base = vec2i(floor(sourcePixel - vec2f(f32(scale) * 0.5)));
  var total = 0.0;
  for (var y = 0; y < 8; y += 1) {
    if (y >= scale) { break; }
    for (var x = 0; x < 8; x += 1) {
      if (x >= scale) { break; }
      total += alphaLoad(base + vec2i(x, y));
    }
  }
  return total / f32(scale * scale);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let radius = max(settings.radius, 0.0);
  let support = min(100, i32(ceil(radius)));
  let sigma = max(radius / 3.0, 0.5);
  let denominator = 2.0 * sigma * sigma;
  let outputPixel = floor(input.uv * settings.outputSize);
  let center = settings.sourceOrigin
    + (outputPixel + vec2f(0.5)) * settings.outputToSourceScale;
  var result = alphaSample(center);
  var total = 1.0;
  for (var tap = 1; tap <= 100; tap += 1) {
    if (tap > support) { break; }
    let offset = f32(tap);
    let weight = exp(-(offset * offset) / denominator);
    let sampleOffset = settings.direction * offset * settings.outputToSourceScale;
    result += (alphaSample(center + sampleOffset) + alphaSample(center - sampleOffset)) * weight;
    total += 2.0 * weight;
  }
  let coverage = clamp(result / total, 0.0, 1.0);
  return vec4f(coverage);
}
`;

/**
 * Pixel-aligned dense Gaussian used only to construct the Bevel height field.
 * Bevel ROI passes map one output pixel to exactly one source pixel, so a
 * direct load is pixel-identical to the previous hand-written bilinear sample
 * while requiring one quarter of the texture reads.
 */
export const LAYER_STYLE_BEVEL_BLUR_WGSL = /* wgsl */ `
struct LayerStyleBlurSettings {
  outputSize: vec2f,
  sourceSize: vec2f,
  sourceOrigin: vec2f,
  direction: vec2f,
  radius: f32,
  outputToSourceScale: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: LayerStyleBlurSettings;

fn alphaLoad(point: vec2i) -> f32 {
  let size = vec2i(textureDimensions(sourceTexture));
  let inside = all(point >= vec2i(0)) && all(point < size);
  return select(0.0, textureLoad(sourceTexture, clamp(point, vec2i(0), size - vec2i(1)), 0).a, inside);
}

fn alphaSample(sourcePixel: vec2f) -> f32 {
  let scale = max(1, i32(round(settings.outputToSourceScale)));
  if (scale == 1) { return alphaLoad(vec2i(floor(sourcePixel))); }
  let base = vec2i(floor(sourcePixel - vec2f(f32(scale) * 0.5)));
  var total = 0.0;
  for (var y = 0; y < 16; y += 1) {
    if (y >= scale) { break; }
    for (var x = 0; x < 16; x += 1) {
      if (x >= scale) { break; }
      total += alphaLoad(base + vec2i(x, y));
    }
  }
  return total / f32(scale * scale);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let radius = max(settings.radius, 0.0);
  let support = min(100, i32(ceil(radius)));
  let sigma = max(radius / 4.0, 0.5);
  let denominator = 2.0 * sigma * sigma;
  let outputPixel = floor(input.uv * settings.outputSize);
  let center = settings.sourceOrigin
    + (outputPixel + vec2f(0.5)) * settings.outputToSourceScale;
  var result = alphaSample(center);
  var total = 1.0;
  for (var tap = 1; tap <= 100; tap += 1) {
    if (tap > support) { break; }
    let offset = f32(tap);
    let taper = 1.0 - smoothstep(0.75, 1.0, offset / max(radius, 1.0));
    let weight = exp(-(offset * offset) / denominator) * taper;
    let sampleOffset = settings.direction * offset * settings.outputToSourceScale;
    result += (alphaSample(center + sampleOffset) + alphaSample(center - sampleOffset)) * weight;
    total += 2.0 * weight;
  }
  let coverage = clamp(result / total, 0.0, 1.0);
  return vec4f(coverage);
}
`;

export const ADJUSTMENT_LAYER_MIX_WGSL = /* wgsl */ `
struct AdjustmentMixSettings {
  opacity: f32,
  maskEnabled: f32,
  clippingEnabled: f32,
  blendMode: f32,
  maskDensity: f32,
  maskFeather: f32,
  maskPadding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var adjustedTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: AdjustmentMixSettings;
@group(0) @binding(4) var maskTexture: texture_2d<f32>;
@group(0) @binding(5) var clippingTexture: texture_2d<f32>;

${LAYER_BLEND_FUNCTIONS_WGSL}

fn evaluatedMask(uv: vec2f) -> f32 {
  var value = textureSample(maskTexture, sourceSampler, uv).r;
  if (settings.maskFeather > 0.01) {
    let texel = vec2f(1.0) / vec2f(textureDimensions(maskTexture));
    let radius = settings.maskFeather * texel;
    var sum = 0.0;
    let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
    for (var y = 0; y < 5; y += 1) {
      for (var x = 0; x < 5; x += 1) {
        let offset = vec2f(f32(x - 2), f32(y - 2)) * radius * 0.5;
        sum += textureSample(maskTexture, sourceSampler, clamp(uv + offset, vec2f(0.0), vec2f(1.0))).r
          * weights[x] * weights[y];
      }
    }
    value = sum / 256.0;
  }
  return mix(1.0, clamp(value, 0.0, 1.0), clamp(settings.maskDensity, 0.0, 1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(sourceTexture, sourceSampler, input.uv);
  let adjusted = textureSample(adjustedTexture, sourceSampler, input.uv);
  let mask = select(
    1.0,
    evaluatedMask(input.uv),
    settings.maskEnabled > 0.5
  );
  let clipping = select(
    1.0,
    clamp(textureSample(clippingTexture, sourceSampler, input.uv).a, 0.0, 1.0),
    settings.clippingEnabled > 0.5
  );
  let amount = clamp(settings.opacity * mask * clipping, 0.0, 1.0);
  let sourceStraight = source.rgb / max(source.a, 1e-6);
  let adjustedStraight = adjusted.rgb / max(adjusted.a, 1e-6);
  let sourceEncoded = linearStraightToBlend(sourceStraight, settings.maskPadding.x, settings.maskPadding.y);
  let adjustedEncoded = linearStraightToBlend(adjustedStraight, settings.maskPadding.x, settings.maskPadding.y);
  let blendedEncoded = blendColorEncoded(
    sourceEncoded,
    adjustedEncoded,
    i32(settings.blendMode + 0.5),
    settings.maskPadding.y
  );
  let outputAlpha = mix(source.a, adjusted.a, amount);
  let outputEncoded = mix(sourceEncoded, blendedEncoded, amount);
  return vec4f(blendStraightToLinear(outputEncoded, settings.maskPadding.x) * outputAlpha, outputAlpha);
}
`;

export const BRUSH_DAB_WGSL = /* wgsl */ `
struct BrushDab {
  centerSizeHardness: vec4f,
  colorOpacity: vec4f,
  tip: vec4f,
}

struct BrushCanvas {
  size: vec2f,
  padding: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  forwardRow0: vec4f,
  forwardRow1: vec4f,
}

struct BrushVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) centerSizeHardness: vec4f,
  @location(1) colorOpacity: vec4f,
  @location(2) tip: vec4f,
}

@group(0) @binding(0) var<storage, read> dabs: array<BrushDab>;
@group(0) @binding(1) var<uniform> canvas: BrushCanvas;
@group(0) @binding(2) var selectionMask: texture_2d<f32>;

@vertex
fn brushVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BrushVertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let dab = dabs[instanceIndex];
  let corner = corners[vertexIndex];
  // The inverse-projected document-space square is only conservative
  // rasterization geometry. Fragment coverage is evaluated independently
  // through the forward local-to-document matrix below.
  let documentPixel = dab.centerSizeHardness.xy + corner * dab.centerSizeHardness.z * 0.5;
  let localPixel = vec2f(
    dot(canvas.inverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(canvas.inverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let clip = vec2f(
    localPixel.x / canvas.size.x * 2.0 - 1.0,
    1.0 - localPixel.y / canvas.size.y * 2.0
  );
  var output: BrushVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.centerSizeHardness = dab.centerSizeHardness;
  output.colorOpacity = dab.colorOpacity;
  output.tip = dab.tip;
  return output;
}

@fragment
fn brushFragment(input: BrushVertexOutput) -> @location(0) vec4f {
  // Fragment position is the destination texture's layer/mask-local coordinate.
  // Project it forward to document space so rotation, scale and translation
  // use exactly the same geometry contract as the compositor.
  let localPixel = input.position.xy;
  let documentPixel = vec2f(
    dot(canvas.forwardRow0.xyz, vec3f(localPixel, 1.0)),
    dot(canvas.forwardRow1.xyz, vec3f(localPixel, 1.0))
  );
  let radius = max(input.centerSizeHardness.z * 0.5, 0.0001);
  let delta = (documentPixel - input.centerSizeHardness.xy) / radius;
  let c = cos(input.tip.y);
  let s = sin(input.tip.y);
  var oriented = vec2f(c * delta.x + s * delta.y, -s * delta.x + c * delta.y);
  oriented.y /= max(input.tip.x, 0.05);
  let angle = atan2(oriented.y, oriented.x);
  let roughNoise = sin(angle * 7.0 + input.tip.w * 2.39996)
    * 0.55 + sin(angle * 13.0 + input.tip.w * 1.61803) * 0.3
    + sin(angle * 23.0 + input.tip.w * 0.75488) * 0.15;
  let roughRadius = max(0.55, 1.0 + roughNoise * input.tip.z);
  let distance = length(oriented) / roughRadius;
  if (distance >= 1.0) { discard; }
  let coverage = 1.0 - smoothstep(
    clamp(input.centerSizeHardness.w, 0.0, 0.995),
    1.0,
    distance
  );
  let pixel = clamp(
    vec2i(documentPixel),
    vec2i(0),
    vec2i(textureDimensions(selectionMask)) - vec2i(1)
  );
  let selectionCoverage = textureLoad(selectionMask, pixel, 0).r;
  let alpha = input.colorOpacity.a * coverage * selectionCoverage;
  return vec4f(input.colorOpacity.rgb * alpha, alpha);
}
`;

/**
 * Clone/Healing brush source compositor. The sampled document is an immutable
 * rgba16float GPU snapshot captured at pointer-down, so a stroke can never
 * feed its own output back into later dabs and never requires CPU readback.
 */
export const SAMPLED_BRUSH_DAB_WGSL = /* wgsl */ `
struct BrushDab {
  centerSizeHardness: vec4f,
  colorOpacity: vec4f,
  tip: vec4f,
}

struct BrushCanvas {
  size: vec2f,
  padding: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  forwardRow0: vec4f,
  forwardRow1: vec4f,
}

struct SampledSourceSettings {
  size: vec2f,
  offset: vec2f,
  // One complete vec4 keeps this uniform 32-byte portable on Dawn and wgpu.
  tuning: vec4f,
}

struct BrushVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) centerSizeHardness: vec4f,
  @location(1) colorOpacity: vec4f,
  @location(2) tip: vec4f,
}

@group(0) @binding(0) var<storage, read> dabs: array<BrushDab>;
@group(0) @binding(1) var<uniform> canvas: BrushCanvas;
@group(0) @binding(2) var selectionMask: texture_2d<f32>;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var sourceSampler: sampler;
@group(0) @binding(5) var<uniform> sourceSettings: SampledSourceSettings;

@vertex
fn brushVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BrushVertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let dab = dabs[instanceIndex];
  let documentPixel = dab.centerSizeHardness.xy
    + corners[vertexIndex] * dab.centerSizeHardness.z * 0.5;
  let localPixel = vec2f(
    dot(canvas.inverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(canvas.inverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let clip = vec2f(
    localPixel.x / canvas.size.x * 2.0 - 1.0,
    1.0 - localPixel.y / canvas.size.y * 2.0
  );
  var output: BrushVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.centerSizeHardness = dab.centerSizeHardness;
  output.colorOpacity = dab.colorOpacity;
  output.tip = dab.tip;
  return output;
}

fn documentPoint(input: BrushVertexOutput) -> vec2f {
  return vec2f(
    dot(canvas.forwardRow0.xyz, vec3f(input.position.xy, 1.0)),
    dot(canvas.forwardRow1.xyz, vec3f(input.position.xy, 1.0))
  );
}

fn dabCoverage(input: BrushVertexOutput, documentPixel: vec2f) -> f32 {
  let radius = max(input.centerSizeHardness.z * 0.5, 0.0001);
  let delta = (documentPixel - input.centerSizeHardness.xy) / radius;
  let c = cos(input.tip.y);
  let s = sin(input.tip.y);
  var oriented = vec2f(c * delta.x + s * delta.y, -s * delta.x + c * delta.y);
  oriented.y /= max(input.tip.x, 0.05);
  let angle = atan2(oriented.y, oriented.x);
  let roughNoise = sin(angle * 7.0 + input.tip.w * 2.39996) * 0.55
    + sin(angle * 13.0 + input.tip.w * 1.61803) * 0.3
    + sin(angle * 23.0 + input.tip.w * 0.75488) * 0.15;
  let distance = length(oriented) / max(0.55, 1.0 + roughNoise * input.tip.z);
  if (distance >= 1.0) { return 0.0; }
  return 1.0 - smoothstep(
    clamp(input.centerSizeHardness.w, 0.0, 0.995), 1.0, distance
  );
}

fn sampleDocument(point: vec2f) -> vec4f {
  if (any(point < vec2f(0.0)) || any(point >= sourceSettings.size)) {
    return vec4f(0.0);
  }
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    (point + vec2f(0.5)) / sourceSettings.size,
    0.0
  );
}

fn straightColor(pixel: vec4f) -> vec3f {
  return select(vec3f(0.0), pixel.rgb / max(pixel.a, 0.00001), pixel.a > 0.00001);
}

/**
 * Reconstructs the destination/source colour difference inside a circular
 * dab from samples immediately outside its painted boundary. This is the
 * harmonic first approximation described by Georgiev: source detail remains
 * intact while the boundary constrains its tone and illumination to the
 * destination. The discrete Poisson kernel keeps this GPU-only and costs
 * fewer texture reads than the former pair of 9-tap low-frequency filters.
 */
fn biharmonicBoundaryCorrection(input: BrushVertexOutput, destination: vec2f) -> vec3f {
  let radius = max(input.centerSizeHardness.z * 0.5, 1.0);
  let local = (destination - input.centerSizeHardness.xy) / radius;
  let localLength = length(local);
  let radial = min(localLength, 0.96);
  let direction = select(vec2f(1.0, 0.0), local / max(localLength, 0.00001), localLength > 0.00001);
  let diffusion = clamp(sourceSettings.tuning.x, 1.0, 7.0);
  let boundaryRadius = radius + 1.0;
  // A wider derivative baseline is more stable on smooth areas. Diffusion
  // deliberately controls adaptation scale, not a post-process blur.
  let derivativeStep = mix(1.0, 4.0, (diffusion - 1.0) / 6.0);
  let adaptationReach = mix(0.15, 0.65, (diffusion - 1.0) / 6.0);
  let boundaryInfluence = smoothstep(1.0 - adaptationReach, 1.0, radial);
  let needsDerivative = boundaryInfluence > 0.0001;
  let directions = array<vec2f, 8>(
    vec2f(1.0, 0.0), vec2f(0.70710678, 0.70710678),
    vec2f(0.0, 1.0), vec2f(-0.70710678, 0.70710678),
    vec2f(-1.0, 0.0), vec2f(-0.70710678, -0.70710678),
    vec2f(0.0, -1.0), vec2f(0.70710678, -0.70710678)
  );
  var correction = vec3f(0.0);
  var derivativeCorrection = vec3f(0.0);
  var totalWeight = 0.0;
  let radialSquared = radial * radial;
  for (var index = 0; index < 8; index += 1) {
    let boundaryPoint = input.centerSizeHardness.xy + directions[index] * boundaryRadius;
    let destinationBoundary = sampleDocument(boundaryPoint);
    let sourceBoundary = sampleDocument(boundaryPoint + sourceSettings.offset);
    var valid = min(destinationBoundary.a, sourceBoundary.a);
    let boundaryDifference = straightColor(destinationBoundary)
      - straightColor(sourceBoundary);
    var outerDifference = boundaryDifference;
    if (needsDerivative) {
      let outerPoint = boundaryPoint + directions[index] * derivativeStep;
      let destinationOuter = sampleDocument(outerPoint);
      let sourceOuter = sampleDocument(outerPoint + sourceSettings.offset);
      valid = min(valid, min(destinationOuter.a, sourceOuter.a));
      outerDifference = straightColor(destinationOuter) - straightColor(sourceOuter);
    }
    let denominator = max(
      1.0 - 2.0 * radial * dot(direction, directions[index]) + radialSquared,
      0.001
    );
    let weight = valid * (1.0 - radialSquared) / denominator;
    correction += boundaryDifference * weight;
    derivativeCorrection += ((outerDifference - boundaryDifference) / derivativeStep) * weight;
    totalWeight += weight;
  }
  let harmonic = correction / max(totalWeight, 0.00001);
  let normalDerivative = derivativeCorrection / max(totalWeight, 0.00001);
  let inwardDistance = (1.0 - radial) * radius;
  // Match the outward derivative at the boundary, then quickly hand the
  // interior back to the harmonic first approximation. This follows the
  // practical Georgiev strategy: biharmonic where seams form, harmonic deep
  // inside the patch.
  return harmonic - normalDerivative * inwardDistance * boundaryInfluence;
}

fn outputCoverage(input: BrushVertexOutput, documentPixel: vec2f) -> f32 {
  let coverage = dabCoverage(input, documentPixel);
  if (coverage <= 0.0) { discard; }
  let selectionPixel = clamp(
    vec2i(documentPixel), vec2i(0), vec2i(textureDimensions(selectionMask)) - vec2i(1)
  );
  return input.colorOpacity.a * coverage
    * textureLoad(selectionMask, selectionPixel, 0).r;
}

@fragment
fn cloneFragment(input: BrushVertexOutput) -> @location(0) vec4f {
  let destination = documentPoint(input);
  let amount = outputCoverage(input, destination);
  let sampled = sampleDocument(destination + sourceSettings.offset);
  return vec4f(sampled.rgb * amount, sampled.a * amount);
}

@fragment
fn healingFragment(input: BrushVertexOutput) -> @location(0) vec4f {
  let destination = documentPoint(input);
  let source = destination + sourceSettings.offset;
  let amount = outputCoverage(input, destination);
  let sampled = sampleDocument(source);
  let healed = clamp(
    straightColor(sampled) + biharmonicBoundaryCorrection(input, destination),
    vec3f(0.0), vec3f(16.0)
  );
  return vec4f(healed * sampled.a * amount, sampled.a * amount);
}
`;

/**
 * GPU blur brush. The renderer snapshots the current layer texture once per
 * display-frame batch, then these instanced quads sample that immutable copy
 * while blending back into the live layer. Source and destination are never
 * the same texture, which keeps the pass WebGPU-valid and deterministic.
 */
export const BLUR_BRUSH_DAB_WGSL = /* wgsl */ `
struct BrushDab {
  centerSizeHardness: vec4f,
  colorOpacity: vec4f,
  tip: vec4f,
}

struct BrushCanvas {
  size: vec2f,
  padding: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  forwardRow0: vec4f,
  forwardRow1: vec4f,
}

struct BrushVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) centerSizeHardness: vec4f,
  @location(1) colorOpacity: vec4f,
}

@group(0) @binding(0) var<storage, read> dabs: array<BrushDab>;
@group(0) @binding(1) var<uniform> canvas: BrushCanvas;
@group(0) @binding(2) var selectionMask: texture_2d<f32>;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var sourceSampler: sampler;

@vertex
fn brushVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BrushVertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let dab = dabs[instanceIndex];
  let documentPixel = dab.centerSizeHardness.xy
    + corners[vertexIndex] * dab.centerSizeHardness.z * 0.5;
  let localPixel = vec2f(
    dot(canvas.inverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(canvas.inverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let clip = vec2f(
    localPixel.x / canvas.size.x * 2.0 - 1.0,
    1.0 - localPixel.y / canvas.size.y * 2.0
  );
  var output: BrushVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.centerSizeHardness = dab.centerSizeHardness;
  output.colorOpacity = dab.colorOpacity;
  return output;
}

fn sourceAt(localUv: vec2f, documentOffset: vec2f) -> vec4f {
  let localOffset = vec2f(
    dot(canvas.inverseRow0.xy, documentOffset),
    dot(canvas.inverseRow1.xy, documentOffset)
  );
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    clamp(localUv + localOffset / canvas.size, vec2f(0.0), vec2f(1.0)),
    0.0
  );
}

@fragment
fn brushFragment(input: BrushVertexOutput) -> @location(0) vec4f {
  let localPixel = input.position.xy;
  let documentPixel = vec2f(
    dot(canvas.forwardRow0.xyz, vec3f(localPixel, 1.0)),
    dot(canvas.forwardRow1.xyz, vec3f(localPixel, 1.0))
  );
  let radius = max(input.centerSizeHardness.z * 0.5, 0.0001);
  let distance = length(documentPixel - input.centerSizeHardness.xy) / radius;
  if (distance >= 1.0) { discard; }
  let coverage = 1.0 - smoothstep(
    clamp(input.centerSizeHardness.w, 0.0, 0.995),
    1.0,
    distance
  );
  let selectionPixel = clamp(
    vec2i(documentPixel),
    vec2i(0),
    vec2i(textureDimensions(selectionMask)) - vec2i(1)
  );
  let amount = clamp(
    input.colorOpacity.a * coverage * textureLoad(selectionMask, selectionPixel, 0).r,
    0.0,
    1.0
  );
  let uv = localPixel / canvas.size;
  // Radius grows with the brush but is bounded so ordinary small brushes stay
  // cheap and very large cursors cannot explode the fixed per-fragment budget.
  let blurRadius = clamp(radius * 0.08, 0.75, 32.0);
  let directions = array<vec2f, 12>(
    vec2f(1.0, 0.0), vec2f(0.8660254, 0.5), vec2f(0.5, 0.8660254),
    vec2f(0.0, 1.0), vec2f(-0.5, 0.8660254), vec2f(-0.8660254, 0.5),
    vec2f(-1.0, 0.0), vec2f(-0.8660254, -0.5), vec2f(-0.5, -0.8660254),
    vec2f(0.0, -1.0), vec2f(0.5, -0.8660254), vec2f(0.8660254, -0.5)
  );
  var blurred = sourceAt(uv, vec2f(0.0)) * 4.0;
  for (var index = 0u; index < 12u; index += 1u) {
    blurred += sourceAt(uv, directions[index] * blurRadius);
  }
  blurred /= 16.0;
  // Color blends source-over with coverage while alpha is preserved by the
  // pipeline's separate alpha blend component.
  return vec4f(blurred.rgb * amount, amount);
}
`;

/**
 * Shared non-destructive-looking tone brush kernel. The current layer region
 * is copied to an immutable GPU scratch texture before every display-frame
 * batch; dabs then blend a tonal transform back without changing coverage.
 */
export const TONE_BRUSH_DAB_WGSL = /* wgsl */ `
struct BrushDab {
  centerSizeHardness: vec4f,
  colorOpacity: vec4f,
  tip: vec4f,
}

struct BrushCanvas {
  size: vec2f,
  padding: vec2f,
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  forwardRow0: vec4f,
  forwardRow1: vec4f,
}

struct ToneSettings {
  // 0 dodge, 1 burn, 2 saturate, 3 desaturate.
  mode: f32,
  // 0 shadows, 1 midtones, 2 highlights.
  range: f32,
  protectTones: f32,
  vibrance: f32,
}

struct BrushVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) centerSizeHardness: vec4f,
  @location(1) colorOpacity: vec4f,
}

@group(0) @binding(0) var<storage, read> dabs: array<BrushDab>;
@group(0) @binding(1) var<uniform> canvas: BrushCanvas;
@group(0) @binding(2) var selectionMask: texture_2d<f32>;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var sourceSampler: sampler;
@group(0) @binding(5) var<uniform> tone: ToneSettings;

// Empirical Photoshop-compatible destination curves. Each curve maps one
// encoded-sRGB channel to a linear-light destination. The values come from
// the reproducible ToneBrush oracle at 5/10/20/25/50% Exposure; interpolation
// keeps the hot fragment path compact while retaining sub-level accuracy.
// Ordering: Dodge legacy S/M/H, Dodge protected S/M/H,
// Burn legacy S/M/H, Burn protected S/M/H.
// Kept flat because nested constant arrays trigger inconsistent validation in
// some WGSL reflection implementations. Each curve occupies 17 consecutive
// entries and is addressed as curve * 17 + knot.
const toneTargetCurves = array<f32, 204>(
  0.0180022,0.0431055,0.0684776,0.0980333,0.1284852,0.1756879,0.2152815,0.2763192,0.3358922,0.3965225,0.4704055,0.5422748,0.6240592,0.7096728,0.7989286,0.8937230,1.0000000,
  0.0000000,0.0129720,0.0366320,0.0687231,0.1051346,0.1426118,0.1956558,0.2436657,0.3166927,0.3754181,0.4519647,0.5324325,0.6141693,0.7020316,0.7969164,0.8919328,1.0000000,
  0.0000000,0.0064420,0.0200490,0.0441128,0.0802789,0.1273983,0.1848697,0.2598650,0.3626070,0.4664965,0.5894556,0.7385212,0.8797658,0.9834615,1.1103789,1.1125387,1.0000000,
  0.0000000,0.0120830,0.0384386,0.0755320,0.1246375,0.1730781,0.2234891,0.2618278,0.3163018,0.3573283,0.4100144,0.4655311,0.5464055,0.6387012,0.7548348,0.8824347,1.0000000,
  0.0000000,0.0054653,0.0219346,0.0535589,0.1069738,0.1996628,0.3168213,0.4290584,0.5883254,0.7049448,0.8025291,0.8656242,0.9259615,0.9492331,0.9878753,0.9862631,1.0000000,
  0.0000000,0.0052259,0.0146052,0.0305952,0.0659594,0.1350506,0.2656028,0.4673408,0.7545477,1.1074200,1.4754262,1.9086962,2.2532248,2.2578593,2.2271318,1.7602005,1.0000000,
  0.0000000,-0.0048833,-0.0077311,-0.0076396,-0.0017290,0.0128570,0.0331791,0.0665119,0.1105241,0.1642611,0.2426500,0.3256997,0.4362971,0.5538174,0.6851120,0.8568474,1.0000000,
  0.0000000,0.0028983,0.0064840,0.0124573,0.0220667,0.0366120,0.0561494,0.0800901,0.1169930,0.1635095,0.2302587,0.3010725,0.3995687,0.5092438,0.6489346,0.8231087,1.0000000,
  0.0000000,0.0037853,0.0099826,0.0181451,0.0292076,0.0461089,0.0672252,0.0933068,0.1175126,0.1495555,0.1835999,0.2319769,0.2839852,0.3340156,0.3781582,0.5226287,0.8057059,
  0.0000000,-0.0061675,-0.0191406,-0.0396333,-0.0632273,-0.0658275,-0.0513863,-0.0143188,0.0489147,0.1388469,0.2535119,0.3734611,0.5093467,0.6351189,0.7547576,0.8823441,1.0000000,
  0.0000000,0.0050276,0.0090132,0.0102481,0.0106396,0.0011730,-0.0087267,-0.0105792,-0.0153485,-0.0060891,0.0418446,0.1279239,0.2470357,0.4011723,0.5725016,0.8000172,1.0000000,
  0.0000000,0.0052142,0.0145625,0.0298273,0.0487777,0.0643021,0.0718071,0.0688221,0.0697343,0.0664003,0.0555275,0.0580591,0.0467795,0.0559305,0.0617880,0.1818466,0.6225393
);

@vertex
fn brushVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BrushVertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let dab = dabs[instanceIndex];
  let documentPixel = dab.centerSizeHardness.xy
    + corners[vertexIndex] * dab.centerSizeHardness.z * 0.5;
  let localPixel = vec2f(
    dot(canvas.inverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(canvas.inverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let clip = vec2f(
    localPixel.x / canvas.size.x * 2.0 - 1.0,
    1.0 - localPixel.y / canvas.size.y * 2.0
  );
  var output: BrushVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.centerSizeHardness = dab.centerSizeHardness;
  output.colorOpacity = dab.colorOpacity;
  return output;
}

fn linearToSrgb(value: f32) -> f32 {
  if (value <= 0.0031308) { return value * 12.92; }
  return 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055;
}

fn toneTargetChannel(value: f32) -> f32 {
  if (value > 1.0) { return value; }
  let encoded = clamp(linearToSrgb(max(value, 0.0)), 0.0, 1.0);
  let scaled = encoded * 16.0;
  let lower = min(u32(floor(scaled)), 15u);
  let fraction = scaled - f32(lower);
  let modeOffset = select(0u, 6u, tone.mode > 0.5);
  let protectOffset = select(0u, 3u, tone.protectTones > 0.5);
  let rangeIndex = u32(clamp(round(tone.range), 0.0, 2.0));
  let curve = modeOffset + protectOffset + rangeIndex;
  let curveOffset = curve * 17u;
  return mix(
    toneTargetCurves[curveOffset + lower],
    toneTargetCurves[curveOffset + lower + 1u],
    fraction
  );
}

fn transformTone(color: vec3f) -> vec3f {
  if (tone.mode < 1.5) {
    // Negative destination values are intentional for the protected Burn
    // shadow curve. They are blended toward from a positive source and let a
    // low exposure reach Photoshop's deep-shadow response without changing
    // the user-facing Exposure or the brush accumulation model.
    return clamp(vec3f(
      toneTargetChannel(color.r),
      toneTargetChannel(color.g),
      toneTargetChannel(color.b)
    ), vec3f(-16.0), vec3f(16.0));
  }

  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let gray = vec3f(luma);
  let chroma = color - gray;
  let saturation = length(chroma) / max(luma + 0.25, 0.25);
  if (tone.mode < 2.5) {
    let headroom = select(1.0, 1.0 - smoothstep(0.15, 1.2, saturation), tone.vibrance > 0.5);
    return clamp(gray + chroma * (1.0 + 0.8 * headroom), vec3f(0.0), vec3f(16.0));
  }
  return max(gray + chroma * 0.2, vec3f(0.0));
}

@fragment
fn brushFragment(input: BrushVertexOutput) -> @location(0) vec4f {
  let localPixel = input.position.xy;
  let documentPixel = vec2f(
    dot(canvas.forwardRow0.xyz, vec3f(localPixel, 1.0)),
    dot(canvas.forwardRow1.xyz, vec3f(localPixel, 1.0))
  );
  let radius = max(input.centerSizeHardness.z * 0.5, 0.0001);
  let distance = length(documentPixel - input.centerSizeHardness.xy) / radius;
  if (distance >= 1.0) { discard; }
  let coverage = 1.0 - smoothstep(
    clamp(input.centerSizeHardness.w, 0.0, 0.995), 1.0, distance
  );
  let selectionPixel = clamp(
    vec2i(documentPixel), vec2i(0), vec2i(textureDimensions(selectionMask)) - vec2i(1)
  );
  let amount = clamp(
    input.colorOpacity.a * coverage * textureLoad(selectionMask, selectionPixel, 0).r,
    0.0,
    1.0
  );
  let sampled = textureSampleLevel(
    sourceTexture, sourceSampler,
    clamp(localPixel / canvas.size, vec2f(0.0), vec2f(1.0)), 0.0
  );
  if (sampled.a <= 0.00001 || amount <= 0.00001) { discard; }
  let straight = sampled.rgb / sampled.a;
  return vec4f(transformTone(straight) * amount, amount);
}
`;

export const SELECTION_SHAPE_WGSL = /* wgsl */ `
struct SelectionSettings {
  canvasSize: vec2f,
  kind: f32,
  pointCount: f32,
  bounds: vec4f,
  options: vec4f,
}

@group(0) @binding(0) var<uniform> settings: SelectionSettings;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;

fn insideFreeSelection(pixel: vec2f) -> bool {
  var inside = false;
  let count = u32(settings.pointCount);
  var previous = points[count - 1u];
  for (var index = 0u; index < count; index += 1u) {
    let current = points[index];
    let crosses = (current.y > pixel.y) != (previous.y > pixel.y);
    let crossingX = (previous.x - current.x) * (pixel.y - current.y) /
      select(1e-6, previous.y - current.y, abs(previous.y - current.y) > 1e-6) + current.x;
    if (crosses && pixel.x < crossingX) { inside = !inside; }
    previous = current;
  }
  return inside;
}

fn insideSelection(pixel: vec2f) -> bool {
  let minimum = min(settings.bounds.xy, settings.bounds.zw);
  let maximum = max(settings.bounds.xy, settings.bounds.zw);
  var inside = false;
  if (settings.kind < 0.5) {
    inside = all(pixel >= minimum) && all(pixel <= maximum);
  } else if (settings.kind < 1.5) {
    let center = (minimum + maximum) * 0.5;
    let radius = max((maximum - minimum) * 0.5, vec2f(0.5));
    let normalized = (pixel - center) / radius;
    inside = dot(normalized, normalized) <= 1.0;
  } else if (settings.pointCount >= 3.0) {
    inside = insideFreeSelection(pixel);
  }
  return inside;
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let pixel = input.uv * settings.canvasSize;
  if (settings.options.x < 0.5) {
    return select(0.0, 1.0, insideSelection(pixel));
  }
  let offsets = array<vec2f, 4>(
    vec2f(-0.25, -0.25),
    vec2f(0.25, -0.25),
    vec2f(-0.25, 0.25),
    vec2f(0.25, 0.25)
  );
  var coverage = 0.0;
  for (var index = 0u; index < 4u; index += 1u) {
    coverage += select(0.0, 1.0, insideSelection(pixel + offsets[index]));
  }
  return coverage * 0.25;
}
`;

export const SELECTION_COMBINE_WGSL = /* wgsl */ `
struct SelectionCombineSettings {
  mode: f32,
  // Separate scalars keep this uniform at 16 bytes. A vec3 has 16-byte
  // alignment after mode, which would make the struct 32 bytes in WGSL.
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var currentMask: texture_2d<f32>;
@group(0) @binding(1) var shapeMask: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: SelectionCombineSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let dimensions = vec2i(textureDimensions(currentMask));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let current = textureLoad(currentMask, pixel, 0).r;
  let shape = textureLoad(shapeMask, pixel, 0).r;
  if (settings.mode < 0.5) { return shape; }
  if (settings.mode < 1.5) { return max(current, shape); }
  if (settings.mode < 2.5) { return current * (1.0 - shape); }
  if (settings.mode < 3.5) { return current * shape; }
  return 1.0 - current;
}
`;

export const SELECTION_FEATHER_WGSL = /* wgsl */ `
struct FeatherSettings {
  canvasSize: vec2f,
  direction: vec2f,
  radius: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: FeatherSettings;

const gaussianKernel = array<vec2f, 17>(
  vec2f(0.00000000, 0.074947560),
  vec2f(0.06250000, 0.073641634),
  vec2f(0.12500000, 0.069858807),
  vec2f(0.18750000, 0.063980960),
  vec2f(0.25000000, 0.056573386),
  vec2f(0.31250000, 0.048295362),
  vec2f(0.37500000, 0.039804348),
  vec2f(0.43750000, 0.031672872),
  vec2f(0.50000000, 0.024331910),
  vec2f(0.56250000, 0.018046658),
  vec2f(0.62500000, 0.012922580),
  vec2f(0.68750000, 0.008933744),
  vec2f(0.75000000, 0.005962791),
  vec2f(0.81250000, 0.003842355),
  vec2f(0.87500000, 0.002390437),
  vec2f(0.93750000, 0.001435783),
  vec2f(1.00000000, 0.000832592),
);

fn maskSample(uv: vec2f) -> f32 {
  let inside = select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    clamp(uv, vec2f(0.0), vec2f(1.0)),
    0.0
  ).r * inside;
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let texel = settings.direction / settings.canvasSize;
  let radius = max(settings.radius, 0.0);
  var result = maskSample(input.uv) * gaussianKernel[0].y;
  for (var index = 1u; index < 17u; index += 1u) {
    let kernel = gaussianKernel[index];
    let offset = texel * radius * kernel.x;
    result += (
      maskSample(input.uv + offset) + maskSample(input.uv - offset)
    ) * kernel.y;
  }
  return clamp(result, 0.0, 1.0);
}
`;

/**
 * One-sample linear resample used after a wide feather was evaluated on a
 * smaller intermediate mask. Keeping this separate from the Gaussian shader
 * avoids evaluating the full kernel again for every full-resolution pixel.
 */
export const SELECTION_RESAMPLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0).r;
}
`;

export const SELECTION_COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  let coverage = textureLoad(selectionTexture, pixel, 0).r;
  // Layer textures are premultiplied linear RGBA, so coverage scales RGB and A.
  return source * coverage;
}
`;

export const SELECTION_DISPLAY_COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  let coverage = textureLoad(selectionTexture, pixel, 0).r;
  // The display texture is already straight-alpha, output-encoded RGBA8.
  // Preserve its RGB values and use the selection solely as alpha coverage.
  return vec4f(source.rgb, source.a * coverage);
}
`;

export const SELECTION_CONTENT_COVERAGE_WGSL = /* wgsl */ `
struct SelectionContentSettings {
  layerOpacity: f32,
  maskEnabled: f32,
  selectionEnabled: f32,
  padding1: f32,
}

@group(0) @binding(0) var layerTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;
@group(0) @binding(2) var layerMask: texture_2d<f32>;
@group(0) @binding(3) var<uniform> settings: SelectionContentSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let dimensions = vec2i(textureDimensions(layerTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let layerAlpha = textureLoad(layerTexture, pixel, 0).a;
  let selection = select(
    1.0,
    textureLoad(selectionTexture, pixel, 0).r,
    settings.selectionEnabled > 0.5
  );
  let mask = select(
    1.0,
    clamp(textureLoad(layerMask, pixel, 0).r, 0.0, 1.0),
    settings.maskEnabled > 0.5
  );
  return clamp(layerAlpha * selection * mask * settings.layerOpacity, 0.0, 1.0);
}
`;

export const LAYER_INVERT_COLORS_WGSL = /* wgsl */ `
struct InvertSettings {
  transformRow0: vec4f,
  transformRow1: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: InvertSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  // Raster layers use premultiplied linear RGBA. Invert the straight color
  // while retaining both transparency and valid premultiplied output.
  let inverted = max(vec3f(source.a) - source.rgb, vec3f(0.0));
  let documentPosition = vec2f(
    dot(settings.transformRow0.xyz, vec3f(vec2f(pixel), 1.0)),
    dot(settings.transformRow1.xyz, vec3f(vec2f(pixel), 1.0))
  );
  let selectionDimensions = vec2i(textureDimensions(selectionTexture));
  let selectionInside = all(documentPosition >= vec2f(0.0))
    && all(documentPosition < vec2f(selectionDimensions));
  let selectionPixel = clamp(vec2i(documentPosition), vec2i(0), selectionDimensions - vec2i(1));
  let selection = select(
    0.0,
    clamp(textureLoad(selectionTexture, selectionPixel, 0).r, 0.0, 1.0),
    selectionInside
  );
  return mix(source, vec4f(inverted, source.a), selection);
}
`;

/** Copies a scalar channel without filtering between selection and mask textures. */
export const RED_CHANNEL_COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let value = clamp(textureLoad(sourceTexture, pixel, 0).r, 0.0, 1.0);
  return vec4f(value, value, value, 1.0);
}
`;

/** Extracts an RGBA channel or composite luminance into a scalar selection texture. */
export const COLOR_CHANNEL_COPY_WGSL = /* wgsl */ `
struct ChannelSettings {
  channel: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: ChannelSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  let color = source.rgb;
  var value = color.r;
  if (settings.channel == 1u) { value = color.g; }
  if (settings.channel == 2u) { value = color.b; }
  if (settings.channel == 3u) {
    value = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  }
  if (settings.channel == 4u) { value = source.a; }
  value = clamp(value, 0.0, 1.0);
  return vec4f(value, value, value, 1.0);
}
`;

export const LAYER_FILL_COLOR_WGSL = /* wgsl */ `
struct FillSettings {
  color: vec4f,
  preserveTransparency: f32,
  maskChannel: f32,
  padding: vec2f,
  transformRow0: vec4f,
  transformRow1: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: FillSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  let documentPosition = vec2f(
    dot(settings.transformRow0.xyz, vec3f(vec2f(pixel), 1.0)),
    dot(settings.transformRow1.xyz, vec3f(vec2f(pixel), 1.0))
  );
  let selectionDimensions = vec2i(textureDimensions(selectionTexture));
  let selectionInside = all(documentPosition >= vec2f(0.0))
    && all(documentPosition < vec2f(selectionDimensions));
  let selectionPixel = clamp(vec2i(documentPosition), vec2i(0), selectionDimensions - vec2i(1));
  let selection = select(
    0.0,
    clamp(textureLoad(selectionTexture, selectionPixel, 0).r, 0.0, 1.0),
    selectionInside
  );

  if (settings.maskChannel > 0.5) {
    let gray = dot(settings.color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    return mix(source, vec4f(gray, gray, gray, 1.0), selection);
  }

  // Raster pixels are stored as premultiplied linear RGBA. Transparency lock
  // retains source alpha; otherwise the command supplies the target alpha.
  // A zero target alpha is also the shared GPU path for clearing a selection.
  let alpha = select(settings.color.a, source.a, settings.preserveTransparency > 0.5);
  let filled = vec4f(settings.color.rgb * alpha, alpha);
  return mix(source, filled, selection);
}
`;

export const LAYER_FILL_GRADIENT_WGSL = /* wgsl */ `
struct GradientFillSettings {
  sourceToDocumentRow0: vec4f,
  sourceToDocumentRow1: vec4f,
  gradientInverseRow0: vec4f,
  gradientInverseRow1: vec4f,
  options: vec4f,
  channel: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: GradientFillSettings;
@group(0) @binding(3) var<storage, read> gradientLut: array<vec4f>;

${LAYER_BLEND_FUNCTIONS_WGSL}

fn noiseAt(pixel: vec2f) -> f32 {
  return fract(sin(dot(pixel, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  let documentPosition = vec2f(
    dot(settings.sourceToDocumentRow0.xyz, vec3f(vec2f(pixel), 1.0)),
    dot(settings.sourceToDocumentRow1.xyz, vec3f(vec2f(pixel), 1.0))
  );
  let selectionDimensions = vec2i(textureDimensions(selectionTexture));
  let selectionInside = all(documentPosition >= vec2f(0.0))
    && all(documentPosition < vec2f(selectionDimensions));
  let selectionPixel = clamp(vec2i(documentPosition), vec2i(0), selectionDimensions - vec2i(1));
  let selection = select(
    0.0,
    clamp(textureLoad(selectionTexture, selectionPixel, 0).r, 0.0, 1.0),
    selectionInside
  );
  let point = vec2f(
    dot(settings.gradientInverseRow0.xyz, vec3f(documentPosition, 1.0)),
    dot(settings.gradientInverseRow1.xyz, vec3f(documentPosition, 1.0))
  );
  let shape = u32(settings.gradientInverseRow1.w + 0.5);
  var position = point.x;
  if (shape == 1u) { position = length(point); }
  if (shape == 2u) { position = fract(atan2(point.y, point.x) / 6.28318530718 + 1.0); }
  if (shape == 3u) { position = abs(point.x); }
  if (shape == 4u) { position = abs(point.x) + abs(point.y); }
  position = clamp(select(position, 1.0 - position, settings.options.x > 0.5), 0.0, 1.0);
  let scaled = position * 255.0;
  let lower = u32(floor(scaled));
  let upper = min(255u, lower + 1u);
  var gradient = mix(gradientLut[lower], gradientLut[upper], fract(scaled));
  if (settings.options.z > 0.5) {
    gradient = vec4f(
      clamp(gradient.rgb + vec3f(noiseAt(documentPosition) / 255.0), vec3f(0.0), vec3f(1.0)),
      gradient.a
    );
  }
  let amount = clamp(gradient.a * settings.options.y * selection, 0.0, 1.0);
  if (settings.channel.y > 0.5) {
    let gray = dot(gradient.rgb, vec3f(0.2126, 0.7152, 0.0722));
    return mix(source, vec4f(gray, gray, gray, 1.0), amount);
  }
  let sourceStraight = source.rgb / max(source.a, 1e-6);
  let sourceEncoded = linearStraightToBlend(sourceStraight, 0.0, 0.0);
  let gradientEncoded = linearStraightToBlend(gradient.rgb, 0.0, 0.0);
  let blendedEncoded = blendColorEncoded(
    sourceEncoded,
    gradientEncoded,
    i32(settings.options.w + 0.5),
    0.0
  );
  if (settings.channel.x > 0.5) {
    let outputEncoded = mix(sourceEncoded, blendedEncoded, amount);
    return vec4f(blendStraightToLinear(outputEncoded, 0.0) * source.a, source.a);
  }
  return compositeBlend(
    source,
    vec4f(gradient.rgb * amount, amount),
    i32(settings.options.w + 0.5),
    0.0,
    0.0
  );
}
`;
