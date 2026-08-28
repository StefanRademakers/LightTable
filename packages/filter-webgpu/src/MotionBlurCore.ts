import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';
import { releaseInactiveFilterRuntimes } from './FilterRuntimeCache';

export const MOTION_BLUR_WGSL = /* wgsl */ `
struct MotionBlurUniforms {
  directionUv: vec2f,
  sampleCount: u32,
  outputMode: u32,
  amount: f32,
  reduceNoise: f32,
  padding: vec2f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: MotionBlurUniforms;

fn motionLuminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn motionUnpremultiply(value: vec4f) -> vec3f {
  return select(vec3f(0.0), value.rgb / value.a, value.a > 0.000001);
}

@fragment
fn motionBlurMain(input: VertexOutput) -> @location(0) vec4f {
  var accumulated = vec4f(0.0);
  let denominator = max(f32(params.sampleCount - 1u), 1.0);
  for (var index = 0u; index < 257u; index += 1u) {
    if (index >= params.sampleCount) { break; }
    let position = f32(index) / denominator - 0.5;
    accumulated += textureSampleLevel(
      sourceTexture, sourceSampler, input.uv + params.directionUv * position, 0.0
    );
  }
  let blurred = accumulated / f32(params.sampleCount);
  if (params.outputMode == 0u) { return blurred; }
  let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let texel = 1.0 / vec2f(textureDimensions(sourceTexture));
  let centerLuma = motionLuminance(motionUnpremultiply(source));
  let neighborMean = (
    motionLuminance(motionUnpremultiply(textureSampleLevel(
      sourceTexture, sourceSampler, input.uv - vec2f(texel.x, 0.0), 0.0)))
    + motionLuminance(motionUnpremultiply(textureSampleLevel(
      sourceTexture, sourceSampler, input.uv + vec2f(texel.x, 0.0), 0.0)))
    + motionLuminance(motionUnpremultiply(textureSampleLevel(
      sourceTexture, sourceSampler, input.uv - vec2f(0.0, texel.y), 0.0)))
    + motionLuminance(motionUnpremultiply(textureSampleLevel(
      sourceTexture, sourceSampler, input.uv + vec2f(0.0, texel.y), 0.0)))
  ) * 0.25;
  let detail = source.rgb - blurred.rgb;
  let detailLuma = abs(centerLuma - motionLuminance(motionUnpremultiply(blurred)));
  let noise = abs(centerLuma - neighborMean);
  let confidence = detailLuma / (detailLuma + noise * params.reduceNoise * 4.0 + 0.000001);
  return vec4f(max(source.rgb + detail * params.amount * confidence, vec3f(0.0)), source.a);
}
`;

interface Runtime { readonly uniforms: GPUBuffer; revision: number }
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: 'LightTable Motion Blur shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${MOTION_BLUR_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable Motion Blur', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'motionBlurMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

/**
 * Premultiplied-linear line integration for Motion Blur.
 *
 * Sampling is pixel-dense through 256 px. Larger distances remain bounded at
 * 257 taps and use linear sampling across gaps no wider than two pixels, so a
 * pathological slider value cannot make frame cost grow without bound.
 */
export class MotionBlurCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly device: GPUDevice, pool?: FilterTargetPool) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = pool === undefined;
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.width = width;
    this.height = height;
    this.sampler = sampler;
    this.pool.configure(width, height);
  }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string;
    readonly revision: number;
    readonly mode: 'motion-blur';
    readonly settings: P0FilterSettingsMap['motion-blur'];
  } | {
    readonly key: string;
    readonly revision: number;
    readonly mode: 'smart-sharpen';
    readonly settings: P0FilterSettingsMap['smart-sharpen'];
  }): GPUTexture {
    if (!this.sampler || this.width < 1 || this.height < 1) {
      throw new Error('MotionBlurCore is not configured for the active document.');
    }
    const angle = request.settings.angle;
    const distance = request.mode === 'motion-blur'
      ? request.settings.distance
      : request.settings.radius;
    if (distance <= 0) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Motion Blur uniforms: ${request.key}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        }),
        revision: -1
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const radians = angle * Math.PI / 180;
      const values = new ArrayBuffer(32);
      const floats = new Float32Array(values);
      const integers = new Uint32Array(values);
      floats[0] = Math.cos(radians) * distance / this.width;
      floats[1] = Math.sin(radians) * distance / this.height;
      integers[2] = Math.min(257, Math.max(2, Math.ceil(distance) + 1));
      integers[3] = request.mode === 'smart-sharpen' ? 1 : 0;
      floats[4] = request.mode === 'smart-sharpen' ? request.settings.amount / 100 : 0;
      floats[5] = request.mode === 'smart-sharpen' ? request.settings.reduceNoise / 100 : 0;
      this.device.queue.writeBuffer(runtime.uniforms, 0, values);
      runtime.revision = request.revision;
    }
    const target = this.pool.acquire([source]);
    const pipeline = pipelineFor(this.device);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: runtime.uniforms } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable Motion Blur',
      colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return target;
  }

  estimatedTextureBytes(): number { return this.ownsPool ? this.pool.estimatedTextureBytes() : 0; }

  releaseInactive(activeKeys: ReadonlySet<string>): void {
    releaseInactiveFilterRuntimes(this.runtimes, activeKeys, (runtime) => runtime.uniforms.destroy());
  }

  destroy(): void {
    if (this.ownsPool) this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.uniforms.destroy();
    this.runtimes.clear();
    this.sampler = null;
    this.width = 0;
    this.height = 0;
  }
}
