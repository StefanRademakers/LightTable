import { describe, expect, it } from 'vitest';
import { ParagraphFragmentCache } from './ParagraphFragmentCache';

describe('paragraph fragment cache', () => {
  it('reuses unchanged fragments and misses only an edited paragraph', () => {
    const cache = new ParagraphFragmentCache<{ bytes: number; value: string }>((value) => value.bytes, 100);
    const keys = ['first', 'second', 'third'];
    keys.forEach((key) => cache.set(key, { bytes: 10, value: key }));

    expect(cache.get('first')?.value).toBe('first');
    expect(cache.get('second changed')).toBeUndefined();
    expect(cache.get('third')?.value).toBe('third');
    expect(cache.metrics()).toMatchObject({ hits: 2, misses: 1, entries: 3 });
  });

  it('evicts the least recently used fragment by retained bytes', () => {
    const cache = new ParagraphFragmentCache<{ bytes: number; value: string }>((value) => value.bytes, 20);
    cache.set('first', { bytes: 10, value: 'first' });
    cache.set('second', { bytes: 10, value: 'second' });
    expect(cache.get('first')?.value).toBe('first');
    cache.set('third', { bytes: 10, value: 'third' });

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')?.value).toBe('first');
    expect(cache.metrics()).toMatchObject({ entries: 2, byteLength: 20, evictions: 1 });
  });

  it('does not retain an oversized fragment and releases all owned bytes', () => {
    const cache = new ParagraphFragmentCache<{ bytes: number }>((value) => value.bytes, 10);
    const oversized = { bytes: 11 };
    expect(cache.set('oversized', oversized)).toBe(oversized);
    expect(cache.get('oversized')).toBeUndefined();
    cache.set('kept', { bytes: 10 });
    cache.clear();
    expect(cache.metrics()).toMatchObject({ entries: 0, byteLength: 0, budgetBytes: 10 });
  });
});
