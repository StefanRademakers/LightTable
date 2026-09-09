import { describe, expect, it } from 'vitest';
import type { RasterLayer } from '../../document/documentTypes';
import { createGroupLayer, createImageDocument } from '../../document/documentTypes';
import { addLayerMask } from '../../document/documentCommands';
import {
  aroundPoint,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix
} from '../transform/affine';
import { documentPointToPaintTarget, paintTargetSourceToDocument } from './paintCoordinates';

describe('paint coordinate contract', () => {
  it('maps tight raster pixel painting through the layer transform', () => {
    const document = createImageDocument('Paint coordinates', 320, 180, 'asset');
    const transformed = { ...document.layers[0] as RasterLayer,
      transform: translationMatrix(48, -12) };
    document.layers = [transformed];
    expect(paintTargetSourceToDocument(document, transformed, 'pixels'))
      .toEqual(translationMatrix(48, -12));
  });

  it('uses the persisted mask transform independently from raster content', () => {
    let document = createImageDocument('Paint coordinates', 320, 180, 'asset');
    document = addLayerMask(document, document.activeLayerId!);
    const maskTransform = translationMatrix(7, 11);
    const transformed = { ...document.layers[0] as RasterLayer,
      transform: translationMatrix(48, -12),
      mask: { ...(document.layers[0] as RasterLayer).mask!, transform: maskTransform } };
    document.layers = [transformed];
    const matrix = paintTargetSourceToDocument(document, transformed, 'mask');
    expect(matrix).toEqual(maskTransform);
    expect(documentPointToPaintTarget({ x: 70, y: 60 }, matrix)).toEqual({ x: 63, y: 49 });
  });

  it('includes ancestor transforms for raster pixels inside a group', () => {
    const matrix = multiplyMatrices(
      translationMatrix(31, -17),
      aroundPoint(
        multiplyMatrices(rotationMatrix(Math.PI / 7), scaleMatrix(1.35, 0.72)),
        { x: 160, y: 90 }
      )
    );
    const document = createImageDocument('Paint coordinates', 320, 180, 'asset');
    const transformed = { ...document.layers[0] as RasterLayer,
      transform: translationMatrix(4, 6) };
    const group = { ...createGroupLayer(), transform: matrix, children: [transformed] };
    document.layers = [group];
    expect(paintTargetSourceToDocument(document, transformed, 'pixels'))
      .toEqual(multiplyMatrices(matrix, transformed.transform));
  });
});
