import { describe, expect, it } from 'vitest';
import { faceWarpTopology } from './faceWarpTopology';

describe('faceWarpTopology', () => {
  it('derives deterministic weighted adjacency, boundaries and symmetry', () => {
    const mesh = [
      { x: -1, y: 0 }, { x: 1, y: 0 },
      { x: -1, y: 1 }, { x: 1, y: 1 }
    ];
    const first = faceWarpTopology(mesh, [0, 1, 2, 1, 3, 2]);
    const second = faceWarpTopology(mesh, [0, 1, 2, 1, 3, 2]);

    expect(second).toBe(first);
    expect(first.adjacency[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ vertex: 1 }),
      expect.objectContaining({ vertex: 2 })
    ]));
    first.laplacianWeights.forEach((neighbors) => {
      expect(neighbors.reduce((sum, { weight }) => sum + weight, 0)).toBeCloseTo(1);
      neighbors.forEach(({ weight }) => expect(weight).toBeGreaterThan(0));
    });
    expect(second.laplacianWeights).toBe(first.laplacianWeights);
    expect([...first.boundaryVertices]).toEqual([0, 1, 2, 3]);
    expect(first.symmetry).toEqual([1, 0, 3, 2]);
  });

  it('does not reuse face-specific edge lengths for a differently scaled face', () => {
    const small = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    const large = small.map(({ x, y }) => ({ x: x * 10, y: y * 10 }));
    const indices = [0, 1, 2];
    const smallTopology = faceWarpTopology(small, indices);
    const largeTopology = faceWarpTopology(large, indices);
    expect(largeTopology).not.toBe(smallTopology);
    expect(largeTopology.adjacency[0]![0]!.length)
      .toBeCloseTo(smallTopology.adjacency[0]![0]!.length * 10);
  });
});
