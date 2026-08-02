import { describe, expect, it } from 'vitest';
import {
  normalizeRecentFiles,
  RecentFileOperationQueue,
  touchRecentFile
} from './recentFiles';

describe('desktop recent files', () => {
  it('keeps the four most recently opened unique files', () => {
    const result = normalizeRecentFiles([
      { id: 'one', path: 'one.png', openedAt: 1 },
      { id: 'two', path: 'two.png', openedAt: 2 },
      { id: 'three', path: 'three.png', openedAt: 3 },
      { id: 'four', path: 'four.png', openedAt: 4 },
      { id: 'five', path: 'five.png', openedAt: 5 }
    ]);

    expect(result.map((entry) => entry.id)).toEqual(['five', 'four', 'three', 'two']);
  });

  it('moves a reopened file to the front without losing the other entries', () => {
    const result = touchRecentFile([
      { id: 'three', path: 'three.png', openedAt: 3 },
      { id: 'two', path: 'two.png', openedAt: 2 },
      { id: 'one', path: 'one.png', openedAt: 1 }
    ], { id: 'one', path: 'one.png', openedAt: 4 });

    expect(result.map((entry) => entry.id)).toEqual(['one', 'three', 'two']);
    expect(result[0]?.openedAt).toBe(4);
  });

  it('repairs duplicate and unsorted persisted entries', () => {
    const result = normalizeRecentFiles([
      { id: 'same', path: 'old.png', openedAt: 1 },
      { id: 'other', path: 'other.png', openedAt: 3 },
      { id: 'same', path: 'new.png', openedAt: 2 }
    ]);

    expect(result).toEqual([
      { id: 'other', path: 'other.png', openedAt: 3 },
      { id: 'same', path: 'new.png', openedAt: 2 }
    ]);
  });

  it('serializes launcher pruning with files opened while the refresh is pending', async () => {
    const queue = new RecentFileOperationQueue();
    const order: string[] = [];
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });

    const refresh = queue.run(async () => {
      order.push('refresh:start');
      await refreshGate;
      order.push('refresh:save');
    });
    const opened = queue.run(async () => {
      order.push('open:save');
    });

    await Promise.resolve();
    expect(order).toEqual(['refresh:start']);
    releaseRefresh();
    await Promise.all([refresh, opened]);
    expect(order).toEqual(['refresh:start', 'refresh:save', 'open:save']);
  });

  it('continues serial operations after a failed manifest write', async () => {
    const queue = new RecentFileOperationQueue();
    await expect(queue.run(async () => { throw new Error('write failed'); }))
      .rejects.toThrow('write failed');
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered');
  });
});
