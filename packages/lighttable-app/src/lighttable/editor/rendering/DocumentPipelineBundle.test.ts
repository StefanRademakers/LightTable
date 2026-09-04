import { describe, expect, it, vi } from 'vitest';
import { documentPipelinesFor } from './DocumentPipelineBundle';

const device = () => ({
  createShaderModule: vi.fn(() => ({})),
  createRenderPipeline: vi.fn(() => ({}))
}) as unknown as GPUDevice;

describe('documentPipelinesFor', () => {
  it('builds the baseline pipelines once per GPU device', () => {
    const gpu = device();
    const first = documentPipelinesFor(gpu);
    const second = documentPipelinesFor(gpu);

    expect(second).toBe(first);
    expect(gpu.createRenderPipeline).toHaveBeenCalledTimes(3);
    expect(gpu.createShaderModule).toHaveBeenCalledTimes(4);

    void first.adobeRgbDecode;
    void first.maskDecode;
    void first.exportLayer;
    void first.styleShape;
    void second.styleShape;
    expect(gpu.createRenderPipeline).toHaveBeenCalledTimes(7);
    expect(gpu.createShaderModule).toHaveBeenCalledTimes(8);
  });

  it('keeps device pipeline caches isolated', () => {
    expect(documentPipelinesFor(device())).not.toBe(documentPipelinesFor(device()));
  });
});
