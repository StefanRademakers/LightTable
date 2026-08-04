export const LAYER_TRANSFORM_WGSL = /* wgsl */ `
struct TransformSettings {
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  inverseRow2: vec4f,
  canvasSize: vec2f,
  selectionActive: f32,
  duplicateSelection: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: TransformSettings;

fn inversePoint(point: vec2f) -> vec2f {
  let homogeneous = vec3f(
    dot(settings.inverseRow0.xyz, vec3f(point, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(point, 1.0)),
    dot(settings.inverseRow2.xyz, vec3f(point, 1.0))
  );
  let safeW = select(homogeneous.z, select(-1e-6, 1e-6, homogeneous.z >= 0.0), abs(homogeneous.z) < 1e-6);
  return homogeneous.xy / safeW;
}

fn insideCanvas(point: vec2f) -> bool {
  return all(point >= vec2f(0.0)) && all(point < settings.canvasSize);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let destinationPixel = input.uv * settings.canvasSize;
  let destinationUv = destinationPixel / settings.canvasSize;
  let sourcePixel = inversePoint(destinationPixel);
  let sourceUv = sourcePixel / settings.canvasSize;
  let safeSourceUv = clamp(sourceUv, vec2f(0.0), vec2f(1.0));
  let sourceInside = select(0.0, 1.0, insideCanvas(sourcePixel));

  let selectionAtDestination = select(
    1.0,
    textureSample(selectionTexture, sourceSampler, destinationUv).r,
    settings.selectionActive > 0.5
  );
  let original = textureSample(sourceTexture, sourceSampler, destinationUv);
  let cutBase = original * (1.0 - selectionAtDestination);
  let base = select(
    vec4f(0.0),
    select(cutBase, original, settings.duplicateSelection > 0.5),
    settings.selectionActive > 0.5
  );
  let sourceSelection = select(
    1.0,
    textureSample(selectionTexture, sourceSampler, safeSourceUv).r,
    settings.selectionActive > 0.5
  );
  let moved = textureSample(sourceTexture, sourceSampler, safeSourceUv)
    * sourceSelection
    * sourceInside;

  return moved + base * (1.0 - moved.a);
}
`;

export const SELECTION_TRANSFORM_WGSL = /* wgsl */ `
struct TransformSettings {
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  inverseRow2: vec4f,
  canvasSize: vec2f,
  selectionActive: f32,
  padding: f32,
}

@group(0) @binding(0) var selectionTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: TransformSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let destinationPixel = input.uv * settings.canvasSize;
  let homogeneous = vec3f(
    dot(settings.inverseRow0.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(destinationPixel, 1.0)),
    dot(settings.inverseRow2.xyz, vec3f(destinationPixel, 1.0))
  );
  let safeW = select(homogeneous.z, select(-1e-6, 1e-6, homogeneous.z >= 0.0), abs(homogeneous.z) < 1e-6);
  let sourcePixel = homogeneous.xy / safeW;
  let sourceInside = select(
    0.0,
    1.0,
    all(sourcePixel >= vec2f(0.0)) && all(sourcePixel < settings.canvasSize)
  );
  let safeSourceUv = clamp(sourcePixel / settings.canvasSize, vec2f(0.0), vec2f(1.0));
  return textureSample(selectionTexture, sourceSampler, safeSourceUv).r * sourceInside;
}
`;
