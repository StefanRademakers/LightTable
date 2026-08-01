import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { vectorRenderContract } from './contracts';

describe('vectorRenderContract', () => {
  it('derives document bounds and independent revisions at the backend boundary', () => {
    const path = createVectorPath('p', 'Path', [createSubpath('s', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 10, y: 10 })
    ])]);
    path.transform = { a: 2, b: 0, c: 0, d: 3, tx: 5, ty: 7 };
    path.transformRevision = 4;
    const resource = { buffer: 'test' };
    const contract = vectorRenderContract(path, resource, { x: 0, y: 0, width: 10, height: 10 });
    expect(contract.documentBounds).toEqual({ x: 5, y: 7, width: 20, height: 30 });
    expect(contract.revision).toEqual({ geometry: 0, transform: 4, style: 0 });
    expect(contract.resource).toBe(resource);
  });
});
