import { describe, expect, it, vi } from 'vitest';
import { toolPipelinesFor } from './ToolPipelineBundle';

describe('toolPipelinesFor', () => {
  it('compiles optional tool pipelines once per shared GPU device', () => {
    let pipelineId = 0;
    const createShaderModule = vi.fn(() => ({}));
    const createRenderPipeline = vi.fn(() => ({ id: ++pipelineId }));
    const device = {
      createShaderModule,
      createRenderPipeline
    } as unknown as GPUDevice;

    const first = toolPipelinesFor(device);
    const second = toolPipelinesFor(device);

    expect(second).toBe(first);
    expect(createRenderPipeline).toHaveBeenCalledTimes(14);
    expect(Object.keys(first)).toHaveLength(14);
  });

  it('does not share pipelines across GPU devices', () => {
    const device = () => ({
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({}))
    }) as unknown as GPUDevice;

    expect(toolPipelinesFor(device())).not.toBe(toolPipelinesFor(device()));
  });
});
