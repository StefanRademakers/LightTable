import { describe, expect, it } from 'vitest';
import { trianglesFromUndirectedEdges, validateDeformationSurface } from './deformationSurface';

describe('DeformationSurface', () => {
  it('derives each triangle once from an undirected topology', () => {
    expect(trianglesFromUndirectedEdges(4, [
      [0, 1], [1, 2], [2, 0], [1, 3], [3, 2]
    ])).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it('rejects mismatched target geometry', () => {
    expect(() => validateDeformationSurface({
      source: [{ x: 0, y: 0 }], target: [], indices: [], geometryRevision: 0
    })).toThrow(/matching source and target/);
  });
});
