import { describe, expect, it, vi } from 'vitest';
import { OptionalGpuFeature } from './optionalGpuFeature';

describe('OptionalGpuFeature', () => {
  it('coalesces compilation and publishes only the completed resource', async () => {
    let resolve!: (value: { pipeline: string }) => void;
    const compile = vi.fn(() => new Promise<{ pipeline: string }>((done) => { resolve = done; }));
    const onReady = vi.fn();
    const feature = new OptionalGpuFeature({ id: 'test', compile, onReady });

    const first = feature.ensure();
    const second = feature.ensure();
    expect(compile).toHaveBeenCalledTimes(1);
    expect(feature.status).toBe('compiling');
    expect(feature.resource).toBeNull();

    resolve({ pipeline: 'valid' });
    await expect(first).resolves.toEqual({ pipeline: 'valid' });
    await expect(second).resolves.toEqual({ pipeline: 'valid' });
    expect(feature.status).toBe('ready');
    expect(feature.resource).toEqual({ pipeline: 'valid' });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('contains a compilation failure and retries only when explicitly requested', async () => {
    const compile = vi.fn()
      .mockRejectedValueOnce(new Error('invalid WGSL'))
      .mockResolvedValueOnce({ pipeline: 'fixed' });
    const onError = vi.fn();
    const feature = new OptionalGpuFeature({ id: 'grain', compile, onError });

    await expect(feature.ensure()).resolves.toBeNull();
    expect(feature.status).toBe('failed');
    expect(feature.failure).toContain('invalid WGSL');
    expect(onError).toHaveBeenCalledOnce();
    await feature.ensure();
    expect(compile).toHaveBeenCalledTimes(1);

    await expect(feature.retry()).resolves.toEqual({ pipeline: 'fixed' });
    expect(feature.status).toBe('ready');
  });

  it('does not publish late resources after disposal', async () => {
    let resolve!: (value: string) => void;
    const onReady = vi.fn();
    const feature = new OptionalGpuFeature({
      id: 'late',
      compile: () => new Promise<string>((done) => { resolve = done; }),
      onReady
    });

    const pending = feature.ensure();
    feature.dispose();
    resolve('pipeline');
    await expect(pending).resolves.toBeNull();
    expect(feature.status).toBe('disposed');
    expect(feature.resource).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
  });
});
