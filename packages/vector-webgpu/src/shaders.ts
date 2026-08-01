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

