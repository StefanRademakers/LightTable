import { LENS_DISTORTION_MAPPING_WGSL } from '../lensDistortion/shaders';

const LENS_BLUR_UNIFORMS_WGSL = /* wgsl */ `
struct LensBlurUniforms {
  apertureSize: f32,
  catEye: f32,
  bokehBoost: f32,
  focusStart: f32,
  focusEnd: f32,
  transitionFeather: f32,
  bokehShape: f32,
  visualizeDepth: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  distortionAmount: f32,
  distortionMidpoint: f32,
  distortionZoom: f32,
  padding0: f32,
  padding1: f32,
  gatherSamples: f32,
}
`;

export const LENS_BLUR_DEPTH_REFINE_WGSL = /* wgsl */ `
${LENS_BLUR_UNIFORMS_WGSL}
${LENS_DISTORTION_MAPPING_WGSL}

@group(0) @binding(0) var guideTexture: texture_2d<f32>;
@group(0) @binding(1) var rawDepthTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: LensBlurUniforms;

fn rawDepthAtOutputUv(uv: vec2f) -> f32 {
  let outputDimensions = max(vec2f(settings.sourceWidth, settings.sourceHeight), vec2f(1.0));
  let sourceUv = lensDistortionSourceUv(
    uv,
    outputDimensions,
    settings.distortionAmount,
    settings.distortionMidpoint,
    settings.distortionZoom
  );
  let depthDimensions = vec2f(textureDimensions(rawDepthTexture));
  let position = clamp(sourceUv * depthDimensions - vec2f(0.5), vec2f(0.0), depthDimensions - vec2f(1.0));
  let lower = vec2i(floor(position));
  let upper = min(lower + vec2i(1), vec2i(depthDimensions) - vec2i(1));
  let fraction = fract(position);
  let top = mix(textureLoad(rawDepthTexture, lower, 0).r, textureLoad(rawDepthTexture, vec2i(upper.x, lower.y), 0).r, fraction.x);
  let bottom = mix(textureLoad(rawDepthTexture, vec2i(lower.x, upper.y), 0).r, textureLoad(rawDepthTexture, upper, 0).r, fraction.x);
  return mix(top, bottom, fraction.y);
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let dimensions = max(vec2f(settings.sourceWidth, settings.sourceHeight), vec2f(1.0));
  let coordinate = vec2i(clamp(input.uv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));
  let centerColor = textureLoad(guideTexture, coordinate, 0).rgb;
  var depthSum = 0.0;
  var weightSum = 0.0;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      let offset = vec2f(f32(x), f32(y));
      let sampleUv = clamp(input.uv + offset / dimensions, vec2f(0.0), vec2f(1.0));
      let sampleCoordinate = vec2i(clamp(sampleUv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));
      let sampleColor = textureLoad(guideTexture, sampleCoordinate, 0).rgb;
      let colorDistance = length(sampleColor - centerColor);
      let spatialWeight = exp(-dot(offset, offset) * 0.22);
      let guideWeight = exp(-colorDistance * 7.5);
      let weight = spatialWeight * guideWeight;
      depthSum += rawDepthAtOutputUv(sampleUv) * weight;
      weightSum += weight;
    }
  }
  return clamp(depthSum / max(weightSum, 0.000001), 0.0, 1.0);
}
`;

export const LENS_BLUR_DOWNSAMPLE_WGSL = /* wgsl */ `
${LENS_BLUR_UNIFORMS_WGSL}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: LensBlurUniforms;

struct DownsampleOutput {
  @location(0) color: vec4f,
  @location(1) depth: vec4f,
}

@fragment
fn main(input: VertexOutput) -> DownsampleOutput {
  let fullDimensions = vec2i(max(vec2f(settings.sourceWidth, settings.sourceHeight), vec2f(1.0)));
  let base = vec2i(input.position.xy) * 2;
  var colorSum = vec4f(0.0);
  var depthSum = 0.0;
  var minimumDepth = 1.0;
  var maximumDepth = 0.0;
  for (var y = 0; y < 2; y += 1) {
    for (var x = 0; x < 2; x += 1) {
      let coordinate = clamp(base + vec2i(x, y), vec2i(0), fullDimensions - vec2i(1));
      let color = textureLoad(inputTexture, coordinate, 0);
      let depth = textureLoad(depthTexture, coordinate, 0).r;
      colorSum += color;
      depthSum += depth;
      minimumDepth = min(minimumDepth, depth);
      maximumDepth = max(maximumDepth, depth);
    }
  }
  var output: DownsampleOutput;
  output.color = colorSum * 0.25;
  output.depth = vec4f(depthSum * 0.25, minimumDepth, maximumDepth, 1.0);
  return output;
}
`;

