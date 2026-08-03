export const TEXT_EDITING_OVERLAY_QUAD_WGSL = /* wgsl */`
struct Settings {
  matrix: vec4<f32>,
  viewport: vec4<f32>,
};
struct Quad {
  p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>,
  color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read> quads: array<Quad>;
struct Output { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
fn project(point: vec2<f32>) -> vec4<f32> {
  let pixel = vec2<f32>(
    settings.matrix.x * point.x + settings.matrix.z * point.y + settings.viewport.x,
    settings.matrix.y * point.x + settings.matrix.w * point.y + settings.viewport.y
  );
  return vec4<f32>(pixel.x / settings.viewport.z * 2.0 - 1.0,
    1.0 - pixel.y / settings.viewport.w * 2.0, 0.0, 1.0);
}
@vertex fn quadVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Output {
  let quad = quads[instance];
  var point = quad.p0;
  switch vertex { case 1u: { point = quad.p1; } case 2u, 3u: { point = quad.p2; }
    case 4u: { point = quad.p3; } case 5u: { point = quad.p0; } default: {} }
  var output: Output; output.position = project(point); output.color = quad.color; return output;
}
@fragment fn overlayFragment(input: Output) -> @location(0) vec4<f32> { return input.color; }
`;

export const TEXT_EDITING_OVERLAY_LINE_WGSL = /* wgsl */`
struct Settings {
  matrix: vec4<f32>,
  viewport: vec4<f32>,
};
struct Line { geometry: vec4<f32>, style: vec4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read> lines: array<Line>;
struct Output { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
fn pixel(point: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    settings.matrix.x * point.x + settings.matrix.z * point.y + settings.viewport.x,
    settings.matrix.y * point.x + settings.matrix.w * point.y + settings.viewport.y
  );
}
fn clip(point: vec2<f32>) -> vec4<f32> {
  return vec4<f32>(point.x / settings.viewport.z * 2.0 - 1.0,
    1.0 - point.y / settings.viewport.w * 2.0, 0.0, 1.0);
}
@vertex fn lineVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Output {
  let line = lines[instance];
  let start = pixel(line.geometry.xy); let end = pixel(line.geometry.zw);
  let delta = end - start; let length = max(length(delta), 0.0001);
  let normal = vec2<f32>(-delta.y, delta.x) / length * line.style.x * 0.5;
  var point = start - normal;
  switch vertex { case 1u: { point = end - normal; } case 2u, 3u: { point = end + normal; }
    case 4u: { point = start + normal; } case 5u: { point = start - normal; } default: {} }
  var output: Output; output.position = clip(point); output.color = line.color; return output;
}
@fragment fn overlayFragment(input: Output) -> @location(0) vec4<f32> { return input.color; }
`;

export const TEXT_EDITING_OVERLAY_MARKER_WGSL = /* wgsl */`
struct Settings {
  matrix: vec4<f32>,
  viewport: vec4<f32>,
};
struct Marker { point: vec2<f32>, sizePx: f32, kind: f32 };
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read> markers: array<Marker>;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) kind: f32,
};
fn pixel(point: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    settings.matrix.x * point.x + settings.matrix.z * point.y + settings.viewport.x,
    settings.matrix.y * point.x + settings.matrix.w * point.y + settings.viewport.y
  );
}
@vertex fn markerVertex(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32
) -> Output {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let marker = markers[instance];
  let local = corners[vertex];
  let overflowOffset = select(vec2<f32>(0.0), vec2<f32>(7.0), marker.kind > 0.5);
  let point = pixel(marker.point) + overflowOffset + local * marker.sizePx * 0.5;
  var output: Output;
  output.position = vec4<f32>(
    point.x / settings.viewport.z * 2.0 - 1.0,
    1.0 - point.y / settings.viewport.w * 2.0,
    0.0,
    1.0
  );
  output.local = local;
  output.kind = marker.kind;
  return output;
}
@fragment fn markerFragment(input: Output) -> @location(0) vec4<f32> {
  let border = max(abs(input.local.x), abs(input.local.y)) >= 0.64;
  let plus = input.kind > 0.5
    && (abs(input.local.x) <= 0.14 || abs(input.local.y) <= 0.14)
    && max(abs(input.local.x), abs(input.local.y)) <= 0.5;
  return select(
    vec4<f32>(0.08, 0.09, 0.11, 1.0),
    vec4<f32>(0.24, 0.66, 1.0, 1.0),
    border || plus
  );
}
`;
