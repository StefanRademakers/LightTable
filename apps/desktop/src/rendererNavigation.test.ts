import { describe, expect, it, vi } from 'vitest';
import { loadRendererUrlWithRetry } from './rendererNavigation';

describe('loadRendererUrlWithRetry', () => {
  it('loads once when the renderer origin is ready', async () => {
    const target = { loadURL: vi.fn().mockResolvedValue(undefined) };
    await expect(loadRendererUrlWithRetry(target, 'http://127.0.0.1:1234/')).resolves.toBe('loaded');
    expect(target.loadURL).toHaveBeenCalledTimes(1);
  });

  it('recovers from bounded transient localhost navigation failures', async () => {
    const transient = new Error('ERR_CONNECTION_REFUSED (-102)');
    const target = {
      loadURL: vi.fn()
        .mockRejectedValueOnce(transient)
        .mockRejectedValueOnce(transient)
        .mockResolvedValue(undefined)
    };
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    await expect(loadRendererUrlWithRetry(target, 'http://127.0.0.1:1234/', {
      wait, onRetry
    })).resolves.toBe('loaded');
    expect(wait.mock.calls).toEqual([[75], [150]]);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(target.loadURL).toHaveBeenCalledTimes(3);
  });

  it('does not fight a navigation that another owner superseded', async () => {
    const target = { loadURL: vi.fn().mockRejectedValue(new Error('ERR_ABORTED (-3)')) };
    await expect(loadRendererUrlWithRetry(target, 'http://127.0.0.1:1234/'))
      .resolves.toBe('superseded');
    expect(target.loadURL).toHaveBeenCalledTimes(1);
  });

  it('preserves a persistent failure after the bounded attempts', async () => {
    const failure = new Error('ERR_CONNECTION_REFUSED (-102)');
    const target = { loadURL: vi.fn().mockRejectedValue(failure) };
    await expect(loadRendererUrlWithRetry(target, 'http://127.0.0.1:1234/', {
      attempts: 3,
      wait: async () => {}
    })).rejects.toBe(failure);
    expect(target.loadURL).toHaveBeenCalledTimes(3);
  });
});
