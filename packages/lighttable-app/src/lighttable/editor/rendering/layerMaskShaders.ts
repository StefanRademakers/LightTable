/** Applies one document-space layer mask to retained premultiplied layer pixels. */
export const APPLY_LAYER_MASK_WGSL = /* wgsl */ `
struct ApplyMaskSettings {
  sourceToDocumentRow0: vec4f,
  sourceToDocumentRow1: vec4f,
  maskInverseRow0: vec4f,
  maskInverseRow1: vec4f,
  sourceSize: vec2f,
  canvasSize: vec2f,
  density: f32,
  feather: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: ApplyMaskSettings;

fn evaluatedMask(uv: vec2f) -> f32 {
  var value = textureSample(maskTexture, sourceSampler, uv).r;
  if (settings.feather > 0.01) {
    let texel = vec2f(1.0) / settings.canvasSize;
    let radius = settings.feather * texel;
    var sum = 0.0;
    let weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
    for (var y = 0; y < 5; y += 1) {
      for (var x = 0; x < 5; x += 1) {
        let offset = vec2f(f32(x - 2), f32(y - 2)) * radius * 0.5;
        sum += textureSample(
          maskTexture,
          sourceSampler,
          clamp(uv + offset, vec2f(0.0), vec2f(1.0))
        ).r * weights[x] * weights[y];
      }
    }
    value = sum / 256.0;
  }
  return mix(1.0, clamp(value, 0.0, 1.0), clamp(settings.density, 0.0, 1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let sourcePixel = input.uv * settings.sourceSize;
  let documentPixel = vec2f(
    dot(settings.sourceToDocumentRow0.xyz, vec3f(sourcePixel, 1.0)),
    dot(settings.sourceToDocumentRow1.xyz, vec3f(sourcePixel, 1.0))
  );
  let maskPixel = vec2f(
    dot(settings.maskInverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(settings.maskInverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let inside = select(
    0.0,
    1.0,
    all(maskPixel >= vec2f(0.0)) && all(maskPixel < settings.canvasSize)
  );
  let maskUv = clamp(maskPixel / settings.canvasSize, vec2f(0.0), vec2f(1.0));
  let coverage = evaluatedMask(maskUv) * inside;
  return textureSample(sourceTexture, sourceSampler, input.uv) * coverage;
}
`;
