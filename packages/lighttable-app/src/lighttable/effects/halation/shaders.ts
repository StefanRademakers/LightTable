const HALATION_UNIFORMS_WGSL = /* wgsl */ `
struct HalationUniforms {
  amount: f32,
  radius: f32,
  threshold: f32,
  warmth: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  padding: vec2f,
}
`;

export const HALATION_EXTRACT_WGSL = /* wgsl */ `
${HALATION_UNIFORMS_WGSL}
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> settings: HalationUniforms;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let rgb = textureSampleLevel(inputTexture, linearSampler, input.uv, 0.0).rgb;
  let y = max(luminance(rgb), 0.0);
  let thresholdControl = clamp(settings.threshold / 100.0, 0.0, 1.0);
  let threshold = mix(0.18, 1.15, pow(thresholdControl, 1.55));
  let knee = mix(0.10, 0.24, thresholdControl);
  let highlight = max(y - threshold + knee, 0.0);
  let softEnergy = highlight * highlight / max(highlight + knee, 0.0001);
  let sourceColor = max(rgb, vec3f(0.0)) / max(y, 0.0001);
  let warmth = clamp(settings.warmth / 100.0, 0.0, 1.0);
  let filmBase = mix(vec3f(1.0, 0.46, 0.16), vec3f(1.0, 0.16, 0.025), warmth);
  let tint = mix(sourceColor, filmBase, mix(0.55, 0.88, warmth));
  return vec4f(tint * softEnergy, 1.0);
}
`;

export const HALATION_BLUR_WGSL = /* wgsl */ `
${HALATION_UNIFORMS_WGSL}
struct BlurUniforms {
  direction: vec2f,
  padding: vec2f,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> settings: HalationUniforms;
@group(0) @binding(3) var<uniform> blur: BlurUniforms;

fn sampleInput(uv: vec2f) -> vec3f {
  return textureSampleLevel(inputTexture, linearSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(inputTexture)), vec2f(1.0));
  let resolutionScale = max(min(settings.sourceWidth, settings.sourceHeight) / 1400.0, 0.35);
  let radius = mix(0.7, 18.0, pow(clamp(settings.radius / 100.0, 0.0, 1.0), 1.35)) * resolutionScale;
  let axis = blur.direction * radius / dimensions;
  var value = sampleInput(input.uv) * 0.227027;
  value += (sampleInput(input.uv + axis * 0.38) + sampleInput(input.uv - axis * 0.38)) * 0.1945946;
  value += (sampleInput(input.uv + axis * 0.92) + sampleInput(input.uv - axis * 0.92)) * 0.1216216;
  value += (sampleInput(input.uv + axis * 1.55) + sampleInput(input.uv - axis * 1.55)) * 0.054054;
  let normalization = 0.227027 + 2.0 * (0.1945946 + 0.1216216 + 0.054054);
  return vec4f(value / normalization, 1.0);
}
`;

export const HALATION_COMPOSITE_WGSL = /* wgsl */ `
${HALATION_UNIFORMS_WGSL}
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var halationTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> settings: HalationUniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let base = textureSampleLevel(inputTexture, linearSampler, input.uv, 0.0);
  let spill = textureSampleLevel(halationTexture, linearSampler, input.uv, 0.0).rgb;
  let amount = pow(clamp(settings.amount / 100.0, 0.0, 1.0), 1.15) * 1.35;
  return vec4f(base.rgb + spill * amount, base.a);
}
`;
