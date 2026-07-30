const GRAIN_UNIFORMS_WGSL = /* wgsl */ `
struct GrainUniforms {
  amount: f32,
  size: f32,
  softness: f32,
  color: f32,
  shadowResponse: f32,
  blend: f32,
  seed: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  redScale: f32,
  greenScale: f32,
  blueScale: f32,
  redContrast: f32,
  greenContrast: f32,
  blueContrast: f32,
  padding: f32,
}
`;

export const GRAIN_GENERATE_WGSL = /* wgsl */ `
${GRAIN_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> grainSettings: GrainUniforms;

fn pcg3d(value: vec3u) -> vec3u {
  var state = value * 1664525u + 1013904223u;
  state.x = state.x + state.y * state.z;
  state.y = state.y + state.z * state.x;
  state.z = state.z + state.x * state.y;
  state = state ^ (state >> vec3u(16u));
  state.x = state.x + state.y * state.z;
  state.y = state.y + state.z * state.x;
  state.z = state.z + state.x * state.y;
  return state;
}

fn hashToUnit(value: u32) -> f32 {
  return f32(value) * (1.0 / 4294967295.0);
}

fn grainKernel(delta: vec2f, radius: f32) -> f32 {
  return exp(-dot(delta, delta) / max(radius * radius, 0.0001));
}

fn grainCellLayer(pixel: vec2f, grainScale: f32, seed: u32) -> f32 {
  let scale = max(grainScale, 0.35);
  let localPixel = pixel / scale;
  let baseCell = vec2i(floor(localPixel));
  let local = fract(localPixel);
  var sum = 0.0;
  var weightSum = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let cell = baseCell + vec2i(ox, oy);
      let cellBits = bitcast<vec2u>(cell);
      let jitterHash = pcg3d(vec3u(cellBits, seed + 17u));
      let amplitudeHash = pcg3d(vec3u(cellBits, seed + 53u));
      let center = vec2f(f32(ox), f32(oy)) + vec2f(hashToUnit(jitterHash.x), hashToUnit(jitterHash.y));
      let delta = center - local;
      let radius = mix(0.22, 0.78, hashToUnit(jitterHash.z));
      let kernel = grainKernel(delta, radius);
      let polarity = mix(-1.0, 1.0, step(0.5, hashToUnit(amplitudeHash.x)));
      let amplitude = mix(0.35, 1.0, hashToUnit(amplitudeHash.y));
      sum += polarity * amplitude * kernel;
      weightSum += kernel;
    }
  }
  return sum / max(weightSum, 0.0001);
}

fn grainSpeckle(pixel: vec2f, seed: u32) -> f32 {
  let coordinate = vec2u(max(pixel, vec2f(0.0)));
  let hash = pcg3d(vec3u(coordinate, seed));
  return hashToUnit(hash.x) + hashToUnit(hash.y) - 1.0;
}

fn grainNoise(pixel: vec2f, grainScale: f32, seed: u32) -> f32 {
  let clumps = grainCellLayer(pixel, grainScale, seed);
  let clusters = grainCellLayer(pixel + vec2f(11.37, 3.91), grainScale * 0.43, seed + 101u);
  let speckle = grainSpeckle(pixel + vec2f(23.0, 47.0), seed + 211u);
  return clumps * 0.58 + clusters * 0.27 + speckle * 0.15;
}

fn shapeNoise(sample: f32, contrast: f32) -> f32 {
  return sign(sample) * pow(abs(sample), max(contrast, 0.001));
}

fn channelSeed(baseSeed: u32, offset: u32) -> u32 {
  return baseSeed * 747796405u + offset * 2891336453u + 277803737u;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(grainSettings.sourceWidth, grainSettings.sourceHeight), vec2f(1.0));
  let pixel = floor(input.uv * dimensions);
  let seed = u32(max(grainSettings.seed, 1.0));
  let size = max(grainSettings.size, 0.25);
  let noiseR = shapeNoise(grainNoise(pixel + vec2f(19.0, 31.0), size * grainSettings.redScale, channelSeed(seed, 11u)), grainSettings.redContrast);
  let noiseG = shapeNoise(grainNoise(pixel + vec2f(47.0, 13.0), size * grainSettings.greenScale, channelSeed(seed, 37u)), grainSettings.greenContrast);
  let noiseB = shapeNoise(grainNoise(pixel + vec2f(7.0, 59.0), size * grainSettings.blueScale, channelSeed(seed, 73u)), grainSettings.blueContrast);
  let grain = clamp(vec3f(noiseR, noiseG, noiseB), vec3f(-1.0), vec3f(1.0));
  return vec4f(grain * 0.5 + 0.5, 1.0);
}
`;

