import { describe, expect, it, vi } from 'vitest';
import { LayerStylePipelineProvider } from './LayerStylePipelineProvider';

const gpu = () => {
  const pipeline = {} as GPURenderPipeline;
  const module = {
    getCompilationInfo: vi.fn(async () => ({
      messages: [
        { type: 'warning', message: 'warning' },
        { type: 'error', message: 'invalid sample', lineNum: 12, linePos: 4 }
      ]
    }))
  } as unknown as GPUShaderModule;
  const device = {
    createShaderModule: vi.fn(() => module),
    createRenderPipelineAsync: vi.fn(async () => pipeline)
  } as unknown as GPUDevice;
  return { device, module, pipeline };
};

describe('LayerStylePipelineProvider', () => {
  it('shares one optional pipeline compile per device', async () => {
    const { device, pipeline } = gpu();
    const fullscreen = {} as GPUShaderModule;
    const first = new LayerStylePipelineProvider(device, fullscreen);
    const second = new LayerStylePipelineProvider(device, fullscreen);

    expect(await first.initialize()).toBe(pipeline);
    expect(await second.initialize()).toBe(pipeline);
    expect(device.createRenderPipelineAsync).toHaveBeenCalledOnce();
  });

  it('reports only labeled shader compilation errors', async () => {
    const { device } = gpu();
    const provider = new LayerStylePipelineProvider(device, {} as GPUShaderModule);
    await provider.initialize();

    expect(await provider.shaderErrors()).toEqual([':12:4 invalid sample']);
  });
});
