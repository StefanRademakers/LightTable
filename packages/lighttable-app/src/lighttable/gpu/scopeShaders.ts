const SCOPE_ANALYSIS_HEADER = /* wgsl */ `
struct ScopeUniforms {
  imageAndSampleSize: vec4u,
  rangeAndThresholds: vec4f,
}

@group(0) @binding(0) var imageTexture: texture_2d<f32>;
`;

const SCOPE_ANALYSIS_HELPERS = /* wgsl */ `
fn sourceCoordinate(id: vec2u) -> vec2u {
  let imageSize = max(info.imageAndSampleSize.xy, vec2u(1u));
  let sampleSize = max(info.imageAndSampleSize.zw, vec2u(1u));
  let source = (vec2f(id) + vec2f(0.5)) * vec2f(imageSize) / vec2f(sampleSize);
  return min(vec2u(source), imageSize - vec2u(1u));
}

fn vectorRangeIncludes(luma: f32) -> bool {
  let range = u32(info.rangeAndThresholds.x + 0.5);
  let low = info.rangeAndThresholds.y;
  let high = info.rangeAndThresholds.z;
  if (range == 1u) { return luma < low; }
  if (range == 2u) { return luma >= low && luma <= high; }
  if (range == 3u) { return luma > high; }
  return true;
}
`;

const PARADE_DECLARATIONS = (binsBinding: number, maxBinding: number) => /* wgsl */ `
struct ParadeBins {
  values: array<atomic<u32>, 196608>,
}

struct ScopeMaximum {
  value: atomic<u32>,
}

@group(0) @binding(${binsBinding}) var<storage, read_write> paradeBins: ParadeBins;
@group(0) @binding(${maxBinding}) var<storage, read_write> paradeMaximum: ScopeMaximum;
`;

const VECTOR_DECLARATIONS = (binsBinding: number, maxBinding: number) => /* wgsl */ `
struct VectorBins {
  values: array<atomic<u32>, 65536>,
}

struct VectorMaximum {
  value: atomic<u32>,
}

@group(0) @binding(${binsBinding}) var<storage, read_write> vectorBins: VectorBins;
@group(0) @binding(${maxBinding}) var<storage, read_write> vectorMaximum: VectorMaximum;
`;

const PARADE_WRITE = /* wgsl */ `
fn writeParade(coordinate: vec2u, color: vec3f) {
  let width = max(info.imageAndSampleSize.x, 1u);
  let sourceX = f32(coordinate.x) / f32(max(width - 1u, 1u));
  let xBin = min(u32(sourceX * 255.0 + 0.5), 255u);
  let values = vec3u(clamp(color, vec3f(0.0), vec3f(1.0)) * 255.0 + 0.5);
  for (var channel = 0u; channel < 3u; channel += 1u) {
    let index = channel * 65536u + values[channel] * 256u + xBin;
    let next = atomicAdd(&paradeBins.values[index], 1u) + 1u;
    atomicMax(&paradeMaximum.value, next);
  }
}
`;

const VECTOR_WRITE = /* wgsl */ `
fn writeVector(color: vec3f) {
  let rgb = clamp(color, vec3f(0.0), vec3f(1.0));
  let luma = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  if (!vectorRangeIncludes(luma)) { return; }
  let cb = -0.114572 * rgb.r - 0.385428 * rgb.g + 0.5 * rgb.b;
  let cr = 0.5 * rgb.r - 0.454153 * rgb.g - 0.045847 * rgb.b;
  let xBin = min(u32(clamp(cb + 0.5, 0.0, 1.0) * 255.0 + 0.5), 255u);
  let yBin = min(u32(clamp(cr + 0.5, 0.0, 1.0) * 255.0 + 0.5), 255u);
  let index = yBin * 256u + xBin;
  let next = atomicAdd(&vectorBins.values[index], 1u) + 1u;
  atomicMax(&vectorMaximum.value, next);
}
`;

export const PARADE_SCOPE_ANALYSIS_WGSL = /* wgsl */ `${SCOPE_ANALYSIS_HEADER}
${PARADE_DECLARATIONS(1, 2)}
@group(0) @binding(3) var<uniform> info: ScopeUniforms;
${SCOPE_ANALYSIS_HELPERS}
${PARADE_WRITE}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= info.imageAndSampleSize.zw)) { return; }
  let coordinate = sourceCoordinate(id.xy);
  let color = textureLoad(imageTexture, vec2i(coordinate), 0);
  if (color.a <= 0.001) { return; }
  writeParade(coordinate, color.rgb);
}
`;

