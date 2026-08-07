const SETTINGS_WGSL = /* wgsl */ `
struct MagicWandSettings {
  width: u32,
  height: u32,
  seedX: u32,
  seedY: u32,
  sampleRadius: u32,
  contiguous: u32,
  antiAlias: u32,
  comparator: u32,
  tolerance: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}
`;

const COLOR_WGSL = /* wgsl */ `
fn straightColor(value: vec4f) -> vec4f {
  return vec4f(select(vec3f(0.0), value.rgb / value.a, value.a > 1e-6), value.a);
}

// Comparator 0 is the deliberately centralized parity baseline. Keeping the
// selector in the settings contract lets corpus work change the metric without
// changing sampling, connectivity or selection-combine code.
fn colorDistance(left: vec4f, right: vec4f, comparator: u32) -> f32 {
  let delta = abs(left - right);
  if (comparator == 1u) {
    return length(delta.rgb) / sqrt(3.0);
  }
  return max(max(delta.r, delta.g), max(delta.b, delta.a));
}
`;

export const MAGIC_WAND_SAMPLE_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: MagicWandSettings;
@group(0) @binding(2) var<storage, read_write> referenceColor: array<vec4f>;

${COLOR_WGSL}

@compute @workgroup_size(1)
fn main() {
  let radius = i32(settings.sampleRadius);
  var sum = vec4f(0.0);
  var count = 0.0;
  for (var y = -radius; y <= radius; y += 1) {
    for (var x = -radius; x <= radius; x += 1) {
      let point = clamp(
        vec2i(i32(settings.seedX) + x, i32(settings.seedY) + y),
        vec2i(0),
        vec2i(i32(settings.width) - 1, i32(settings.height) - 1)
      );
      sum += straightColor(textureLoad(sourceTexture, point, 0));
      count += 1.0;
    }
  }
  referenceColor[0] = sum / max(count, 1.0);
}
`;

export const MAGIC_WAND_INITIALIZE_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: MagicWandSettings;
@group(0) @binding(2) var<storage, read> referenceColor: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> labels: array<atomic<u32>>;

${COLOR_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.width || id.y >= settings.height) { return; }
  let index = id.y * settings.width + id.x;
  let pixel = straightColor(textureLoad(sourceTexture, vec2i(id.xy), 0));
  let candidate = colorDistance(pixel, referenceColor[0], settings.comparator)
    <= settings.tolerance / 255.0;
  atomicStore(&labels[index], select(0xffffffffu, index, candidate));
}
`;

export const MAGIC_WAND_RELAX_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: MagicWandSettings;
@group(0) @binding(1) var<storage, read_write> labels: array<atomic<u32>>;

fn neighborLabel(x: u32, y: u32) -> u32 {
  return atomicLoad(&labels[y * settings.width + x]);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.width || id.y >= settings.height) { return; }
  let index = id.y * settings.width + id.x;
  let current = atomicLoad(&labels[index]);
  if (current == 0xffffffffu) { return; }
  var minimum = current;
  if (id.x > 0u) { minimum = min(minimum, neighborLabel(id.x - 1u, id.y)); }
  if (id.x + 1u < settings.width) { minimum = min(minimum, neighborLabel(id.x + 1u, id.y)); }
  if (id.y > 0u) { minimum = min(minimum, neighborLabel(id.x, id.y - 1u)); }
  if (id.y + 1u < settings.height) { minimum = min(minimum, neighborLabel(id.x, id.y + 1u)); }
  atomicMin(&labels[index], minimum);
}
`;

export const MAGIC_WAND_COMPRESS_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var<uniform> settings: MagicWandSettings;
@group(0) @binding(1) var<storage, read_write> labels: array<atomic<u32>>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.width || id.y >= settings.height) { return; }
  let index = id.y * settings.width + id.x;
  let parent = atomicLoad(&labels[index]);
  if (parent == 0xffffffffu) { return; }
  let grandparent = atomicLoad(&labels[parent]);
  if (grandparent != 0xffffffffu) { atomicMin(&labels[index], grandparent); }
}
`;

export const MAGIC_WAND_FINAL_WGSL = /* wgsl */ `
${SETTINGS_WGSL}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: MagicWandSettings;
@group(0) @binding(2) var<storage, read> referenceColor: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> labels: array<atomic<u32>>;

${COLOR_WGSL}

fn rootLabel(start: u32) -> u32 {
  var current = start;
  for (var iteration = 0u; iteration < 64u; iteration += 1u) {
    if (current == 0xffffffffu) { return current; }
    let parent = atomicLoad(&labels[current]);
    if (parent == current) { return current; }
    current = parent;
  }
  return current;
}

fn belongsToSelection(index: u32, seedRoot: u32) -> bool {
  let label = atomicLoad(&labels[index]);
  if (label == 0xffffffffu) { return false; }
  return settings.contiguous == 0u || rootLabel(index) == seedRoot;
}

fn selectedNeighbor(pixel: vec2u, seedRoot: u32) -> bool {
  if (pixel.x > 0u && belongsToSelection(pixel.y * settings.width + pixel.x - 1u, seedRoot)) {
    return true;
  }
  if (pixel.x + 1u < settings.width
    && belongsToSelection(pixel.y * settings.width + pixel.x + 1u, seedRoot)) {
    return true;
  }
  if (pixel.y > 0u && belongsToSelection((pixel.y - 1u) * settings.width + pixel.x, seedRoot)) {
    return true;
  }
  return pixel.y + 1u < settings.height
    && belongsToSelection((pixel.y + 1u) * settings.width + pixel.x, seedRoot);
}

fn hasUnselectedNeighbor(pixel: vec2u, seedRoot: u32) -> bool {
  if (pixel.x > 0u && !belongsToSelection(pixel.y * settings.width + pixel.x - 1u, seedRoot)) {
    return true;
  }
  if (pixel.x + 1u < settings.width
    && !belongsToSelection(pixel.y * settings.width + pixel.x + 1u, seedRoot)) {
    return true;
  }
  if (pixel.y > 0u && !belongsToSelection((pixel.y - 1u) * settings.width + pixel.x, seedRoot)) {
    return true;
  }
  return pixel.y + 1u < settings.height
    && !belongsToSelection((pixel.y + 1u) * settings.width + pixel.x, seedRoot);
}

@fragment
fn main(input: VertexOutput) -> @location(0) f32 {
  let pixel = clamp(vec2u(input.position.xy), vec2u(0), vec2u(settings.width - 1u, settings.height - 1u));
  let index = pixel.y * settings.width + pixel.x;
  let seed = settings.seedY * settings.width + settings.seedX;
  let seedRoot = rootLabel(seed);
  let selected = belongsToSelection(index, seedRoot);
  if (settings.antiAlias == 0u) { return select(0.0, 1.0, selected); }
  let sampled = straightColor(textureLoad(sourceTexture, vec2i(pixel), 0));
  let distance = colorDistance(sampled, referenceColor[0], settings.comparator);
  let tolerance = settings.tolerance / 255.0;
  let edge = 1.5 / 255.0;
  let coverage = clamp((tolerance + edge - distance) / (2.0 * edge), 0.0, 1.0);
  if (selected) {
    return select(1.0, max(coverage, 0.5), hasUnselectedNeighbor(pixel, seedRoot));
  }
  // Only the one-pixel neighborhood of the accepted component may receive
  // fractional coverage. This avoids turning every near-tolerance pixel in
  // the image into a soft, disconnected selection.
  return select(0.0, coverage, coverage > 0.0 && selectedNeighbor(pixel, seedRoot));
}
`;
