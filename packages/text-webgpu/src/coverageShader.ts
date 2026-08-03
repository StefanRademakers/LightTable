export const COVERAGE_ATLAS_WGSL = /* wgsl */ `
struct CoverageSettings {
  viewportAtlas: vec4f,
};

struct CoverageInstance {
  rect: vec4f,
  basis: vec4f,
  uvRect: vec4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> settings: CoverageSettings;
@group(0) @binding(1) var coverageAtlas: texture_2d<f32>;
@group(0) @binding(2) var coverageSampler: sampler;
@group(0) @binding(3) var<storage, read> instances: array<CoverageInstance>;

struct CoverageVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
};

@vertex fn coverageVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> CoverageVertexOutput {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let corner = corners[vertexIndex];
  let instance = instances[instanceIndex];
  let pixel = instance.rect.xy
    + instance.basis.xy * (corner.x * instance.rect.z)
    + instance.basis.zw * (corner.y * instance.rect.w);
  let clip = vec2f(pixel.x / settings.viewportAtlas.x * 2.0 - 1.0, 1.0 - pixel.y / settings.viewportAtlas.y * 2.0);
  var output: CoverageVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.uv = (instance.uvRect.xy + corner * instance.uvRect.zw) / settings.viewportAtlas.zw;
  output.color = instance.color;
  return output;
}

@fragment fn coverageFragment(input: CoverageVertexOutput) -> @location(0) vec4f {
  let coverage = textureSample(coverageAtlas, coverageSampler, input.uv).r;
  return input.color * coverage;
}
`;
