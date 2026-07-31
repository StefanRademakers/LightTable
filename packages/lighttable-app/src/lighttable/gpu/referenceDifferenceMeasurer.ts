import type { ReferenceDifferenceMetrics } from '../application/rendering/rendererTypes';
import { mapGpuBufferCopy } from './gpuReadback';

const DIFFERENCE_METRICS_BYTE_SIZE = 8 * Uint32Array.BYTES_PER_ELEMENT;
const MAXIMUM_SAMPLES = 4_000_000;

export interface ReferenceDifferenceRequest {
  sourceTexture: GPUTexture;
  reconstructedTexture: GPUTexture;
  width: number;
  height: number;
  threshold?: number;
}

/**
 * Measures reconstruction drift without owning document or renderer state.
 *
 * The caller is responsible for rendering and synchronizing the compared
 * textures before invoking this service. Keeping that lifecycle outside this
 * class makes the compute/readback operation reusable by PSD diagnostics and
 * future document verification tooling.
 */
export class ReferenceDifferenceMeasurer {
  constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline
  ) {}

  async measure(request: ReferenceDifferenceRequest): Promise<ReferenceDifferenceMetrics> {
    const threshold = Math.max(0, Math.min(1, request.threshold ?? 2 / 255));
    const stride = Math.max(
      1,
      Math.ceil(Math.sqrt((request.width * request.height) / MAXIMUM_SAMPLES))
    );
    const metricsBuffer = this.device.createBuffer({
      label: 'LightTable reference difference metrics',
      size: DIFFERENCE_METRICS_BYTE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const uniformBuffer = this.device.createBuffer({
      label: 'LightTable reference difference settings',
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const readBuffer = this.device.createBuffer({
      label: 'LightTable reference difference readback',
      size: DIFFERENCE_METRICS_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    try {
      this.device.queue.writeBuffer(uniformBuffer, 0, new Uint32Array([
        request.width,
        request.height,
        stride,
        Math.round(threshold * 255)
      ]));
      const bindGroup = this.device.createBindGroup({
        label: 'LightTable reference difference metrics',
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: request.sourceTexture.createView() },
          { binding: 1, resource: request.reconstructedTexture.createView() },
          { binding: 2, resource: { buffer: metricsBuffer } },
          { binding: 3, resource: { buffer: uniformBuffer } }
        ]
      });
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable measure reference difference'
      });
      encoder.clearBuffer(metricsBuffer);
      const pass = encoder.beginComputePass({
        label: 'LightTable reference difference metrics'
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(request.width / stride / 8),
        Math.ceil(request.height / stride / 8)
      );
      pass.end();
      encoder.copyBufferToBuffer(
        metricsBuffer,
        0,
        readBuffer,
        0,
        DIFFERENCE_METRICS_BYTE_SIZE
      );
      this.device.queue.submit([encoder.finish()]);

      const values = new Uint32Array(await mapGpuBufferCopy(readBuffer));
      const sampledPixels = values[0] ?? 0;
      const differingPixels = values[1] ?? 0;
      if (sampledPixels === 0) {
        throw new Error('LightTable reference comparison produced no samples.');
      }
      return {
        sampledPixels,
        differingPixels,
        differingPixelPercentage: differingPixels / sampledPixels * 100,
        meanAbsoluteRgbError: (values[2] ?? 0) / (sampledPixels * 3 * 255),
        maximumChannelError: (values[3] ?? 0) / 255,
        meanAbsoluteAlphaError: (values[4] ?? 0) / (sampledPixels * 255),
        maximumAlphaError: (values[5] ?? 0) / 255,
        threshold,
        stride
      };
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      uniformBuffer.destroy();
      metricsBuffer.destroy();
    }
  }
}
