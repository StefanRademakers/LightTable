export const LAYER_SOURCE_DECODE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

fn srgbToLinearChannel(value: f32) -> f32 {
  return select(value / 12.92, pow((value + 0.055) / 1.055, 2.4), value > 0.04045);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let encoded = textureSample(sourceTexture, sourceSampler, input.uv);
  let linear = vec3f(
    srgbToLinearChannel(encoded.r),
    srgbToLinearChannel(encoded.g),
    srgbToLinearChannel(encoded.b)
  );
  // Layer textures use premultiplied linear RGBA end-to-end.
  return vec4f(linear * encoded.a, encoded.a);
}
`;

export const LAYER_MASK_DECODE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let value = textureSample(sourceTexture, sourceSampler, input.uv).r;
  return vec4f(value, value, value, 1.0);
}
`;

export const LAYER_EXPORT_WGSL = /* wgsl */ `
struct ExportSettings {
  maskChannel: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: ExportSettings;

fn linearToSrgbChannel(value: f32) -> f32 {
  return select(value * 12.92, 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055, value > 0.0031308);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSample(sourceTexture, sourceSampler, input.uv);
  if (settings.maskChannel > 0.5) {
    let value = clamp(sampled.r, 0.0, 1.0);
    return vec4f(value, value, value, 1.0);
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

fn blendColor(background: vec3f, foreground: vec3f, mode: i32) -> vec3f {
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
  if (mode == 8) { return min(vec3f(1.0), background / max(vec3f(1e-6), vec3f(1.0) - foreground)); }
  if (mode == 9) { return vec3f(1.0) - min(vec3f(1.0), (vec3f(1.0) - background) / max(foreground, vec3f(1e-6))); }
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
    let burn = vec3f(1.0) - min(
      vec3f(1.0),
      (vec3f(1.0) - background) / max(vec3f(2.0) * foreground, vec3f(1e-6))
    );
    let dodge = min(
      vec3f(1.0),
      background / max(vec3f(2.0) * (vec3f(1.0) - foreground), vec3f(1e-6))
    );
    return select(burn, dodge, foreground >= vec3f(0.5));
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
    let burn = vec3f(1.0) - min(
      vec3f(1.0),
      (vec3f(1.0) - background) / max(vec3f(2.0) * foreground, vec3f(1e-6))
    );
    let dodge = min(
      vec3f(1.0),
      background / max(vec3f(2.0) * (vec3f(1.0) - foreground), vec3f(1e-6))
    );
    let vivid = select(burn, dodge, foreground >= vec3f(0.5));
    return select(vec3f(0.0), vec3f(1.0), vivid >= vec3f(0.5));
  }
  if (mode == 23) { return background + foreground - vec3f(2.0) * background * foreground; }
  if (mode == 24) { return max(vec3f(0.0), background - foreground); }
  if (mode == 25) { return min(vec3f(1.0), background / max(foreground, vec3f(1e-6))); }
  return foreground;
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
  // Layer masks are authored in document space. The raster source transform
  // must never rotate, scale or translate their coverage.
  let mask = select(1.0, evaluatedMask(input.uv), settings.maskEnabled > 0.5);
  let clipping = select(
    1.0,
    clamp(textureSample(clippingTexture, sourceSampler, input.uv).a, 0.0, 1.0),
    settings.clippingEnabled > 0.5
  );
  let foreground = sampledForeground * settings.opacity * mask * clipping;
  let backgroundStraight = background.rgb / max(background.a, 1e-6);
  let foregroundStraight = foreground.rgb / max(foreground.a, 1e-6);
  let blended = blendColor(backgroundStraight, foregroundStraight, i32(settings.blendMode + 0.5));
  let outputAlpha = foreground.a + background.a * (1.0 - foreground.a);
  let outputRgb =
    background.rgb * (1.0 - foreground.a) +
    foreground.rgb * (1.0 - background.a) +
    blended * background.a * foreground.a;
  return vec4f(outputRgb, outputAlpha);
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
  let mask = select(
    1.0,
    evaluatedMask(input.uv),
    settings.header.x > 0.5
  );
  let coverage = select(0.0, mask, sourceInside);
  return sampled * coverage;
}
`;

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
}

