import type { AdjustmentLayer, RasterLayer } from '../editor/document/documentTypes';
import { gaussianBlurModule, gaussianBlurSettings } from '../processing/gaussianBlurFilter';
import { encodeFullscreenPass } from './fullscreenPass';

interface GaussianRuntime {
  readonly horizontal: GPUBuffer;
  readonly vertical: GPUBuffer;
  revision: number;
}

/**
 * Full-resolution separable Gaussian filter in premultiplied linear RGBA.
 *
 * The filter owns only GPU execution resources. The canonical module remains
 * in the document stack; the compositor remains responsible for its mask,
 * clipping, opacity and blend semantics.
 */
export class GaussianBlurFilterRenderer {
  private sampler: GPUSampler | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private horizontalTexture: GPUTexture | null = null;
  private outputTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private readonly runtimes = new Map<string, GaussianRuntime>();

  constructor(private readonly device: GPUDevice) {}

  configure(
    width: number,
    height: number,
    sampler: GPUSampler,
    pipeline: GPURenderPipeline
  ): void {
    this.resetImageResources();
    this.sampler = sampler;
    this.pipeline = pipeline;
    this.width = width;
    this.height = height;
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const module = gaussianBlurModule(layer.adjustmentStack);
    const settings = gaussianBlurSettings(layer.adjustmentStack);
    if (!module?.enabled || !settings || settings.radius <= 0) return source;
    if (!this.pipeline || !this.sampler || this.width < 1 || this.height < 1) {
      throw new Error('Gaussian Blur renderer is not configured for the active document.');
    }
    this.ensureTextures();
    const runtime = this.runtimeFor(layer.id);
    if (runtime.revision !== module.revision) {
      const sigma = Math.max(settings.radius / 3, 0.5);
      this.device.queue.writeBuffer(
        runtime.horizontal, 0, new Float32Array([1, 0, settings.radius, sigma])
      );
      this.device.queue.writeBuffer(
        runtime.vertical, 0, new Float32Array([0, 1, settings.radius, sigma])
      );
      runtime.revision = module.revision;
    }
    const bindGroup = (input: GPUTexture, uniforms: GPUBuffer) => this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.sampler! },
        { binding: 2, resource: { buffer: uniforms } }
      ]
    });
    encodeFullscreenPass(
      encoder,
      this.pipeline,
      bindGroup(source, runtime.horizontal),
      this.horizontalTexture!.createView(),
      { label: `LightTable Gaussian Blur horizontal: ${layer.name}` }
    );
    encodeFullscreenPass(
      encoder,
      this.pipeline,
      bindGroup(this.horizontalTexture!, runtime.vertical),
      this.outputTexture!.createView(),
      { label: `LightTable Gaussian Blur vertical: ${layer.name}` }
    );
    return this.outputTexture!;
  }

  estimatedTextureBytes(): number {
    return this.horizontalTexture && this.outputTexture
      ? this.width * this.height * 8 * 2
      : 0;
  }

  destroy(): void {
    this.reset();
    this.sampler = null;
    this.pipeline = null;
    this.width = 0;
    this.height = 0;
  }

  reset(): void {
    this.resetImageResources();
    for (const runtime of this.runtimes.values()) {
      runtime.horizontal.destroy();
      runtime.vertical.destroy();
    }
    this.runtimes.clear();
  }

  private runtimeFor(id: string): GaussianRuntime {
    const existing = this.runtimes.get(id);
    if (existing) return existing;
    const createBuffer = (axis: string) => this.device.createBuffer({
      label: `LightTable Gaussian Blur ${axis} uniforms: ${id}`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const runtime = {
      horizontal: createBuffer('horizontal'),
      vertical: createBuffer('vertical'),
      revision: -1
    };
    this.runtimes.set(id, runtime);
    return runtime;
  }

  private ensureTextures(): void {
    if (this.horizontalTexture && this.outputTexture) return;
    const createTexture = (label: string) => this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.horizontalTexture = createTexture('LightTable Gaussian Blur horizontal scratch');
    this.outputTexture = createTexture('LightTable Gaussian Blur output');
  }

  private resetImageResources(): void {
    this.horizontalTexture?.destroy();
    this.outputTexture?.destroy();
    this.horizontalTexture = null;
    this.outputTexture = null;
  }
}
