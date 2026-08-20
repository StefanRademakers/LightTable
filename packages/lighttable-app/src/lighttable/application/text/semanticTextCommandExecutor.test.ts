import { describe, expect, it, vi } from 'vitest';
import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, createVectorLayer, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { BUNDLED_TEXT_FONT_CATALOG } from '../../text/fonts/bundledTextFont';
import { executeSemanticTextCommand, type SemanticTextCommandDependencies } from './semanticTextCommandExecutor';

const setup = (value = 'A👋B') => {
  const source = createDefaultFlowTextSource(value);
  let document: ImageDocument = createTextLayer(createImageDocument('Text', 400, 300, 'source'), {
    ...createDefaultTextLayerData(), source
  }, 'Text');
  const layerId = document.activeLayerId!;
  const history = vi.fn();
  const dependencies: SemanticTextCommandDependencies = {
    fontRegistry: { availableAssets: [] } as never,
    getDocument: () => document,
    getTextSettings: () => ({ family: 'Inter', style: 'Regular', size: 50,
      antiAlias: 'smooth', alignment: 'start', fillEnabled: true }),
    getForegroundColor: () => '#000000',
    applyDocument: (next) => { document = next; },
    recordHistory: history
  };
  return { layerId, dependencies, history, document: () => document };
};

