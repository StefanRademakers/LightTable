import { describe, expect, it, vi } from 'vitest';
import { brushPipelinesFor, toolPipelinesFor } from './ToolPipelineBundle';

describe('toolPipelinesFor', () => {
  it('can compile the gesture-critical brush subset without compiling other tools', () => {
    const createRenderPipeline = vi.fn(() => ({}));
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline
    } as unknown as GPUDevice;

    const first = brushPipelinesFor(device);
    const second = brushPipelinesFor(device);

    expect(second).toBe(first);
    expect(Object.keys(first)).toHaveLength(7);
    expect(createRenderPipeline).toHaveBeenCalledTimes(7);
  });

  it('compiles optional tool pipelines once per shared GPU device', () => {
    let pipelineId = 0;
    const createShaderModule = vi.fn(() => ({}));
    const createRenderPipeline = vi.fn(() => ({ id: ++pipelineId }));
    const createComputePipeline = vi.fn(() => ({ id: ++pipelineId }));
    const device = {
      createShaderModule,
      createRenderPipeline,
      createComputePipeline
    } as unknown as GPUDevice;

    const first = toolPipelinesFor(device);
    const second = toolPipelinesFor(device);

    expect(second).toBe(first);
    expect(createRenderPipeline).toHaveBeenCalledTimes(26);
    expect(createComputePipeline).toHaveBeenCalledTimes(4);
    expect(Object.keys(first)).toHaveLength(30);
    const calls = createRenderPipeline.mock.calls as unknown as [GPURenderPipelineDescriptor][];
    const descriptor = (label: string) => calls
      .map(([value]) => value)
      .find((value) => value.label === label)!;
    const blend = (label: string) => Array.from(descriptor(label).fragment?.targets ?? [])[0]?.blend;
    expect(blend('LightTable round brush with transparency lock')).toEqual({
        color: {
          srcFactor: 'dst-alpha',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add'
        },
        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
      });
    expect(blend('LightTable round eraser with transparency lock')).toEqual({
        color: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
      });
    expect(blend('LightTable blur brush')?.alpha).toEqual({
      srcFactor: 'zero', dstFactor: 'one', operation: 'add'
    });
  });

  it('does not share pipelines across GPU devices', () => {
    const device = () => ({
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({}))
    }) as unknown as GPUDevice;

    expect(toolPipelinesFor(device())).not.toBe(toolPipelinesFor(device()));
  });
});
