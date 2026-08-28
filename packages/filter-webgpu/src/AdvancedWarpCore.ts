import type { P2FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";
export type AdvancedWarpMode =
  "path-blur" | "spin-blur" | "pinch" | "shear" | "glass";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct Params { a: vec4f, b: vec4f, mode: u32, option: u32, padding: vec2u }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7)) + params.b.w) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let cell = floor(p); let localPoint = fract(p);
  let blend = localPoint * localPoint * (3.0 - 2.0 * localPoint);
  return mix(mix(hash(cell), hash(cell + vec2f(1.0, 0.0)), blend.x),
    mix(hash(cell + vec2f(0.0, 1.0)), hash(cell + vec2f(1.0)), blend.x), blend.y);
}
@fragment fn advancedWarpMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture)); let mode = params.mode;
  let aspect = dimensions.x / dimensions.y;
  if (mode == 0u || mode == 1u) {
    let center = params.b.xy; let q = (input.uv - center) * vec2f(aspect, 1.0); var total = vec4f(0.0); var weight = 0.0;
    for (var i = -24; i <= 24; i += 1) { let t = f32(i) / 24.0; var uv = input.uv;
      if (mode == 0u) { let direction = vec2f(cos(params.a.y), sin(params.a.y)); let taper = 1.0 - params.a.z * abs(t); uv += direction * t * params.a.x / dimensions * taper; }
      else { let angle = t * params.a.x; let feather = smoothstep(0.0, max(params.a.y, 1e-3), 0.5 - length(q)); let value = angle * feather; let rotated = vec2f(cos(value) * q.x - sin(value) * q.y, sin(value) * q.x + cos(value) * q.y); uv = center + rotated / vec2f(aspect, 1.0); }
      total += textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0); weight += 1.0;
    } return total / weight;
  }
  var uv = input.uv;
  if (mode == 2u) { let center = params.b.xy; let p = (uv - center) * vec2f(aspect, 1.0); let radius = length(p) * 2.0;
    if (radius < 1.0) { let mapped = pow(max(radius, 1e-5), 1.0 + params.a.x); uv = center + p * mapped / max(radius, 1e-5) / vec2f(aspect, 1.0); }
  } else if (mode == 3u) { if (params.option == 0u) { uv.x += (uv.y - 0.5) * params.a.x; } else { uv.y += (uv.x - 0.5) * params.a.x; }
  } else { let scale = max(params.a.z, 0.01); let p = uv * dimensions / scale; let smoothness = max(params.a.y, 1.0);
    let nx = noise(p / smoothness); let ny = noise(p / smoothness + vec2f(19.0, 7.0));
    uv += (vec2f(nx, ny) - vec2f(0.5)) * params.a.x / dimensions;
  }
  return textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Advanced Warp shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Advanced Warp",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "advancedWarpMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
const index = (mode: AdvancedWarpMode) =>
  ["path-blur", "spin-blur", "pinch", "shear", "glass"].indexOf(mode);
export class AdvancedWarpCore {
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
  encode<K extends AdvancedWarpMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: {
      key: string;
      revision: number;
      mode: K;
      settings: P2FilterSettingsMap[K];
    },
  ) {
    if (!this.sampler) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Advanced Warp: ${request.key}`,
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(48);
      const f = new Float32Array(bytes);
      const u = new Uint32Array(bytes);
      u[8] = index(request.mode);
      f[4] = 0.5;
      f[5] = 0.5;
      if (request.mode === "path-blur") {
        const s = request.settings as P2FilterSettingsMap["path-blur"];
        f[0] = s.speed;
        f[1] = (s.angle * Math.PI) / 180;
        f[2] = s.taper / 100;
      }
      if (request.mode === "spin-blur") {
        const s = request.settings as P2FilterSettingsMap["spin-blur"];
        f[0] = (s.angle * Math.PI) / 180;
        f[1] = s.feather / 200;
        f[4] = s.center.x / 100;
        f[5] = s.center.y / 100;
      }
      if (request.mode === "pinch") {
        const s = request.settings as P2FilterSettingsMap["pinch"];
        f[0] = s.amount / 100;
        f[4] = s.center.x / 100;
        f[5] = s.center.y / 100;
      }
      if (request.mode === "shear") {
        const s = request.settings as P2FilterSettingsMap["shear"];
        f[0] = s.amount / 100;
        u[9] = s.axis === "vertical" ? 1 : 0;
      }
      if (request.mode === "glass") {
        const s = request.settings as P2FilterSettingsMap["glass"];
        f[0] = s.distortion;
        f[1] = s.smoothness;
        f[2] = s.scale / 100;
        f[7] = s.seed;
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
