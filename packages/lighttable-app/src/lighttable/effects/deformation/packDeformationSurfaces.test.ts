import { describe, expect, it } from 'vitest';
import type { DeformationSurface } from './deformationSurface';
import { packDeformationSurfaces } from './packDeformationSurfaces';

describe('packDeformationSurfaces', () => {
  it('packs an irregular indexed face topology without changing its triangles', () => {
    const irregular: DeformationSurface = {
      source: [
        { x: 4, y: 1 }, { x: 1, y: 5 }, { x: 5, y: 4 },
        { x: 9, y: 5 }, { x: 7, y: 1 }
      ],
      target: [
        { x: 4, y: 1 }, { x: 0, y: 6 }, { x: 5, y: 5, z: 0.2 },
        { x: 10, y: 6 }, { x: 7, y: 1 }
      ],
      indices: [0, 1, 2, 0, 2, 4, 2, 3, 4],
      geometryRevision: 1
    };
    const packed = packDeformationSurfaces([irregular]);
    expect(packed.isIdentity).toBe(false);
    expect([...packed.indices]).toEqual(irregular.indices);
    expect([...packed.sourcePositions]).toEqual(irregular.source.flatMap(({ x, y }) => [x, y]));
    expect(packed.targetPositions[2]).toBe(0.5);
    expect(packed.targetPositions[8]).toBeCloseTo(0.2);
  });

  it('packs a rectangular patch and offsets a following surface', () => {
    const patch: DeformationSurface = {
      source: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }],
      target: [{ x: 0, y: 0 }, { x: 11, y: 0 }, { x: 0, y: 10 }, { x: 9, y: 10 }],
      indices: [0, 1, 2, 1, 3, 2], geometryRevision: 2
    };
    const second: DeformationSurface = {
      source: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }],
      target: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }],
      indices: [0, 1, 2], geometryRevision: 3
    };
    expect([...packDeformationSurfaces([patch, second]).indices])
      .toEqual([0, 1, 2, 1, 3, 2, 4, 5, 6]);
  });

  it('identifies an exact no-op surface without treating depth as image deformation', () => {
    const identity: DeformationSurface = {
      source: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 8 }],
      target: [{ x: 0, y: 0, z: 0.1 }, { x: 12, y: 0, z: 0.4 }, { x: 0, y: 8, z: 0.8 }],
      indices: [0, 1, 2], geometryRevision: 1
    };
    expect(packDeformationSurfaces([identity]).isIdentity).toBe(true);
    expect(packDeformationSurfaces([{ ...identity, target: [
      { x: 0, y: 0 }, { x: 12.001, y: 0 }, { x: 0, y: 8 }
    ] }]).isIdentity).toBe(false);
  });
});
