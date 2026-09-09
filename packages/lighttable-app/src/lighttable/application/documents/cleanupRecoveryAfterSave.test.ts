import { describe, expect, it, vi } from 'vitest';
import { cleanupRecoveryAfterSave } from './cleanupRecoveryAfterSave';

describe('cleanupRecoveryAfterSave', () => {
  it('removes recovery through every committed revision, including a stale save', async () => {
    const cleanup = vi.fn();
    await expect(cleanupRecoveryAfterSave({
      status: 'committed', revision: 9, markedClean: false
    }, cleanup)).resolves.toBeNull();
    expect(cleanup).toHaveBeenCalledWith(9);
  });

  it('does not remove recovery for canceled or failed writes', async () => {
    const cleanup = vi.fn();
    await cleanupRecoveryAfterSave({ status: 'canceled', revision: 4, markedClean: false }, cleanup);
    await cleanupRecoveryAfterSave({
      status: 'failed', revision: 5, markedClean: false, phase: 'write', message: 'disk full'
    }, cleanup);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('reports cleanup failure without changing the committed save outcome', async () => {
    const error = await cleanupRecoveryAfterSave(
      { status: 'committed', revision: 3, markedClean: true },
      () => Promise.reject(new Error('store unavailable'))
    );
    expect(error?.message).toBe('store unavailable');
  });
});
