import { describe, expect, it, vi } from 'vitest';
import { runGpuDeviceErrorScopeTransaction } from './gpuDeviceErrorScopeTransaction';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
};

describe('runGpuDeviceErrorScopeTransaction', () => {
  it('serializes complete scope stacks on one shared device', async () => {
    const events: string[] = [];
    const gate = deferred();
    const device = {
      pushErrorScope: vi.fn((filter: GPUErrorFilter) => { events.push(`push:${filter}`); }),
      popErrorScope: vi.fn(async () => { events.push('pop'); return null; })
    } as unknown as GPUDevice;

    const first = runGpuDeviceErrorScopeTransaction(
      device, ['out-of-memory', 'validation'], async () => {
        events.push('first:start');
        await gate.promise;
        events.push('first:end');
      }
    );
    const second = runGpuDeviceErrorScopeTransaction(
      device, ['validation'], () => { events.push('second'); }
    );
    await Promise.resolve();
    expect(events).not.toContain('second');
    gate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'push:out-of-memory', 'push:validation', 'first:start', 'first:end',
      'pop', 'pop', 'push:validation', 'second', 'pop'
    ]);
  });

  it('unwinds every scope and rejects when a pop fails', async () => {
    const device = {
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn()
        .mockRejectedValueOnce(new Error('device lost while popping'))
        .mockResolvedValueOnce(null)
    } as unknown as GPUDevice;

    await expect(runGpuDeviceErrorScopeTransaction(
      device, ['out-of-memory', 'validation'], () => undefined
    )).rejects.toThrow('WebGPU error-scope cleanup failed');
    expect(device.popErrorScope).toHaveBeenCalledTimes(2);
  });

  it('unwinds scopes already pushed when a later push fails', async () => {
    const operation = vi.fn();
    const device = {
      pushErrorScope: vi.fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => { throw new Error('device already lost'); }),
      popErrorScope: vi.fn(async () => null)
    } as unknown as GPUDevice;

    await expect(runGpuDeviceErrorScopeTransaction(
      device, ['out-of-memory', 'validation'], operation
    )).rejects.toThrow('device already lost');
    expect(operation).not.toHaveBeenCalled();
    expect(device.popErrorScope).toHaveBeenCalledOnce();
  });
});
