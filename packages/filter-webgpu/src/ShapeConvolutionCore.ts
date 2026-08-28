import type { P2FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";
export type ShapeConvolutionMode = "shape-blur" | "custom";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct Params { kernel0: vec4f, kernel1: vec4f, kernel2: vec4f, options: vec4f, mode: u32, shape: u32, padding: vec2u }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>; @group(0) @binding(1) var<uniform> params: Params;
fn at(p: vec2i, size: vec2i) -> vec4f { return textureLoad(sourceTexture, clamp(p, vec2i(0), size - vec2i(1)), 0); }
@fragment fn convolutionMain(input: VertexOutput) -> @location(0) vec4f { let size = vec2i(textureDimensions(sourceTexture)); let p = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  if (params.mode == 1u) { var total = vec4f(0.0); var i = 0u; for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
    let weights = array<vec4f, 3>(params.kernel0, params.kernel1, params.kernel2); let w = weights[i / 4u][i % 4u]; total += at(p + vec2i(x, y), size) * w; i += 1u; }} return max(total / max(abs(params.options.y), 1e-6) + vec4f(params.options.z / 255.0), vec4f(0.0)); }
  let radius = max(params.options.x, 0.0); let support = min(5, max(1, i32(ceil(radius)))); let step = max(radius / f32(support), 1.0); var total = vec4f(0.0); var weight = 0.0;
  for (var y = -5; y <= 5; y += 1) { for (var x = -5; x <= 5; x += 1) { if (abs(x) > support || abs(y) > support) { continue; }
    let normalized = vec2f(f32(x), f32(y)) / f32(support); let include = params.shape == 2u || params.shape == 1u && abs(normalized.x) + abs(normalized.y) <= 1.0 || params.shape == 0u && length(normalized) <= 1.0;
    if (include) { total += at(p + vec2i(round(vec2f(f32(x), f32(y)) * step)), size); weight += 1.0; }
  }} return total / max(weight, 1.0); }
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Shape Convolution shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Shape Convolution",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "convolutionMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
export class ShapeConvolutionCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  constructor(
    private readonly device: GPUDevice,
    pool?: FilterTargetPool,
  ) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = !pool;
  }
  configure(width: number, height: number) {
    this.pool.configure(width, height);
  }
  encode<K extends ShapeConvolutionMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: {
      key: string;
      revision: number;
      mode: K;
      settings: P2FilterSettingsMap[K];
    },
  ) {
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Convolution: ${request.key}`,
          size: 80,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(80);
      const f = new Float32Array(bytes);
      const u = new Uint32Array(bytes);
      if (request.mode === "custom") {
        const s = request.settings as P2FilterSettingsMap["custom"];
        s.kernel.forEach((v, i) => {
          f[i] = v;
        });
        f[13] = s.scale;
        f[14] = s.offset;
        u[16] = 1;
      } else {
        const s = request.settings as P2FilterSettingsMap["shape-blur"];
        f[12] = s.radius;
        u[17] = s.shape === "circle" ? 0 : s.shape === "diamond" ? 1 : 2;
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
        { binding: 1, resource: { buffer: runtime.uniforms } },
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
  }
}
