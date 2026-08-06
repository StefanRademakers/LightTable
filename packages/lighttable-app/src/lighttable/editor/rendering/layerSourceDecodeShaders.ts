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
  return vec4f(linear * encoded.a, encoded.a);
}
`;

export const LAYER_ADOBE_RGB_SOURCE_DECODE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

fn adobeToLinear(value: f32) -> f32 {
  return pow(max(value, 0.0), 563.0 / 256.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let encoded = textureSample(sourceTexture, sourceSampler, input.uv);
  let adobe = vec3f(adobeToLinear(encoded.r), adobeToLinear(encoded.g), adobeToLinear(encoded.b));
  let linearSrgb = vec3f(
    1.39835574 * adobe.r - 0.39835574 * adobe.g,
    adobe.g,
    -0.0429288 * adobe.g + 1.0429288 * adobe.b
  );
  return vec4f(linearSrgb * encoded.a, encoded.a);
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
