import { createAnchor, createSubpath, createVectorLiveShape, createVectorPath } from '@lighttable/vector-core';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { createImageDocument, createVectorLayer, type LayerId } from '../../editor/document/documentTypes';
import { writePdfDisplayListPage } from '../../infrastructure/pdf/writePdfDisplayListPage';
import { buildPdfNativeVectorPage } from './buildPdfNativeVectorPage';

describe('buildPdfNativeVectorPage', () => {
  it('preserves canonical curves, compound paint, live shapes and document-to-PDF geometry', async () => {
    const curve = createVectorPath('curve', 'Curve', [createSubpath('curve-outline', [
      createAnchor('a', { x: 10, y: 20 }, { handleOut: { x: 20, y: 5 } }),
      createAnchor('b', { x: 80, y: 40 }, { handleIn: { x: 60, y: 55 } }),
      createAnchor('c', { x: 10, y: 20 })
    ], true)]);
    curve.style.fill = { type: 'solid', color: [0.2, 0.4, 0.6, 0.8] };
    curve.style.stroke = {
      paint: { type: 'solid', color: [1, 0, 0, 0.5] }, width: 4,
      alignment: 'center', cap: 'round', join: 'bevel', miterLimit: 7,
      dash: [8, 2], dashOffset: 1
    };
    const ellipse = createVectorLiveShape('ellipse', { kind: 'ellipse', width: 50, height: 30 });
    const vector = createVectorLayer([curve, ellipse]);
    vector.transform.tx = 5;
    vector.transform.ty = 7;
    const document = createImageDocument('Native vectors', 1000, 500, 'pixels');
    document.layers.push(vector);

    const page = buildPdfNativeVectorPage({
      document,
      nativeVectorLayerIds: new Set([vector.id]),
      pixelsPerInch: 100
    });
    expect(page.mediaBox).toEqual({ x: 0, y: 0, width: 720, height: 360 });
    expect(page.operations.filter(operation => operation.kind === 'draw-path')).toHaveLength(2);
    expect(page.operations).toContainEqual(expect.objectContaining({
      kind: 'concat-transform', matrix: [0.72, 0, 0, -0.72, 3.5999999999999996, 354.96]
    }));
    const firstPath = page.operations.find(operation => operation.kind === 'draw-path');
    expect(firstPath).toMatchObject({
      kind: 'draw-path', paint: 'fill-stroke',
      path: { commands: expect.arrayContaining([expect.objectContaining({ kind: 'cubic' })]) }
    });

    const written = await writePdfDisplayListPage({ page });
    const task = pdfjs.getDocument({
      data: new Uint8Array(await written.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const reopened = await task.promise;
    const operatorList = await (await reopened.getPage(1)).getOperatorList();
    expect(operatorList.fnArray.length).toBeGreaterThan(15);
    expect(JSON.stringify(operatorList.argsArray)).toContain('#336699');
    await task.destroy();
  });

  it('rejects stale layer ids', () => {
    const document = createImageDocument('Stale', 10, 10, 'pixels');
    expect(() => buildPdfNativeVectorPage({
      document,
      nativeVectorLayerIds: new Set(['missing' as LayerId])
    })).toThrow('stale or non-vector layer id');
  });
});
