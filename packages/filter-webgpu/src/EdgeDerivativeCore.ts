import type { P1FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";

export type EdgeDerivativeMode = "find-edges" | "emboss";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const WGSL = /* wgsl */ `
struct EdgeParams { mode: u32, amount: f32, angle: f32, height: f32 }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: EdgeParams;

fn luma(value: vec4f) -> f32 {
  let straight = select(vec3f(0.0), value.rgb / value.a, value.a > 1e-6);
  return dot(straight, vec3f(0.2126, 0.7152, 0.0722));
}
fn at(point: vec2i, size: vec2i) -> vec4f {
  return textureLoad(sourceTexture, clamp(point, vec2i(0), size - vec2i(1)), 0);
}
@fragment fn edgeMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let p = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  let source = at(p, size);
  if (params.mode == 1u) {
    let delta = vec2i(round(vec2f(cos(params.angle), sin(params.angle)) * params.height));
    let relief = (luma(at(p + delta, size)) - luma(at(p - delta, size))) * params.amount;
    return vec4f(vec3f(clamp(0.5 + relief, 0.0, 1.0)) * source.a, source.a);
  }
  let tl = luma(at(p + vec2i(-1, -1), size)); let tc = luma(at(p + vec2i(0, -1), size));
  let tr = luma(at(p + vec2i(1, -1), size));  let ml = luma(at(p + vec2i(-1, 0), size));
  let mr = luma(at(p + vec2i(1, 0), size));   let bl = luma(at(p + vec2i(-1, 1), size));
  let bc = luma(at(p + vec2i(0, 1), size));   let br = luma(at(p + vec2i(1, 1), size));
  let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  let edge = clamp(length(vec2f(gx, gy)) * params.amount, 0.0, 1.0);
  return vec4f(vec3f(1.0 - edge) * source.a, source.a);
}
`;

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Edge Derivative shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Edge Derivative",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "edgeMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

export class EdgeDerivativeCore {
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
  encode<K extends EdgeDerivativeMode>(
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
          label: `LightTable Edge uniforms: ${request.key}`,
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
      u[0] = request.mode === "emboss" ? 1 : 0;
      if (request.mode === "emboss") {
        const s = request.settings as P1FilterSettingsMap["emboss"];
        f[1] = s.amount / 100;
        f[2] = (s.angle * Math.PI) / 180;
        f[3] = s.height;
      } else
        f[1] =
          (request.settings as P1FilterSettingsMap["find-edges"]).amount / 100;
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