describe('semantic text command executor', () => {
  it('replaces Unicode grapheme ranges atomically without corrupting surrogate pairs', async () => {
    const state = setup();
    await executeSemanticTextCommand({ kind: 'replace', layerId: state.layerId,
      start: 1, end: 3, text: '🙂' }, state.dependencies);
    const layer = findDocumentLayer(state.document(), state.layerId)!;
    expect(layer.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.text : null).toBe('A🙂B');
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('batches range formatting and RTL paragraph properties into one history publication', async () => {
    const state = setup('abc אבג');
    await executeSemanticTextCommand({ kind: 'format', layerId: state.layerId, start: 0, end: 3,
      style: { fontSize: 72, tracking: 120, fill: { enabled: true, color: '#ff0088' },
        stroke: { enabled: true, color: '#001122', width: 3 },
        syntheticBold: true, syntheticItalic: true },
      paragraph: { alignment: 'end', direction: 'rtl', leading: { value: 88 }, startIndent: 12 } },
    state.dependencies);
    const layer = findDocumentLayer(state.document(), state.layerId)!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') throw new Error('Text missing.');
    expect(layer.text.source.styleRuns[0]).toMatchObject({ end: 3, fontSize: 72, tracking: 120,
      fill: { kind: 'solid' }, stroke: { width: 3 }, syntheticBold: true,
      syntheticItalic: true });
    expect(layer.text.source.paragraphRuns[0]).toMatchObject({ alignment: 'end', direction: 'rtl',
      lineHeight: { kind: 'absolute', value: 88 }, startIndent: 12 });
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('publishes paragraph, vertical writing and transformed geometry together', async () => {
    const state = setup('vertical');
    await executeSemanticTextCommand({ kind: 'layout', layerId: state.layerId, mode: 'paragraph',
      frame: { x: 2, y: 3, width: 180, height: 240 }, writingMode: 'vertical-rl',
      transform: { a: 0, b: 1, c: -1, d: 0, tx: 250, ty: 40 } }, state.dependencies);
    const layer = findDocumentLayer(state.document(), state.layerId)!;
    expect(layer.type === 'text' ? layer.text.source : null).toMatchObject({
      kind: 'flow', layout: { mode: 'paragraph', writingMode: 'vertical-rl',
        frame: { x: 2, y: 3, width: 180, height: 240 } }
    });
    expect(layer.transform).toEqual({ a: 0, b: 1, c: -1, d: 0, tx: 250, ty: 40 });
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it('reports a missing requested font before publishing a destructive format', async () => {
    const state = setup('keep me');
    await expect(executeSemanticTextCommand({ kind: 'format', layerId: state.layerId,
      style: { font: { assetId: 'missing-font' }, fontSize: 90 } }, state.dependencies))
      .rejects.toThrow(/font.*unavailable/i);
    const layer = findDocumentLayer(state.document(), state.layerId)!;
    expect(layer.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.styleRuns[0].fontSize : null).not.toBe(90);
    expect(state.history).not.toHaveBeenCalled();
  });

  it('creates editable text bound to one explicit native contour', async () => {
    const font = BUNDLED_TEXT_FONT_CATALOG[0]!;
    const path = createVectorPath('title-path', 'Title path', [
      createSubpath('main-contour', [
        createAnchor('a', { x: 20, y: 40 }),
        createAnchor('b', { x: 280, y: 80 })
      ])
    ]);
    const vector = createVectorLayer([path], 'Paths');
    let document: ImageDocument = {
      ...createImageDocument('Path Text', 400, 300, 'source'),
      layers: [vector], activeLayerId: vector.id
    };
    const history = vi.fn();
    const dependencies: SemanticTextCommandDependencies = {
      fontRegistry: { availableAssets: [font] } as never,
      getDocument: () => document,
      getTextSettings: () => ({ family: font.familyNames[0]!, style: font.styleName,
        size: 48, antiAlias: 'smooth', alignment: 'start', fillEnabled: true }),
      getForegroundColor: () => '#224466',
      applyDocument: (next) => { document = next; },
      recordHistory: history
    };
    const result = await executeSemanticTextCommand({
      kind: 'create', mode: 'path', text: 'Along the curve', origin: { x: 0, y: 0 },
      writingMode: 'horizontal-tb', path: {
        layerId: vector.id, elementId: path.id, subpathId: 'main-contour',
        startOffset: 22, side: 'right', upright: false, direction: 'reverse'
      }
    }, dependencies);
    const layer = result ? findDocumentLayer(document, result.layerId) : null;
    expect(layer?.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.layout : null).toEqual({
      mode: 'path', pathLayerId: vector.id, pathElementId: path.id,
      pathSubpathId: 'main-contour', startOffset: 22, side: 'right',
      upright: false, direction: 'reverse'
    });
    expect(history).toHaveBeenCalledOnce();
  });

  it('does not mutate the active layer when the requested contour is missing', async () => {
    const font = BUNDLED_TEXT_FONT_CATALOG[0]!;
    const path = createVectorPath('title-path', 'Title path', [
      createSubpath('main-contour', [
        createAnchor('a', { x: 20, y: 40 }),
        createAnchor('b', { x: 280, y: 80 })
      ])
    ]);
    const vector = createVectorLayer([path], 'Paths');
    let document: ImageDocument = {
      ...createImageDocument('Path Text', 400, 300, 'source'),
      layers: [vector], activeLayerId: vector.id
    };
    const original = document;
    const history = vi.fn();
    const result = await executeSemanticTextCommand({
      kind: 'create', mode: 'path', text: 'Missing path', name: 'Must not rename',
      origin: { x: 0, y: 0 }, writingMode: 'horizontal-tb', path: {
        layerId: vector.id, elementId: path.id, subpathId: 'missing-contour',
        startOffset: 0, side: 'left', upright: true, direction: 'forward'
      }
    }, {
      fontRegistry: { availableAssets: [font] } as never,
      getDocument: () => document,
      getTextSettings: () => ({ family: font.familyNames[0]!, style: font.styleName,
        size: 48, antiAlias: 'smooth', alignment: 'start', fillEnabled: true }),
      getForegroundColor: () => '#224466',
      applyDocument: (next) => { document = next; },
      recordHistory: history
    });
    expect(result).toBeNull();
    expect(document).toBe(original);
    expect(findDocumentLayer(document, vector.id)?.name).toBe('Paths');
    expect(history).not.toHaveBeenCalled();
  });
});
