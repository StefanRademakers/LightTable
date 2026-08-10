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
@group(0) @binding(1) var previousDisplacement: texture_2d<u32>;
@group(0) @binding(2) var displacementOutput: texture_storage_2d<r32uint, write>;
@group(0) @binding(3) var<uniform> settings: WarpFieldSettings;

fn samplePreviousDisplacement(pixel: vec2f) -> vec2f {
  let maximum = vec2i(settings.canvasSize) - vec2i(1);
  let base = floor(pixel - vec2f(0.5));
  let fraction = fract(pixel - vec2f(0.5));
  let lower = clamp(vec2i(base), vec2i(0), maximum);
  let upper = clamp(lower + vec2i(1), vec2i(0), maximum);
  let topLeft = unpack2x16float(textureLoad(previousDisplacement, lower, 0).x);
  let topRight = unpack2x16float(textureLoad(previousDisplacement, vec2i(upper.x, lower.y), 0).x);
  let bottomLeft = unpack2x16float(textureLoad(previousDisplacement, vec2i(lower.x, upper.y), 0).x);
  let bottomRight = unpack2x16float(textureLoad(previousDisplacement, upper, 0).x);
  return mix(
    mix(topLeft, topRight, fraction.x),
    mix(bottomLeft, bottomRight, fraction.x),
    fraction.y
  );
}

// Quintic smootherstep has zero first and second derivatives at both ends.
// That matters for a displacement field: a power falloff leaves a visible
// cusp at each stamp centre even when the pointer path itself is smooth.
fn smootherstep01(value: f32) -> f32 {
  let t = clamp(value, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
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
    // Adobe-style Density controls edge feathering, independently from
    // Pressure/Strength. At zero density the whole radius feathers smoothly;
    // increasing density grows a fully effective core while retaining a
    // narrow, derivative-continuous edge transition at 100%.
    let density = clamp(stamp.radiusStrengthHardness.z, 0.0, 1.0);
    let coreRadius = density * 0.75;
    let feather = (normalizedDistance - coreRadius) / max(1.0 - coreRadius, 0.001);
    let influence = (1.0 - smootherstep01(feather)) * stamp.radiusStrengthHardness.y;
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
      // Inverse mapping: Pinch samples farther from the center; Bloat
      // samples closer to it.
      let direction = select(1.0, -1.0, mode == 4u);
      let radialScale = exp2(direction * influence * 0.22);
      source = stamp.centerDelta.xy + local * radialScale;
    }
  }

  if (settings.reusePrevious != 0u) {
    source += samplePreviousDisplacement(source);
  }
  let displacement = source - destination;
  textureStore(displacementOutput, vec2i(invocation.xy), vec4u(pack2x16float(displacement), 0u, 0u, 0u));
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
@group(0) @binding(1) var displacementTexture: texture_2d<u32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: WarpRenderSettings;

fn mirrorCoordinate(value: f32) -> f32 {
  let period = value - floor(value * 0.5) * 2.0;
  return select(period, 2.0 - period, period > 1.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  var displacement = unpack2x16float(textureLoad(
    displacementTexture,
    clamp(vec2i(input.uv * settings.canvasSize), vec2i(0), vec2i(settings.canvasSize) - 1),
    0
  ).x);
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

/**
 * Development-only visualization of the signed Warp displacement texture.
 * No document pixels are sampled and the view is never part of export.
 *
 * Neutral gray means no movement. Horizontal movement travels along the
 * red/cyan axis, vertical movement along green/magenta. The deformed grid
 * makes discontinuities and overly sparse stroke stamping easy to spot.
 */
export const WARP_DISPLACEMENT_DEBUG_WGSL = /* wgsl */`
struct WarpRenderSettings {
  canvasSize: vec2f,
  opacity: f32,
  borderMode: u32,
  edgePinning: f32,
}

@group(0) @binding(0) var displacementTexture: texture_2d<u32>;
@group(0) @binding(1) var<uniform> settings: WarpRenderSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = clamp(
    vec2i(input.uv * settings.canvasSize),
    vec2i(0),
    vec2i(settings.canvasSize) - 1
  );
  let displacement = unpack2x16float(textureLoad(displacementTexture, pixel, 0).x);
  let debugRange = max(min(settings.canvasSize.x, settings.canvasSize.y) * 0.04, 8.0);
  let signedDisplacement = clamp(displacement / debugRange, vec2f(-1.0), vec2f(1.0));
  let magnitude = clamp(length(signedDisplacement), 0.0, 1.0);

  // Signed XY encoding: +X red, -X cyan, +Y green, -Y magenta.
  let encoded = vec3f(
    0.5 + 0.5 * signedDisplacement.x,
    0.5 + 0.5 * signedDisplacement.y,
    0.5 - 0.25 * (signedDisplacement.x + signedDisplacement.y)
  );
  var color = mix(vec3f(0.18), encoded, smoothstep(0.002, 0.12, magnitude));

  // A source-space grid exposes folds, gaps and jagged stamp transitions.
  let sourcePixel = vec2f(pixel) + vec2f(0.5) + displacement;
  let gridCoordinate = sourcePixel / 32.0;
  let gridDistance = abs(fract(gridCoordinate) - vec2f(0.5));
  let gridLine = smoothstep(0.46, 0.5, max(gridDistance.x, gridDistance.y));
  color = mix(color, vec3f(0.92), gridLine * 0.32);

  return vec4f(color, 1.0);
}
`;