export const VECTOR_SCOPE_ANALYSIS_WGSL = /* wgsl */ `${SCOPE_ANALYSIS_HEADER}
${VECTOR_DECLARATIONS(1, 2)}
@group(0) @binding(3) var<uniform> info: ScopeUniforms;
${SCOPE_ANALYSIS_HELPERS}
${VECTOR_WRITE}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= info.imageAndSampleSize.zw)) { return; }
  let coordinate = sourceCoordinate(id.xy);
  let color = textureLoad(imageTexture, vec2i(coordinate), 0);
  if (color.a <= 0.001) { return; }
  writeVector(color.rgb);
}
`;

export const COMBINED_SCOPE_ANALYSIS_WGSL = /* wgsl */ `${SCOPE_ANALYSIS_HEADER}
${PARADE_DECLARATIONS(1, 2)}
${VECTOR_DECLARATIONS(3, 4)}
@group(0) @binding(5) var<uniform> info: ScopeUniforms;
${SCOPE_ANALYSIS_HELPERS}
${PARADE_WRITE}
${VECTOR_WRITE}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= info.imageAndSampleSize.zw)) { return; }
  let coordinate = sourceCoordinate(id.xy);
  let color = textureLoad(imageTexture, vec2i(coordinate), 0);
  if (color.a <= 0.001) { return; }
  writeParade(coordinate, color.rgb);
  writeVector(color.rgb);
}
`;

export const HUE_DISTRIBUTION_ANALYSIS_WGSL = /* wgsl */ `${SCOPE_ANALYSIS_HEADER}
struct HueBins {
  values: array<atomic<u32>, 256>,
}

struct ScopeMaximum {
  value: atomic<u32>,
}

@group(0) @binding(1) var<storage, read_write> hueBins: HueBins;
@group(0) @binding(2) var<storage, read_write> hueMaximum: ScopeMaximum;
@group(0) @binding(3) var<uniform> info: ScopeUniforms;
${SCOPE_ANALYSIS_HELPERS}

fn srgbToLinearChannel(value: f32) -> f32 {
  let safeValue = max(value, 0.0);
  return select(
    pow((safeValue + 0.055) / 1.055, 2.4),
    safeValue / 12.92,
    safeValue <= 0.04045
  );
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

fn perceptualHueToDisplayHue(angle: f32) -> f32 {
  // Warp the non-uniform OKLCH hue locations onto the familiar colour axis.
  // This keeps the measurement perceptual while placing Red, Orange, Yellow,
  // Green, Aqua, Blue, Purple and Magenta where editors expect to see them.
  let tau = 6.28318530718;
  let sourceCenters = array<f32, 8>(
    0.5102, 0.9211, 1.9160, 2.4870,
    3.3986, 4.6085, 5.2464, 5.9994
  );
  let displayCenters = array<f32, 8>(
    0.0, 0.0833333, 0.1666667, 0.3333333,
    0.5, 0.6666667, 0.7638889, 0.875
  );
  var wrapped = angle;
  if (wrapped < 0.0) { wrapped += tau; }
  if (wrapped < sourceCenters[0]) { wrapped += tau; }
  for (var index = 0u; index < 8u; index += 1u) {
    var sourceEnd = sourceCenters[0] + tau;
    var displayEnd = 1.0;
    if (index < 7u) {
      sourceEnd = sourceCenters[index + 1u];
      displayEnd = displayCenters[index + 1u];
    }
    if (wrapped <= sourceEnd) {
      let position = clamp(
        (wrapped - sourceCenters[index]) / max(sourceEnd - sourceCenters[index], 0.00001),
        0.0,
        1.0
      );
      return mix(displayCenters[index], displayEnd, position);
    }
  }
  return 0.0;
}

fn writeHueDistribution(encodedOrLinear: vec3f, alpha: f32) {
  // The source texture is linear while LightTable's final scope texture is
  // display-encoded sRGB. Keeping that distinction explicit makes Original
  // and corrected views use the same perceptual hue definition.
  let isDisplayEncoded = info.rangeAndThresholds.w > 0.5;
  let linearRgb = select(
    encodedOrLinear,
    vec3f(
      srgbToLinearChannel(encodedOrLinear.r),
      srgbToLinearChannel(encodedOrLinear.g),
      srgbToLinearChannel(encodedOrLinear.b)
    ),
    isDisplayEncoded
  );
  let lab = linearRgbToOklab(max(linearRgb, vec3f(0.0)));
  let chroma = length(lab.yz);
  // Hue becomes unstable in neutrals. These are the same protection
  // thresholds used by the Color Mixer, with a mild chroma-strength weight
  // so colourful pixels describe the scope without deleting subtle colour.
  let reliability = smoothstep(0.012, 0.055, chroma);
  let chromaStrength = sqrt(clamp(chroma / 0.25, 0.0, 1.0));
  let luminanceProtection =
    smoothstep(0.004, 0.025, lab.x) *
    (1.0 - smoothstep(0.985, 1.04, lab.x));
  let weight = clamp(alpha, 0.0, 1.0) * reliability *
    mix(0.35, 1.0, chromaStrength) * luminanceProtection;
  if (weight <= 0.0001) { return; }

  let hue = atan2(lab.z, lab.y);
  let displayHue = fract(perceptualHueToDisplayHue(hue));
  let bin = min(u32(displayHue * 256.0), 255u);
  let contribution = max(1u, u32(weight * 256.0 + 0.5));
  let next = atomicAdd(&hueBins.values[bin], contribution) + contribution;
  atomicMax(&hueMaximum.value, next);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= info.imageAndSampleSize.zw)) { return; }
  let coordinate = sourceCoordinate(id.xy);
  let color = textureLoad(imageTexture, vec2i(coordinate), 0);
  if (color.a <= 0.001) { return; }
  writeHueDistribution(color.rgb, color.a);
}
`;

