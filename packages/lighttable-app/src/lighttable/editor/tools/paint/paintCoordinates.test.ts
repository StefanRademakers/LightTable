import { describe, expect, it } from 'vitest';
import type { RasterLayer } from '../../document/documentTypes';
import { createImageDocument } from '../../document/documentTypes';
import {
  aroundPoint,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
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

  it('keeps a mask in document space when its raster content is translated', () => {
    const transformed = { ...layer(), transform: translationMatrix(48, -12) };
    const matrix = paintTargetSourceToDocument(transformed, 'mask');
    expect(matrix).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(documentPointToPaintTarget({ x: 70, y: 60 }, matrix)).toEqual({ x: 70, y: 60 });
  });

  it('keeps mask painting fixed under rotated and scaled raster content', () => {
    const matrix = multiplyMatrices(
      translationMatrix(31, -17),
      aroundPoint(
        multiplyMatrices(rotationMatrix(Math.PI / 7), scaleMatrix(1.35, 0.72)),
        { x: 160, y: 90 }
      )
    );
    const transformed = { ...layer(), transform: matrix };
    const paintMatrix = paintTargetSourceToDocument(transformed, 'mask');
    expect(paintMatrix).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(documentPointToPaintTarget({ x: 83.25, y: 112.5 }, paintMatrix)).toEqual({
      x: 83.25,
      y: 112.5
    });
  });
});
