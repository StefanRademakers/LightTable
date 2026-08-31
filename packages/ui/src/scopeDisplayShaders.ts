// Presentation only: consumes the editor's existing 256-bin/256-square analysis buffers.
export const HUE_DISTRIBUTION_DISPLAY_WGSL = /* wgsl */ `
struct HueBins {
  values: array<u32, 256>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
  background: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: HueBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(index: i32) -> f32 {
  let wrapped = (index % 256 + 256) % 256;
  return f32(bins.values[u32(wrapped)]);
}

fn smoothedCount(index: i32) -> f32 {
  return (
    binCount(index - 4) * 0.028 +
    binCount(index - 3) * 0.066 +
    binCount(index - 2) * 0.124 +
    binCount(index - 1) * 0.180 +
    binCount(index)     * 0.204 +
    binCount(index + 1) * 0.180 +
    binCount(index + 2) * 0.124 +
    binCount(index + 3) * 0.066 +
    binCount(index + 4) * 0.028
  );
}

fn interpolatedCount(binPosition: f32) -> f32 {
  let lower = i32(floor(binPosition));
  let fraction = fract(binPosition);
  // Interpolate the already-filtered bins so a wide or Retina canvas does not
  // expose the 256 analysis buckets as a stair-stepped silhouette. The cubic
  // blend keeps the tangent calm at bin centres without another analysis pass.
  let blend = fraction * fraction * (3.0 - 2.0 * fraction);
  return mix(smoothedCount(lower), smoothedCount(lower + 1), blend);
}

fn hueToRgb(hue: f32) -> vec3f {
  let shifted = fract(hue + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(shifted * 6.0 - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let hue = clamp(input.uv.x, 0.0, 0.999999);
  let count = interpolatedCount(hue * 256.0);
  let peak = max(f32(maximum.value), 1.0);
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let normalized = clamp(count / peak, 0.0, 1.0);
  // A gentle root curve keeps less common colours legible without making
  // tiny chroma noise dominate the distribution.
  let height = pow(normalized, 0.58);
  let fromBottom = 1.0 - input.uv.y;
  let background = settings.background.rgb;
  let hueColor = mix(vec3f(0.42), hueToRgb(hue), 0.86);
  let edgeDistance = fromBottom - height;
  // Fragment derivatives express the edge footprint in physical render
  // pixels. This produces the same crisp hairline on 1x and Retina canvases,
  // rather than scaling a thick normalized-UV border with panel height.
  let edgePixel = max(fwidth(edgeDistance), 0.00001);
  let inside = 1.0 - smoothstep(-edgePixel, edgePixel, edgeDistance);
  let topLine = 1.0 - smoothstep(edgePixel * 0.45, edgePixel * 1.35, abs(edgeDistance));
  let verticalFade = mix(0.42, 1.0, clamp(fromBottom / max(height, 0.0001), 0.0, 1.0));
  var trace = hueColor * inside * verticalFade * brightness;
  trace += mix(hueColor, vec3f(1.0), 0.18) * topLine * 0.72;
  // Preserve the thin full-spectrum hue band at the baseline.
  let baselinePixel = max(fwidth(fromBottom), 0.00001);
  let baseline = (1.0 - smoothstep(baselinePixel * 0.35, baselinePixel * 1.65, fromBottom)) * 0.28;
  if (settings.values.z > 0.5) {
    let coverage = clamp(inside * verticalFade * brightness * 0.5 + topLine * 0.8 + baseline, 0.0, 1.0);
    return vec4f(mix(background, hueColor * 0.8, coverage), 1.0);
  }
  return vec4f(background + trace + hueColor * baseline, 1.0);
}
`;

export const PARADE_SCOPE_DISPLAY_WGSL = /* wgsl */ `
struct ParadeBins {
  values: array<u32, 196608>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
  background: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: ParadeBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(channel: u32, x: i32, y: i32) -> f32 {
  let safeX = u32(clamp(x, 0, 255));
  let safeY = u32(clamp(y, 0, 255));
  return f32(bins.values[channel * 65536u + safeY * 256u + safeX]);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let section = min(u32(input.uv.x * 3.0), 2u);
  let localX = fract(input.uv.x * 3.0);
  let x = i32(localX * 255.0 + 0.5);
  let y = i32((1.0 - input.uv.y) * 255.0 + 0.5);
  var count = 0.0;
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let weight = select(0.42, 1.0, offsetX == 0 && offsetY == 0);
      count += binCount(section, x + offsetX, y + offsetY) * weight;
    }
  }
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let gain = 0.12 * exp2(brightness - 1.0);
  let peak = max(f32(maximum.value), 1.0);
  let normalized = log(1.0 + count * gain) / log(1.0 + peak * gain);
  let intensity = clamp(pow(max(normalized, 0.0), 0.58) * brightness, 0.0, 1.0);
  let colors = array<vec3f, 3>(
    vec3f(1.0, 0.12, 0.16),
    vec3f(0.16, 1.0, 0.34),
    vec3f(0.18, 0.46, 1.0)
  );
  let background = settings.background.rgb;
  if (settings.values.z > 0.5) {
    return vec4f(mix(background, colors[section] * 0.75, intensity), 1.0);
  }
  return vec4f(background + colors[section] * intensity, 1.0);
}
`;

