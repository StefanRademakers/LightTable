import type { PdfPageDisplayList } from '@lighttable/pdf-core';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  writePdfDisplayListPage,
  type PdfTransparencyGroupContent
} from './writePdfDisplayListPage';

const onePixelPng = () => new Blob([Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAH8u1VwAAAABJRU5ErkJggg=='
), character => character.charCodeAt(0))], { type: 'image/png' });

const rectangle = (x: number, y: number, width: number, height: number) => ({ commands: [
  { kind: 'move' as const, point: { x, y } },
  { kind: 'line' as const, point: { x: x + width, y } },
  { kind: 'line' as const, point: { x: x + width, y: y + height } },
  { kind: 'line' as const, point: { x, y: y + height } },
  { kind: 'close' as const }
] });

const fixture = (): PdfPageDisplayList => ({
  pageIndex: 0,
  sourceObjectId: 'page:1',
  mediaBox: { x: 0, y: 0, width: 240, height: 160 },
  cropBox: { x: 10, y: 20, width: 200, height: 120 },
  rotation: 90,
  userUnit: 1,
  operations: [
    { kind: 'set-fill-paint', paint: { kind: 'device-rgb', r: 1, g: 0, b: 0 } },
    { kind: 'draw-path', path: rectangle(20, 30, 80, 40), paint: 'fill', fillRule: 'nonzero' },
    { kind: 'save-state' },
    { kind: 'concat-transform', matrix: [1, 0, 0, 1, 15, 5] },
    { kind: 'clip-path', path: rectangle(0, 0, 50, 50), fillRule: 'evenodd' },
    { kind: 'set-stroke-paint', paint: { kind: 'device-cmyk', c: 1, m: 0.5, y: 0, k: 0 } },
    { kind: 'set-stroke-state', stroke: { width: 3, cap: 'round', join: 'bevel', miterLimit: 6, dash: [5, 2], dashPhase: 1 } },
    { kind: 'set-alpha', fill: 0.75, stroke: 0.5 },
    { kind: 'set-blend-mode', blendMode: 'multiply' },
    { kind: 'draw-path', path: { commands: [
      { kind: 'move', point: { x: 5, y: 5 } },
      { kind: 'cubic', control1: { x: 20, y: 50 }, control2: { x: 60, y: 50 }, point: { x: 75, y: 5 } }
    ] }, paint: 'stroke', fillRule: 'nonzero' },
    { kind: 'restore-state' }
  ]
});

