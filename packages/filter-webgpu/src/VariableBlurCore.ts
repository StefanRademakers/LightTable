import type { P1FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";

export type VariableBlurMode =
  "box-blur" | "radial-blur" | "field-blur" | "iris-blur" | "tilt-shift";
interface Runtime {
  readonly horizontal: GPUBuffer;
  readonly vertical: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const WGSL = /* wgsl */ `
struct BlurParams { a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: BlurParams;

fn localRadius(uv: vec2f) -> f32 {
  let radius = params.a.x; let mode = i32(params.a.y + 0.5);
  if (mode == 0) { return radius; }
  let center = params.b.xy; let feather = max(params.b.w, 0.0001);
  if (mode == 2 || mode == 3) {
    let distance = length(uv - center) * 141.421356;
    return radius * smoothstep(params.b.z, params.b.z + feather, distance);
  }
  let angle = params.c.x; let q = uv - center;
  let perpendicular = abs(-sin(angle) * q.x + cos(angle) * q.y) * 100.0;
  return radius * smoothstep(params.b.z, params.b.z + feather, perpendicular);
}

@fragment fn blurMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let mode = i32(params.a.y + 0.5);
  let count = max(i32(params.a.w + 0.5), 1);
  if (mode == 1 || mode == 2) {
    let center = params.b.xy; let q = input.uv - center;
    var total = vec4f(0.0); var weight = 0.0;
    for (var index = -32; index <= 32; index += 1) {
      if (abs(index) > count) { continue; }
      let t = f32(index) / f32(count);
      var uv = input.uv;
      if (mode == 1) {
        let angle = t * params.a.x * 0.00174532925;
        let rotated = vec2f(cos(angle) * q.x - sin(angle) * q.y, sin(angle) * q.x + cos(angle) * q.y);
        uv = center + rotated;
      } else { uv = center + q * (1.0 + t * params.a.x * 0.005); }
      total += textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
      weight += 1.0;
    }
    return total / max(weight, 1.0);
  }
  let radius = localRadius(input.uv);
  if (radius <= 0.001) { return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0); }
  let direction = params.c.yz / dimensions;
  let support = min(32, max(1, i32(ceil(radius))));
  let stepPixels = radius / f32(support);
  var total = vec4f(0.0); var weight = 0.0;
  for (var index = -32; index <= 32; index += 1) {
    if (abs(index) > support) { continue; }
    let uv = clamp(input.uv + direction * f32(index) * stepPixels,
      vec2f(0.5) / dimensions, vec2f(1.0) - vec2f(0.5) / dimensions);
    total += textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0); weight += 1.0;
  }
  return total / max(weight, 1.0);
}
`;

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Variable Blur shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Variable Blur",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "blurMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

const modeIndex = (mode: VariableBlurMode) =>
  ["box-blur", "radial-blur", "field-blur", "iris-blur", "tilt-shift"].indexOf(
    mode,
  );
export class VariableBlurCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;
  constructor(
    private readonly device: GPUDevice,
    pool?: FilterTargetPool,
  ) {
    this.pool = pool ?? new FilterTargetPool(device, 3);
    this.ownsPool = !pool;
  }
  configure(width: number, height: number, sampler: GPUSampler) {
    this.pool.configure(width, height);
    this.sampler = sampler;
  }
  encode<K extends VariableBlurMode>(
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
      const create = (axis: string) =>
        this.device.createBuffer({
          label: `LightTable Variable Blur ${axis}: ${request.key}`,
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      runtime = {
        horizontal: create("horizontal"),
        vertical: create("vertical"),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const payload = (axisX: number, axisY: number) => {
        const f = new Float32Array(12);
        f[1] = modeIndex(request.mode);
        f[6] = 0;
        f[7] = 1;
        f[9] = axisX;
        f[10] = axisY;
        const s = request.settings;
        if (request.mode === "box-blur")
          f[0] = (s as P1FilterSettingsMap["box-blur"]).radius;
        if (request.mode === "radial-blur") {
          const v = s as P1FilterSettingsMap["radial-blur"];
          f[0] = v.amount;
          f[3] = v.quality === "draft" ? 8 : v.quality === "best" ? 32 : 16;
          f[4] = v.center.x / 100;
          f[5] = v.center.y / 100;
          f[1] = v.method === "zoom" ? 2 : 1;
        }
        if (request.mode === "field-blur") {
          const v = s as P1FilterSettingsMap["field-blur"];
          f[0] = v.radius;
          f[4] = v.center.x / 100;
          f[5] = v.center.y / 100;
          f[6] = v.focus;
          f[7] = v.feather;
        }
        if (request.mode === "iris-blur") {
          const v = s as P1FilterSettingsMap["iris-blur"];
          f[0] = v.radius;
          f[4] = v.center.x / 100;
          f[5] = v.center.y / 100;
          f[6] = v.irisRadius;
          f[7] = v.feather;
        }
        if (request.mode === "tilt-shift") {
          const v = s as P1FilterSettingsMap["tilt-shift"];
          f[0] = v.radius;
          f[4] = v.center.x / 100;
          f[5] = v.center.y / 100;
          f[6] = v.bandSize;
          f[7] = v.feather;
          f[8] = (v.angle * Math.PI) / 180;
        }
        return f;
      };
      this.device.queue.writeBuffer(runtime.horizontal, 0, payload(1, 0));
      this.device.queue.writeBuffer(runtime.vertical, 0, payload(0, 1));
      runtime.revision = request.revision;
    }
    const pipeline = pipelineFor(this.device);
    const pass = (
      input: GPUTexture,
      target: GPUTexture,
      uniforms: GPUBuffer,
      label: string,
    ) => {
      const group = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: input.createView() },
          { binding: 1, resource: this.sampler! },
          { binding: 2, resource: { buffer: uniforms } },
        ],
      });
      const render = encoder.beginRenderPass({
        label,
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      render.setPipeline(pipeline);
      render.setBindGroup(0, group);
      render.draw(3);
      render.end();
    };
    if (request.mode === "radial-blur") {
      const target = this.pool.acquire([source]);
      pass(source, target, runtime.horizontal, `LightTable ${request.mode}`);
      return target;
    }
    const horizontal = this.pool.acquire([source]);
    const output = this.pool.acquire([source, horizontal]);
    pass(
      source,
      horizontal,
      runtime.horizontal,
      `LightTable ${request.mode} horizontal`,
    );
    pass(
      horizontal,
      output,
      runtime.vertical,
      `LightTable ${request.mode} vertical`,
    );
    return output;
  }
  releaseInactive(keys: ReadonlySet<string>) {
    releaseInactiveFilterRuntimes(this.runtimes, keys, (r) => {
      r.horizontal.destroy();
      r.vertical.destroy();
    });
  }
  estimatedTextureBytes() {
    return this.ownsPool ? this.pool.estimatedTextureBytes() : 0;
  }
  destroy() {
    if (this.ownsPool) this.pool.destroy();
    for (const r of this.runtimes.values()) {
      r.horizontal.destroy();
      r.vertical.destroy();
    }
    this.runtimes.clear();
    this.sampler = null;
  }
}
