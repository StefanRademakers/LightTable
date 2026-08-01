import { describe, expect, it, vi } from 'vitest';
import { RevisionedResourceCache, disposableResourceCache } from './RevisionedResourceCache';

describe('RevisionedResourceCache', () => {
  it('evicts the least recently used resource within a byte budget', () => {
    const cache = new RevisionedResourceCache<string>(10);
    cache.set('a', 'A', 4);
    cache.set('b', 'B', 4);
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
    expect(cache.metrics()).toMatchObject({ entries: 2, bytes: 8, evictions: 1 });
  });

  it('disposes replaced, evicted and cleared backend resources exactly once', () => {
    const disposed: string[] = [];
    const resource = (id: string) => ({ id, dispose: vi.fn(() => disposed.push(id)) });
    const cache = disposableResourceCache<ReturnType<typeof resource>>(5);
    const first = resource('first');
    const second = resource('second');
    const third = resource('third');
    cache.set('same', first, 3);
    cache.set('same', second, 3);
    cache.set('third', third, 3);
    cache.clear();
    expect(disposed).toEqual(['first', 'second', 'third']);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(third.dispose).toHaveBeenCalledTimes(1);
  });
});
