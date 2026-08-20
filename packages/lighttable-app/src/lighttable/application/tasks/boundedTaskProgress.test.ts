import { describe, expect, it, vi } from 'vitest';
import { createBoundedTaskProgress } from './boundedTaskProgress';

describe('bounded task progress', () => {
  it('keeps hot producer updates away from task/event subscribers', () => {
    let now = 0;
    const publish = vi.fn();
    const report = createBoundedTaskProgress(publish, { minimumIntervalMs: 100, now: () => now });
    report(0, 'first');
    for (let index = 1; index <= 99; index += 1) {
      now = index;
      report(index / 100, `hot-${index}`);
    }
    now = 100;
    report(1, 'next window');
    expect(publish.mock.calls).toEqual([[0, 'first'], [1, 'next window']]);
  });
});
