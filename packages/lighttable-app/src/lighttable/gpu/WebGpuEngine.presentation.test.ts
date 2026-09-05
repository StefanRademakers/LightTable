import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

describe('WebGpuEngine presentation ownership', () => {
  it('retires waiters and histogram publication when callbacks move to a new document', async () => {
    const invalidatePendingPublication = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      callbacks: {},
      presentationGeneration: 0,
      presentationWaiters: new Set(),
      histogramRuntime: { invalidatePendingPublication },
      destroyed: false,
      requestRender
    } as unknown as WebGpuEngine;

    const stalePresentation = WebGpuEngine.prototype.waitForPresentation.call(engine);
    const callbacks = { onFirstFrame: vi.fn() };
    WebGpuEngine.prototype.updateCallbacks.call(engine, callbacks);
    await stalePresentation;

    expect(invalidatePendingPublication).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
    expect((engine as unknown as { callbacks: unknown }).callbacks).toBe(callbacks);
    expect((engine as unknown as { presentationWaiters: Set<unknown> })
      .presentationWaiters.size).toBe(0);
  });
});
