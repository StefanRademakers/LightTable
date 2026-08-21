import { describe, expect, it } from 'vitest';
import { createVectorLiveShape, createVectorPath, createSubpath, createAnchor } from '@lighttable/vector-core';
import {
  maximumAffineScale,
  quantizePresentationScale,
  vectorSurfaceBytes,
  vectorSurfaceSampleCount,
  VectorGeometryRealizationCache
} from './VectorLayerRenderer';

describe('adaptive vector tessellation', () => {
  it('measures the largest affine scale including rotation and non-uniform scale', () => {
    expect(maximumAffineScale({ a: 0, b: 3, c: -2, d: 0, tx: 10, ty: 20 })).toBeCloseTo(3);
    expect(maximumAffineScale({ a: 1, b: 0, c: 1, d: 1, tx: 0, ty: 0 })).toBeCloseTo(1.6180339887);
  });

  it('buckets presentation scale upward and never reduces base quality', () => {
    expect(quantizePresentationScale(0.25)).toBe(1);
    expect(quantizePresentationScale(1)).toBe(1);
    expect(quantizePresentationScale(1.01)).toBeCloseTo(2 ** 0.25);
    expect(quantizePresentationScale(8)).toBe(8);
    expect(quantizePresentationScale(1_000)).toBe(64);
  });

  it('drops multisampling before a large vector surface exceeds its budget', () => {
    expect(vectorSurfaceBytes(10_000, 10_000, 4)).toBe(5_600_000_000);
    expect(vectorSurfaceBytes(10_000, 10_000, 1)).toBe(1_200_000_000);
    expect(vectorSurfaceSampleCount(1_000, 1_000, true)).toBe(4);
    expect(vectorSurfaceSampleCount(10_000, 10_000, true)).toBe(1);
    expect(vectorSurfaceSampleCount(1_000, 1_000, false)).toBe(1);
  });
});

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
