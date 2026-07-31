export const WARP_FIELD_COMPUTE_WGSL = /* wgsl */`
struct Stamp {
  centerDelta: vec4f,
  radiusStrengthHardness: vec4f,
}

struct WarpFieldSettings {
  canvasSize: vec2f,
  stampCount: u32,
  edgePinning: f32,
}

@group(0) @binding(0) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(1) var displacementOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> settings: WarpFieldSettings;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(settings.canvasSize.x) || invocation.y >= u32(settings.canvasSize.y)) {
    return;
  }

  let destination = vec2f(invocation.xy) + vec2f(0.5);
  var source = destination;
  var index = settings.stampCount;
  loop {
    if (index == 0u) { break; }
    index -= 1u;
    let stamp = stamps[index];
    let radius = max(stamp.radiusStrengthHardness.x, 0.5);
    let normalizedDistance = distance(source, stamp.centerDelta.xy) / radius;
    let radial = clamp(1.0 - normalizedDistance, 0.0, 1.0);
    let exponent = mix(2.75, 0.65, clamp(stamp.radiusStrengthHardness.z, 0.0, 1.0));
    let influence = pow(radial, exponent) * stamp.radiusStrengthHardness.y;
    source -= stamp.centerDelta.zw * influence;
  }

  let edgeDistance = min(
    min(destination.x, settings.canvasSize.x - destination.x),
    min(destination.y, settings.canvasSize.y - destination.y)
  );
  let pinWidth = max(1.0, min(settings.canvasSize.x, settings.canvasSize.y) * 0.08);
  let edgeWeight = mix(1.0, smoothstep(0.0, pinWidth, edgeDistance), settings.edgePinning);
  let displacement = (source - destination) * edgeWeight;
  textureStore(displacementOutput, vec2i(invocation.xy), vec4f(displacement, 0.0, 1.0));
}
`;

export const WARP_RENDER_WGSL = /* wgsl */`
struct WarpRenderSettings {
  canvasSize: vec2f,
  opacity: f32,
  borderMode: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var displacementTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: WarpRenderSettings;

fn mirrorCoordinate(value: f32) -> f32 {
  let period = value - floor(value * 0.5) * 2.0;
  return select(period, 2.0 - period, period > 1.0);
}

@fragment
fn main(input: FullscreenOutput) -> @location(0) vec4f {
  let displacement = textureLoad(
    displacementTexture,
    clamp(vec2i(input.uv * settings.canvasSize), vec2i(0), vec2i(settings.canvasSize) - 1),
    0
  ).xy;
  let sourceUvRaw = input.uv + displacement / settings.canvasSize;
  var sourceUv = sourceUvRaw;
  if (settings.borderMode == 2u) {
    sourceUv = vec2f(mirrorCoordinate(sourceUv.x), mirrorCoordinate(sourceUv.y));
  } else {
    sourceUv = clamp(sourceUv, vec2f(0.0), vec2f(1.0));
  }
  let inside = f32(all(sourceUvRaw >= vec2f(0.0)) && all(sourceUvRaw <= vec2f(1.0)));
  let borderAlpha = select(1.0, inside, settings.borderMode == 0u);
  let warped = textureSample(sourceTexture, sourceSampler, sourceUv) * borderAlpha;
  let original = textureSample(sourceTexture, sourceSampler, input.uv);
  return mix(original, warped, settings.opacity);
}
`;
