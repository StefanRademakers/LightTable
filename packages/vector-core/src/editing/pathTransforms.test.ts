import { describe, expect, it } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createVectorLiveShape } from '../model/factories';
import { translationMatrix } from '../math/affine';
import { transformVectorElementDocumentPaint } from './pathTransforms';

describe('vector path transforms', () => {
  it('carries document-space gradient paint with an authored object move', () => {
    const shape = createVectorLiveShape('shape', { kind: 'ellipse', width: 40, height: 40 });
    const gradient = createDefaultGradientPaint('gradient');
    shape.style.fill = {
      ...gradient,
      coordinateSpace: 'document',
      transform: { a: 30, b: 0, c: 0, d: 30, tx: 12, ty: 18 }
    };

    const moved = transformVectorElementDocumentPaint(shape, translationMatrix(50, 25));
    expect(moved.style.fill).toMatchObject({
      coordinateSpace: 'document',
      transform: { a: 30, b: 0, c: 0, d: 30, tx: 62, ty: 43 }
    });
    expect(shape.style.fill).toMatchObject({ transform: { tx: 12, ty: 18 } });
    expect(moved.styleRevision).toBe(shape.styleRevision + 1);
  });

  it('leaves object-bounds paint owned by the ordinary element transform', () => {
    const shape = createVectorLiveShape('shape', { kind: 'ellipse', width: 40, height: 40 });
    const gradient = createDefaultGradientPaint('gradient');
    shape.style.fill = { ...gradient, coordinateSpace: 'object-bounds' };

    expect(transformVectorElementDocumentPaint(shape, translationMatrix(50, 25))).toBe(shape);
  });
});