describe('writePdfDisplayListPage', () => {
  it('preserves ordered paths, clips, transforms and graphics state in a reopenable PDF', async () => {
    const result = await writePdfDisplayListPage({
      page: fixture(), title: 'Display list fixture', rasterUnderlayPng: onePixelPng()
    });
    expect(result).toMatchObject({ operationCount: 11, pathCount: 2 });
    expect(result.blob.type).toBe('application/pdf');

    const reopened = await PDFDocument.load(await result.blob.arrayBuffer());
    const [page] = reopened.getPages();
    expect(page?.getMediaBox()).toEqual({ x: 0, y: 0, width: 240, height: 160 });
    expect(page?.getCropBox()).toEqual({ x: 10, y: 20, width: 200, height: 120 });
    expect(page?.getRotation().angle).toBe(90);
    const content = page?.node.Contents();
    expect(content).toBeDefined();
    expect(page?.node.Resources()?.lookupMaybe).toBeDefined();

    const task = pdfjs.getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const pdfJsDocument = await task.promise;
    const operatorList = await (await pdfJsDocument.getPage(1)).getOperatorList();
    expect(operatorList.fnArray.length).toBeGreaterThan(10);
    expect(JSON.stringify(operatorList.argsArray)).toContain('"BM","multiply"');
    expect(operatorList.argsArray.some(args => Array.isArray(args) && args.includes('img_p0_1'))).toBe(true);
    await task.destroy();
  });

  it('fails closed for resources and unbalanced graphics state', async () => {
    const image = fixture();
    await expect(writePdfDisplayListPage({ page: {
      ...image,
      operations: [{ kind: 'draw-image', imageResourceId: 'image:1', matrix: [1, 0, 0, 1, 0, 0] }]
    } })).rejects.toThrow('does not support draw-image yet');
    await expect(writePdfDisplayListPage({ page: {
      ...image,
      operations: [{ kind: 'save-state' }]
    } })).rejects.toThrow('leaves graphics state unbalanced');
  });

  it('writes isolated vector operations into a transparency Form XObject', async () => {
    const result = await writePdfDisplayListPage({
      page: fixture(),
      transparencyGroups: [{
        opacity: 0.65,
        blendMode: 'screen',
        operations: [
          { kind: 'set-fill-paint', paint: { kind: 'device-rgb', r: 0, g: 0, b: 1 } },
          { kind: 'set-alpha', fill: 0.8, stroke: 1 },
          { kind: 'draw-path', path: rectangle(40, 40, 60, 60), paint: 'fill', fillRule: 'nonzero' }
        ]
      }]
    });
    expect(result).toMatchObject({ operationCount: 14, pathCount: 3 });

    const reopened = await PDFDocument.load(await result.blob.arrayBuffer());
    const page = reopened.getPages()[0]!;
    const xObjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const form = reopened.context.lookup(xObjects.get(PDFName.of('LTGroup1'))) as PDFRawStream;
    expect(form).toBeInstanceOf(PDFRawStream);
    const group = form.dict.lookup(PDFName.of('Group'), PDFDict);
    expect(group.get(PDFName.of('S'))?.toString()).toBe('/Transparency');
    expect(group.get(PDFName.of('I'))?.toString()).toBe('true');

    const task = pdfjs.getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const operators = await (await (await task.promise).getPage(1)).getOperatorList();
    expect(operators.fnArray).toContain(pdfjs.OPS.paintFormXObjectBegin);
    expect(JSON.stringify(operators.argsArray)).toContain('screen');
    await task.destroy();
  });

  it('preserves ordered nested transparency Forms and their local resources', async () => {
    const draw = (color: readonly [number, number, number], x: number) => [
      { kind: 'set-fill-paint' as const, paint: {
        kind: 'device-rgb' as const, r: color[0], g: color[1], b: color[2]
      } },
      { kind: 'set-alpha' as const, fill: 0.7, stroke: 1 },
      { kind: 'draw-path' as const, path: rectangle(x, 30, 40, 40), paint: 'fill' as const, fillRule: 'nonzero' as const }
    ];
    const result = await writePdfDisplayListPage({
      page: fixture(),
      transparencyGroups: [{
        opacity: 0.8,
        blendMode: 'normal',
        items: [
          { kind: 'operations', operations: draw([1, 0, 0], 20) },
          { kind: 'group', group: {
            opacity: 0.5,
            blendMode: 'multiply',
            operations: draw([0, 0, 1], 50)
          } }
        ]
      }]
    });
    expect(result).toMatchObject({ operationCount: 17, pathCount: 4 });
    const task = pdfjs.getDocument({
      data: new Uint8Array(await result.blob.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const operators = await (await (await task.promise).getPage(1)).getOperatorList();
    expect(operators.fnArray.filter(value => value === pdfjs.OPS.paintFormXObjectBegin)).toHaveLength(2);
    expect(JSON.stringify(operators.argsArray)).toContain('multiply');
    await task.destroy();
  });

  it('bounds recursive transparency group depth before writing resources', async () => {
    let nested: PdfTransparencyGroupContent = {
      opacity: 1, blendMode: 'normal', operations: []
    };
    for (let depth = 0; depth < 17; depth += 1) {
      nested = {
        opacity: 1,
        blendMode: 'normal',
        items: [{ kind: 'group', group: nested }]
      };
    }
    await expect(writePdfDisplayListPage({
      page: fixture(), transparencyGroups: [nested]
    })).rejects.toThrow('transparency group depth exceeds 16');
  });
});