export const HUE_DISTRIBUTION_DISPLAY_WGSL = /* wgsl */ `
struct HueBins {
  values: array<u32, 256>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: HueBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(index: i32) -> f32 {
  let wrapped = (index % 256 + 256) % 256;
  return f32(bins.values[u32(wrapped)]);
}

fn smoothedCount(index: i32) -> f32 {
  return (
    binCount(index - 4) * 0.028 +
    binCount(index - 3) * 0.066 +
    binCount(index - 2) * 0.124 +
    binCount(index - 1) * 0.180 +
    binCount(index)     * 0.204 +
    binCount(index + 1) * 0.180 +
    binCount(index + 2) * 0.124 +
    binCount(index + 3) * 0.066 +
    binCount(index + 4) * 0.028
  );
}

fn hueToRgb(hue: f32) -> vec3f {
  let shifted = fract(hue + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(shifted * 6.0 - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let hue = clamp(input.uv.x, 0.0, 0.999999);
  let index = i32(hue * 256.0);
  let count = smoothedCount(index);
  let peak = max(f32(maximum.value), 1.0);
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let normalized = clamp(count / peak, 0.0, 1.0);
  // A gentle root curve keeps less common colours legible without making
  // tiny chroma noise dominate the distribution.
  let height = pow(normalized, 0.58);
  let fromBottom = 1.0 - input.uv.y;
  let background = vec3f(0.018, 0.023, 0.03);
  let hueColor = mix(vec3f(0.42), hueToRgb(hue), 0.86);
  let inside = 1.0 - step(height, fromBottom);
  let topLine = 1.0 - smoothstep(0.0, 0.018, abs(fromBottom - height));
  let verticalFade = mix(0.42, 1.0, clamp(fromBottom / max(height, 0.0001), 0.0, 1.0));
  var trace = hueColor * inside * verticalFade * brightness;
  trace += mix(hueColor, vec3f(1.0), 0.18) * topLine * 0.72;
  let baseline = (1.0 - smoothstep(0.0, 0.018, fromBottom)) * 0.28;
  return vec4f(background + trace + hueColor * baseline, 1.0);
}
`;

