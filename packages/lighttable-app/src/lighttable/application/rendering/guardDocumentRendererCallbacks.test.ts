import { describe, expect, it, vi } from 'vitest';
import { guardDocumentRendererCallbacks } from './guardDocumentRendererCallbacks';

describe('guardDocumentRendererCallbacks', () => {
  it('forwards callbacks only while their document generation is current', () => {
    let current = true;
    const onGpuMemoryEstimate = vi.fn();
    const onRendererError = vi.fn();
    const onDeviceLost = vi.fn();
    const onFirstFrame = vi.fn();
    const guarded = guardDocumentRendererCallbacks(
      () => current,
      { onGpuMemoryEstimate, onRendererError, onDeviceLost, onFirstFrame }
    );

    guarded.onGpuMemoryEstimate?.(128);
    guarded.onFirstFrame?.();
    current = false;
    guarded.onGpuMemoryEstimate?.(256);
    guarded.onRendererError?.('stale renderer');
    guarded.onDeviceLost?.('stale device');
    guarded.onFirstFrame?.();

    expect(onGpuMemoryEstimate).toHaveBeenCalledOnce();
    expect(onGpuMemoryEstimate).toHaveBeenCalledWith(128);
    expect(onDeviceLost).not.toHaveBeenCalled();
    expect(onRendererError).not.toHaveBeenCalled();
    expect(onFirstFrame).toHaveBeenCalledOnce();
  });
});
