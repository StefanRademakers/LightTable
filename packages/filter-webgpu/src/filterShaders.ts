export const FILTER_FULLSCREEN_VERTEX_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn filterFullscreenVertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}
`;

export const BLUR_CORE_WGSL = /* wgsl */ `
struct BlurCoreUniforms {
  direction: vec2f,
  radius: f32,
  sigma: f32,
  outputMode: u32,
  amount: f32,
  threshold: f32,
  padding: f32,
}

@group(0) @binding(0) var originalTexture: texture_2d<f32>;
@group(0) @binding(1) var blurInputTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> params: BlurCoreUniforms;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn unpremultiply(value: vec4f) -> vec3f {
  return select(vec3f(0.0), value.rgb / value.a, value.a > 0.000001);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(blurInputTexture));
  let texel = params.direction / dimensions;
  let support = min(100, i32(ceil(params.radius)));
  let sigma = max(params.sigma, 0.5);
  let denominator = 2.0 * sigma * sigma;
  var blurred = textureSampleLevel(blurInputTexture, sourceSampler, input.uv, 0.0);
  var total = 1.0;
  for (var tap = 1; tap <= 100; tap += 1) {
    if (tap > support) { break; }
    let offset = f32(tap);
    let weight = exp(-(offset * offset) / denominator);
    blurred += textureSampleLevel(blurInputTexture, sourceSampler, input.uv + texel * offset, 0.0) * weight;
    blurred += textureSampleLevel(blurInputTexture, sourceSampler, input.uv - texel * offset, 0.0) * weight;
    total += 2.0 * weight;
  }
  blurred /= total;
  if (params.outputMode == 0u) { return blurred; }

  let source = textureSampleLevel(originalTexture, sourceSampler, input.uv, 0.0);
  let detail = source.rgb - blurred.rgb;
  if (params.outputMode == 1u) {
    return vec4f(clamp(detail + vec3f(0.5 * source.a), vec3f(0.0), vec3f(source.a)), source.a);
  }

  let perceptualDifference = abs(luminance(unpremultiply(source)) - luminance(unpremultiply(blurred)));
  let gain = select(0.0, params.amount, perceptualDifference * 255.0 >= params.threshold);
  return vec4f(clamp(source.rgb + detail * gain, vec3f(0.0), vec3f(source.a)), source.a);
}
`;
