import { describe, expect, it } from 'vitest';
import { mapDetectedFaceToLayerSource } from './faceWarpDetectionMapping';

describe('face-warp detection coordinate mapping', () => {
  it.each([
    ['front', { a: 0.5, b: 0, c: 0, d: 0.5, tx: 0, ty: 0 }, { x: 50, y: 30, z: -2 }, { x: 100, y: 60, z: -4 }],
    ['rolled', { a: 0, b: 0.5, c: -0.5, d: 0, tx: 80, ty: 0 }, { x: 65, y: 50, z: -2 }, { x: 100, y: 30, z: -4 }],
    ['scaled', { a: 0.25, b: 0, c: 0, d: 0.25, tx: 4, ty: 8 }, { x: 29, y: 23, z: -1 }, { x: 100, y: 60, z: -4 }],
    ['three-quarter depth', { a: 0.5, b: 0, c: 0, d: 0.5, tx: 0, ty: 0 }, { x: 50, y: 30, z: 6 }, { x: 100, y: 60, z: 12 }]
  ] as const)('maps %s detection without a first-frame offset', (_name, matrix, point, expected) => {
    const [mapped] = mapDetectedFaceToLayerSource([point], matrix);
    expect(mapped?.x).toBeCloseTo(expected.x);
    expect(mapped?.y).toBeCloseTo(expected.y);
    expect(mapped?.z).toBeCloseTo(expected.z);
  });
});
