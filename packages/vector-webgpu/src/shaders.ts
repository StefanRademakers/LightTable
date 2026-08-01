export const VECTOR_STENCIL_VERTEX_WGSL = /* wgsl */ `
struct VectorSettings {
  tile: vec4f,
  transform: vec4f,
  translation: vec4f,
  color: vec4f,
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
`;

export const VECTOR_COVER_WGSL = /* wgsl */ `
struct VectorSettings {
  tile: vec4f,
  transform: vec4f,
  translation: vec4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> settings: VectorSettings;

@vertex
fn coverVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment
fn coverFragment() -> @location(0) vec4f {
  return settings.color;
}
`;

export const VECTOR_EDITING_OVERLAY_LINE_WGSL = /* wgsl */ `
struct OverlaySettings {
  transform: vec4f,
  translationViewport: vec4f,
  style: vec4f,
  color: vec4f,
};

struct CubicData {
  p0: vec2f,
  p1: vec2f,
  p2: vec2f,
  p3: vec2f,
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
) -> @builtin(position) vec4f {
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
  let point = mix(start, end, endpoints[vertexIndex])
    + normal * sides[vertexIndex] * settings.style.x * 0.5;
  return pixelToClip(point);
}

@fragment
fn lineFragment() -> @location(0) vec4f {
  return settings.color;
}
`;

export const VECTOR_EDITING_OVERLAY_MARKER_WGSL = /* wgsl */ `
struct OverlaySettings {
  transform: vec4f,
  translationViewport: vec4f,
  style: vec4f,
  color: vec4f,
};

struct MarkerData {
  point: vec2f,
  sizeState: vec2f,
};

@group(0) @binding(0) var<uniform> settings: OverlaySettings;
@group(0) @binding(1) var<storage, read> markers: array<MarkerData>;

struct MarkerOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) state: f32,
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
  return output;
}

@fragment
fn markerFragment(input: MarkerOutput) -> @location(0) vec4f {
  let circular = input.state >= 3.0;
  let distance = select(max(abs(input.local.x), abs(input.local.y)), length(input.local), circular);
  if (distance > 1.0) { discard; }
  let border = distance >= 0.64;
  let selected = input.state >= 1.0 && input.state < 3.0;
  let active = input.state >= 2.0 && input.state < 3.0;
  let interior = select(vec4f(0.08, 0.09, 0.11, 1.0), settings.color, selected);
  let activeInterior = select(interior, vec4f(1.0, 1.0, 1.0, 1.0), active);
  return select(activeInterior, settings.color, border);
}
`;
