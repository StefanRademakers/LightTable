import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { hitTestVectorPath } from './pathSelection';
import { rotateVectorPath, translateVectorPath } from './pathTransforms';

const square = () => createVectorPath('square', 'Square', [createSubpath('shape', [
  createAnchor('a', { x: 0, y: 0 }, { handleOut: { x: 3, y: 0 } }),
  createAnchor('b', { x: 10, y: 0 }),
  createAnchor('c', { x: 10, y: 10 }),
  createAnchor('d', { x: 0, y: 10 })
], true)]);

describe('path selection and transforms', () => {
  it('hit-tests in local geometry through the inverse scene transform', () => {
    const path = translateVectorPath(square(), { x: 100, y: 50 });
    expect(hitTestVectorPath(path, { documentPoint: { x: 100.5, y: 50.5 }, radius: 1 }))
      .toEqual({ kind: 'anchor', subpathId: 'shape', anchorId: 'a' });
    expect(hitTestVectorPath(path, { documentPoint: { x: 105, y: 55 }, radius: 0.5 }))
      .toEqual({ kind: 'fill', pathId: 'square' });
  });

  it('returns handles before segments and fill', () => {
    expect(hitTestVectorPath(square(), { documentPoint: { x: 3, y: 0 }, radius: 0.5 }))
      .toEqual({ kind: 'handle-out', subpathId: 'shape', anchorId: 'a' });
  });

  it('composes whole-path transforms without baking anchors', () => {
    const source = square();
    const transformed = rotateVectorPath(
      translateVectorPath(source, { x: 10, y: 20 }),
      Math.PI / 2,
      { x: 10, y: 20 }
    );
    expect(transformed.subpaths).toEqual(source.subpaths);
    expect(transformed.geometryRevision).toBe(0);
    expect(transformed.transformRevision).toBe(2);
    expect(transformed.transform.a).toBeCloseTo(0);
    expect(transformed.transform.b).toBeCloseTo(1);
    expect(transformed.transform.c).toBeCloseTo(-1);
    expect(transformed.transform.d).toBeCloseTo(0);
    expect(transformed.transform.tx).toBeCloseTo(10);
    expect(transformed.transform.ty).toBeCloseTo(20);
  });
});
