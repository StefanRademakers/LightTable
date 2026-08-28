import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import {
  PSD_RAW_ADOBE_RGBA16_MEDIA_TYPE,
  PSD_RAW_ADOBE_RGBA8_MEDIA_TYPE,
  PSD_RAW_RGBA16_MEDIA_TYPE,
  PSD_RAW_RGBA8_MEDIA_TYPE
} from '../../image-io/psdProtocol';
import {
  encodeRgba8Image,
  stripTextureRowPadding,
  type Rgba8ImageEncoding
} from '../../gpu/gpuReadback';
import { invertMatrix } from '../geometry/affine';
import type { AffineMatrix } from '../geometry/affine';

const EXPORT_SETTINGS_FLOATS = 16;

export const layerPngReadbackLayout = (width: number, height: number) => {
  const bytesPerRow = Math.ceil((Math.max(1, width) * 4) / 256) * 256;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    bytesPerRow,
    byteLength: bytesPerRow * Math.max(1, height)
  };
};

export const rawRgba8UploadLayout = (
  byteLength: number,
  width: number,
  height: number
) => {
  const expectedByteLength = width * height * 4;
  if (
    !Number.isInteger(width) || width <= 0
    || !Number.isInteger(height) || height <= 0
    || byteLength !== expectedByteLength
  ) {
    throw new Error('A PSD layer preview does not match its layer-local dimensions.');
  }
  return { bytesPerRow: width * 4, rowsPerImage: height };
};

export const rawRgba16UploadLayout = (
  byteLength: number,
  width: number,
  height: number
) => {
  const expectedByteLength = width * height * 4 * Uint16Array.BYTES_PER_ELEMENT;
  if (
    !Number.isInteger(width) || width <= 0
    || !Number.isInteger(height) || height <= 0
    || byteLength !== expectedByteLength
  ) {
    throw new Error('A 16-bit PSD layer preview does not match its layer-local dimensions.');
  }
  return { bytesPerRow: width * 8, rowsPerImage: height };
};

export const normalizedUint16ToFloat16 = (value: number) => {
  const normalized = Math.min(1, Math.max(0, value / 65_535));
  if (normalized === 0) return 0;
  if (normalized === 1) return 0x3c00;
  const exponent = Math.floor(Math.log2(normalized));
  const biasedExponent = exponent + 15;
  if (biasedExponent <= 0) {
    return Math.min(0x03ff, Math.round(normalized * 16_777_216));
  }
  const mantissa = Math.round((normalized / (2 ** exponent) - 1) * 1024);
  if (mantissa === 1024) return (biasedExponent + 1) << 10;
  return (biasedExponent << 10) | mantissa;
};

export interface LayerTextureCodecPipelines {
  decode: GPURenderPipeline;
  adobeRgbDecode: GPURenderPipeline;
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
    let decoded: Awaited<ReturnType<typeof decodeNativeImage>> | null = null;
    let encodedTexture: GPUTexture | null = null;
    try {
      if (!isCurrent()) throw new Error('LightTable was closed while restoring its layers.');
      const isRaw16 = blob.type === PSD_RAW_RGBA16_MEDIA_TYPE
        || blob.type === PSD_RAW_ADOBE_RGBA16_MEDIA_TYPE;
      const isAdobeRgb = blob.type === PSD_RAW_ADOBE_RGBA8_MEDIA_TYPE
        || blob.type === PSD_RAW_ADOBE_RGBA16_MEDIA_TYPE;
      encodedTexture = this.device.createTexture({
        label: 'LightTable persisted layer source',
        size: [width, height],
        format: isRaw16 ? 'rgba16float' : 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      });
      if (isRaw16) {
        const source = new Uint16Array(await blob.arrayBuffer());
        if (!isCurrent()) throw new Error('LightTable was closed while restoring its layers.');
        const upload = rawRgba16UploadLayout(source.byteLength, width, height);
        const pixels = new Uint16Array(source.length);
        for (let index = 0; index < source.length; index += 1) {
          pixels[index] = normalizedUint16ToFloat16(source[index]);
        }
        this.device.queue.writeTexture(
          { texture: encodedTexture },
          pixels,
          upload,
          [width, height]
        );
      } else if (
        blob.type === PSD_RAW_RGBA8_MEDIA_TYPE
        || blob.type === PSD_RAW_ADOBE_RGBA8_MEDIA_TYPE
      ) {
        const pixels = new Uint8Array(await blob.arrayBuffer());
        if (!isCurrent()) throw new Error('LightTable was closed while restoring its layers.');
        const upload = rawRgba8UploadLayout(pixels.byteLength, width, height);
        this.device.queue.writeTexture(
          { texture: encodedTexture },
          pixels,
          upload,
          [width, height]
        );
      } else {
        decoded = await decodeNativeImage(blob);
        if (!isCurrent()) throw new Error('LightTable was closed while restoring its layers.');
        const { bitmap } = decoded;
        if (bitmap.width !== width || bitmap.height !== height) {
          throw new Error('A saved layer does not match the LightTable document dimensions.');
        }
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture: encodedTexture },
          [width, height]
        );
      }
      const pipeline = maskChannel
        ? this.pipelines.maskDecode
        : isAdobeRgb ? this.pipelines.adobeRgbDecode : this.pipelines.decode;
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
      decoded?.close();
    }
  }

  encode(
    source: GPUTexture,
    maskChannel: boolean,
    outputWidth: number,
    outputHeight: number,
    sourceToOutput?: AffineMatrix,
    encoding: Rgba8ImageEncoding = { format: 'png' }
  ) {
    return this.withValidationScope(
      maskChannel
        ? 'LightTable mask export validation failed'
        : 'LightTable layer export validation failed',
      () => this.encodeUnchecked(
        source,
        maskChannel,
        outputWidth,
        outputHeight,
        sourceToOutput,
        false,
        encoding
      )
    );
  }

  async encodeUnchecked(
    source: GPUTexture,
    maskChannel: boolean,
    outputWidth: number,
    outputHeight: number,
    sourceToOutput?: AffineMatrix,
    sourceIsStraightSrgb = false,
    encoding: Rgba8ImageEncoding = { format: 'png' }
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
    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const inverse = sourceToOutput ? invertMatrix(sourceToOutput) : null;
    this.device.queue.writeBuffer(
      settingsBuffer,
      0,
      new Float32Array([
        maskChannel ? 1 : 0,
        inverse ? 1 : 0,
        sourceIsStraightSrgb ? 1 : 0,
        0,
        inverse?.a ?? 1,
        inverse?.c ?? 0,
        inverse?.tx ?? 0,
        0,
        inverse?.b ?? 0,
        inverse?.d ?? 1,
        inverse?.ty ?? 0,
        0,
        sourceWidth,
        sourceHeight,
        layout.width,
        layout.height
      ])
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
      return encodeRgba8Image(pixels, layout.width, layout.height, encoding);
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
