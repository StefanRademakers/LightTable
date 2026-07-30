import { describe, expect, it, vi } from 'vitest';
import { guardDocumentRendererCallbacks } from './guardDocumentRendererCallbacks';

describe('guardDocumentRendererCallbacks', () => {
  it('forwards callbacks only while their document generation is current', () => {
    let current = true;
    const onGpuMemoryEstimate = vi.fn();
    const onDeviceLost = vi.fn();
    const onFirstFrame = vi.fn();
    const guarded = guardDocumentRendererCallbacks(
      () => current,
      { onGpuMemoryEstimate, onDeviceLost, onFirstFrame }
    );

    guarded.onGpuMemoryEstimate?.(128);
    guarded.onFirstFrame?.();
    current = false;
    guarded.onGpuMemoryEstimate?.(256);
    guarded.onDeviceLost?.('stale device');
    guarded.onFirstFrame?.();

    expect(onGpuMemoryEstimate).toHaveBeenCalledOnce();
    expect(onGpuMemoryEstimate).toHaveBeenCalledWith(128);
    expect(onDeviceLost).not.toHaveBeenCalled();
    expect(onFirstFrame).toHaveBeenCalledOnce();
  });
});
