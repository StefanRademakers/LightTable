import { ADJUSTMENTS_WGSL } from './adjustmentShaderLayout';

export const WAVELET_DETAIL_HORIZONTAL_WGSL = /* wgsl */ `
struct WaveletScale {
  step: f32,
  index: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> scale: WaveletScale;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(sourceTexture)), vec2f(1.0));
  let offset = vec2f(scale.step / dimensions.x, 0.0);
  let center = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let negativeTwo = textureSampleLevel(sourceTexture, sourceSampler, input.uv - offset * 2.0, 0.0);
  let negativeOne = textureSampleLevel(sourceTexture, sourceSampler, input.uv - offset, 0.0);
  let positiveOne = textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset, 0.0);
  let positiveTwo = textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset * 2.0, 0.0);
  let rgb = (
    negativeTwo.rgb + negativeOne.rgb * 4.0 + center.rgb * 6.0
    + positiveOne.rgb * 4.0 + positiveTwo.rgb
  ) / 16.0;
  return vec4f(rgb, center.a);
}
`;

export const WAVELET_DETAIL_VERTICAL_WGSL = /* wgsl */ `
${ADJUSTMENTS_WGSL}

struct WaveletScale {
  step: f32,
  index: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var horizontalTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> adjustments: Adjustments;
@group(0) @binding(4) var<uniform> scale: WaveletScale;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn waveletRetention(magnitude: f32, threshold: f32, detail: f32) -> f32 {
  let protectedThreshold = threshold * mix(1.65, 0.48, detail);
  let normalized = magnitude / max(protectedThreshold, 0.000001);
  let squared = normalized * normalized;
  return 1.0 - exp(-(squared * squared));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(sourceTexture)), vec2f(1.0));
  let offset = vec2f(0.0, scale.step / dimensions.y);
  let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let negativeTwo = textureSampleLevel(horizontalTexture, sourceSampler, input.uv - offset * 2.0, 0.0);
  let negativeOne = textureSampleLevel(horizontalTexture, sourceSampler, input.uv - offset, 0.0);
  let center = textureSampleLevel(horizontalTexture, sourceSampler, input.uv, 0.0);
  let positiveOne = textureSampleLevel(horizontalTexture, sourceSampler, input.uv + offset, 0.0);
  let positiveTwo = textureSampleLevel(horizontalTexture, sourceSampler, input.uv + offset * 2.0, 0.0);
  let base = (
    negativeTwo.rgb + negativeOne.rgb * 4.0 + center.rgb * 6.0
    + positiveOne.rgb * 4.0 + positiveTwo.rgb
  ) / 16.0;

  let sourceY = luminance(source.rgb);
  let baseY = luminance(base);
  let detailY = sourceY - baseY;
  let sourceChroma = source.rgb - vec3f(sourceY);
  let baseChroma = base - vec3f(baseY);
  let detailChroma = sourceChroma - baseChroma;

  let luminanceControlResponse = pow(clamp(adjustments.detail[1].x / 100.0, 0.0, 1.0), 0.40);
  let luminanceStrength = luminanceControlResponse;
  let luminanceDetail = clamp(adjustments.detail[1].y / 100.0, 0.0, 1.0);
  let luminanceContrast = clamp(adjustments.detail[1].z / 100.0, 0.0, 1.0);
  let colorStrength = clamp(adjustments.detail[1].w / 100.0, 0.0, 1.0);
  let colorDetail = clamp(adjustments.detail[2].x / 100.0, 0.0, 1.0);
  let colorSmoothness = clamp(adjustments.detail[2].y / 100.0, 0.0, 1.0);

  // Noise energy falls with each undecimated B3-spline scale. Linear-light
  // luminance dependence approximates shot-noise growth without RAW metadata.
  let scaleIndex = u32(clamp(scale.index, 0.0, 3.0));
  let luminanceThresholds = array<f32, 4>(0.100, 0.028, 0.002, 0.0005);
  let chromaThresholds = array<f32, 4>(0.120, 0.045, 0.016, 0.006);
  let signalScale = 0.38 + 0.62 * sqrt(clamp(abs(baseY), 0.0, 1.0));
  let luminanceThreshold = luminanceThresholds[scaleIndex] * signalScale
    * mix(0.85, 1.30, luminanceControlResponse);
  let luminanceKeep = waveletRetention(abs(detailY), luminanceThreshold, luminanceDetail);
  let coarseContrast = luminanceContrast * f32(scaleIndex) / 3.0;
  let retainedY = mix(luminanceKeep, 1.0, coarseContrast * 0.42);
  let filteredYDetail = detailY * mix(1.0, retainedY, luminanceStrength);

  let chromaMagnitude = length(detailChroma);
  let chromaKeep = waveletRetention(chromaMagnitude, chromaThresholds[scaleIndex], colorDetail);
  let coarseWeight = f32(scaleIndex) / 3.0;
  let smoothnessWeight = mix(1.0 - coarseWeight * 0.45, 0.58 + coarseWeight * 0.42, colorSmoothness);
  let filteredChromaDetail = detailChroma
    * mix(1.0, chromaKeep, colorStrength * smoothnessWeight);

  let resultY = baseY + filteredYDetail;
  let resultChroma = baseChroma + filteredChromaDetail;
  return vec4f(vec3f(resultY) + resultChroma, source.a);
}
`;
