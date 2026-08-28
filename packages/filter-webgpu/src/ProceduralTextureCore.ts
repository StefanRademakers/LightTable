import type { P2FilterSettingsMap } from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";
export type ProceduralTextureMode = "difference-clouds" | "fibers";
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct Params { scale: f32, detail: f32, strength: f32, seed: f32, mode: u32, padding: vec3u }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>; @group(0) @binding(1) var<uniform> params: Params;
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7)) + params.seed) * 43758.5453); }
fn noise(p: vec2f) -> f32 { let c=floor(p); let q=fract(p); let s=q*q*(3.0-2.0*q); return mix(mix(hash(c),hash(c+vec2f(1,0)),s.x),mix(hash(c+vec2f(0,1)),hash(c+vec2f(1,1)),s.x),s.y); }
@fragment fn proceduralMain(input: VertexOutput) -> @location(0) vec4f { let dimensions=vec2f(textureDimensions(sourceTexture)); var p=input.uv*dimensions/max(params.scale,2.0); if(params.mode==1u){p=vec2f(p.x*params.detail,p.y/max(params.strength,1.0));}
  var value=0.0; var amplitude=.5; var norm=0.0; for(var i=0;i<8;i+=1){if(i>=i32(params.detail)){break;} value+=noise(p)*amplitude;norm+=amplitude;p=p*2.03+vec2f(11.7,5.3);amplitude*=.5;} value/=max(norm,1e-6);
  if(params.mode==1u){return vec4f(vec3f(value),1.0);} let source=textureLoad(sourceTexture,clamp(vec2i(floor(input.uv*dimensions)),vec2i(0),vec2i(dimensions)-vec2i(1)),0); let rgb=select(vec3f(0),source.rgb/source.a,source.a>1e-6); return vec4f(abs(rgb-vec3f(value))*source.a,source.a); }
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Procedural Texture shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Procedural Texture",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "proceduralMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
export class ProceduralTextureCore {
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
  encode<K extends ProceduralTextureMode>(
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
          label: `LightTable Procedural: ${request.key}`,
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
      u[4] = request.mode === "fibers" ? 1 : 0;
      if (request.mode === "difference-clouds") {
        const s = request.settings as P2FilterSettingsMap["difference-clouds"];
        f[0] = s.scale;
        f[1] = s.detail;
        f[3] = s.seed;
      } else {
        const s = request.settings as P2FilterSettingsMap["fibers"];
        f[0] = 64;
        f[1] = s.variance;
        f[2] = s.strength;
        f[3] = s.seed;
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
