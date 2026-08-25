import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

export const MOTION_BLUR_WGSL = /* wgsl */ `
struct MotionBlurUniforms {
  directionUv: vec2f,
  sampleCount: u32,
  padding: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: MotionBlurUniforms;

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
  return accumulated / f32(params.sampleCount);
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
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly device: GPUDevice) {
    this.pool = new FilterTargetPool(device, 1);
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
    readonly settings: P0FilterSettingsMap['motion-blur'];
  }): GPUTexture {
    if (!this.sampler || this.width < 1 || this.height < 1) {
      throw new Error('MotionBlurCore is not configured for the active document.');
    }
    const { angle, distance } = request.settings;
    if (distance <= 0) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Motion Blur uniforms: ${request.key}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        }),
        revision: -1
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const radians = angle * Math.PI / 180;
      const values = new ArrayBuffer(16);
      const floats = new Float32Array(values);
      const integers = new Uint32Array(values);
      floats[0] = Math.cos(radians) * distance / this.width;
      floats[1] = Math.sin(radians) * distance / this.height;
      integers[2] = Math.min(257, Math.max(2, Math.ceil(distance) + 1));
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

  estimatedTextureBytes(): number { return this.pool.estimatedTextureBytes(); }

  destroy(): void {
    this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.uniforms.destroy();
    this.runtimes.clear();
    this.sampler = null;
    this.width = 0;
    this.height = 0;
  }
}
