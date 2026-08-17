import type { BasicAdjustments } from '../types';
import type { DocumentBitDepth, DocumentBlendProfile } from '../editor/document/documentTypes';
import { CURVE_LUT_SIZE } from '../curves';
import { ADJUSTMENT_UNIFORM_FLOATS } from './adjustmentUniform';
import { AdjustmentGpuPayloadWriter } from './AdjustmentGpuPayloadWriter';

const createUniformBuffer = (device: GPUDevice, label: string, floats: number) =>
  device.createBuffer({
    label,
    size: floats * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

/**
 * Owns the immutable sampler and small retained GPU payloads used by one
 * document renderer. These resources share one lifecycle and contain no
 * canvas, document-tree or scheduling policy.
 */
export class DocumentCoreGpuResources {
  readonly sampler: GPUSampler;
  readonly nearestSampler: GPUSampler;
  readonly adjustmentBuffer: GPUBuffer;
  readonly outputSettingsBuffer: GPUBuffer;
  readonly viewBuffer: GPUBuffer;
  readonly channelViewBuffer: GPUBuffer;
  readonly blurHorizontalBuffer: GPUBuffer;
  readonly blurVerticalBuffer: GPUBuffer;
  readonly curveTexture: GPUTexture;
  readonly identityColorLookupTexture: GPUTexture;

  private readonly adjustmentPayloadWriter: AdjustmentGpuPayloadWriter;
  private lastOutputSettings: Float32Array | null = null;
  private destroyed = false;

  constructor(private readonly device: GPUDevice) {
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
    // Presentation-only sampler for pixel inspection. Processing continues to
    // use the linear sampler above, so zooming cannot alter authored pixels.
    this.nearestSampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
    this.adjustmentBuffer = createUniformBuffer(
      device,
      'LightTable document adjustment settings',
      ADJUSTMENT_UNIFORM_FLOATS
    );
    this.outputSettingsBuffer = createUniformBuffer(
      device,
      'LightTable output transform settings',
      8
    );
    this.viewBuffer = createUniformBuffer(device, 'LightTable viewport settings', 8);
    this.channelViewBuffer = createUniformBuffer(device, 'LightTable channel view settings', 4);
    this.blurHorizontalBuffer = this.createBlurUniformBuffer(1, 0);
    this.blurVerticalBuffer = this.createBlurUniformBuffer(0, 1);
    this.curveTexture = device.createTexture({
      label: 'LightTable custom curve LUT',
      size: [CURVE_LUT_SIZE, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.identityColorLookupTexture = device.createTexture({
      label: 'LightTable identity 3D Color Lookup',
      size: [2, 2, 2],
      dimension: '3d',
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const identity = new Float32Array(2 * 2 * 2 * 4);
    let target = 0;
    for (let blue = 0; blue < 2; blue += 1) {
      for (let green = 0; green < 2; green += 1) {
        for (let red = 0; red < 2; red += 1) {
          identity.set([red, green, blue, 1], target);
          target += 4;
        }
      }
    }
    device.queue.writeTexture(
      { texture: this.identityColorLookupTexture },
      identity,
      { bytesPerRow: 2 * 4 * Float32Array.BYTES_PER_ELEMENT, rowsPerImage: 2 },
      { width: 2, height: 2, depthOrArrayLayers: 2 }
    );
    this.adjustmentPayloadWriter = new AdjustmentGpuPayloadWriter(device, {
      uniformBuffer: this.adjustmentBuffer,
      curveTexture: this.curveTexture
    });
  }

  syncAdjustments(
    adjustments: BasicAdjustments,
    width: number,
    height: number,
    inputIsLinearComposite: boolean,
    photoshopBlendProfile: DocumentBlendProfile = 'srgb',
    documentBitDepth: DocumentBitDepth = 16
  ) {
    return this.adjustmentPayloadWriter.sync(
      adjustments,
      width,
      height,
      inputIsLinearComposite,
      null,
      photoshopBlendProfile,
      documentBitDepth
    );
  }

  writeViewport(uniforms: Float32Array<ArrayBuffer>) {
    this.device.queue.writeBuffer(this.viewBuffer, 0, uniforms);
  }

  writeOutputSettings(next: Float32Array<ArrayBuffer>): boolean {
    if (
      this.lastOutputSettings
      && this.lastOutputSettings.length === next.length
      && next.every((value, index) => value === this.lastOutputSettings?.[index])
    ) return false;
    this.lastOutputSettings = next;
    this.device.queue.writeBuffer(this.outputSettingsBuffer, 0, next);
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.adjustmentBuffer.destroy();
    this.outputSettingsBuffer.destroy();
    this.viewBuffer.destroy();
    this.channelViewBuffer.destroy();
    this.blurHorizontalBuffer.destroy();
    this.blurVerticalBuffer.destroy();
    this.curveTexture.destroy();
    this.identityColorLookupTexture.destroy();
    this.lastOutputSettings = null;
  }

  private createBlurUniformBuffer(x: number, y: number) {
    const buffer = createUniformBuffer(this.device, 'LightTable blur direction', 4);
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([x, y, 0, 0]));
    return buffer;
  }
}
