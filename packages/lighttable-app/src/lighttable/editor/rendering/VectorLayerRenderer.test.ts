import { describe, expect, it } from 'vitest';
import { createVectorLiveShape, createVectorPath, createSubpath, createAnchor } from '@lighttable/vector-core';
import { VectorGeometryRealizationCache } from './VectorLayerRenderer';

describe('VectorGeometryRealizationCache', () => {
  it('reuses flattened path geometry across paint and transform revisions', () => {
    const cache = new VectorGeometryRealizationCache();
    const path = createVectorPath('path', 'Path', [createSubpath('outline', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 100, y: 100 })
    ], false)]);
    const first = cache.realize(path, 0.25);
    path.transformRevision += 1;
    path.styleRevision += 1;
    const second = cache.realize(path, 0.25);

    expect(second.realized).toBe(first.realized);
    expect(cache.metrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });

  it('invalidates changed geometry and refreshes live-shape paint on cache hits', () => {
    const cache = new VectorGeometryRealizationCache();
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse', width: 100, height: 80
    });
    const first = cache.realize(shape, 0.25);
    shape.style.opacity = 0.5;
    shape.styleRevision += 1;
    const restyled = cache.realize(shape, 0.25);
    expect(restyled.realized).toBe(first.realized);
    expect(restyled.path.style.opacity).toBe(0.5);

    if (shape.geometry.kind !== 'ellipse') throw new Error('Expected ellipse geometry.');
    shape.geometry.width = 120;
    shape.geometryRevision += 1;
    const changed = cache.realize(shape, 0.25);
    expect(changed.realized).not.toBe(first.realized);
    expect(cache.metrics()).toMatchObject({ entries: 2, hits: 1, misses: 2 });
  });
});
