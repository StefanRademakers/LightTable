import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createVectorPath,
  createSubpath
} from '@lighttable/vector-core';
import { quantizeDocumentTolerance, realizeVectorPath } from './realizePath';

describe('vector path realization', () => {
  it('uses stable document-space tolerance buckets', () => {
    expect(quantizeDocumentTolerance(0.25)).toBe(0.25);
    expect(quantizeDocumentTolerance(0.26)).toBe(0.25);
    expect(() => quantizeDocumentTolerance(0)).toThrow(RangeError);
  });

  it('realizes immutable local geometry independently of path transforms', () => {
    const path = createVectorPath('path', 'Path', [createSubpath('shape', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 10, y: 0 }),
      createAnchor('c', { x: 10, y: 10 }),
      createAnchor('d', { x: 0, y: 10 })
    ], true)]);
    path.transform = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 };
    const realized = realizeVectorPath(path, 0.25);
    expect(realized.localBounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(realized.key).toEqual({ pathId: 'path', geometryRevision: 0, toleranceBucket: 0.25 });
    expect(realized.subpaths[0].points.length).toBeGreaterThanOrEqual(4);
  });
});