export const LENS_BLUR_GATHER_WGSL = /* wgsl */ `
${LENS_BLUR_UNIFORMS_WGSL}

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> settings: LensBlurUniforms;

struct GatherOutput {
  @location(0) foreground: vec4f,
  @location(1) background: vec4f,
}

fn signedCoc(depth: f32) -> f32 {
  let feather = max(settings.transitionFeather, 0.001);
  let nearDistance = max(depth - settings.focusEnd, 0.0);
  let farDistance = max(settings.focusStart - depth, 0.0);
  return clamp((nearDistance - farDistance) / feather, -1.0, 1.0);
}

fn sampleRotation(uv: vec2f) -> f32 {
  let hash = fract(sin(dot(floor(uv * vec2f(4096.0)), vec2f(127.1, 311.7))) * 43758.5453123);
  return hash * 6.28318531;
}

fn apertureSample(index: u32, count: f32, uv: vec2f) -> vec2f {
  let unitIndex = f32(index) + 0.5;
  let angle = unitIndex * 2.39996323 + sampleRotation(uv);
  var radius = sqrt(unitIndex / count);
  if (settings.bokehShape > 2.5) {
    radius = mix(0.62, 1.0, unitIndex / count);
  }
  var sample = vec2f(cos(angle), sin(angle)) * radius;
  if (settings.bokehShape > 0.5 && settings.bokehShape < 1.5) {
    let sector = 3.14159265 / 3.0;
    let localAngle = abs(fract((angle + sector * 0.5) / sector) * sector - sector * 0.5);
    sample *= cos(sector * 0.5) / max(cos(localAngle), 0.001);
  } else if (settings.bokehShape > 1.5 && settings.bokehShape < 2.5) {
    sample.y *= 0.42;
  }

  let centered = uv - vec2f(0.5);
  let edge = smoothstep(0.08, 0.72, length(centered) * 1.41421356);
  let radial = normalize(centered + vec2f(0.00001));
  let tangent = vec2f(-radial.y, radial.x);
  let radialComponent = dot(sample, radial);
  let tangentComponent = dot(sample, tangent);
  let catEye = clamp(settings.catEye / 100.0, 0.0, 1.0) * edge;
  sample = radial * (radialComponent * (1.0 - catEye * 0.72) + catEye * 0.18) + tangent * tangentComponent;
  return sample;
}

fn highlightWeight(color: vec3f) -> f32 {
  let luminance = dot(max(color, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
  let highlight = smoothstep(0.62, 1.35, luminance);
  return 1.0 + highlight * clamp(settings.bokehBoost / 100.0, 0.0, 1.0) * 2.5;
}

@fragment
fn main(input: VertexOutput) -> GatherOutput {
  let dimensions = vec2f(textureDimensions(colorTexture));
  let centerCoordinate = vec2i(clamp(input.uv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));
  let centerDepth = textureLoad(depthTexture, centerCoordinate, 0).r;
  let centerCoc = signedCoc(centerDepth);
  let resolutionScale = min(settings.sourceWidth, settings.sourceHeight) / 1080.0;
  let maxRadius = pow(clamp(settings.apertureSize / 100.0, 0.0, 1.0), 1.35) * 28.0 * resolutionScale;

  var backgroundColor = vec3f(0.0);
  var backgroundWeight = 0.0;
  var foregroundColor = vec3f(0.0);
  var foregroundWeight = 0.0;
  var foregroundCoverage = 0.0;
  let sampleCount = max(u32(settings.gatherSamples + 0.5), 1u);

  for (var index = 0u; index < 128u; index += 1u) {
    if (index >= sampleCount) { break; }
    let aperture = apertureSample(index, f32(sampleCount), input.uv);

    // Search at the full aperture radius. A background source sample itself
    // decides whether its negative CoC reaches this output pixel.
    let backgroundUv = clamp(input.uv + aperture * maxRadius / dimensions, vec2f(0.0), vec2f(1.0));
    let backgroundDepthInfo = textureSampleLevel(depthTexture, linearSampler, backgroundUv, 0.0);
    let backgroundDepth = backgroundDepthInfo.r;
    let backgroundCoc = min(signedCoc(backgroundDepth), 0.0);
    let sourceRadius = abs(backgroundCoc) * maxRadius;
    let sampleDistance = length(aperture) * maxRadius;
    let sourceReach = 1.0 - smoothstep(sourceRadius - 1.0, sourceRadius + 1.0, sampleDistance);
    // The maximum depth in the source 2x2 tile identifies nearer geometry
    // mixed into that tile and prevents it bleeding into far background blur.
    let tileOcclusion = 1.0 - smoothstep(centerDepth + 0.015, centerDepth + 0.08, backgroundDepthInfo.b);
    let backgroundAccept = sourceReach * tileOcclusion;
    let backgroundSample = textureSampleLevel(colorTexture, linearSampler, backgroundUv, 0.0).rgb;
    let backgroundSampleWeight = backgroundAccept * highlightWeight(backgroundSample);
    backgroundColor += backgroundSample * backgroundSampleWeight;
    backgroundWeight += backgroundSampleWeight;

    // Foreground is gathered at its maximum possible spread, then accepted
    // only when that sample's own CoC reaches the current output position.
    let foregroundUv = clamp(input.uv + aperture * maxRadius / dimensions, vec2f(0.0), vec2f(1.0));
    let foregroundDepth = textureSampleLevel(depthTexture, linearSampler, foregroundUv, 0.0).r;
    let foregroundCoc = max(signedCoc(foregroundDepth), 0.0);
    let sampleRadius = max(length(aperture) * maxRadius, 0.001);
    let reach = smoothstep(sampleRadius - 2.0, sampleRadius + 1.0, foregroundCoc * maxRadius);
    let foregroundSample = textureSampleLevel(colorTexture, linearSampler, foregroundUv, 0.0).rgb;
    let foregroundSampleWeight = reach * highlightWeight(foregroundSample);
    foregroundColor += foregroundSample * foregroundSampleWeight;
    foregroundWeight += foregroundSampleWeight;
    foregroundCoverage += reach;
  }

  let centerColor = textureLoad(colorTexture, centerCoordinate, 0).rgb;
  var output: GatherOutput;
  output.background = vec4f(
    select(centerColor, backgroundColor / max(backgroundWeight, 0.000001), backgroundWeight > 0.000001),
    abs(min(centerCoc, 0.0))
  );
  let expectedForegroundCoverage = max(f32(sampleCount) * (7.0 / 24.0), 1.0);
  let foregroundAlpha = clamp(foregroundCoverage / expectedForegroundCoverage, 0.0, 1.0);
  let foregroundResult = select(centerColor, foregroundColor / max(foregroundWeight, 0.000001), foregroundWeight > 0.000001);
  output.foreground = vec4f(foregroundResult * foregroundAlpha, foregroundAlpha);
  return output;
}
`;

