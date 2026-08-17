export const VIGNETTE_WGSL = /* wgsl */ `
struct VignetteSettings {
  amount: f32,
  midpoint: f32,
  roundness: f32,
  feather: f32,
  highlights: f32,
  enabled: f32,
  width: f32,
  height: f32,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> settings: VignetteSettings;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTexture, inputSampler, input.uv);
  if (settings.enabled < 0.5 || abs(settings.amount) < 0.00001) {
    return source;
  }
  let aspect = settings.width / max(settings.height, 1.0);
  let centered = (input.uv - vec2f(0.5)) * 2.0;
  let circleDistance = length(centered * vec2f(aspect, 1.0))
    / max(length(vec2f(aspect, 1.0)), 0.0001);
  let ovalDistance = length(centered) / 1.41421356237;
  let roundnessMix = clamp(settings.roundness / 100.0, -1.0, 1.0) * 0.5 + 0.5;
  let distance = mix(ovalDistance, circleDistance, roundnessMix);
  let transitionStart = mix(0.10, 0.76, clamp(settings.midpoint / 100.0, 0.0, 1.0));
  let feather = clamp(settings.feather / 100.0, 0.0, 1.0);
  let transitionEnd = min(1.0, transitionStart + mix(0.008, 1.0 - transitionStart, feather));
  var weight = smoothstep(transitionStart, max(transitionEnd, transitionStart + 0.0001), distance);
  if (settings.amount < 0.0 && settings.highlights > 0.0) {
    let highlightMask = smoothstep(0.35, 1.15, luminance(source.rgb));
    weight *= 1.0 - highlightMask * clamp(settings.highlights / 100.0, 0.0, 1.0);
  }
  let result = source.rgb * exp2((settings.amount / 100.0) * 2.0 * weight);
  return vec4f(result, source.a);
}
`;