export const PARADE_SCOPE_DISPLAY_WGSL = /* wgsl */ `
struct ParadeBins {
  values: array<u32, 196608>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: ParadeBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(channel: u32, x: i32, y: i32) -> f32 {
  let safeX = u32(clamp(x, 0, 255));
  let safeY = u32(clamp(y, 0, 255));
  return f32(bins.values[channel * 65536u + safeY * 256u + safeX]);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let section = min(u32(input.uv.x * 3.0), 2u);
  let localX = fract(input.uv.x * 3.0);
  let x = i32(localX * 255.0 + 0.5);
  let y = i32((1.0 - input.uv.y) * 255.0 + 0.5);
  var count = 0.0;
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let weight = select(0.42, 1.0, offsetX == 0 && offsetY == 0);
      count += binCount(section, x + offsetX, y + offsetY) * weight;
    }
  }
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let gain = 0.12 * exp2(brightness - 1.0);
  let peak = max(f32(maximum.value), 1.0);
  let normalized = log(1.0 + count * gain) / log(1.0 + peak * gain);
  let intensity = clamp(pow(max(normalized, 0.0), 0.58) * brightness, 0.0, 1.0);
  let colors = array<vec3f, 3>(
    vec3f(1.0, 0.12, 0.16),
    vec3f(0.16, 1.0, 0.34),
    vec3f(0.18, 0.46, 1.0)
  );
  let background = vec3f(0.018, 0.023, 0.03);
  return vec4f(background + colors[section] * intensity, 1.0);
}
`;

export const VECTOR_SCOPE_DISPLAY_WGSL = /* wgsl */ `
struct VectorBins {
  values: array<u32, 65536>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: VectorBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(x: i32, y: i32) -> f32 {
  let safeX = u32(clamp(x, 0, 255));
  let safeY = u32(clamp(y, 0, 255));
  return f32(bins.values[safeY * 256u + safeX]);
}

fn traceColorForPosition(screenUv: vec2f) -> vec3f {
  // Reconstruct the chroma direction represented by this Cb/Cr bin. Luma is
  // intentionally omitted: the scope position carries hue/chroma while the
  // measured density carries intensity. Shift and normalize the inverse-709
  // chroma vector to obtain a vivid display hue without changing the bins.
  let cb = screenUv.x - 0.5;
  let cr = 0.5 - screenUv.y;
  let chromaRgb = vec3f(
    1.5748 * cr,
    -0.187324 * cb - 0.468124 * cr,
    1.8556 * cb
  );
  let minimum = min(chromaRgb.r, min(chromaRgb.g, chromaRgb.b));
  let shifted = chromaRgb - vec3f(minimum);
  let peak = max(shifted.r, max(shifted.g, shifted.b));
  let hueColor = select(vec3f(1.0), shifted / max(peak, 0.000001), peak > 0.000001);
  // Neutrals stay white; chroma smoothly reveals the corresponding target
  // colour as the trace moves away from the centre.
  let chromaAmount = smoothstep(0.015, 0.34, length(vec2f(cb, cr)));
  return mix(vec3f(0.92), hueColor, chromaAmount);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let zoom = select(1.0, 2.0, settings.values.y > 1.5);
  let sampleUv = vec2f(0.5) + (input.uv - vec2f(0.5)) / zoom;
  let x = i32(clamp(sampleUv.x, 0.0, 1.0) * 255.0 + 0.5);
  let y = i32((1.0 - clamp(sampleUv.y, 0.0, 1.0)) * 255.0 + 0.5);
  var count = 0.0;
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let weight = select(0.38, 1.0, offsetX == 0 && offsetY == 0);
      count += binCount(x + offsetX, y + offsetY) * weight;
    }
  }
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let gain = 0.1 * exp2(brightness - 1.0);
  let peak = max(f32(maximum.value), 1.0);
  let normalized = log(1.0 + count * gain) / log(1.0 + peak * gain);
  let intensity = clamp(pow(max(normalized, 0.0), 0.48) * brightness, 0.0, 1.0);
  let background = vec3f(0.018, 0.023, 0.03);
  let chromaTrace = traceColorForPosition(sampleUv);
  // Resolve-like traces become white-hot where many samples occupy the same
  // bin, while sparse outer detail retains its diagnostic hue.
  let whiteHeat = smoothstep(0.58, 1.0, intensity);
  let trace = mix(chromaTrace, vec3f(1.0), whiteHeat);
  return vec4f(background + trace * intensity, 1.0);
}
`;
