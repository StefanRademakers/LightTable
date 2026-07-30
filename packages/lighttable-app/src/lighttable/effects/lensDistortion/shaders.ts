export const LENS_DISTORTION_MAPPING_WGSL = /* wgsl */ `
fn lensDistortionSourceUv(
  uv: vec2f,
  dimensions: vec2f,
  amount: f32,
  midpoint: f32,
  zoom: f32
) -> vec2f {
  let aspect = dimensions.x / dimensions.y;
  let halfExtent = vec2f(0.5 * aspect, 0.5);
  let cornerRadius = max(length(halfExtent), 0.0001);
  let centered = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let radius = clamp(length(centered) / cornerRadius, 0.0, 1.0);
  let strength = clamp(amount / 100.0, -1.0, 1.0) * 0.58;
  let exponent = mix(1.35, 3.8, clamp(midpoint / 100.0, 0.0, 1.0));
  let radial = pow(radius, exponent);
  let radial2 = radial * radial;
  let distortionScale = 1.0 + strength * radial + strength * 0.18 * radial2;
  let cornerFactor = 1.0 + strength * 1.18;
  let edgeSafeScale = 1.0 / max(1.0, cornerFactor);
  let userZoom = 1.0 / (1.0 + clamp(zoom / 100.0, 0.0, 1.0) * 0.45);
  let sourceCentered = centered * distortionScale * edgeSafeScale * userZoom;
  return clamp(sourceCentered / vec2f(aspect, 1.0) + vec2f(0.5), vec2f(0.0), vec2f(1.0));
}
`;

export const LENS_DISTORTION_WGSL = /* wgsl */ `
struct LensDistortionUniforms {
  amount: f32,
  midpoint: f32,
  zoom: f32,
  padding: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  padding2: vec2f,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> settings: LensDistortionUniforms;

${LENS_DISTORTION_MAPPING_WGSL}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(settings.sourceWidth, settings.sourceHeight), vec2f(1.0));
  let sourceUv = lensDistortionSourceUv(
    input.uv,
    dimensions,
    settings.amount,
    settings.midpoint,
    settings.zoom
  );
  return textureSampleLevel(inputTexture, linearSampler, sourceUv, 0.0);
}
`;
