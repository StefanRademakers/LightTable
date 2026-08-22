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

const keepSvgSource = async (source: string) => source;

describe('SVG document codec owner', () => {
  it('publishes a complete import once with one history boundary', async () => {
    let document = createRasterLayer(createImageDocument('SVG', 200, 100, 'source'), 'Background');
    const applyDocument = vi.fn((next) => { document = next; });
    const recordHistory = vi.fn();
    const result = await executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect id="card" width="80" height="40" fill="#f00"/></svg>',
      placement: 'document', layerName: 'Logo'
    }, { getDocument: () => document, applyDocument, recordHistory, normalizeSvgSource: keepSvgSource });
    expect(result).toMatchObject({ width: 200, height: 100, elementIds: [expect.any(String)] });
    expect(applyDocument).toHaveBeenCalledOnce();
    expect(recordHistory).toHaveBeenCalledOnce();
    expect(document.layers.at(-1)).toMatchObject({ type: 'vector', name: 'Logo' });
  });

  it('does not publish any partial state when SVG validation fails', async () => {
    const document = createImageDocument('SVG', 200, 100, 'source');
    const applyDocument = vi.fn(); const recordHistory = vi.fn();
    await expect(executeSvgImport({ svg: '<svg><script/></svg>', placement: 'document' },
      { getDocument: () => document, applyDocument, recordHistory,
        normalizeSvgSource: keepSvgSource })).rejects.toThrow();
    expect(applyDocument).not.toHaveBeenCalled();
    expect(recordHistory).not.toHaveBeenCalled();
  });

  it('bases the atomic import on document authority read after async normalization', async () => {
    const original = createImageDocument('Original', 200, 100, 'source');
    const edited = createRasterLayer(original, 'User edit during normalization');
    let document = original;
    let releaseNormalization!: (source: string) => void;
    const normalization = new Promise<string>((resolve) => { releaseNormalization = resolve; });
    const applyDocument = vi.fn((next) => { document = next; });
    const recordHistory = vi.fn();
    const pending = executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>',
      placement: 'document'
    }, {
      getDocument: () => document,
      applyDocument,
      recordHistory,
      normalizeSvgSource: () => normalization
    });
    document = edited;
    releaseNormalization('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>');
    await pending;

    expect(document.layers.slice(0, edited.layers.length)).toEqual(edited.layers);
    expect(document.layers.at(-1)).toMatchObject({ type: 'vector' });
    expect(recordHistory).toHaveBeenCalledWith(edited, document);
  });

  it('exports an imported vector-only document as an SVG File', async () => {
    let document = createImageDocument('Logo', 200, 100, 'source');
    document.layers = [];
    document.activeLayerId = null;
    await executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="25" fill="#0f0"/></svg>',
      placement: 'document'
    }, { getDocument: () => document, applyDocument: (next) => { document = next; },
      recordHistory: () => undefined, normalizeSvgSource: keepSvgSource });
    const file = exportSvgDocument(document, 'Logo.lighttable');
    expect(file).toMatchObject({ name: 'Logo.svg', type: 'image/svg+xml' });
    expect(await file.text()).toContain('<ellipse');
  });

  it('maps SVG group opacity to canonical isolated groups and exports it losslessly', async () => {
    let document = createImageDocument('Opacity', 100, 100, 'source');
    document.layers = [];
    document.activeLayerId = null;
    const imported = await executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g id="faded" opacity=".4"><rect width="60" height="60" fill="#f00"/><rect x="30" y="30" width="60" height="60" fill="#00f"/></g></svg>',
      placement: 'document', layerName: 'Grouped SVG'
    }, {
      getDocument: () => document,
      applyDocument: (next) => { document = next; },
      recordHistory: () => undefined,
      normalizeSvgSource: keepSvgSource
    });
    expect(imported?.elementIds).toHaveLength(2);
    expect(document.layers[0]).toMatchObject({
      type: 'group', name: 'Grouped SVG', compositing: 'pass-through',
      children: [{
        type: 'group', name: 'faded', opacity: 0.4, compositing: 'isolated',
        children: [{ type: 'vector', elements: [{}, {}] }]
      }]
    });

    const exported = await exportSvgDocument(document, 'opacity.lighttable').text();
    expect(exported).toContain('id="faded" opacity="0.4"');
    let reopened = createImageDocument('Reopen', 100, 100, 'source');
    reopened.layers = [];
    reopened.activeLayerId = null;
    await executeSvgImport({ svg: exported, placement: 'document' }, {
      getDocument: () => reopened,
      applyDocument: (next) => { reopened = next; },
      recordHistory: () => undefined,
      normalizeSvgSource: keepSvgSource
    });
    const outer = reopened.layers[0];
    expect(outer?.type === 'group' ? outer.children[0] : null).toMatchObject({
      type: 'group', name: 'faded', opacity: 0.4, compositing: 'isolated'
    });
  });

  it('preserves native vector semantics through save, reopen, export, and re-import', async () => {
    let document = createImageDocument('Round trip', 240, 120, 'source');
    document.layers = [];
    document.activeLayerId = null;
    const first = await executeSvgImport({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><g transform="translate(8 6)"><rect x="4" y="5" width="80" height="35" rx="6" fill="#369" stroke="#123" stroke-width="2"/><path d="M100 20 Q130 60 170 20" fill="none" stroke="#f60"/></g></svg>',
      placement: 'document'
    }, { getDocument: () => document, applyDocument: (next) => { document = next; },
      recordHistory: () => undefined, normalizeSvgSource: keepSvgSource });
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
    const second = await executeSvgImport({ svg: exportedText, placement: 'document' }, {
      getDocument: () => finalDocument,
      applyDocument: (next) => { finalDocument = next; },
      recordHistory: () => undefined,
      normalizeSvgSource: keepSvgSource
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
