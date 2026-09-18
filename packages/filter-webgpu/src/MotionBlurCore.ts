import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { COLOR_MOTION_BLUR_WGSL, VisualEffectPipelineProvider } from '@mediavibe/effects-webgpu';
import { FilterTargetPool } from './FilterTargetPool';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { releaseInactiveFilterRuntimes } from './FilterRuntimeCache';

/** Retained export for shader contract tests and downstream diagnostics. */
export const MOTION_BLUR_WGSL = COLOR_MOTION_BLUR_WGSL;

const SMART_SHARPEN_WGSL = /* wgsl */ `
struct Params { directionUv: vec2f, sampleCount: u32, padding: u32, amount: f32, reduceNoise: f32, tail: vec2f }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
fn luma(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
fn straight(value: vec4f) -> vec3f { return select(vec3f(0.0), value.rgb / value.a, value.a > 0.000001); }
@fragment fn smartMotionMain(input: VertexOutput) -> @location(0) vec4f {
  var accumulated = vec4f(0.0); let denominator = max(f32(params.sampleCount - 1u), 1.0);
  for (var index = 0u; index < 257u; index += 1u) {
    if (index >= params.sampleCount) { break; }
    let position = f32(index) / denominator - 0.5;
    accumulated += textureSampleLevel(sourceTexture, sourceSampler, input.uv + params.directionUv * position, 0.0);
  }
  let blurred = accumulated / f32(params.sampleCount);
  let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let texel = 1.0 / vec2f(textureDimensions(sourceTexture)); let center = luma(straight(source));
  let neighbor = (luma(straight(textureSampleLevel(sourceTexture, sourceSampler, input.uv-vec2f(texel.x,0.0),0.0)))
    + luma(straight(textureSampleLevel(sourceTexture, sourceSampler, input.uv+vec2f(texel.x,0.0),0.0)))
    + luma(straight(textureSampleLevel(sourceTexture, sourceSampler, input.uv-vec2f(0.0,texel.y),0.0)))
    + luma(straight(textureSampleLevel(sourceTexture, sourceSampler, input.uv+vec2f(0.0,texel.y),0.0)))) * 0.25;
  let detail = source.rgb - blurred.rgb; let detailLuma = abs(center - luma(straight(blurred)));
  let noise = abs(center - neighbor); let confidence = detailLuma / (detailLuma + noise * params.reduceNoise * 4.0 + 0.000001);
  return vec4f(max(source.rgb + detail * params.amount * confidence, vec3f(0.0)), source.a);
}`;
interface SmartRuntime { readonly uniforms: GPUBuffer; revision: number }
const smartPipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

/** LightTable adapter over the shared MediaVibe directional blur kernel. */
export class MotionBlurCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly shared: VisualEffectPipelineProvider;
  private width = 0;
  private height = 0;
  private sampler: GPUSampler | null = null;
  private readonly smartRuntimes = new Map<string, SmartRuntime>();

  constructor(private readonly device: GPUDevice, pool?: FilterTargetPool) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = pool === undefined;
    this.shared = new VisualEffectPipelineProvider(device);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.width = width; this.height = height; this.sampler = sampler;
    this.pool.configure(width, height); this.shared.configure(width, height, sampler);
  }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string; readonly revision: number; readonly mode: 'motion-blur';
    readonly settings: P0FilterSettingsMap['motion-blur'];
  } | {
    readonly key: string; readonly revision: number; readonly mode: 'smart-sharpen';
    readonly settings: P0FilterSettingsMap['smart-sharpen'];
  }): GPUTexture {
    if (!this.sampler || this.width < 1 || this.height < 1) {
      throw new Error('MotionBlurCore is not configured for the active document.');
    }
    if (request.mode === 'smart-sharpen') return this.encodeSmartSharpen(encoder, source, request);
    return this.shared.encode(encoder, source, {
      key: request.key, revision: request.revision, id: 'mediavibe.motion-blur',
      parameters: { angle: request.settings.angle, distance: request.settings.distance }
    }, this.pool);
  }

  estimatedTextureBytes(): number { return this.ownsPool ? this.pool.estimatedTextureBytes() : 0; }
  releaseInactive(activeKeys: ReadonlySet<string>): void {
    this.shared.releaseInactive(activeKeys);
    releaseInactiveFilterRuntimes(this.smartRuntimes, activeKeys, runtime => runtime.uniforms.destroy());
  }
  destroy(): void {
    if (this.ownsPool) this.pool.destroy();
    this.shared.destroy();
    for (const runtime of this.smartRuntimes.values()) runtime.uniforms.destroy();
    this.smartRuntimes.clear(); this.sampler = null; this.width = 0; this.height = 0;
  }

  private encodeSmartSharpen(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string; readonly revision: number; readonly mode: 'smart-sharpen';
    readonly settings: P0FilterSettingsMap['smart-sharpen'];
  }) {
    if (request.settings.radius <= 0) return source;
    let runtime = this.smartRuntimes.get(request.key);
    if (!runtime) {
      runtime = { uniforms: this.device.createBuffer({ size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), revision: -1 };
      this.smartRuntimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(32); const f = new Float32Array(bytes); const u = new Uint32Array(bytes);
      const radians = request.settings.angle * Math.PI / 180;
      f[0] = Math.cos(radians) * request.settings.radius / this.width;
      f[1] = Math.sin(radians) * request.settings.radius / this.height;
      u[2] = Math.min(257, Math.max(2, Math.ceil(request.settings.radius) + 1));
      u[3] = 1;
      f[4] = request.settings.amount / 100; f[5] = request.settings.reduceNoise / 100;
      this.device.queue.writeBuffer(runtime.uniforms, 0, bytes); runtime.revision = request.revision;
    }
    let pipeline = smartPipelines.get(this.device);
    if (!pipeline) {
      const module = this.device.createShaderModule({ code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${SMART_SHARPEN_WGSL}` });
      pipeline = this.device.createRenderPipeline({ layout: 'auto',
        vertex: { module, entryPoint: 'filterFullscreenVertex' },
        fragment: { module, entryPoint: 'smartMotionMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' } }); smartPipelines.set(this.device, pipeline);
    }
    const target = this.pool.acquire([source]);
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: source.createView() }, { binding: 1, resource: this.sampler! },
      { binding: 2, resource: { buffer: runtime.uniforms } }
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end(); return target;
  }
}
