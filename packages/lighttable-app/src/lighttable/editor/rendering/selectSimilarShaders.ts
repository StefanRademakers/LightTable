const SETTINGS_WGSL = /* wgsl */ `
struct SelectSimilarSettings {
  width: u32,
  height: u32,
  gridSize: u32,
  axis: u32,
  radius: u32,
  alphaRadius: u32,
  antiAlias: u32,
  padding0: u32,
  tolerance: f32,
  padding1: f32,
  padding2: f32,
  padding3: f32,
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

fn alphaBin(value: f32, gridSize: u32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * f32(gridSize - 1u)));
}
`;

export const SELECT_SIMILAR_CLEAR_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(1) var<storage, read_write> colors: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> alpha: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let cellCount = settings.gridSize * settings.gridSize * settings.gridSize;
  if (id.x < cellCount) { atomicStore(&colors[id.x], 0u); }
  if (id.x < settings.gridSize) { atomicStore(&alpha[id.x], 0u); }
}
`;

export const SELECT_SIMILAR_MARK_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
${COLOR_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionMask: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(3) var<storage, read_write> colors: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> alpha: array<atomic<u32>>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.width || id.y >= settings.height) { return; }
  if (textureLoad(selectionMask, vec2i(id.xy), 0).r < 0.5) { return; }
  let sampled = straightColor(textureLoad(sourceTexture, vec2i(id.xy), 0));
  atomicStore(&colors[colorIndex(colorBin(sampled.rgb, settings.gridSize), settings.gridSize)], 1u);
  atomicStore(&alpha[alphaBin(sampled.a, settings.gridSize)], 1u);
}
`;

export const SELECT_SIMILAR_DILATE_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(1) var<storage, read> inputColors: array<u32>;
@group(0) @binding(2) var<storage, read> inputAlpha: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputColors: array<u32>;
@group(0) @binding(4) var<storage, read_write> outputAlpha: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let grid = settings.gridSize;
  let cellCount = grid * grid * grid;
  if (id.x < cellCount) {
    let x = id.x % grid;
    let y = (id.x / grid) % grid;
    let z = id.x / (grid * grid);
    var accepted = false;
    let radius = i32(settings.radius);
    for (var offset = -radius; offset <= radius; offset += 1) {
      var sample = vec3i(i32(x), i32(y), i32(z));
      if (settings.axis == 0u) { sample.x += offset; }
      else if (settings.axis == 1u) { sample.y += offset; }
      else { sample.z += offset; }
      if (all(sample >= vec3i(0)) && all(sample < vec3i(i32(grid)))) {
        let index = u32(sample.x) + grid * (u32(sample.y) + grid * u32(sample.z));
        accepted = accepted || inputColors[index] != 0u;
      }
    }
    outputColors[id.x] = select(0u, 1u, accepted);
  }
  if (id.x < grid) {
    if (settings.axis != 0u) {
      outputAlpha[id.x] = inputAlpha[id.x];
      return;
    }
    var accepted = false;
    let radius = i32(settings.alphaRadius);
    for (var offset = -radius; offset <= radius; offset += 1) {
      let sample = i32(id.x) + offset;
      if (sample >= 0 && sample < i32(grid)) {
        accepted = accepted || inputAlpha[u32(sample)] != 0u;
      }
    }
    outputAlpha[id.x] = select(0u, 1u, accepted);
  }
}
`;

export const SELECT_SIMILAR_FINAL_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
${COLOR_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: SelectSimilarSettings;
@group(0) @binding(2) var<storage, read> colors: array<u32>;
@group(0) @binding(3) var<storage, read> alpha: array<u32>;

fn accepted(pixel: vec2u) -> bool {
  let sampled = straightColor(textureLoad(sourceTexture, vec2i(pixel), 0));
  return colors[colorIndex(colorBin(sampled.rgb, settings.gridSize), settings.gridSize)] != 0u
    && alpha[alphaBin(sampled.a, settings.gridSize)] != 0u;
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let pixel = clamp(vec2u(input.position.xy), vec2u(0), vec2u(settings.width - 1u, settings.height - 1u));
  if (accepted(pixel)) { return 1.0; }
  if (settings.antiAlias == 0u) { return 0.0; }
  if (pixel.x > 0u && accepted(vec2u(pixel.x - 1u, pixel.y))) { return 0.5; }
  if (pixel.x + 1u < settings.width && accepted(vec2u(pixel.x + 1u, pixel.y))) { return 0.5; }
  if (pixel.y > 0u && accepted(vec2u(pixel.x, pixel.y - 1u))) { return 0.5; }
  if (pixel.y + 1u < settings.height && accepted(vec2u(pixel.x, pixel.y + 1u))) { return 0.5; }
  return 0.0;
}
`;
