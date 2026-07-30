import { describe, expect, it, vi } from 'vitest';
import { DocumentRendererLifecycle } from './documentRendererLifecycle';

describe('DocumentRendererLifecycle', () => {
  it('guards asynchronous starts with a monotonic generation', () => {
    const lifecycle = new DocumentRendererLifecycle();
    const first = lifecycle.beginStart();
    const second = lifecycle.beginStart();

    expect(second).toBe(first + 1);
    expect(lifecycle.markReady(first)).toBe(false);
    expect(lifecycle.markReady(second)).toBe(true);
    expect(lifecycle.getSnapshot().status).toBe('ready');
  });

  it('preserves a ready renderer while switching active documents', () => {
    const lifecycle = new DocumentRendererLifecycle();
    const generation = lifecycle.beginStart();
    lifecycle.setActive(false);
    lifecycle.markReady(generation);

    expect(lifecycle.getSnapshot()).toMatchObject({
      status: 'suspended',
      active: false,
      generation
    });

    lifecycle.setActive(true);
    expect(lifecycle.getSnapshot().status).toBe('ready');
  });

  it('ignores memory updates from stale renderer generations', () => {
    const lifecycle = new DocumentRendererLifecycle();
    const first = lifecycle.beginStart();
    const second = lifecycle.beginStart();

    expect(lifecycle.setMemoryEstimate(10_000, first)).toBe(false);
    expect(lifecycle.setMemoryEstimate(20_000, second)).toBe(true);
    expect(lifecycle.getSnapshot().estimatedGpuBytes).toBe(20_000);
  });

  it('publishes failure and terminal disposal without retaining memory', () => {
    const lifecycle = new DocumentRendererLifecycle();
    const listener = vi.fn();
    lifecycle.subscribe(listener);
    const generation = lifecycle.beginStart();
    lifecycle.setMemoryEstimate(8_192, generation);
    lifecycle.markFailed(generation, 'Device lost');

    expect(lifecycle.getSnapshot()).toMatchObject({
      status: 'failed',
      error: 'Device lost',
      estimatedGpuBytes: 0
    });

    lifecycle.dispose();
    expect(lifecycle.getSnapshot().status).toBe('disposed');
    expect(listener).toHaveBeenCalled();
    expect(() => lifecycle.beginStart()).toThrow(/disposed/i);
  });
});
