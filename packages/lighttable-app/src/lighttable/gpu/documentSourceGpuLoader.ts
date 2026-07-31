import type { LightTableImageMetadata } from '../types';
import { decodeNativeImage } from '../image-io/NativeImageDecoder';
import type { WasmVipsDecoder } from '../image-io/WasmVipsDecoder';
import type { AdvancedDecodedImage } from '../image-io/types';
import type { LightTableLoadImageOptions } from '../application/rendering/rendererTypes';
import { TEXTURE_FORMATS_TIER1 } from './sharedWebGpuDevice';

export interface LoadedGpuDocumentSource {
  readonly metadata: LightTableImageMetadata;
  readonly texture: GPUTexture;
}

const cancelled = (): DOMException => (
  new DOMException('The image load was cancelled.', 'AbortError')
);

/**
 * Owns source decoding and the source-image GPU upload boundary.
 *
 * It deliberately does not own the currently installed document texture.
 * A successful result is transferred to the renderer; cancellation or loader
 * disposal prevents stale asynchronous work from replacing a newer document.
 */
export class DocumentSourceGpuLoader {
  private advancedDecoder: WasmVipsDecoder | null = null;
  private loadRevision = 0;
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly precisionSourceResolvePipeline: GPURenderPipeline
  ) {}

  async load(
    blob: Blob,
    name: string,
    options: LightTableLoadImageOptions = {}
  ): Promise<LoadedGpuDocumentSource> {
    const revision = ++this.loadRevision;
    return options.decodeMode === 'preserve-precision'
      ? this.loadAdvanced(blob, name, options.signal, revision)
      : this.loadNative(blob, name, options.signal, revision);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadRevision += 1;
    this.advancedDecoder?.destroy();
    this.advancedDecoder = null;
  }

  private assertCurrent(signal: AbortSignal | undefined, revision: number): void {
    if (signal?.aborted || revision !== this.loadRevision) throw cancelled();
    if (this.destroyed) throw new Error('LightTable was closed while the image was loading.');
  }

  private async loadNative(
    blob: Blob,
    name: string,
    signal: AbortSignal | undefined,
    revision: number
  ): Promise<LoadedGpuDocumentSource> {
    this.assertCurrent(signal, revision);
    const decoded = await decodeNativeImage(blob);
    const { bitmap, descriptor } = decoded;
    try {
      this.assertCurrent(signal, revision);
      const texture = this.device.createTexture({
        label: 'LightTable original sRGB image',
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height]
      );
      return {
        texture,
        metadata: {
          name,
          width: descriptor.width,
          height: descriptor.height,
          contentType: descriptor.contentType
        }
      };
    } finally {
      decoded.close();
    }
  }

  private async loadAdvanced(
    blob: Blob,
    name: string,
    signal: AbortSignal | undefined,
    revision: number
  ): Promise<LoadedGpuDocumentSource> {
    const decodeStartedAt = performance.now();
    this.assertCurrent(signal, revision);
    if (!this.advancedDecoder) {
      const { WasmVipsDecoder: AdvancedDecoder } = await import('../image-io/WasmVipsDecoder');
      this.assertCurrent(signal, revision);
      this.advancedDecoder = new AdvancedDecoder();
    }
    const decoded = await this.advancedDecoder.decode(blob, signal);
    this.assertCurrent(signal, revision);
    this.validateAdvancedDescriptor(decoded);
    return this.createAdvancedSource(
      decoded,
      name,
      performance.now() - decodeStartedAt
    );
  }

  private validateAdvancedDescriptor(decoded: AdvancedDecodedImage): void {
    const { descriptor, pixels } = decoded;
    if (descriptor.iccProfile && !descriptor.iccProfileAppliedToSrgb) {
      throw new Error('Precision-preserving import of embedded ICC profiles is not enabled yet.');
    }
    if (
      descriptor.sourceProfile === 'embedded-icc-to-srgb'
      && (!descriptor.iccProfile || !descriptor.iccProfileAppliedToSrgb)
    ) {
      throw new Error('The precision-preserving decoder returned inconsistent embedded ICC metadata.');
    }
    if (
      descriptor.sourceProfile === 'assumed-srgb'
      && (descriptor.iccProfile || descriptor.iccProfileAppliedToSrgb)
    ) {
      throw new Error('The precision-preserving decoder returned inconsistent assumed-sRGB metadata.');
    }
    if (descriptor.storage === 'f32') {
      throw new Error('Floating-point image ingest is not enabled yet.');
    }
    if (descriptor.storage === 'u16' && !this.device.features.has(TEXTURE_FORMATS_TIER1)) {
      throw new Error(
        'This WebGPU adapter cannot upload 16-bit normalized images because texture-formats-tier1 is unavailable. '
        + 'Ordinary 8-bit images remain supported.'
      );
    }
    const supportedInterpretations = new Set(['srgb', 'rgb', 'rgb16', 'b-w', 'grey', 'grey16']);
    if (
      !descriptor.iccProfileAppliedToSrgb
      && !supportedInterpretations.has(descriptor.sourceInterpretation.toLowerCase())
    ) {
      throw new Error(
        `Precision-preserving import does not yet support ${descriptor.sourceInterpretation} source color.`
      );
    }
    const bytesPerChannel = descriptor.storage === 'u16' ? 2 : 1;
    const expectedBytes = descriptor.width * descriptor.height * descriptor.channels * bytesPerChannel;
    if (pixels.byteLength !== expectedBytes) {
      throw new Error(`The decoded image buffer has ${pixels.byteLength} bytes; expected ${expectedBytes}.`);
    }
  }

  private createAdvancedSource(
    decoded: AdvancedDecodedImage,
    name: string,
    decodeDurationMs: number
  ): LoadedGpuDocumentSource {
    const { descriptor, pixels } = decoded;
    const bytesPerChannel = descriptor.storage === 'u16' ? 2 : 1;
    const metadata: LightTableImageMetadata = {
      name,
      width: descriptor.width,
      height: descriptor.height,
      contentType: descriptor.contentType,
      decoder: 'wasm-vips',
      sourceBitDepth: descriptor.sourceBitDepth,
      sourceFormat: descriptor.sourceFormat,
      sourceInterpretation: descriptor.sourceInterpretation,
      sourceProfile: descriptor.sourceProfile === 'embedded-icc-to-srgb'
        ? 'embedded ICC -> sRGB'
        : 'no embedded ICC; assumed sRGB',
      decodeDurationMs
    };

    if (descriptor.storage !== 'u16') {
      const texture = this.device.createTexture({
        label: `LightTable original ${descriptor.sourceBitDepth}-bit sRGB image`,
        size: [descriptor.width, descriptor.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.device.queue.writeTexture(
        { texture },
        pixels,
        {
          offset: 0,
          bytesPerRow: descriptor.width * descriptor.channels * bytesPerChannel,
          rowsPerImage: descriptor.height
        },
        [descriptor.width, descriptor.height]
      );
      return { metadata, texture };
    }

    const stagingTexture = this.device.createTexture({
      label: `LightTable ${descriptor.sourceBitDepth}-bit UNORM staging image`,
      size: [descriptor.width, descriptor.height],
      format: 'rgba16unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: stagingTexture },
      pixels,
      {
        offset: 0,
        bytesPerRow: descriptor.width * descriptor.channels * bytesPerChannel,
        rowsPerImage: descriptor.height
      },
      [descriptor.width, descriptor.height]
    );
    const texture = this.device.createTexture({
      label: `LightTable original ${descriptor.sourceBitDepth}-bit sRGB working image`,
      size: [descriptor.width, descriptor.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    const bindGroup = this.device.createBindGroup({
      layout: this.precisionSourceResolvePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: stagingTexture.createView() }]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable precision source ingest' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.precisionSourceResolvePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    void this.device.queue.onSubmittedWorkDone().then(
      () => stagingTexture.destroy(),
      () => stagingTexture.destroy()
    );
    return { metadata, texture };
  }
}
