import { createAnchor, createSubpath, createVectorLiveShape, createVectorPath } from '@lighttable/vector-core';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer,
  type LayerId
} from '../../editor/document/documentTypes';
import { writePdfDisplayListPage } from '../../infrastructure/pdf/writePdfDisplayListPage';
import {
  buildPdfNativeVectorExportPage,
  buildPdfNativeVectorPage
} from './buildPdfNativeVectorPage';

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

  it('emits a supported layer blend mode around its native path draws', () => {
    const vector = createVectorLayer([createVectorLiveShape('rectangle', {
      kind: 'rectangle', width: 50, height: 30,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    })]);
    vector.blendMode = 'multiply';
    const document = createImageDocument('Blend', 100, 100, 'pixels');
    document.layers.push(vector);
    const page = buildPdfNativeVectorPage({
      document, nativeVectorLayerIds: new Set([vector.id])
    });
    expect(page.operations[0]).toEqual({ kind: 'save-state' });
    expect(page.operations[1]).toEqual({ kind: 'set-blend-mode', blendMode: 'multiply' });
    expect(page.operations.at(-1)).toEqual({ kind: 'restore-state' });
  });

  it('keeps isolated group children in one reopenable transparency Form', async () => {
    const first = createVectorLayer([createVectorLiveShape('ellipse', {
      kind: 'ellipse', width: 30, height: 20
    })]);
    const second = createVectorLayer([createVectorLiveShape('ellipse-2', {
      kind: 'ellipse', width: 20, height: 20
    })]);
    const group = createGroupLayer();
    group.children.push(first, second);
    group.compositing = 'isolated';
    group.opacity = 0.5;
    const document = createImageDocument('Group', 100, 100, 'pixels');
    document.layers.push(group);
    const output = buildPdfNativeVectorExportPage({
      document,
      nativeVectorLayerIds: new Set([first.id, second.id]),
      transparencyGroups: [{
        groupId: group.id,
        nativeVectorLayerIds: [first.id, second.id],
        opacity: 0.5,
        blendMode: 'normal'
      }]
    });
    expect(output.page.operations).toEqual([]);
    expect(output.layers).toEqual([]);
    expect(output.transparencyGroups).toHaveLength(1);
    expect(output.transparencyGroups[0]?.operations.filter(operation => operation.kind === 'draw-path')).toHaveLength(2);
    const written = await writePdfDisplayListPage({
      page: output.page,
      transparencyGroups: output.transparencyGroups
    });
    const task = pdfjs.getDocument({
      data: new Uint8Array(await written.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const operators = await (await (await task.promise).getPage(1)).getOperatorList();
    expect(operators.fnArray).toContain(pdfjs.OPS.paintFormXObjectBegin);
    expect(operators.fnArray.filter(value => value === pdfjs.OPS.constructPath)).toHaveLength(2);
    await task.destroy();
  });

  it('scopes a clipped vector layer to its opaque base path', async () => {
    const square = (id: string, size: number) => {
      const value = createVectorPath(id, id, [createSubpath(`${id}-outline`, [
        createAnchor(`${id}-a`, { x: 10, y: 10 }),
        createAnchor(`${id}-b`, { x: 10 + size, y: 10 }),
        createAnchor(`${id}-c`, { x: 10 + size, y: 10 + size }),
        createAnchor(`${id}-d`, { x: 10, y: 10 + size })
      ], true)]);
      value.style.fill = { type: 'solid', color: [0, 0, 0, 1] };
      value.style.stroke = null;
      return value;
    };
    const base = createVectorLayer([square('base', 40)]);
    const clipped = createVectorLayer([square('clipped', 80)]);
    clipped.clipping = true;
    const document = createImageDocument('Clipped', 100, 100, 'pixels');
    document.layers.push(base, clipped);
    const output = buildPdfNativeVectorExportPage({
      document,
      nativeVectorLayerIds: new Set([base.id, clipped.id]),
      transparencyGroups: [],
      clippingPairs: [{ baseLayerId: base.id, clippedLayerId: clipped.id }]
    });
    const clippedOperations = output.layers.find(layer => layer.layerId === clipped.id)?.operations;
    expect(clippedOperations?.some(operation => operation.kind === 'clip-path')).toBe(true);
    const written = await writePdfDisplayListPage({ page: output.page });
    const task = pdfjs.getDocument({
      data: new Uint8Array(await written.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const operators = await (await (await task.promise).getPage(1)).getOperatorList();
    expect(operators.fnArray).toContain(pdfjs.OPS.clip);
    expect(operators.fnArray.filter(value => value === pdfjs.OPS.constructPath)).toHaveLength(3);
    await task.destroy();
  });
});
