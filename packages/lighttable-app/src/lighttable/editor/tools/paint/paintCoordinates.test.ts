import { describe, expect, it } from 'vitest';
import type { RasterLayer } from '../../document/documentTypes';
import { createImageDocument } from '../../document/documentTypes';
import {
  aroundPoint,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix
} from '../transform/affine';
import { documentPointToPaintTarget, paintTargetSourceToDocument } from './paintCoordinates';

const layer = (): RasterLayer => createImageDocument('Paint coordinates', 320, 180, 'asset').layers[0] as RasterLayer;

describe('paint coordinate contract', () => {
  it('keeps raster pixel painting in document space', () => {
    const transformed = { ...layer(), transform: translationMatrix(48, -12) };
    expect(paintTargetSourceToDocument(transformed, 'pixels')).toEqual({
      a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0
    });
  });

  it('maps a translated mask pointer back to the matching local pixel', () => {
    const transformed = { ...layer(), transform: translationMatrix(48, -12) };
    const matrix = paintTargetSourceToDocument(transformed, 'mask');
    const local = { x: 70, y: 60 };
    const document = transformPoint(matrix, local);
    expect(documentPointToPaintTarget(document, matrix)).toEqual(local);
  });

  it('round-trips scale and rotation around a layer-space pivot', () => {
    const matrix = multiplyMatrices(
      translationMatrix(31, -17),
      aroundPoint(
        multiplyMatrices(rotationMatrix(Math.PI / 7), scaleMatrix(1.35, 0.72)),
        { x: 160, y: 90 }
      )
    );
    const transformed = { ...layer(), transform: matrix };
    const local = { x: 83.25, y: 112.5 };
    const document = transformPoint(paintTargetSourceToDocument(transformed, 'mask'), local);
    const restored = documentPointToPaintTarget(document, transformed.transform);
    expect(restored?.x).toBeCloseTo(local.x, 5);
    expect(restored?.y).toBeCloseTo(local.y, 5);
  });
});

