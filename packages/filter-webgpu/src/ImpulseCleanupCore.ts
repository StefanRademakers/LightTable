import type { P1FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";

export type ImpulseCleanupMode = "dust-scratches" | "despeckle";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct CleanupParams { mode: u32, step: i32, threshold: f32, strength: f32 }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: CleanupParams;
fn at(p: vec2i, size: vec2i) -> vec4f { return textureLoad(sourceTexture, clamp(p, vec2i(0), size - vec2i(1)), 0); }
fn luma(v: vec4f) -> f32 { let rgb = select(vec3f(0.0), v.rgb / v.a, v.a > 1e-6); return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
@fragment fn cleanupMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let p = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  let source = at(p, size);
  if (params.mode == 1u) {
    var average = vec4f(0.0); var minL = 1e9; var maxL = -1e9;
    for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
      if (x == 0 && y == 0) { continue; } let sample = at(p + vec2i(x, y), size);
      average += sample; let value = luma(sample); minL = min(minL, value); maxL = max(maxL, value);
    }}
    average /= 8.0; let center = luma(source);
    let outlier = smoothstep(maxL - minL, (maxL - minL) * 2.0 + 1e-4, abs(center - luma(average)));
    return mix(source, average, outlier * params.strength);
  }
  var samples: array<vec4f, 25>; var index = 0u;
  for (var y = -2; y <= 2; y += 1) { for (var x = -2; x <= 2; x += 1) {
    samples[index] = at(p + vec2i(x, y) * params.step, size); index += 1u;
  }}
  for (var outer = 1u; outer < 25u; outer += 1u) { var inner = outer;
    while (inner > 0u) { let left = samples[inner - 1u]; let right = samples[inner];
      let swap = luma(left) > luma(right); samples[inner - 1u] = select(left, right, swap);
      samples[inner] = select(right, left, swap); inner -= 1u;
    }
  }
  let median = samples[12];
  return select(source, median, abs(luma(source) - luma(median)) * 255.0 >= params.threshold);
}
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Impulse Cleanup shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Impulse Cleanup",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "cleanupMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
export class ImpulseCleanupCore {
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
  encode<K extends ImpulseCleanupMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: {
      key: string;
      revision: number;
      mode: K;
      settings: P1FilterSettingsMap[K];
    },
  ): GPUTexture {
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Cleanup uniforms: ${request.key}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(16);
      const u = new Uint32Array(bytes);
      const i = new Int32Array(bytes);
      const f = new Float32Array(bytes);
      u[0] = request.mode === "despeckle" ? 1 : 0;
      if (request.mode === "dust-scratches") {
        const s = request.settings as P1FilterSettingsMap["dust-scratches"];
        i[1] = Math.max(1, Math.ceil(s.radius / 2));
        f[2] = s.threshold;
      } else
        f[3] =
          (request.settings as P1FilterSettingsMap["despeckle"]).strength / 100;
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
