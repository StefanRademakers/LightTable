export const ALIGNMENT_REPROJECT_WGSL = /* wgsl */ `
struct ReprojectSettings {
  inverseRow0: vec4f,
  inverseRow1: vec4f,
  sourceSize: vec2f,
  canvasSize: vec2f,
  analysisOrigin: vec2f,
  analysisExtent: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: ReprojectSettings;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let documentPixel = settings.analysisOrigin + input.uv * settings.analysisExtent;
  let sourcePixel = vec2f(
    dot(settings.inverseRow0.xyz, vec3f(documentPixel, 1.0)),
    dot(settings.inverseRow1.xyz, vec3f(documentPixel, 1.0))
  );
  let inside = select(
    0.0,
    1.0,
    all(sourcePixel >= vec2f(0.0)) && all(sourcePixel < settings.sourceSize)
  );
  let sourceUv = clamp(sourcePixel / settings.sourceSize, vec2f(0.0), vec2f(1.0));
  let premultiplied = textureSample(sourceTexture, sourceSampler, sourceUv);
  let valid = inside * select(0.0, 1.0, premultiplied.a > 0.001);
  let straight = premultiplied.rgb / max(premultiplied.a, 0.000001);
  let luminance = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  return vec4f(luminance, 0.0, 0.0, valid);
}
`;

export const ALIGNMENT_GRADIENT_WGSL = /* wgsl */ `
@group(0) @binding(0) var luminanceTexture: texture_2d<f32>;

fn sampleAt(pixel: vec2i, dimensions: vec2i) -> vec4f {
  return textureLoad(luminanceTexture, clamp(pixel, vec2i(0), dimensions - vec2i(1)), 0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(luminanceTexture));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let center = sampleAt(pixel, dimensions);
  let left = sampleAt(pixel + vec2i(-1, 0), dimensions);
  let right = sampleAt(pixel + vec2i(1, 0), dimensions);
  let top = sampleAt(pixel + vec2i(0, -1), dimensions);
  let bottom = sampleAt(pixel + vec2i(0, 1), dimensions);
  let gradient = vec2f(right.r - left.r, bottom.r - top.r);
  let magnitude = length(gradient);
  let direction = gradient / max(magnitude, 0.00001);
  let valid = min(center.a, min(min(left.a, right.a), min(top.a, bottom.a)))
    * smoothstep(0.002, 0.02, magnitude);
  return vec4f(direction, min(1.0, magnitude * 8.0), valid);
}
`;

export const ALIGNMENT_SCORE_TRANSLATION_WGSL = /* wgsl */ `
struct ScoreSettings {
  analysisSize: vec2u,
  candidateCount: u32,
  padding: u32,
}

struct CandidateTransform {
  row0: vec4f,
  row1: vec4f,
}

struct CandidateScore {
  errorSum: f32,
  weightSum: f32,
  validCount: u32,
  referenceCount: u32,
}

@group(0) @binding(0) var referenceTexture: texture_2d<f32>;
@group(0) @binding(1) var targetTexture: texture_2d<f32>;
@group(0) @binding(2) var targetSampler: sampler;
@group(0) @binding(3) var<uniform> settings: ScoreSettings;
@group(0) @binding(4) var<storage, read> candidates: array<CandidateTransform>;
@group(0) @binding(5) var<storage, read_write> scores: array<CandidateScore>;

var<workgroup> localError: array<f32, 64>;
var<workgroup> localWeight: array<f32, 64>;
var<workgroup> localValid: array<u32, 64>;
var<workgroup> localReference: array<u32, 64>;

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3u,
  @builtin(local_invocation_id) localId: vec3u
) {
  let candidateIndex = workgroupId.x;
  if (candidateIndex >= settings.candidateCount) { return; }
  let candidate = candidates[candidateIndex];
  let pixelCount = settings.analysisSize.x * settings.analysisSize.y;
  var errorSum = 0.0;
  var weightSum = 0.0;
  var validCount = 0u;
  var referenceCount = 0u;
  var linearIndex = localId.x;
  while (linearIndex < pixelCount) {
    let referencePixel = vec2i(
      i32(linearIndex % settings.analysisSize.x),
      i32(linearIndex / settings.analysisSize.x)
    );
    let reference = textureLoad(referenceTexture, referencePixel, 0);
    if (reference.a > 0.0) {
      referenceCount += 1u;
      let referencePoint = vec2f(referencePixel) + vec2f(0.5);
      let targetPoint = vec2f(
        dot(candidate.row0.xyz, vec3f(referencePoint, 1.0)),
        dot(candidate.row1.xyz, vec3f(referencePoint, 1.0))
      );
      if (
        all(targetPoint >= vec2f(0.0))
        && all(targetPoint < vec2f(settings.analysisSize))
      ) {
        // target is a reserved WGSL keyword; keep the sample name explicit.
        let targetSample = textureSampleLevel(
          targetTexture,
          targetSampler,
          targetPoint / vec2f(settings.analysisSize),
          0.0
        );
        if (targetSample.a > 0.0) {
          // B stores the Y component of the unit gradient; it may be negative.
          // Z stores the non-negative gradient magnitude used as match weight.
          let weight = min(reference.z, targetSample.z);
          let candidateScale = max(0.00001, length(candidate.row0.xy));
          // Bring the sampled target gradient direction back into reference
          // orientation before comparing it.
          let rotatedTargetDirection = vec2f(
            candidate.row0.x * targetSample.r + candidate.row1.x * targetSample.g,
            candidate.row0.y * targetSample.r + candidate.row1.y * targetSample.g
          ) / candidateScale;
          let alignedTargetDirection = rotatedTargetDirection
            / max(0.00001, length(rotatedTargetDirection));
          // Compare orientation through a cosine cost. Euclidean direction
          // distance grows almost linearly for small angle differences and
          // punished normal resampling noise far too aggressively. The
          // cosine cost is quadratic near a correct match while unrelated
          // edge directions still converge toward an error of 0.5.
          let directionAgreement = clamp(dot(reference.rg, alignedTargetDirection), -1.0, 1.0);
          let angularError = 0.5 * (1.0 - directionAgreement);
          errorSum += min(angularError, 0.75) * weight;
          weightSum += weight;
          validCount += 1u;
        }
      }
    }
    linearIndex += 64u;
  }
  localError[localId.x] = errorSum;
  localWeight[localId.x] = weightSum;
  localValid[localId.x] = validCount;
  localReference[localId.x] = referenceCount;
  workgroupBarrier();
  var stride = 32u;
  while (stride > 0u) {
    if (localId.x < stride) {
      localError[localId.x] += localError[localId.x + stride];
      localWeight[localId.x] += localWeight[localId.x + stride];
      localValid[localId.x] += localValid[localId.x + stride];
      localReference[localId.x] += localReference[localId.x + stride];
    }
    workgroupBarrier();
    stride /= 2u;
  }
  if (localId.x == 0u) {
    scores[candidateIndex].errorSum = localError[0];
    scores[candidateIndex].weightSum = localWeight[0];
    scores[candidateIndex].validCount = localValid[0];
    scores[candidateIndex].referenceCount = localReference[0];
  }
}
`;
