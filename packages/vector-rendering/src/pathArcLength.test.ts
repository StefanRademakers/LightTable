import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  identityAffineMatrix
} from '@lighttable/vector-core';
import {
  PathArcLengthCache,
  realizePathArcLength,
  resolvePathTextRange,
  samplePathArcLength
} from './pathArcLength';

const line = (closed = false) => createVectorPath('path', 'Path', [createSubpath('contour', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 10, y: 0 }),
  ...(closed ? [createAnchor('c', { x: 10, y: 10 })] : [])
], closed)]);

describe('path arc-length realization', () => {
  it('measures in document space without viewport state', () => {
    const path = line();
    path.transform = { a: 2, b: 0, c: 0, d: 1, tx: 5, ty: 7 };
    path.transformRevision = 2;
    const table = realizePathArcLength(
      path,
      'contour',
      { a: 1, b: 0, c: 0, d: 3, tx: 11, ty: 13 },
      0.25
    );
    expect(table.length).toBe(20);
    expect([...table.points]).toEqual([16, 34, 36, 34]);
    expect(table.key).toContain('path:contour:0:2:0.25');
  });

  it('samples forward and reverse traversal with stable unit tangents', () => {
    const table = realizePathArcLength(line(), 'contour', identityAffineMatrix(), 0.25);
    expect(samplePathArcLength(table, 2)).toMatchObject({
      point: { x: 2, y: 0 }, tangent: { x: 1, y: 0 }, distance: 2
    });
    expect(samplePathArcLength(table, 2, 'reverse')).toMatchObject({
      point: { x: 8, y: 0 }, tangent: { x: -1, y: 0 }, distance: 2
    });
    expect(samplePathArcLength(table, 99).point).toEqual({ x: 10, y: 0 });
  });

  it('includes and wraps the closing edge', () => {
    const table = realizePathArcLength(line(true), 'contour', identityAffineMatrix(), 0.25);
    expect(table.length).toBeCloseTo(20 + Math.sqrt(200));
    expect(samplePathArcLength(table, table.length + 5).point).toEqual({ x: 5, y: 0 });
    expect(samplePathArcLength(table, -5).distance).toBeCloseTo(table.length - 5);
  });

  it('flattens cubic geometry at the requested stable tolerance', () => {
    const path = createVectorPath('curve', 'Curve', [createSubpath('arc', [
      createAnchor('a', { x: 0, y: 0 }, { handleOut: { x: 0, y: 10 } }),
      createAnchor('b', { x: 10, y: 10 }, { handleIn: { x: 10, y: 0 } })
    ])]);
    const table = realizePathArcLength(path, 'arc', identityAffineMatrix(), 0.1);
    expect(table.length).toBeGreaterThan(Math.sqrt(200));
    expect(table.length).toBeLessThan(20);
    expect(table.points.length).toBeGreaterThan(4);
  });

  it('keeps degenerate paths finite', () => {
    const path = createVectorPath('dot', 'Dot', [createSubpath('only', [
      createAnchor('a', { x: 4, y: 6 })
    ])]);
    const table = realizePathArcLength(path, 'only', identityAffineMatrix(), 0.25);
    expect(table.length).toBe(0);
    expect(samplePathArcLength(table, 10)).toEqual({
      point: { x: 4, y: 6 }, tangent: { x: 1, y: 0 }, distance: 0
    });
  });

  it('resolves start/end offsets, alignment and overflow in traversal space', () => {
    const table = realizePathArcLength(line(), 'contour', identityAffineMatrix(), 0.25);
    expect(resolvePathTextRange(table, {
      startOffset: 1, endOffset: 9, contentAdvance: 4, alignment: 'center', direction: 'reverse'
    })).toEqual({ start: 1, end: 9, origin: 3, available: 8, overflow: 0, direction: 'reverse' });
    expect(resolvePathTextRange(table, {
      startOffset: 2, endOffset: 5, contentAdvance: 8, alignment: 'end'
    }).overflow).toBe(5);
  });

  it('shares entries and evicts metrics within an explicit byte budget', () => {
    const path = line();
    const first = realizePathArcLength(path, 'contour', identityAffineMatrix(), 0.25);
    const cache = new PathArcLengthCache(first.estimatedBytes);
    const cached = cache.realize(path, 'contour', identityAffineMatrix(), 0.25);
    expect(cache.realize(path, 'contour', identityAffineMatrix(), 0.26)).toBe(cached);
    path.geometryRevision += 1;
    cache.realize(path, 'contour', identityAffineMatrix(), 0.25);
    expect(cache.metrics()).toMatchObject({ entries: 1, hits: 1, misses: 2, evictions: 1 });
    cache.clear();
    expect(cache.metrics().bytes).toBe(0);
  });
});
