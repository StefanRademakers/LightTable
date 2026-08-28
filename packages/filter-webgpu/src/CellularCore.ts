import type { P2FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";
export type CellularMode = "crystallize" | "mezzotint" | "pointillize";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct Params { cellSize: f32, seed: f32, mode: u32, option: u32 }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>; @group(0) @binding(1) var sourceSampler: sampler; @group(0) @binding(2) var<uniform> params: Params;
fn hash2(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1,311.7)), dot(p, vec2f(269.5,183.3))) + params.seed) * 43758.5453); }
fn hash1(p: vec2f) -> f32 { return hash2(p).x; }
fn toDisplay(v: vec3f) -> vec3f { let c = clamp(v, vec3f(0.0), vec3f(1.0)); return select(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - .055, c > vec3f(.0031308)); }
@fragment fn cellularMain(input: VertexOutput) -> @location(0) vec4f { let dimensions = vec2f(textureDimensions(sourceTexture)); let pixel = input.uv * dimensions; let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  if (params.mode == 1u) { let grain = select(1.0, 2.0, params.option >= 1u); let p = floor(pixel / grain); var threshold = hash1(p);
    if (params.option >= 3u) { threshold = hash1(vec2f(floor(pixel.x / select(8.0, 20.0, params.option == 4u)), floor(pixel.y))); }
    let rgb = select(vec3f(0.0), source.rgb / source.a, source.a > 1e-6); let value = select(0.0, 1.0, dot(toDisplay(rgb), vec3f(.2126,.7152,.0722)) > threshold); return vec4f(vec3f(value) * source.a, source.a); }
  let cellSize = max(params.cellSize, 3.0); let base = floor(pixel / cellSize); var nearest = 1e9; var site = base;
  for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) { let cell = base + vec2f(f32(x), f32(y)); let point = (cell + .15 + hash2(cell) * .7) * cellSize; let distance = length(pixel - point); if (distance < nearest) { nearest = distance; site = point; } }}
  let sampled = textureSampleLevel(sourceTexture, sourceSampler, clamp(site / dimensions, vec2f(0.0), vec2f(1.0)), 0.0);
  if (params.mode == 2u) { let edge = smoothstep(cellSize * .38, cellSize * .48, nearest); return mix(sampled, source, edge); } return sampled; }
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Cellular shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Cellular",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "cellularMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
export class CellularCore {
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
  encode<K extends CellularMode>(
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
          label: `LightTable Cellular: ${request.key}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(16);
      const f = new Float32Array(bytes);
      const u = new Uint32Array(bytes);
      u[2] =
        request.mode === "crystallize"
          ? 0
          : request.mode === "mezzotint"
            ? 1
            : 2;
      if (request.mode === "mezzotint") {
        const s = request.settings as P2FilterSettingsMap["mezzotint"];
        f[1] = s.seed;
        u[3] = [
          "fine-dots",
          "medium-dots",
          "grainy-dots",
          "short-lines",
          "long-lines",
        ].indexOf(s.type);
      } else {
        const s = request.settings as P2FilterSettingsMap[
          "crystallize" | "pointillize"];
        f[0] = s.cellSize;
        f[1] = s.seed;
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
