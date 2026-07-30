export const CHROMATIC_ABERRATION_WGSL = /* wgsl */ `
struct ChromaticAberrationUniforms {
  amount: f32,
  falloff: f32,
  balance: f32,
  padding: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  padding2: vec2f,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> settings: ChromaticAberrationUniforms;

fn sampleInput(uv: vec2f) -> vec4f {
  return textureSampleLevel(inputTexture, linearSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(settings.sourceWidth, settings.sourceHeight), vec2f(1.0));
  let aspect = dimensions.x / dimensions.y;
  let centered = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let radius = length(centered) / max(length(vec2f(0.5 * aspect, 0.5)), 0.0001);
  var direction = vec2f(0.0);
  if (radius > 0.00001) {
    direction = normalize(centered) / vec2f(aspect, 1.0);
  }
  let falloffExponent = mix(0.65, 3.5, clamp(settings.falloff / 100.0, 0.0, 1.0));
  let radialWeight = pow(clamp(radius, 0.0, 1.0), falloffExponent);
  let resolutionScale = min(dimensions.x, dimensions.y) / 2000.0;
  let pixelShift = pow(clamp(settings.amount / 100.0, 0.0, 1.0), 1.35) * 14.0 * resolutionScale;
  let uvShift = direction * pixelShift / dimensions * radialWeight;
  let balance = clamp(settings.balance / 100.0, -1.0, 1.0);
  let redShift = uvShift * mix(0.55, 1.45, balance * 0.5 + 0.5);
  let blueShift = uvShift * mix(1.45, 0.55, balance * 0.5 + 0.5);
  let edgeDistance = min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y));
  let edgeGuard = smoothstep(0.0, max(pixelShift / min(dimensions.x, dimensions.y) * 2.5, 0.002), edgeDistance);
  let center = sampleInput(input.uv);
  let separated = vec4f(
    sampleInput(input.uv + redShift).r,
    center.g,
    sampleInput(input.uv - blueShift).b,
    center.a
  );
  return mix(center, separated, edgeGuard);
}
`;
