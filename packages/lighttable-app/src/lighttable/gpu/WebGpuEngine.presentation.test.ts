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

  it('re-arms first-frame ownership when suspend retires an in-flight completion', () => {
    const staleWaiter = { generation: 4, resolve: vi.fn() };
    const engine = {
      active: true,
      destroyed: false,
      presentationGeneration: 4,
      presentationWaiters: new Set([staleWaiter]),
      firstFramePending: false,
      firstFrameCompletionGeneration: 4,
      renderScheduler: { setPaused: vi.fn() },
      selectionAntsAnimator: { setActive: vi.fn() },
      documentRenderer: { setActive: vi.fn() }
    } as unknown as WebGpuEngine;

    WebGpuEngine.prototype.setActive.call(engine, false);

    expect((engine as unknown as { presentationGeneration: number })
      .presentationGeneration).toBe(5);
    expect((engine as unknown as { firstFramePending: boolean })
      .firstFramePending).toBe(true);
    expect((engine as unknown as { firstFrameCompletionGeneration: number | null })
      .firstFrameCompletionGeneration).toBeNull();
    expect(staleWaiter.resolve).toHaveBeenCalledOnce();
    expect((engine as unknown as { presentationWaiters: Set<unknown> })
      .presentationWaiters.size).toBe(0);
  });
});
