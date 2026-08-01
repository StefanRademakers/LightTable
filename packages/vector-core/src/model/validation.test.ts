import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorLiveShape, createVectorPath } from './factories';
import { validateVectorLiveShape, validateVectorPath } from './validation';

describe('vector validation', () => {
  it('accepts a valid path', () => {
    const path = createVectorPath('path', 'Valid', [createSubpath('subpath', [
      createAnchor('anchor', { x: 1, y: 2 })
    ])]);
    expect(validateVectorPath(path)).toEqual([]);
  });

  it('reports duplicate ids and non-finite coordinates', () => {
    const path = createVectorPath('same', 'Invalid', [createSubpath('same', [
      createAnchor('anchor', { x: Number.NaN, y: 2 }),
      createAnchor('anchor', { x: 3, y: 4 })
    ])]);
    expect(validateVectorPath(path).map(({ code }) => code)).toEqual([
      'duplicate-id', 'invalid-point', 'duplicate-id'
    ]);
  });
});

describe('live-shape validation', () => {
  it('rejects non-finite dimensions independently from rendering', () => {
    const shape = createVectorLiveShape('shape', { kind: 'ellipse', width: 10, height: Number.NaN });
    expect(validateVectorLiveShape(shape)).toContainEqual(expect.objectContaining({
      code: 'invalid-live-shape-dimension', path: 'geometry'
    }));
  });
});
