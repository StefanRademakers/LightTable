import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from './factories';
import { validateVectorPath } from './validation';

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
