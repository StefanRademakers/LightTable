export const WARP_FIELD_COMPUTE_WGSL = /* wgsl */`
struct Stamp {
  centerDelta: vec4f,
  radiusStrengthHardness: vec4f,
}

struct WarpFieldSettings {
  canvasSize: vec2f,
  stampCount: u32,
  reusePrevious: u32,
}

@group(0) @binding(0) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(1) var previousDisplacement: texture_2d<f32>;
@group(0) @binding(2) var displacementOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> settings: WarpFieldSettings;

fn samplePreviousDisplacement(pixel: vec2f) -> vec2f {
  let maximum = vec2i(settings.canvasSize) - vec2i(1);
  let base = floor(pixel - vec2f(0.5));
  let fraction = fract(pixel - vec2f(0.5));
  let lower = clamp(vec2i(base), vec2i(0), maximum);
  let upper = clamp(lower + vec2i(1), vec2i(0), maximum);
  let topLeft = textureLoad(previousDisplacement, lower, 0).xy;
  let topRight = textureLoad(previousDisplacement, vec2i(upper.x, lower.y), 0).xy;
  let bottomLeft = textureLoad(previousDisplacement, vec2i(lower.x, upper.y), 0).xy;
  let bottomRight = textureLoad(previousDisplacement, upper, 0).xy;
  return mix(
    mix(topLeft, topRight, fraction.x),
    mix(bottomLeft, bottomRight, fraction.x),
    fraction.y
  );
}

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
    let mode = u32(round(stamp.radiusStrengthHardness.w));
    if (mode == 0u) {
      source -= stamp.centerDelta.zw * influence;
    } else if (mode == 1u || mode == 2u) {
      let local = source - stamp.centerDelta.xy;
      let direction = select(-1.0, 1.0, mode == 2u);
      let angle = direction * influence * 0.18;
      let cosine = cos(angle);
      let sine = sin(angle);
      source = stamp.centerDelta.xy + vec2f(
        cosine * local.x - sine * local.y,
        sine * local.x + cosine * local.y
      );
    } else if (mode == 3u || mode == 4u) {
      let local = source - stamp.centerDelta.xy;
      let direction = select(-1.0, 1.0, mode == 4u);
      let radialScale = exp2(direction * influence * 0.22);
      source = stamp.centerDelta.xy + local * radialScale;
    }
  }

  if (settings.reusePrevious != 0u) {
    source += samplePreviousDisplacement(source);
  }
  let displacement = source - destination;
  textureStore(displacementOutput, vec2i(invocation.xy), vec4f(displacement, 0.0, 1.0));
}
`;

export const WARP_RENDER_WGSL = /* wgsl */`
struct WarpRenderSettings {
  canvasSize: vec2f,
  opacity: f32,
  borderMode: u32,
  edgePinning: f32,
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
fn main(input: VertexOutput) -> @location(0) vec4f {
  var displacement = textureLoad(
    displacementTexture,
    clamp(vec2i(input.uv * settings.canvasSize), vec2i(0), vec2i(settings.canvasSize) - 1),
    0
  ).xy;
  let destination = input.uv * settings.canvasSize;
  let edgeDistance = min(
    min(destination.x, settings.canvasSize.x - destination.x),
    min(destination.y, settings.canvasSize.y - destination.y)
  );
  let pinWidth = max(1.0, min(settings.canvasSize.x, settings.canvasSize.y) * 0.08);
  let edgeWeight = mix(1.0, smoothstep(0.0, pinWidth, edgeDistance), settings.edgePinning);
  displacement *= edgeWeight;
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