@group(0) @binding(0) var currentTexture: texture_2d<f32>;
@group(0) @binding(1) var shapeTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: StyleSettings;
@group(0) @binding(4) var patternTexture: texture_2d<f32>;

${LAYER_BLEND_FUNCTIONS_WGSL}

fn over(foreground: vec4f, background: vec4f) -> vec4f {
  return vec4f(
    foreground.rgb + background.rgb * (1.0 - foreground.a),
    foreground.a + background.a * (1.0 - foreground.a)
  );
}

fn styleOverCurrent(current: vec4f, color: vec3f, alpha: f32, mode: i32) -> vec4f {
  let effectAlpha = clamp(alpha, 0.0, 1.0);
  let currentStraight = current.rgb / max(current.a, 1e-6);
  let blended = blendColor(currentStraight, color, mode);
  // Interior styles operate inside the source coverage. Using Porter-Duff
  // Porter-Duff over here would make an antialiased edge more opaque every time another
  // overlay is added. Preserve the strongest existing coverage and replace
  // only the proportional straight-color contribution instead.
  let outputAlpha = max(current.a, effectAlpha);
  let mixAmount = effectAlpha / max(outputAlpha, 1e-6);
  let outputStraight = mix(currentStraight, blended, mixAmount);
  return vec4f(outputStraight * outputAlpha, outputAlpha);
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
  let directions = array<vec2f, 16>(
    vec2f(1.0, 0.0), vec2f(0.9239, 0.3827), vec2f(0.7071, 0.7071), vec2f(0.3827, 0.9239),
    vec2f(0.0, 1.0), vec2f(-0.3827, 0.9239), vec2f(-0.7071, 0.7071), vec2f(-0.9239, 0.3827),
    vec2f(-1.0, 0.0), vec2f(-0.9239, -0.3827), vec2f(-0.7071, -0.7071), vec2f(-0.3827, -0.9239),
    vec2f(0.0, -1.0), vec2f(0.3827, -0.9239), vec2f(0.7071, -0.7071), vec2f(0.9239, -0.3827)
  );
  var value = alphaAt(uv, centerOffset) * 4.0;
  for (var index = 0u; index < 16u; index += 1u) {
    value += alphaAt(uv, centerOffset + directions[index] * radius * 0.35) * 2.0;
    value += alphaAt(uv, centerOffset + directions[index] * radius * 0.72);
    value += alphaAt(uv, centerOffset + directions[index] * radius);
  }
  // A fixed sample topology avoids backend-dependent uniform-flow validation:
  // center=4 and sixteen directions contribute 2+1+1, for a total of 68.
  return clamp(value / 68.0, 0.0, 1.0);
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

fn shapedCoverage(value: f32, choke: f32, noise: f32, pixel: vec2f) -> f32 {
  let tightened = smoothstep(max(0.0, 0.5 - choke * 0.5), min(1.0, 0.5 + (1.0 - choke) * 0.5), value);
  return clamp(contourAt(tightened) + (noiseAt(pixel) - 0.5) * noise, 0.0, 1.0);
}

fn gradientColorAt(position: f32, count: u32) -> vec3f {
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
  return mix(first.rgb, second.rgb, amount);
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
  reverse: bool
) -> f32 {
  let direction = vec2f(cos(radians(angleDegrees)), -sin(radians(angleDegrees)));
  let centeredUv = uv - vec2f(0.5) - offset * 0.5;
  let centered = centeredUv * settings.canvas.xy;
  let extent = max(settings.canvas.x, settings.canvas.y) * max(scale, 0.01);
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

fn strokeCoverageAt(uv: vec2f, radius: f32, position: f32) -> f32 {
  let centerAlpha = textureSampleLevel(shapeTexture, sourceSampler, uv, 0.0).a;
  let expanded = blurredAlpha(uv, vec2f(0.0), max(radius, 0.5));
  let contracted = alphaAt(uv, vec2f(radius, 0.0))
    * alphaAt(uv, vec2f(-radius, 0.0))
    * alphaAt(uv, vec2f(0.0, radius))
    * alphaAt(uv, vec2f(0.0, -radius));
  var coverage = max(0.0, expanded - centerAlpha);
  if (position > 0.5 && position < 1.5) { coverage = max(0.0, centerAlpha - contracted); }
  if (position >= 1.5) { coverage = max(0.0, expanded - contracted); }
  return coverage;
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
    let coverage = shapedCoverage(blurredAlpha(input.uv, -offset, radius), choke, noise, pixel);
    let knockout = clamp(settings.params1.x, 0.0, 1.0);
    let alpha = clamp(coverage * opacity * mix(1.0, 1.0 - shape.a, knockout), 0.0, 1.0);
    let shadow = vec4f(settings.color0.rgb * alpha, alpha);
    return over(current, shadow);
  }
  if (kind == 3) {
    let shifted = shapedCoverage(blurredAlpha(input.uv, -offset, radius), choke, noise, pixel);
    let alpha = shape.a * (1.0 - shifted) * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 4) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let raw = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let ranged = pow(clamp(raw, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let expanded = shapedCoverage(ranged, choke, noise, pixel);
    let alpha = max(0.0, expanded - shape.a) * opacity;
    let glow = vec4f(settings.color0.rgb * alpha, alpha);
    return over(current, glow);
  }
  if (kind == 11) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let raw = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let ranged = pow(clamp(raw, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let expanded = shapedCoverage(ranged, choke, noise, pixel);
    let alphaCoverage = max(0.0, expanded - shape.a);
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let gradientAlpha = gradientOpacityAt(alphaCoverage, opacityCount);
    let alpha = clamp(alphaCoverage * opacity * gradientAlpha, 0.0, 1.0);
    let glow = vec4f(gradientColorAt(alphaCoverage, colorCount) * alpha, alpha);
    return over(current, glow);
  }
  if (kind == 5) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let blurred = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let sourceCenter = settings.params1.x;
    let ranged = pow(clamp(blurred, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let coverage = select(1.0 - ranged, ranged, sourceCenter > 0.5);
    let alpha = shapedCoverage(coverage, choke, noise, pixel) * shape.a * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 12) {
    let jitteredRadius = radius * (1.0 + (noiseAt(pixel + vec2f(31.0, 17.0)) - 0.5) * settings.params1.z);
    let blurred = blurredAlpha(input.uv, vec2f(0.0), jitteredRadius);
    let sourceCenter = settings.params1.x;
    let ranged = pow(clamp(blurred, 0.0, 1.0), mix(2.0, 0.5, settings.params1.y));
    let coverage = select(1.0 - ranged, ranged, sourceCenter > 0.5);
    let shaped = shapedCoverage(coverage, choke, noise, pixel) * shape.a;
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let alpha = shaped * opacity * gradientOpacityAt(coverage, opacityCount);
    return styleOverCurrent(current, gradientColorAt(coverage, colorCount), alpha, mode);
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
      settings.params1.x > 0.5
    );
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let color = gradientColorAt(position, colorCount);
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
      settings.params1.w > 0.5
    );
    let colorCount = u32(settings.color1.x + 0.5);
    let opacityCount = u32(settings.color1.y + 0.5);
    let gradientOpacity = gradientOpacityAt(position, opacityCount);
    let dither = select(0.0, (noiseAt(pixel) - 0.5) / 255.0, settings.params1.z > 0.5);
    let alpha = coverage * opacity * gradientOpacity;
    let color = gradientColorAt(position, colorCount) + vec3f(dither);
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
    let first = alphaAt(input.uv, offset) - alphaAt(input.uv, -offset);
    let wave = 0.5 + 0.5 * sin(first * max(radius, 1.0) * 3.14159265);
    let coverage = contourAt(abs(wave - 0.5) * 2.0) * shape.a;
    let invert = settings.params1.x;
    let alpha = mix(coverage, shape.a - coverage, invert) * opacity;
    return styleOverCurrent(current, settings.color0.rgb, alpha, mode);
  }
  if (kind == 9) {
    let soften = max(settings.params1.z, 0.0);
    let stepSize = max(radius + soften, 1.0);
    let technique = fillOpacity;
    let style = i32(settings.params1.w + 0.5);
    let center = alphaAt(input.uv, vec2f(0.0));
    let rawNormal = vec2f(
      alphaAt(input.uv, vec2f(stepSize, 0.0)) - alphaAt(input.uv, vec2f(-stepSize, 0.0)),
      alphaAt(input.uv, vec2f(0.0, stepSize)) - alphaAt(input.uv, vec2f(0.0, -stepSize))
    );
    let chisel = select(
      1.0,
      select(2.0, 1.45, technique > 1.5),
      technique > 0.5
    );
    let normal = sign(rawNormal) * pow(abs(rawNormal), vec2f(1.0 / chisel));
    let depth = max(settings.params0.w, 0.01) * select(1.0, -1.0, settings.params1.x > 0.5);
    let surfaceNormal = normalize(vec3f(-normal * depth * 8.0, 1.0));
    let altitude = radians(clamp(settings.params0.y, 0.0, 90.0));
    let light = normalize(vec3f(
      cos(angle) * cos(altitude),
      -sin(angle) * cos(altitude),
      sin(altitude)
    ));
    var lighting = dot(surfaceNormal, light);
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
    let expanded = blurredAlpha(input.uv, vec2f(0.0), max(radius, 0.5));
    let contracted = alphaAt(input.uv, vec2f(radius, 0.0))
      * alphaAt(input.uv, vec2f(-radius, 0.0))
      * alphaAt(input.uv, vec2f(0.0, radius))
      * alphaAt(input.uv, vec2f(0.0, -radius));
    var coverage = center;
    if (style == 0) { coverage = max(0.0, expanded - center); }
    if (style == 1) { coverage = max(0.0, center - contracted); }
    if (style == 2) { coverage = max(0.0, expanded - contracted); }
    if (style == 3) {
      coverage = max(0.0, center - contracted);
      lighting = -lighting;
    }
    if (style == 4) { coverage = strokeCoverageAt(input.uv, radius, 2.0); }
    let highlight = contourAt(max(lighting, 0.0)) * coverage * settings.color0.a;
    let shadow = contourAt(max(-lighting, 0.0)) * coverage * settings.color1.a;
    var result = styleOverCurrent(current, settings.color1.rgb, shadow * opacity, i32(settings.params1.y + 0.5));
    result = styleOverCurrent(result, settings.color0.rgb, highlight * opacity, mode);
    return result;
  }

  return current;
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
  let blendedStraight = blendColor(
    sourceStraight,
    adjustedStraight,
    i32(settings.blendMode + 0.5)
  );
  let blended = vec4f(blendedStraight * source.a, source.a);
  return mix(source, blended, amount);
}
`;

export const BRUSH_DAB_WGSL = /* wgsl */ `
struct BrushDab {
  centerSizeHardness: vec4f,
  colorOpacity: vec4f,
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
  let distance = length((documentPixel - input.centerSizeHardness.xy) / radius);
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

export const SELECTION_SHAPE_WGSL = /* wgsl */ `
struct SelectionSettings {
  canvasSize: vec2f,
  kind: f32,
  pointCount: f32,
  bounds: vec4f,
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

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let pixel = input.uv * settings.canvasSize;
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
  return select(0.0, 1.0, inside);
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
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  // Raster layers use premultiplied linear RGBA. Invert the straight color
  // while retaining both transparency and valid premultiplied output.
  let inverted = max(vec3f(source.a) - source.rgb, vec3f(0.0));
  return vec4f(inverted, source.a);
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
  // retains source alpha; otherwise Photoshop-style fill writes opaque color.
  let alpha = select(1.0, source.a, settings.preserveTransparency > 0.5);
  let filled = vec4f(settings.color.rgb * alpha, alpha);
  return mix(source, filled, selection);
}
`;
