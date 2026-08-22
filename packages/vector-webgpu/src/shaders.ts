export const VECTOR_STENCIL_VERTEX_WGSL = /* wgsl */ `
struct VectorSettings {
  tile: vec4f,
  transform: vec4f,
  translation: vec4f,
  color: vec4f,
  gradientRow0: vec4f,
  gradientRow1: vec4f,
  gradientOptions: vec4f,
};

@group(0) @binding(0) var<uniform> settings: VectorSettings;

struct VertexInput {
  @location(0) localPosition: vec2f,
};

@vertex
fn stencilVertex(input: VertexInput) -> @builtin(position) vec4f {
  let documentPosition = vec2f(
    settings.transform.x * input.localPosition.x + settings.transform.z * input.localPosition.y + settings.translation.x,
    settings.transform.y * input.localPosition.x + settings.transform.w * input.localPosition.y + settings.translation.y
  );
  let relative = (documentPosition - settings.tile.xy) / settings.tile.zw;
  return vec4f(relative.x * 2.0 - 1.0, 1.0 - relative.y * 2.0, 0.0, 1.0);
}

// The stencil and cover draws intentionally share one render pass. WebGPU
// therefore requires both pipelines to declare the same color attachment
// layout, even though the stencil draw must not modify the color surface.
@fragment
fn stencilFragment() -> @location(0) vec4f {
  return vec4f(0.0);
}
`;

export const VECTOR_COVER_WGSL = /* wgsl */ `
struct VectorSettings {
  tile: vec4f,
  transform: vec4f,
  translation: vec4f,
  color: vec4f,
  gradientRow0: vec4f,
  gradientRow1: vec4f,
  gradientOptions: vec4f,
};

@group(0) @binding(0) var<uniform> settings: VectorSettings;
@group(0) @binding(1) var<storage, read> gradientLut: array<vec4f>;

struct CoverOutput {
  @builtin(position) position: vec4f,
  @location(0) documentPosition: vec2f,
};

@vertex
fn coverVertex(@builtin(vertex_index) index: u32) -> CoverOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let clip = positions[index];
  var output: CoverOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.documentPosition = settings.tile.xy + vec2f(
    (clip.x + 1.0) * 0.5 * settings.tile.z,
    (1.0 - clip.y) * 0.5 * settings.tile.w
  );
  return output;
}

@fragment
fn coverFragment(input: CoverOutput) -> @location(0) vec4f {
  if (settings.gradientOptions.x < 0.5) { return settings.color; }
  let point = vec2f(
    dot(settings.gradientRow0.xy, input.documentPosition) + settings.gradientRow0.z,
    dot(settings.gradientRow1.xy, input.documentPosition) + settings.gradientRow1.z
  );
  let shape = u32(settings.gradientRow1.w + 0.5);
  var position = point.x;
  if (shape == 1u) { position = length(point); }
  if (shape == 2u) { position = fract(atan2(point.y, point.x) / 6.28318530718 + 1.0); }
  if (shape == 3u) { position = abs(point.x); }
  if (shape == 4u) { position = abs(point.x) + abs(point.y); }
  let spread = u32(settings.gradientRow0.w + 0.5);
  if (spread == 0u) { position = clamp(position, 0.0, 1.0); }
  if (spread == 1u) { position = 1.0 - abs(fract(position * 0.5) * 2.0 - 1.0); }
  if (spread == 2u) { position = fract(position); }
  position = select(position, 1.0 - position, settings.gradientOptions.y > 0.5);
  let scaled = position * 255.0;
  let lower = u32(floor(scaled));
  let upper = min(255u, lower + 1u);
  var color = mix(gradientLut[lower], gradientLut[upper], fract(scaled));
  if (settings.gradientOptions.w > 0.5) {
    let noise = fract(sin(dot(input.documentPosition, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
    color = vec4f(
      clamp(color.rgb + vec3f(noise / 255.0), vec3f(0.0), vec3f(1.0)),
      color.a
    );
  }
  let alpha = color.a * settings.gradientOptions.z;
  return vec4f(color.rgb * alpha, alpha);
}
`;

