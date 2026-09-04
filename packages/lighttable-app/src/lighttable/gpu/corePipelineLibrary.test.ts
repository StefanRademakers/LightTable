import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getCorePipelineBundle } from './corePipelineLibrary';

beforeAll(() => {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
});

const createDevice = () => {
  let identifier = 0;
  const next = (kind: string) => ({ kind, identifier: identifier += 1 });
  return {
    createShaderModule: vi.fn(() => next('shader')),
    createRenderPipeline: vi.fn(() => next('render-pipeline')),
    createComputePipeline: vi.fn(() => next('compute-pipeline')),
    createBindGroupLayout: vi.fn(() => next('bind-group-layout')),
    createPipelineLayout: vi.fn(() => next('pipeline-layout'))
  } as unknown as GPUDevice;
};

describe('getCorePipelineBundle', () => {
  it('reuses immutable pipelines for one device and canvas format', () => {
    const device = createDevice();

    const first = getCorePipelineBundle(device, 'bgra8unorm');
    const second = getCorePipelineBundle(device, 'bgra8unorm');

    expect(second).toBe(first);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(15);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);

    void first.precisionSourceResolve;
    void first.differenceMetrics;
    void second.precisionSourceResolve;
    void second.differenceMetrics;
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(16);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
  });

  it('separates presentation-format-specific bundles', () => {
    const device = createDevice();

    const bgra = getCorePipelineBundle(device, 'bgra8unorm');
    const rgba = getCorePipelineBundle(device, 'rgba8unorm');

    expect(rgba).not.toBe(bgra);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(32);
  });

  it('never shares GPU resources across devices', () => {
    const firstDevice = createDevice();
    const secondDevice = createDevice();

    const first = getCorePipelineBundle(firstDevice, 'bgra8unorm');
    const second = getCorePipelineBundle(secondDevice, 'bgra8unorm');

    expect(second).not.toBe(first);
    expect(firstDevice.createRenderPipeline).toHaveBeenCalledTimes(16);
    expect(secondDevice.createRenderPipeline).toHaveBeenCalledTimes(16);
  });
});
