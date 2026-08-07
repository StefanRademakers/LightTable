import { describe, expect, it } from 'vitest';
import { createImageDocument, createGroupLayer, createVectorLayer } from '../../editor/document/documentTypes';
import {
  createResizePlan,
  parseImageSizeRequest,
  pixelsToSizeUnit,
  resizeImageDocumentSemantics,
  sizeUnitToPixels
} from './imageSizeModel';

const request = (overrides: Partial<Parameters<typeof createResizePlan>[1]> = {}) => ({
  width: 200, height: 100, resolutionPpi: 300, resample: true,
  method: 'automatic' as const, preserveDetailsNoiseReduction: 0,
  scaleStyles: true, ...overrides
});

describe('Image Size model', () => {
  it('converts physical units without changing the represented pixels', () => {
    expect(pixelsToSizeUnit(3000, 'inches', 300, 3000)).toBe(10);
    expect(sizeUnitToPixels(25.4, 'millimeters', 300, 3000)).toBeCloseTo(300);
    expect(pixelsToSizeUnit(1500, 'percent', 300, 3000)).toBe(50);
  });

  it('routes automatic resize by axis direction and stages large reductions', () => {
    expect(createResizePlan({ width: 100, height: 50 }, request()).resolvedMethod).toBe('bicubic-smoother');
    const reduction = createResizePlan({ width: 4000, height: 2000 }, request({ width: 500, height: 250 }));
    expect(reduction.resolvedMethod).toBe('bicubic-sharper');
    expect(reduction.passes).toEqual([
      { width: 2000, height: 1000 },
      { width: 1000, height: 500 },
      { width: 500, height: 250 }
    ]);
    expect(createResizePlan({ width: 100, height: 100 }, request({ width: 200, height: 50 })).resolvedMethod).toBe('bicubic');
  });

  it('keeps pixel dimensions fixed when resampling is disabled', () => {
    const plan = createResizePlan({ width: 640, height: 480 }, request({
      width: 1000, height: 1000, resolutionPpi: 150, resample: false
    }));
    expect(plan).toMatchObject({ targetWidth: 640, targetHeight: 480, resolvedMethod: null, passes: [] });
  });

  it('validates the transport-neutral resize command at the application boundary', () => {
    expect(parseImageSizeRequest(request())).toEqual(request());
    expect(parseImageSizeRequest({ ...request(), method: 'invented' })).toEqual({
      message: 'Resample, method, Reduce Noise and Scale Styles parameters are invalid.'
    });
    expect(parseImageSizeRequest({ ...request(), width: 16_385 })).toEqual({
      message: 'Image dimensions must be integers from 1 to 16384 pixels.'
    });
  });

  it('scales one root transform while preserving nested editable geometry', () => {
    const document = createImageDocument('Layered', 100, 50, 'pixels');
    const group = createGroupLayer('Group');
    const shape = createVectorLayer([], 'Shape');
    group.children = [shape];
    group.styleStack.scale = 1.25;
    document.layers = [document.layers[0]!, group];
    const resized = resizeImageDocumentSemantics(document, request());
    const resizedGroup = resized.layers[1]!;
    expect(resized).toMatchObject({ width: 200, height: 100, resolutionPpi: 300 });
    expect(resizedGroup.transform).toMatchObject({ a: 2, d: 2 });
    expect(resizedGroup.styleStack.scale).toBe(2.5);
    expect(resizedGroup.type === 'group' && resizedGroup.children[0]).toMatchObject({
      id: shape.id,
      elements: shape.elements,
      transform: shape.transform
    });
    expect(resized.layers[0]).toMatchObject({ width: 200, height: 100, transform: { a: 1, d: 1 } });
  });
});
