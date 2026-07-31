import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import { encodeRgba8Png, stripTextureRowPadding } from '../../gpu/gpuReadback';

const EXPORT_SETTINGS_FLOATS = 4;

export const layerPngReadbackLayout = (width: number, height: number) => {
  const bytesPerRow = Math.ceil((Math.max(1, width) * 4) / 256) * 256;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    bytesPerRow,
    byteLength: bytesPerRow * Math.max(1, height)
  };
};

export interface LayerTextureCodecPipelines {
  decode: GPURenderPipeline;
  maskDecode: GPURenderPipeline;
  exportLayer: GPURenderPipeline;
}

/**
 * Browser/Electron-neutral GPU transfer codec for persisted layer pixels.
 *
 * It owns no document state and no persistent textures. Callers provide the
 * current document dimensions and a generation guard, so asynchronous decode
 * cannot publish into a replacement document.
 */
export class LayerTextureCodec {
  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    private readonly pipelines: LayerTextureCodecPipelines
  ) {}

  async decode(
    blob: Blob,
    destination: GPUTexture,
    maskChannel: boolean,
    width: number,
    height: number,
    isCurrent: () => boolean
  ) {
    const decoded = await decodeNativeImage(blob);
    const { bitmap } = decoded;
    let encodedTexture: GPUTexture | null = null;
    try {
      if (!isCurrent()) throw new Error('LightTable was closed while restoring its layers.');
      if (bitmap.width !== width || bitmap.height !== height) {
        throw new Error('A saved layer does not match the LightTable document dimensions.');
      }
      encodedTexture = this.device.createTexture({
        label: 'LightTable persisted layer source',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: encodedTexture },
        [width, height]
      );
      const pipeline = maskChannel ? this.pipelines.maskDecode : this.pipelines.decode;
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: encodedTexture.createView() },
          { binding: 1, resource: this.sampler }
        ]
      });
      const encoder = this.device.createCommandEncoder({
        label: 'Restore LightTable layer pixels'
      });
      this.drawFullscreen(
        encoder,
        pipeline,
        bindGroup,
        destination.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
    } finally {
      encodedTexture?.destroy();
      decoded.close();
    }
  }

  encode(
    source: GPUTexture,
    maskChannel: boolean,
    outputWidth: number,
    outputHeight: number
  ) {
    return this.withValidationScope(
      maskChannel
        ? 'LightTable mask export validation failed'
        : 'LightTable layer export validation failed',
      () => this.encodeUnchecked(source, maskChannel, outputWidth, outputHeight)
    );
  }

  async encodeUnchecked(
    source: GPUTexture,
    maskChannel: boolean,
    outputWidth: number,
    outputHeight: number
  ) {
    const layout = layerPngReadbackLayout(outputWidth, outputHeight);
    const outputTexture = this.device.createTexture({
      label: 'LightTable persisted layer PNG source',
      size: [layout.width, layout.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable layer export settings',
      size: EXPORT_SETTINGS_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(
      settingsBuffer,
      0,
      new Float32Array([maskChannel ? 1 : 0, 0, 0, 0])
    );
    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.exportLayer.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: settingsBuffer } }
      ]
    });
    const readBuffer = this.device.createBuffer({
      label: 'LightTable persisted layer readback',
      size: layout.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: 'Encode LightTable layer PNG'
      });
      this.drawFullscreen(
        encoder,
        this.pipelines.exportLayer,
        bindGroup,
        outputTexture.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      encoder.copyTextureToBuffer(
        { texture: outputTexture },
        {
          buffer: readBuffer,
          bytesPerRow: layout.bytesPerRow,
          rowsPerImage: layout.height
        },
        [layout.width, layout.height]
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const pixels = stripTextureRowPadding(
        new Uint8Array(readBuffer.getMappedRange()),
        layout.width,
        layout.height,
        4,
        layout.bytesPerRow
      );
      readBuffer.unmap();
      return encodeRgba8Png(pixels, layout.width, layout.height);
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      outputTexture.destroy();
      settingsBuffer.destroy();
    }
  }

  private async withValidationScope<T>(label: string, operation: () => Promise<T>) {
    this.device.pushErrorScope('validation');
    let scopeOpen = true;
    try {
      const result = await operation();
      const validationError = await this.device.popErrorScope();
      scopeOpen = false;
      if (validationError) throw new Error(`${label}: ${validationError.message}`);
      return result;
    } finally {
      if (scopeOpen) await this.device.popErrorScope();
    }
  }

  private drawFullscreen(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target,
        clearValue,
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
