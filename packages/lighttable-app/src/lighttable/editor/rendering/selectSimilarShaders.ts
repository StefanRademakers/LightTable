const SETTINGS_WGSL = /* wgsl */ `
struct SelectSimilarSettings {
  width: u32,
  height: u32,
  gridSize: u32,
  axis: u32,
  radius: u32,
  antiAlias: u32,
  padding0: u32,
  padding1: u32,
  tolerance: f32,
  padding2: f32,
  padding3: f32,
  padding4: f32,
}
`;

const COLOR_WGSL = /* wgsl */ `
fn straightColor(value: vec4f) -> vec4f {
  return vec4f(select(vec3f(0.0), value.rgb / value.a, value.a > 1e-6), value.a);
}

fn colorBin(value: vec3f, gridSize: u32) -> vec3u {
  return vec3u(round(clamp(value, vec3f(0.0), vec3f(1.0)) * f32(gridSize - 1u)));
}

fn colorIndex(bin: vec3u, gridSize: u32) -> u32 {
  return bin.x + gridSize * (bin.y + gridSize * bin.z);
}

`;

export const SELECT_SIMILAR_CLEAR_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(1) var<storage, read_write> colors: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> selectedPixelCount: atomic<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let cellCount = settings.gridSize * settings.gridSize * settings.gridSize;
  if (id.x < cellCount) { atomicStore(&colors[id.x], 0u); }
  if (id.x == 0u) { atomicStore(&selectedPixelCount, 0u); }
}
`;

export const SELECT_SIMILAR_MARK_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
${COLOR_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionMask: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(3) var<storage, read_write> colors: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> selectedPixelCount: atomic<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.width || id.y >= settings.height) { return; }
  if (textureLoad(selectionMask, vec2i(id.xy), 0).r < 0.5) { return; }
  let sampled = straightColor(textureLoad(sourceTexture, vec2i(id.xy), 0));
  if (sampled.a <= 1e-6) { return; }
  atomicAdd(&colors[colorIndex(colorBin(sampled.rgb, settings.gridSize), settings.gridSize)], 1u);
  atomicAdd(&selectedPixelCount, 1u);
}
`;

export const SELECT_SIMILAR_DILATE_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(1) var<storage, read> inputColors: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputColors: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let grid = settings.gridSize;
  let cellCount = grid * grid * grid;
  if (id.x < cellCount) {
    let x = id.x % grid;
    let y = (id.x / grid) % grid;
    let z = id.x / (grid * grid);
    var support = 0u;
    let radius = i32(settings.radius);
    for (var offset = -radius; offset <= radius; offset += 1) {
      var sample = vec3i(i32(x), i32(y), i32(z));
      if (settings.axis == 0u) { sample.x += offset; }
      else if (settings.axis == 1u) { sample.y += offset; }
      else { sample.z += offset; }
      if (all(sample >= vec3i(0)) && all(sample < vec3i(i32(grid)))) {
        let index = u32(sample.x) + grid * (u32(sample.y) + grid * u32(sample.z));
        support += inputColors[index];
      }
    }
    outputColors[id.x] = support;
  }
}
`;

export const SELECT_SIMILAR_FINAL_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
${COLOR_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(2) var<storage, read> colors: array<u32>;
@group(0) @binding(3) var<storage, read> selectedPixelCount: u32;

fn minimumSupport() -> u32 {
  if (selectedPixelCount <= 8u) { return 1u; }
  return clamp((selectedPixelCount + 2047u) / 2048u, 2u, 64u);
}

fn confidence(pixel: vec2u) -> f32 {
  let sampled = straightColor(textureLoad(sourceTexture, vec2i(pixel), 0));
  if (sampled.a <= 1e-6 || selectedPixelCount == 0u) { return 0.0; }
  let support = colors[colorIndex(colorBin(sampled.rgb, settings.gridSize), settings.gridSize)];
  let floor = minimumSupport();
  if (support < floor) { return 0.0; }
  if (floor == 1u) { return 1.0; }
  return clamp(f32(support - floor + 1u) / f32(max(2u, floor * 2u)), 0.0, 1.0);
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let pixel = clamp(vec2u(input.position.xy), vec2u(0), vec2u(settings.width - 1u, settings.height - 1u));
  var coverage = confidence(pixel);
  if (settings.antiAlias == 0u || coverage >= 1.0) { return coverage; }
  if (pixel.x > 0u) { coverage = max(coverage, confidence(vec2u(pixel.x - 1u, pixel.y)) * 0.5); }
  if (pixel.x + 1u < settings.width) { coverage = max(coverage, confidence(vec2u(pixel.x + 1u, pixel.y)) * 0.5); }
  if (pixel.y > 0u) { coverage = max(coverage, confidence(vec2u(pixel.x, pixel.y - 1u)) * 0.5); }
  if (pixel.y + 1u < settings.height) { coverage = max(coverage, confidence(vec2u(pixel.x, pixel.y + 1u)) * 0.5); }
  return coverage;
}
`;
