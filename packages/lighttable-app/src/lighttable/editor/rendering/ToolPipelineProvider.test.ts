import { describe, expect, it, vi } from 'vitest';
import type { ToolPipelineBundle } from './ToolPipelineBundle';
import { ToolPipelineProvider } from './ToolPipelineProvider';

describe('ToolPipelineProvider', () => {
  it('does not compile optional authoring pipelines until first use', () => {
    const bundle = { brush: {} } as ToolPipelineBundle;
    const compile = vi.fn(() => bundle);
    const device = {} as GPUDevice;
    const provider = new ToolPipelineProvider(device, compile);

    expect(provider.isInitialized()).toBe(false);
    expect(compile).not.toHaveBeenCalled();
    expect(provider.get()).toBe(bundle);
    expect(provider.get()).toBe(bundle);
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(device);
  });
});