export const LENS_BLUR_COMPOSITE_WGSL = /* wgsl */ `
${LENS_BLUR_UNIFORMS_WGSL}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var foregroundTexture: texture_2d<f32>;
@group(0) @binding(3) var backgroundTexture: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var<uniform> settings: LensBlurUniforms;

fn signedCoc(depth: f32) -> f32 {
  let feather = max(settings.transitionFeather, 0.001);
  let nearDistance = max(depth - settings.focusEnd, 0.0);
  let farDistance = max(settings.focusStart - depth, 0.0);
  return clamp((nearDistance - farDistance) / feather, -1.0, 1.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let coordinate = vec2i(clamp(input.uv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));
  let depth = clamp(textureLoad(depthTexture, coordinate, 0).r, 0.0, 1.0);
  if (settings.visualizeDepth > 0.5) {
    return vec4f(vec3f(depth), 1.0);
  }
  let source = textureLoad(sourceTexture, coordinate, 0);
  let coc = signedCoc(depth);
  let background = textureSampleLevel(backgroundTexture, linearSampler, input.uv, 0.0);
  let foreground = textureSampleLevel(foregroundTexture, linearSampler, input.uv, 0.0);
  var rgb = mix(source.rgb, background.rgb, abs(min(coc, 0.0)));
  rgb = foreground.rgb + rgb * (1.0 - foreground.a);
  return vec4f(rgb, source.a);
}
`;