export const VECTOR_SCOPE_DISPLAY_WGSL = /* wgsl */ `
struct VectorBins {
  values: array<u32, 65536>,
}

struct ScopeMaximum {
  value: u32,
}

struct DisplaySettings {
  values: vec4f,
  background: vec4f,
}

@group(0) @binding(0) var<storage, read> bins: VectorBins;
@group(0) @binding(1) var<storage, read> maximum: ScopeMaximum;
@group(0) @binding(2) var<uniform> settings: DisplaySettings;

fn binCount(x: i32, y: i32) -> f32 {
  let safeX = u32(clamp(x, 0, 255));
  let safeY = u32(clamp(y, 0, 255));
  return f32(bins.values[safeY * 256u + safeX]);
}

fn traceColorForPosition(screenUv: vec2f) -> vec3f {
  // Reconstruct the chroma direction represented by this Cb/Cr bin. Luma is
  // intentionally omitted: the scope position carries hue/chroma while the
  // measured density carries intensity. Shift and normalize the inverse-709
  // chroma vector to obtain a vivid display hue without changing the bins.
  let cb = screenUv.x - 0.5;
  let cr = 0.5 - screenUv.y;
  let chromaRgb = vec3f(
    1.5748 * cr,
    -0.187324 * cb - 0.468124 * cr,
    1.8556 * cb
  );
  let minimum = min(chromaRgb.r, min(chromaRgb.g, chromaRgb.b));
  let shifted = chromaRgb - vec3f(minimum);
  let peak = max(shifted.r, max(shifted.g, shifted.b));
  let hueColor = select(vec3f(1.0), shifted / max(peak, 0.000001), peak > 0.000001);
  // Neutrals stay white; chroma smoothly reveals the corresponding target
  // colour as the trace moves away from the centre.
  let chromaAmount = smoothstep(0.015, 0.34, length(vec2f(cb, cr)));
  return mix(vec3f(0.92), hueColor, chromaAmount);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let zoom = select(1.0, 2.0, settings.values.y > 1.5);
  let sampleUv = vec2f(0.5) + (input.uv - vec2f(0.5)) / zoom;
  let x = i32(clamp(sampleUv.x, 0.0, 1.0) * 255.0 + 0.5);
  let y = i32((1.0 - clamp(sampleUv.y, 0.0, 1.0)) * 255.0 + 0.5);
  var count = 0.0;
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let weight = select(0.38, 1.0, offsetX == 0 && offsetY == 0);
      count += binCount(x + offsetX, y + offsetY) * weight;
    }
  }
  let brightness = clamp(settings.values.x, 0.1, 4.0);
  let gain = 0.1 * exp2(brightness - 1.0);
  let peak = max(f32(maximum.value), 1.0);
  let normalized = log(1.0 + count * gain) / log(1.0 + peak * gain);
  let intensity = clamp(pow(max(normalized, 0.0), 0.48) * brightness, 0.0, 1.0);
  let background = settings.background.rgb;
  let chromaTrace = traceColorForPosition(sampleUv);
  // Resolve-like traces become white-hot where many samples occupy the same
  // bin, while sparse outer detail retains its diagnostic hue.
  let whiteHeat = smoothstep(0.58, 1.0, intensity);
  let trace = mix(chromaTrace, vec3f(1.0), whiteHeat);
  if (settings.values.z > 0.5) {
    // Dense/neutral samples become dark ink on light surfaces, never white-on-white.
    let chromaAmount = smoothstep(0.015, 0.34, length(sampleUv - vec2f(0.5)));
    let ink = mix(vec3f(0.16), chromaTrace * 0.72, chromaAmount);
    return vec4f(mix(background, mix(ink, vec3f(0.12), whiteHeat), intensity), 1.0);
  }
  return vec4f(background + trace * intensity, 1.0);
}
`;
