import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FilterTargetPool } from './FilterTargetPool';
import { BLUR_CORE_WGSL, FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';

export type BlurCoreMode = 'gaussian-blur' | 'high-pass' | 'unsharp-mask' | 'smart-sharpen';

export interface BlurCoreRequestMap {
  'gaussian-blur': P0FilterSettingsMap['gaussian-blur'];
  'high-pass': P0FilterSettingsMap['high-pass'];
  'unsharp-mask': P0FilterSettingsMap['unsharp-mask'];
  'smart-sharpen': P0FilterSettingsMap['smart-sharpen'];
}

interface BlurRuntime {
  readonly horizontal: GPUBuffer;
  readonly vertical: GPUBuffer;
  revision: number;
}

const pipelineCache = new WeakMap<GPUDevice, GPURenderPipeline>();

const pipelineFor = (device: GPUDevice): GPURenderPipeline => {
  const existing = pipelineCache.get(device);
  if (existing) return existing;
  const module = device.createShaderModule({
    label: 'LightTable BlurCore shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${BLUR_CORE_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable BlurCore',
    layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'main', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelineCache.set(device, pipeline);
  return pipeline;
};

const encodePass = (
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  target: GPUTexture,
  label: string
) => {
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{
      view: target.createView(),
      loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 }
    }]
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
};

const parameters = (mode: BlurCoreMode, settings: BlurCoreRequestMap[BlurCoreMode]) => {
  if (mode === 'unsharp-mask') {
    const unsharp = settings as BlurCoreRequestMap['unsharp-mask'];
    return {
      radius: unsharp.radius,
      mode: 2,
      amount: unsharp.amount / 100,
      threshold: unsharp.threshold
    };
  }
  if (mode === 'smart-sharpen') {
    const smart = settings as BlurCoreRequestMap['smart-sharpen'];
    return {
      radius: smart.radius,
      mode: smart.remove === 'lens' ? 4 : 3,
      amount: smart.amount / 100,
      threshold: smart.reduceNoise
    };
  }
  return {
    radius: settings.radius,
    mode: mode === 'high-pass' ? 1 : 0,
    amount: 0,
    threshold: 0
  };
};

/** Shared exact separable baseline for Gaussian, High Pass and Unsharp Mask. */
export class BlurCore {
  private sampler: GPUSampler | null = null;
  private width = 0;
  private height = 0;
  private readonly pool: FilterTargetPool;
  private readonly runtimes = new Map<string, BlurRuntime>();

  constructor(private readonly device: GPUDevice) {
    this.pool = new FilterTargetPool(device);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.width = width;
    this.height = height;
    this.sampler = sampler;
    this.pool.configure(width, height);
  }

  encode<K extends BlurCoreMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: { readonly key: string; readonly revision: number; readonly mode: K; readonly settings: BlurCoreRequestMap[K] }
  ): GPUTexture {
    if (!this.sampler || this.width < 1 || this.height < 1) {
      throw new Error('BlurCore is not configured for the active document.');
    }
    const params = parameters(request.mode, request.settings);
    if (params.radius <= 0) return source;
    const pipeline = pipelineFor(this.device);
    const runtime = this.runtimeFor(request.key);
    if (runtime.revision !== request.revision) {
      const sigma = Math.max(params.radius / 3, 0.5);
      this.device.queue.writeBuffer(runtime.horizontal, 0, new Float32Array([
        1, 0, params.radius, sigma, 0, 0, 0, 0
      ]));
      const vertical = new ArrayBuffer(32);
      const floats = new Float32Array(vertical);
      const integers = new Uint32Array(vertical);
      floats.set([0, 1, params.radius, sigma]);
      integers[4] = params.mode;
      floats[5] = params.amount;
      floats[6] = params.threshold;
      this.device.queue.writeBuffer(runtime.vertical, 0, vertical);
      runtime.revision = request.revision;
    }
    const horizontalTarget = this.pool.acquire([source]);
    const outputTarget = this.pool.acquire([source, horizontalTarget]);
    const bindGroup = (original: GPUTexture, input: GPUTexture, uniforms: GPUBuffer) =>
      this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: original.createView() },
          { binding: 1, resource: input.createView() },
          { binding: 2, resource: this.sampler! },
          { binding: 3, resource: { buffer: uniforms } }
        ]
      });
    encodePass(
      encoder, pipeline, bindGroup(source, source, runtime.horizontal), horizontalTarget,
      `LightTable ${request.mode} horizontal`
    );
    encodePass(
      encoder, pipeline, bindGroup(source, horizontalTarget, runtime.vertical), outputTarget,
      `LightTable ${request.mode} vertical resolve`
    );
    return outputTarget;
  }

  release(key: string): void {
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    runtime.horizontal.destroy();
    runtime.vertical.destroy();
    this.runtimes.delete(key);
  }

  estimatedTextureBytes(): number {
    return this.pool.estimatedTextureBytes();
  }

  destroy(): void {
    this.pool.destroy();
    for (const runtime of this.runtimes.values()) {
      runtime.horizontal.destroy();
      runtime.vertical.destroy();
    }
    this.runtimes.clear();
    this.sampler = null;
    this.width = 0;
    this.height = 0;
  }

  private runtimeFor(key: string): BlurRuntime {
    const existing = this.runtimes.get(key);
    if (existing) return existing;
    const create = (axis: string) => this.device.createBuffer({
      label: `LightTable BlurCore ${axis} uniforms: ${key}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const runtime = { horizontal: create('horizontal'), vertical: create('vertical'), revision: -1 };
    this.runtimes.set(key, runtime);
    return runtime;
  }
}