export const VECTOR_EDITING_OVERLAY_LINE_WGSL = /* wgsl */ `
struct OverlaySettings {
  transform: vec4f,
  translationViewport: vec4f,
  style: vec4f,
  color: vec4f,
  dash: vec4f,
};

struct CubicData {
  p0: vec2f,
  p1: vec2f,
  p2: vec2f,
  p3: vec2f,
  lengthData: vec2f,
  padding: vec2f,
};

struct LineOutput {
  @builtin(position) position: vec4f,
  @location(0) distancePx: f32,
  @location(1) edgeDistancePx: f32,
};

@group(0) @binding(0) var<uniform> settings: OverlaySettings;
@group(0) @binding(1) var<storage, read> cubics: array<CubicData>;

fn cubicAt(curve: CubicData, t: f32) -> vec2f {
  let inverse = 1.0 - t;
  return inverse * inverse * inverse * curve.p0
    + 3.0 * inverse * inverse * t * curve.p1
    + 3.0 * inverse * t * t * curve.p2
    + t * t * t * curve.p3;
}

fn documentToPixel(point: vec2f) -> vec2f {
  return vec2f(
    settings.transform.x * point.x + settings.transform.z * point.y + settings.translationViewport.x,
    settings.transform.y * point.x + settings.transform.w * point.y + settings.translationViewport.y
  );
}

fn pixelToClip(point: vec2f) -> vec4f {
  let viewport = settings.translationViewport.zw;
  return vec4f(point.x / viewport.x * 2.0 - 1.0, 1.0 - point.y / viewport.y * 2.0, 0.0, 1.0);
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> LineOutput {
  let subdivisions = max(1u, u32(settings.style.y));
  let curveIndex = instanceIndex / subdivisions;
  let segmentIndex = instanceIndex % subdivisions;
  let curve = cubics[curveIndex];
  let t0 = f32(segmentIndex) / f32(subdivisions);
  let t1 = f32(segmentIndex + 1u) / f32(subdivisions);
  let start = documentToPixel(cubicAt(curve, t0));
  let end = documentToPixel(cubicAt(curve, t1));
  let delta = end - start;
  let segmentLength = max(length(delta), 0.0001);
  let normal = vec2f(-delta.y, delta.x) / segmentLength;
  var endpoints = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let halfWidth = settings.style.x * 0.5;
  let antialiasExtent = halfWidth + 1.0;
  let point = mix(start, end, endpoints[vertexIndex])
    + normal * sides[vertexIndex] * antialiasExtent;
  let viewportScale = length(vec2f(settings.transform.x, settings.transform.y));
  var output: LineOutput;
  output.position = pixelToClip(point);
  output.distancePx = (curve.lengthData.x
    + curve.lengthData.y * mix(t0, t1, endpoints[vertexIndex])) * viewportScale;
  output.edgeDistancePx = sides[vertexIndex] * antialiasExtent;
  return output;
}

@fragment
fn lineFragment(input: LineOutput) -> @location(0) vec4f {
  let dashLength = settings.style.z;
  let gapLength = settings.style.w;
  if (dashLength > 0.0 && gapLength > 0.0) {
    let period = dashLength + gapLength;
    if (fract((input.distancePx + settings.dash.x) / period) * period >= dashLength) {
      discard;
    }
  }
  let halfWidth = settings.style.x * 0.5;
  let coverage = 1.0 - smoothstep(halfWidth, halfWidth + 1.0, abs(input.edgeDistancePx));
  return vec4f(settings.color.rgb, settings.color.a * coverage);
}
`;

export const VECTOR_EDITING_OVERLAY_MARKER_WGSL = /* wgsl */ `
struct OverlaySettings {
  transform: vec4f,
  translationViewport: vec4f,
  style: vec4f,
  color: vec4f,
  dash: vec4f,
};

struct MarkerData {
  point: vec2f,
  sizeState: vec2f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> settings: OverlaySettings;
@group(0) @binding(1) var<storage, read> markers: array<MarkerData>;

struct MarkerOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) state: f32,
  @location(2) @interpolate(flat) color: vec4f,
};

fn documentToPixel(point: vec2f) -> vec2f {
  return vec2f(
    settings.transform.x * point.x + settings.transform.z * point.y + settings.translationViewport.x,
    settings.transform.y * point.x + settings.transform.w * point.y + settings.translationViewport.y
  );
}

@vertex
fn markerVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> MarkerOutput {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let marker = markers[instanceIndex];
  let local = corners[vertexIndex];
  let pixel = documentToPixel(marker.point) + local * marker.sizeState.x * 0.5;
  let viewport = settings.translationViewport.zw;
  var output: MarkerOutput;
  output.position = vec4f(pixel.x / viewport.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.y * 2.0, 0.0, 1.0);
  output.local = local;
  output.state = marker.sizeState.y;
  output.color = marker.color;
  return output;
}

@fragment
fn markerFragment(input: MarkerOutput) -> @location(0) vec4f {
  let shape = floor(input.state / 3.0);
  let visualState = input.state - shape * 3.0;
  var distance = max(abs(input.local.x), abs(input.local.y));
  if (shape == 1.0) { distance = length(input.local); }
  if (shape == 2.0) { distance = abs(input.local.x) + abs(input.local.y); }
  if (distance > 1.0) { discard; }
  let border = distance >= 0.64;
  let selected = visualState >= 1.0;
  let isActive = visualState >= 2.0;
  let swatch = select(vec4f(1.0, 1.0, 1.0, 1.0), input.color, input.color.a >= 0.0);
  let neutralBorder = vec4f(0.68, 0.71, 0.75, 1.0);
  let borderColor = select(neutralBorder, settings.color, selected || isActive);
  let interior = select(swatch, settings.color, selected);
  let activeInterior = select(interior, vec4f(1.0, 1.0, 1.0, 1.0), isActive);
  let color = select(activeInterior, borderColor, border);
  let edgeWidth = max(fwidth(distance), 0.001);
  let coverage = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, distance);
  return vec4f(color.rgb, color.a * coverage);
}
`;
