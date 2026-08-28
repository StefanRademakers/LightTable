import type {
  P1FilterKind,
  P1FilterSettingsMap,
} from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";

export type AnalyticWarpMode = Extract<
  P1FilterKind,
  "wave" | "ripple" | "twirl" | "spherize" | "polar-coordinates"
>;
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const WGSL = /* wgsl */ `
struct WarpParams { a: vec4f, b: vec4f, mode: u32, edgeMode: u32, option: u32, padding: u32 }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: WarpParams;
fn positiveMod(v: vec2f) -> vec2f { return v - floor(v); }
fn triangle(value: f32) -> f32 { return abs(fract(value) * 2.0 - 1.0) * 2.0 - 1.0; }
fn sampleWarp(uv: vec2f) -> vec4f {
  if (params.edgeMode == 2u) { return textureSampleLevel(sourceTexture, sourceSampler, positiveMod(uv), 0.0); }
  if (params.edgeMode == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, sourceSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
@fragment fn warpMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let center = params.a.xy;
  let aspect = dimensions.x / dimensions.y;
  var uv = input.uv;
  var p = (uv - center) * vec2f(aspect, 1.0);
  if (params.mode == 0u) {
    let coordinate = uv.y * dimensions.y / max(params.a.w, 2.0) + params.b.x;
    let wave = select(sin(coordinate * 6.2831853), triangle(coordinate), params.option == 1u);
    uv.x += wave * params.a.z / dimensions.x;
  } else if (params.mode == 1u) {
    let radius = length(p); let frequency = params.a.w;
    let displacement = sin(radius * frequency * 6.2831853) * params.a.z;
    p += select(vec2f(0.0), normalize(p) * displacement, radius > 1e-6);
    uv = center + p / vec2f(aspect, 1.0);
  } else if (params.mode == 2u) {
    let radius = length(p); let limit = params.a.w;
    if (radius < limit) {
      let falloff = 1.0 - radius / limit; let theta = params.a.z * falloff * falloff;
      let rotated = vec2f(cos(theta) * p.x - sin(theta) * p.y, sin(theta) * p.x + cos(theta) * p.y);
      uv = center + rotated / vec2f(aspect, 1.0);
    }
  } else if (params.mode == 3u) {
    let radius = length(p) * 2.0;
    if (radius < 1.0) {
      let mapped = pow(max(radius, 1e-6), 1.0 + params.a.z * 0.8);
      var q = p * mapped / max(radius, 1e-6);
      if (params.option == 1u) { q.y = p.y; } else if (params.option == 2u) { q.x = p.x; }
      uv = center + q / vec2f(aspect, 1.0);
    }
  } else if (params.option == 0u) {
    let q = uv - vec2f(0.5);
    let angle = atan2(q.y, q.x);
    uv = vec2f((angle + 3.14159265) / 6.2831853, length(q) * 2.0);
  } else {
    let angle = uv.x * 6.2831853 - 3.14159265; let radius = uv.y * 0.5;
    uv = vec2f(0.5) + vec2f(cos(angle), sin(angle)) * radius;
  }
  return sampleWarp(uv);
}
`;

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Analytic Warp shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Analytic Warp",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "warpMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

const modeIndex = (mode: AnalyticWarpMode) =>
  ["wave", "ripple", "twirl", "spherize", "polar-coordinates"].indexOf(mode);
export class AnalyticWarpCore {
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
  encode<K extends AnalyticWarpMode>(
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
          label: `LightTable Warp uniforms: ${request.key}`,
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
      f[0] = 0.5;
      f[1] = 0.5;
      u[8] = modeIndex(request.mode);
      u[9] = 1;
      const s = request.settings;
      if ("center" in s) {
        f[0] = s.center.x / 100;
        f[1] = s.center.y / 100;
      }
      if (request.mode === "wave") {
        const v = s as P1FilterSettingsMap["wave"];
        f[2] = v.amount;
        f[3] = v.wavelength;
        f[4] = v.phase / 360;
        u[9] =
          v.edgeMode === "transparent" ? 0 : v.edgeMode === "clamp" ? 1 : 2;
        u[10] = v.waveType === "triangle" ? 1 : 0;
      }
      if (request.mode === "ripple") {
        const v = s as P1FilterSettingsMap["ripple"];
        f[2] = v.amount / 2000;
        f[3] = v.size === "small" ? 40 : v.size === "large" ? 10 : 20;
      }
      if (request.mode === "twirl") {
        const v = s as P1FilterSettingsMap["twirl"];
        f[2] = (v.angle * Math.PI) / 180;
        f[3] = v.radius / 200;
      }
      if (request.mode === "spherize") {
        const v = s as P1FilterSettingsMap["spherize"];
        f[2] = v.amount / 100;
        u[10] = v.mode === "horizontal" ? 1 : v.mode === "vertical" ? 2 : 0;
      }
      if (request.mode === "polar-coordinates") {
        const v = s as P1FilterSettingsMap["polar-coordinates"];
        u[10] = v.mode === "polar-to-rectangular" ? 1 : 0;
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
