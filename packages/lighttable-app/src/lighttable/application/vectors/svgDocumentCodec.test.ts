import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { realizeLiveShape, transformPoint, type VectorElement } from '@lighttable/vector-core';
import { realizeVectorPath } from '@lighttable/vector-rendering';
import { buildLayeredDocumentFile, parseLayeredDocumentFile } from '../../editor/persistence/layeredDocumentFormat';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { executeSvgImport, exportSvgDocument } from './svgDocumentCodec';

const realizedDocumentPoints = (elements: readonly VectorElement[]) => elements.map((element) => {
  const path = element.type === 'path' ? element : realizeLiveShape(element);
  return realizeVectorPath(path, 0.1).subpaths.map(({ closed, points }) => ({
    closed,
    points: points.map((point) => transformPoint(element.transform, point))
  }));
});

describe('SVG document codec owner', () => {
  it('publishes a complete import once with one history boundary', () => {
    let document = createRasterLayer(createImageDocument('SVG', 200, 100, 'source'), 'Background');
    const applyDocument = vi.fn((next) => { document = next; });
    const recordHistory = vi.fn();
    const result = executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect id="card" width="80" height="40" fill="#f00"/></svg>',
      placement: 'document', layerName: 'Logo'
    }, { getDocument: () => document, applyDocument, recordHistory });
    expect(result).toMatchObject({ width: 200, height: 100, elementIds: [expect.any(String)] });
    expect(applyDocument).toHaveBeenCalledOnce();
    expect(recordHistory).toHaveBeenCalledOnce();
    expect(document.layers.at(-1)).toMatchObject({ type: 'vector', name: 'Logo' });
  });

  it('does not publish any partial state when SVG validation fails', () => {
    const document = createImageDocument('SVG', 200, 100, 'source');
    const applyDocument = vi.fn(); const recordHistory = vi.fn();
    expect(() => executeSvgImport({ svg: '<svg><script/></svg>', placement: 'document' },
      { getDocument: () => document, applyDocument, recordHistory })).toThrow();
    expect(applyDocument).not.toHaveBeenCalled();
    expect(recordHistory).not.toHaveBeenCalled();
  });

  it('exports an imported vector-only document as an SVG File', async () => {
    let document = createImageDocument('Logo', 200, 100, 'source');
    document.layers = [];
    document.activeLayerId = null;
    executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="25" fill="#0f0"/></svg>',
      placement: 'document'
    }, { getDocument: () => document, applyDocument: (next) => { document = next; }, recordHistory: () => undefined });
    const file = exportSvgDocument(document, 'Logo.lighttable');
    expect(file).toMatchObject({ name: 'Logo.svg', type: 'image/svg+xml' });
    expect(await file.text()).toContain('<ellipse');
  });

  it('preserves native vector semantics through save, reopen, export, and re-import', async () => {
    let document = createImageDocument('Round trip', 240, 120, 'source');
    document.layers = [];
    document.activeLayerId = null;
    const first = executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><g transform="translate(8 6)"><rect x="4" y="5" width="80" height="35" rx="6" fill="#369" stroke="#123" stroke-width="2"/><path d="M100 20 Q130 60 170 20" fill="none" stroke="#f60"/></g></svg>',
      placement: 'document'
    }, { getDocument: () => document, applyDocument: (next) => { document = next; }, recordHistory: () => undefined });
    expect(first?.elementIds).toHaveLength(2);

    const nativeFile = buildLayeredDocumentFile(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      document,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      [],
      'round-trip-lighttable.png'
    );
    const reopened = await parseLayeredDocumentFile(nativeFile);
    expect(reopened?.document.layers[0]).toMatchObject({ type: 'vector' });

    const exported = exportSvgDocument(reopened!.document, 'round-trip-lighttable.png');
    const exportedText = await exported.text();
    const reimported = createImageDocument('Re-import', 240, 120, 'source');
    reimported.layers = [];
    reimported.activeLayerId = null;
    let finalDocument = reimported;
    const second = executeSvgImport({ svg: exportedText, placement: 'document' }, {
      getDocument: () => finalDocument,
      applyDocument: (next) => { finalDocument = next; },
      recordHistory: () => undefined
    });
    expect(second?.elementIds).toHaveLength(2);
    expect(finalDocument.layers[0]).toMatchObject({ type: 'vector' });
    if (reopened?.document.layers[0]?.type === 'vector' && finalDocument.layers[0]?.type === 'vector') {
      expect(finalDocument.layers[0].elements.map(({ type }) => type))
        .toEqual(reopened.document.layers[0].elements.map(({ type }) => type));
      expect(finalDocument.layers[0].elements.map(({ style }) => style.fill))
        .toEqual(reopened.document.layers[0].elements.map(({ style }) => style.fill));
      const beforeRender = realizedDocumentPoints(reopened.document.layers[0].elements);
      const afterRender = realizedDocumentPoints(finalDocument.layers[0].elements);
      expect(afterRender.map((element) => element.map(({ closed, points }) => ({ closed, count: points.length }))))
        .toEqual(beforeRender.map((element) => element.map(({ closed, points }) => ({ closed, count: points.length }))));
      afterRender.forEach((element, elementIndex) => element.forEach((subpath, subpathIndex) => {
        subpath.points.forEach((point, pointIndex) => {
          const expected = beforeRender[elementIndex]![subpathIndex]!.points[pointIndex]!;
          expect(point.x).toBeCloseTo(expected.x, 4);
          expect(point.y).toBeCloseTo(expected.y, 4);
        });
      }));
    }
  });
});
