import type { RgbHistogram } from '../types';
import type { LightTableImageMetadata } from '../types';
import { mapGpuBufferCopy } from './gpuReadback';
import { InteractiveRefreshGate } from '../application/rendering/interactiveRefreshGate';

const HISTOGRAM_BYTE_SIZE = 768 * Uint32Array.BYTES_PER_ELEMENT;

/**
 * Owns the document histogram's GPU resources and asynchronous readback.
 *
 * The frame coordinator decides when a histogram is dirty. This runtime only
 * encodes one requested sample at a time and reports the completed bins.
 */
export class DocumentHistogramRuntime {
  private readonly uniformBuffer: GPUBuffer;
  private histogramBuffer: GPUBuffer | null = null;
  private originalBindGroup: GPUBindGroup | null = null;
  private correctedBindGroup: GPUBindGroup | null = null;
  private metadata: LightTableImageMetadata | null = null;
  private pending = false;
  private retryAfterPending = false;
  private visible = true;
  private interactionActive = false;
  private destroyed = false;
  private readonly interactiveRefresh = new InteractiveRefreshGate(100);

  constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    private readonly onHistogram: ((histogram: RgbHistogram) => void) | undefined,
    private readonly requestRender: () => void
  ) {
    this.uniformBuffer = device.createBuffer({
      label: 'LightTable histogram settings',
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  configure(
    sourceTexture: GPUTexture,
    correctedTexture: GPUTexture,
    metadata: LightTableImageMetadata
  ): void {
    this.histogramBuffer?.destroy();
    this.metadata = metadata;
    this.histogramBuffer = this.device.createBuffer({
      label: 'LightTable histogram bins',
      size: HISTOGRAM_BYTE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    this.originalBindGroup = this.createBindGroup(sourceTexture);
    this.correctedBindGroup = this.createBindGroup(correctedTexture);
  }

  clear(): void {
    this.metadata = null;
    this.originalBindGroup = null;
    this.correctedBindGroup = null;
    this.histogramBuffer?.destroy();
    this.histogramBuffer = null;
  }

  setVisible(visible: boolean): boolean {
    const becameVisible = visible && !this.visible;
    this.visible = visible;
    return becameVisible;
  }

  /**
   * Histogram readback is an observer, not part of direct image feedback.
   * While a gesture is active it may sample periodically, but it must not
   * compete with every paint dab or slider frame. Leaving the interaction
   * resets the gate so the next dirty frame is always a final sample.
   */
  setInteractionActive(active: boolean): boolean {
    if (this.interactionActive === active) return false;
    this.interactionActive = active;
    this.interactiveRefresh.setActive(active);
    return true;
  }

  encode(
    encoder: GPUCommandEncoder,
    options: { readonly before: boolean; readonly required: boolean }
  ): GPUBuffer | null {
    if (this.pending) {
      // A dirty image that arrives during readback must be sampled once the
      // mapped buffer is released. A normal readback completion must not wake
      // an otherwise idle renderer merely to discover that there is no work.
      if (this.visible && options.required) this.retryAfterPending = true;
      return null;
    }
    if (
      !this.visible
      || !options.required
      || !this.metadata
      || !this.histogramBuffer
      || !this.originalBindGroup
      || !this.correctedBindGroup
      || !this.interactiveRefresh.shouldRefresh(performance.now())
    ) {
      return null;
    }

    const { width, height } = this.metadata;
    const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 750_000)));
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Uint32Array([width, height, stride, 0])
    );
    encoder.clearBuffer(this.histogramBuffer);
    const pass = encoder.beginComputePass({ label: 'LightTable histogram' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, options.before ? this.originalBindGroup : this.correctedBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(width / stride / 8),
      Math.ceil(height / stride / 8)
    );
    pass.end();

    const readBuffer = this.device.createBuffer({
      label: 'LightTable histogram readback',
      size: HISTOGRAM_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    encoder.copyBufferToBuffer(
      this.histogramBuffer,
      0,
      readBuffer,
      0,
      HISTOGRAM_BYTE_SIZE
    );
    this.pending = true;
    return readBuffer;
  }

  async read(buffer: GPUBuffer): Promise<void> {
    try {
      const values = new Uint32Array(await mapGpuBufferCopy(buffer));
      if (!this.destroyed) {
        this.onHistogram?.({
          red: values.slice(0, 256),
          green: values.slice(256, 512),
          blue: values.slice(512, 768)
        });
      }
    } finally {
      buffer.destroy();
      this.pending = false;
      const retry = this.retryAfterPending;
      this.retryAfterPending = false;
      if (!this.destroyed && retry) this.requestRender();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.retryAfterPending = false;
    this.clear();
    this.uniformBuffer.destroy();
  }

  private createBindGroup(texture: GPUTexture): GPUBindGroup {
    if (!this.histogramBuffer) {
      throw new Error('Histogram resources must be configured before creating bind groups.');
    }
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: this.histogramBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });
  }
}
