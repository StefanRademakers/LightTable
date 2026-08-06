import { describe, expect, it } from 'vitest';
import { BoundedLruCache } from './boundedLruCache';

describe('BoundedLruCache', () => {
  it('evicts the least recently used thumbnail at the hard limit', () => {
    const cache = new BoundedLruCache<string>(2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C');
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('invalidates an entry without disturbing the rest', () => {
    const cache = new BoundedLruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });
});
