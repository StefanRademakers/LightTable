import { describe, expect, it } from 'vitest';
import type { RealizedVectorGeometry } from '@lighttable/vector-rendering';
import { buildStencilFanVertices } from './fanGeometry';

const geometry = (points: { x: number; y: number }[]): RealizedVectorGeometry => ({
  key: { pathId: 'p', geometryRevision: 1, toleranceBucket: 0.25 },
  localBounds: { x: 0, y: 0, width: 10, height: 10 },
  subpaths: [{ id: 's', closed: true, points }],
  estimatedBytes: points.length * 16
});

describe('buildStencilFanVertices', () => {
  it('builds n - 2 triangles and ignores a repeated closing point', () => {
    const vertices = buildStencilFanVertices(geometry([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 }
    ]));
    expect(vertices).toHaveLength(12);
    expect(Array.from(vertices)).toEqual([
      0, 0, 10, 0, 10, 10,
      0, 0, 10, 10, 0, 10
    ]);
  });

  it('does not emit incomplete contours', () => {
    expect(buildStencilFanVertices(geometry([{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toHaveLength(0);
  });
});

