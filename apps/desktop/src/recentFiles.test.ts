import { describe, expect, it } from 'vitest';
import { normalizeRecentFiles, touchRecentFile } from './recentFiles';

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
});
