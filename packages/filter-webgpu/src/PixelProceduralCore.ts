import type { P1FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";

export type PixelProceduralMode =
  "mosaic" | "color-halftone" | "clouds" | "lens-flare";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct PixelParams { a: vec4f, b: vec4f, c: vec4f, mode: u32, option: u32, padding: vec2u }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: PixelParams;
fn hash(point: vec2f) -> f32 { return fract(sin(dot(point, vec2f(127.1, 311.7)) + params.a.w) * 43758.5453123); }
fn noise(point: vec2f) -> f32 {
  let cell = floor(point); let local = fract(point); let smooth = local * local * (3.0 - 2.0 * local);
  return mix(mix(hash(cell), hash(cell + vec2f(1.0, 0.0)), smooth.x),
    mix(hash(cell + vec2f(0.0, 1.0)), hash(cell + vec2f(1.0)), smooth.x), smooth.y);
}
fn dotMask(pixel: vec2f, angle: f32, radius: f32, coverage: f32) -> f32 {
  let rotated = vec2f(cos(angle) * pixel.x - sin(angle) * pixel.y, sin(angle) * pixel.x + cos(angle) * pixel.y);
  let local = fract(rotated / max(radius * 2.0, 2.0)) - vec2f(0.5);
  let threshold = sqrt(clamp(coverage, 0.0, 1.0)) * 0.5;
  return 1.0 - smoothstep(threshold - 0.04, threshold + 0.04, length(local));
}
@fragment fn pixelMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  if (params.mode == 0u) {
    let cell = max(params.a.x, 2.0); let p = (floor(input.uv * dimensions / cell) + vec2f(0.5)) * cell;
    return textureSampleLevel(sourceTexture, sourceSampler, clamp(p / dimensions, vec2f(0.0), vec2f(1.0)), 0.0);
  }
  if (params.mode == 1u) {
    let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
    let rgb = select(vec3f(0.0), source.rgb / source.a, source.a > 1e-6); let ink = vec3f(1.0) - clamp(rgb, vec3f(0.0), vec3f(1.0));
    let k = min(ink.r, min(ink.g, ink.b)); let chroma = clamp(ink - vec3f(k), vec3f(0.0), vec3f(1.0));
    let pixel = input.uv * dimensions; let radius = params.a.x;
    let c = dotMask(pixel, params.a.y, radius, chroma.r); let m = dotMask(pixel, params.a.z, radius, chroma.g);
    let y = dotMask(pixel, params.a.w, radius, chroma.b); let black = dotMask(pixel, params.b.x, radius, k);
    let output = vec3f(1.0 - clamp(c + black, 0.0, 1.0), 1.0 - clamp(m + black, 0.0, 1.0), 1.0 - clamp(y + black, 0.0, 1.0));
    return vec4f(output * source.a, source.a);
  }
  if (params.mode == 2u) {
    var point = input.uv * dimensions / max(params.a.x, 2.0); var amplitude = 0.5; var total = 0.0; var norm = 0.0;
    for (var octave = 0; octave < 8; octave += 1) { if (octave >= i32(params.a.y)) { break; }
      total += noise(point) * amplitude; norm += amplitude; point = point * 2.03 + vec2f(17.1, 9.2); amplitude *= 0.5;
    }
    let value = total / max(norm, 1e-6); return vec4f(vec3f(value), 1.0);
  }
  let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let center = params.a.xy; let q = input.uv - center; let distance = length(q); let brightness = params.a.z;
  let core = exp(-distance * distance * 1800.0); let halo = exp(-abs(distance - 0.12) * 90.0);
  let axis = center - vec2f(0.5); let ghost1 = exp(-dot(input.uv - (vec2f(0.5) - axis * 0.55), input.uv - (vec2f(0.5) - axis * 0.55)) * 500.0);
  let ghost2 = exp(-dot(input.uv - (vec2f(0.5) - axis * 1.2), input.uv - (vec2f(0.5) - axis * 1.2)) * 900.0);
  let streak = exp(-abs(q.y) * 250.0) * exp(-abs(q.x) * 5.0);
  let tint = select(vec3f(1.0, 0.65, 0.3), vec3f(0.55, 0.75, 1.0), params.option == 3u);
  let flare = (core * vec3f(1.0, 0.9, 0.7) + halo * tint * 0.18 + ghost1 * vec3f(0.2, 0.5, 1.0) * 0.22 + ghost2 * vec3f(1.0, 0.25, 0.1) * 0.15 + streak * tint * 0.08) * brightness;
  return vec4f(source.rgb + flare * source.a, source.a);
}
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Pixel Procedural shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Pixel Procedural",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "pixelMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
const modeIndex = (mode: PixelProceduralMode) =>
  ["mosaic", "color-halftone", "clouds", "lens-flare"].indexOf(mode);
export class PixelProceduralCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;
  constructor(
    private readonly device: GPUDevice,
    pool?: FilterTargetPool,
  ) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = !pool;
  }
  configure(width: number, height: number, sampler: GPUSampler) {
    this.pool.configure(width, height);
    this.sampler = sampler;
  }
  encode<K extends PixelProceduralMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: {
      key: string;
      revision: number;
      mode: K;
      settings: P1FilterSettingsMap[K];
    },
  ): GPUTexture {
    if (!this.sampler) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Pixel uniforms: ${request.key}`,
          size: 64,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(64);
      const f = new Float32Array(bytes);
      const u = new Uint32Array(bytes);
      u[12] = modeIndex(request.mode);
      if (request.mode === "mosaic")
        f[0] = (request.settings as P1FilterSettingsMap["mosaic"]).cellSize;
      if (request.mode === "color-halftone") {
        const s = request.settings as P1FilterSettingsMap["color-halftone"];
        f[0] = s.radius;
        f[1] = (s.angle1 * Math.PI) / 180;
        f[2] = (s.angle2 * Math.PI) / 180;
        f[3] = (s.angle3 * Math.PI) / 180;
        f[4] = (s.angle4 * Math.PI) / 180;
      }
      if (request.mode === "clouds") {
        const s = request.settings as P1FilterSettingsMap["clouds"];
        f[0] = s.scale;
        f[1] = s.detail;
        f[3] = s.seed;
      }
      if (request.mode === "lens-flare") {
        const s = request.settings as P1FilterSettingsMap["lens-flare"];
        f[0] = s.center.x / 100;
        f[1] = s.center.y / 100;
        f[2] = s.brightness / 100;
        u[13] = ["50-300mm", "35mm", "105mm", "movie-prime"].indexOf(
          s.lensType,
        );
      }
      this.device.queue.writeBuffer(runtime.uniforms, 0, bytes);
      runtime.revision = request.revision;
    }
    const target = this.pool.acquire([source]);
    const pipeline = pipelineFor(this.device);
    const group = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: runtime.uniforms } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: `LightTable ${request.mode}`,
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    return target;
  }
  releaseInactive(keys: ReadonlySet<string>) {
    releaseInactiveFilterRuntimes(this.runtimes, keys, (r) =>
      r.uniforms.destroy(),
    );
  }
  estimatedTextureBytes() {
    return this.ownsPool ? this.pool.estimatedTextureBytes() : 0;
  }
  destroy() {
    if (this.ownsPool) this.pool.destroy();
    for (const r of this.runtimes.values()) r.uniforms.destroy();
    this.runtimes.clear();
    this.sampler = null;
  }
}
