import { describe, expect, it, vi } from 'vitest';
import {
  RecoveryJournalScheduler,
  type RecoveryJournalRevision
} from './RecoveryJournalScheduler';

const revision = (
  historyStateId: number,
  dirty = true
): RecoveryJournalRevision => ({
  canonicalRevision: historyStateId,
  historyStateId,
  savedStateId: 0,
  dirty
});

describe('RecoveryJournalScheduler', () => {
  it('debounces semantic commits and checkpoints only the newest revision', async () => {
    vi.useFakeTimers();
    const checkpoint = vi.fn(async () => undefined);
    const scheduler = new RecoveryJournalScheduler({ checkpoint });
    scheduler.observe(revision(1));
    await vi.advanceTimersByTimeAsync(4_000);
    scheduler.observe(revision(2));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(checkpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith(revision(2));
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('does not perform recurring work for an unchanged document', async () => {
    vi.useFakeTimers();
    const checkpoint = vi.fn(async () => undefined);
    const scheduler = new RecoveryJournalScheduler({ checkpoint });
    scheduler.observe(revision(1));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checkpoint).toHaveBeenCalledOnce();
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('honors the maximum dirty age during continuous edits', async () => {
    vi.useFakeTimers();
    const checkpoint = vi.fn(async () => undefined);
    const scheduler = new RecoveryJournalScheduler({ checkpoint });
    scheduler.observe(revision(1));
    for (let state = 2; state <= 8; state += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      scheduler.observe(revision(state));
    }
    expect(checkpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(checkpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith(revision(8));
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('hands off only the newest edit after an in-flight checkpoint', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const checkpoint = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const scheduler = new RecoveryJournalScheduler({ checkpoint });
    scheduler.observe(revision(1));
    await vi.advanceTimersByTimeAsync(5_000);
    scheduler.observe(revision(2));
    scheduler.observe(revision(3));
    release();
    await first;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenLastCalledWith(revision(3));
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('cancels pending work when clean or disposed', async () => {
    vi.useFakeTimers();
    const checkpoint = vi.fn(async () => undefined);
    const scheduler = new RecoveryJournalScheduler({ checkpoint });
    scheduler.observe(revision(1));
    scheduler.observe(revision(1, false));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkpoint).not.toHaveBeenCalled();
    scheduler.observe(revision(2));
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkpoint).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports failure and retries only when newer work exists', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const checkpoint = vi.fn(async () => { throw new Error('quota'); });
    const scheduler = new RecoveryJournalScheduler({ checkpoint, onError });
    scheduler.observe(revision(1));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkpoint).toHaveBeenCalledOnce();
    scheduler.observe(revision(2));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    vi.useRealTimers();
  });
});
