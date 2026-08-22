import { describe, expect, it } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { exportVectorLayerToPsd } from './psdVectorExportAdapter';

const gradientPath = () => {
  const path = createVectorPath('shape', 'Shape', [createSubpath('outline', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', { x: 100, y: 0 }),
    createAnchor('c', { x: 100, y: 100 })
  ], true)]);
  path.style.fill = {
    ...createDefaultGradientPaint('paint'),
    transform: { a: 0.8, b: 0.2, c: -0.2, d: 0.8, tx: 0.1, ty: 0.3 }
  };
  return path;
};

describe('PSD vector gradient projection', () => {
  it('projects compatible internal gradient geometry without dropping it', () => {
    const result = exportVectorLayerToPsd([gradientPath()], identityAffineMatrix());
    expect(result?.vectorFill).toMatchObject({
      type: 'solid',
      angle: expect.closeTo(-14.036, 2),
      scale: expect.closeTo(82.462, 2),
      offset: { x: expect.closeTo(0, 4), y: expect.closeTo(-20, 4) }
    });
  });

  it.each([
    { spread: 'repeat' as const },
    { coordinateSpace: 'document' as const },
    { transform: { a: 1, b: 0, c: 0.2, d: 1, tx: 0, ty: 0 } }
  ])('refuses a lossy native PSD gradient projection: %o', (change) => {
    const path = gradientPath();
    if (!path.style.fill || !('kind' in path.style.fill)) throw new Error('Expected gradient.');
    path.style.fill = { ...path.style.fill, ...change };
    expect(exportVectorLayerToPsd([path], identityAffineMatrix())).toBeUndefined();
  });
});