export const GRAIN_BLUR_WGSL = /* wgsl */ `
${GRAIN_UNIFORMS_WGSL}
struct BlurUniforms {
  direction: vec2f,
  padding: vec2f,
}

@group(0) @binding(0) var grainTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> grainSettings: GrainUniforms;
@group(0) @binding(3) var<uniform> blur: BlurUniforms;

fn sampleGrain(uv: vec2f) -> vec3f {
  return textureSampleLevel(grainTexture, linearSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let softness = max(grainSettings.softness, 0.0);
  if (softness < 0.001) {
    return vec4f(sampleGrain(input.uv), 1.0);
  }
  let texel = 1.0 / max(vec2f(textureDimensions(grainTexture)), vec2f(1.0));
  let axis = blur.direction * texel * softness * 0.5;
  var value = sampleGrain(input.uv) * 0.204164;
  value += (sampleGrain(input.uv + axis) + sampleGrain(input.uv - axis)) * 0.180384;
  value += (sampleGrain(input.uv + axis * 2.4) + sampleGrain(input.uv - axis * 2.4)) * 0.123818;
  value += (sampleGrain(input.uv + axis * 4.2) + sampleGrain(input.uv - axis * 4.2)) * 0.066282;
  value += (sampleGrain(input.uv + axis * 6.4) + sampleGrain(input.uv - axis * 6.4)) * 0.027631;
  return vec4f(value, 1.0);
}
`;

export const GRAIN_COMPOSITE_WGSL = /* wgsl */ `
${GRAIN_UNIFORMS_WGSL}
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var grainTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> grainSettings: GrainUniforms;

fn overlay(base: vec3f, blend: vec3f) -> vec3f {
  let low = 2.0 * base * blend;
  let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(vec3f(0.5), base));
}

fn softLight(base: vec3f, blend: vec3f) -> vec3f {
  let low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  let high = base + (2.0 * blend - 1.0) * (sqrt(max(base, vec3f(0.0))) - base);
  return mix(low, high, step(vec3f(0.5), blend));
}

fn mixGrain(base: vec3f, grain: vec3f, overlayMix: f32) -> vec3f {
  let normalized = clamp(grain * 0.5 + 0.5, vec3f(0.0), vec3f(1.0));
  let additive = clamp(base + grain * 0.16, vec3f(0.0), vec3f(1.0));
  let hybrid = mix(softLight(base, normalized), overlay(base, normalized), 0.35);
  return mix(additive, hybrid, overlayMix);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(inputTexture));
  let coordinate = clamp(vec2i(floor(input.uv * vec2f(dimensions))), vec2i(0), dimensions - vec2i(1));
  let base = textureLoad(inputTexture, coordinate, 0);
  let rgbGrain = clamp(textureLoad(grainTexture, coordinate, 0).rgb * 2.0 - 1.0, vec3f(-1.0), vec3f(1.0));
  let monochrome = dot(rgbGrain, vec3f(0.333333));
  let grain = mix(vec3f(monochrome), rgbGrain, clamp(grainSettings.color / 100.0, 0.0, 1.0));
  let luma = dot(base.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let shadowWeight = pow(clamp(1.0 - luma, 0.0, 1.0), max(grainSettings.shadowResponse, 0.001));
  let amount = max(grainSettings.amount, 0.0);
  let compositeWeight = clamp(amount * mix(0.32, 1.0, shadowWeight), 0.0, 1.0);
  let weightedGrain = grain * (amount * mix(0.42, 1.0, shadowWeight));
  let result = mix(base.rgb, mixGrain(base.rgb, weightedGrain, clamp(grainSettings.blend / 100.0, 0.0, 1.0)), compositeWeight);
  return vec4f(result, base.a);
}
`;
