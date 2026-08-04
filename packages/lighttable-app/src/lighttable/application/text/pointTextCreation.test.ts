import { describe, expect, it, vi } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createEditorSession } from '../../editor/session/editorSession';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { translationMatrix } from '../../editor/geometry/affine';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import {
  buildLayeredDocumentFile,
  parseLayeredDocumentFile
} from '../../editor/persistence/layeredDocumentFormat';
import { fingerprintFontBytes } from '../../text/fonts/DocumentFontRegistry';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  ParagraphTextCreationController,
  PointTextCreationController,
  createParagraphTextDocument,
  createPathTextDocument,
  createPointTextDocument,
  defaultTextStyleForFamily,
  resolvePathTextCreationTarget,
  resolveTextToolFont,
  textCreationKind
} from './pointTextCreation';

describe('Type Tool gesture', () => {
  it('uses a zoom-independent screen threshold for point versus paragraph text', () => {
    expect(textCreationKind({ x: 10, y: 10 }, { x: 11, y: 10 }, 2)).toBe('point');
    expect(textCreationKind({ x: 10, y: 10 }, { x: 13, y: 10 }, 2)).toBe('paragraph');
    expect(textCreationKind({ x: 10, y: 10 }, { x: 16, y: 10 }, 0.5)).toBe('point');
    expect(textCreationKind({ x: 10, y: 10 }, { x: 19, y: 10 }, 0.5)).toBe('paragraph');
  });
});

const font: DocumentFontAsset = {
  assetId: 'inter',
  faceIndex: 0,
  fingerprintSha256: 'a'.repeat(64),
  source: 'bundled',
  container: 'woff2',
  outline: 'truetype',
  postScriptName: 'Inter-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Inter'],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 10
};

describe('PointTextCreationController', () => {
  it('owns disposable content and commits it only once', () => {
    const controller = new PointTextCreationController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const document = createImageDocument('Fixture', 100, 80, 'pixels');
    controller.begin(document.id, { x: 12, y: 9 });
    controller.update('Hello');
    expect(controller.commit()).toEqual({
      documentId: document.id,
      origin: { x: 12, y: 9 },
      text: 'Hello'
    });
    expect(controller.commit()).toBeNull();
    expect(controller.getSnapshot()).toEqual({ status: 'idle', request: null });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('cancels empty or explicit creation without producing a request', () => {
    const controller = new PointTextCreationController();
    const document = createImageDocument('Fixture', 100, 80, 'pixels');
    controller.begin(document.id, { x: 1, y: 2 });
    controller.update('');
    expect(controller.commit()).toBeNull();
    controller.begin(document.id, { x: 3, y: 4 });
    expect(controller.cancel()).toBe(true);
    expect(controller.cancel()).toBe(false);
  });
});

describe('ParagraphTextCreationController', () => {
  it('owns its pointer and preserves a dragged frame for one commit', () => {
    const controller = new ParagraphTextCreationController();
    const document = createImageDocument('Fixture', 500, 400, 'pixels');
    expect(controller.begin(document.id, document.activeLayerId, 7, { x: 40, y: 30 })).toBe(true);
    expect(controller.owns(8)).toBe(false);
    expect(controller.move(7, { x: 240, y: 150 })).toBe(true);
    expect(controller.finish(7)).toBe(true);
    controller.update('A paragraph');
    expect(controller.commit()).toMatchObject({
      documentId: document.id,
      aboveLayerId: document.activeLayerId,
      pointerId: null,
      start: { x: 40, y: 30 },
      end: { x: 240, y: 150 },
      text: 'A paragraph'
    });
    expect(controller.commit()).toBeNull();
  });

  it('turns a click into the default 240 by 120 pixel paragraph frame', () => {
    const controller = new ParagraphTextCreationController();
    const document = createImageDocument('Fixture', 500, 400, 'pixels');
    controller.begin(document.id, null, 3, { x: 12, y: 18 });
    expect(controller.finish(3)).toBe(true);
    expect(controller.getSnapshot().request).toMatchObject({
      start: { x: 12, y: 18 },
      end: { x: 252, y: 138 }
    });
  });
});

describe('createPointTextDocument', () => {
  it('resolves family/style exactly and deterministically without silent fallback', () => {
    const bold = { ...font, assetId: 'inter-bold', styleName: 'Bold', weight: 700 };
    expect(resolveTextToolFont([bold, font], { family: 'Inter', style: 'Regular' }))
      .toEqual(font);
    expect(resolveTextToolFont([font, bold], { family: 'Inter', style: 'Bold' }))
      .toEqual(bold);
    expect(resolveTextToolFont([font], { family: 'Missing', style: 'Regular' }))
      .toBeNull();
    expect(defaultTextStyleForFamily([bold, font], 'Inter')).toBe('Regular');
    expect(defaultTextStyleForFamily([font, bold], 'Inter')).toBe('Regular');
  });

  it('creates canonical exact-font point text with foreground color', () => {
    const before = createImageDocument('Fixture', 100, 80, 'pixels');
    const settings = createEditorSession().text;
    const after = createPointTextDocument(before, {
      documentId: before.id,
      origin: { x: 30, y: 20 },
      text: 'Hello'
    }, settings, font, '#3366cc');
    const layer = findDocumentLayer(after, after.activeLayerId);
    expect(layer?.type).toBe('text');
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
    expect(layer.transform).toEqual(translationMatrix(30, 20));
    expect(layer.text.source.layout).toEqual({
      mode: 'point', origin: { x: 0, y: 0 }, writingMode: 'horizontal-tb'
    });
    expect(layer.text.source.styleRuns[0]).toMatchObject({
      fontSize: 250,
      requestedFont: {
        families: ['Inter'],
        postScriptName: 'Inter-Regular',
        preferredAsset: { assetId: 'inter', fingerprintSha256: 'a'.repeat(64) }
      },
      fill: { kind: 'solid', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }
    });
    expect(after.assets.fonts).toEqual([font]);
    expect(before.assets.fonts).toEqual([]);
  });

  it('creates editable vertical point text without a bitmap substitute', () => {
    const before = createImageDocument('Vertical', 400, 300, 'pixels');
    const after = createPointTextDocument(before, {
      documentId: before.id,
      origin: { x: 80, y: 30 },
      text: 'Vertical'
    }, createEditorSession().text, font, '#000000', 'vertical-rl');
    const layer = findDocumentLayer(after, after.activeLayerId);
    expect(layer?.type).toBe('text');
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
    expect(layer.text.source.layout).toEqual({
      mode: 'point', origin: { x: 0, y: 0 }, writingMode: 'vertical-rl'
    });
  });

  it('rebases a document click into a transformed parent group', () => {
    const before = createImageDocument('Fixture', 100, 80, 'pixels');
    const background = before.layers[0]!;
    const group = createGroupLayer('Group');
    group.transform = translationMatrix(10, 20);
    group.children = [background];
    const nested = { ...before, layers: [group] };
    const after = createPointTextDocument(nested, {
      documentId: nested.id,
      origin: { x: 50, y: 70 },
      text: 'Nested'
    }, createEditorSession().text, font, '#000000');
    const layer = findDocumentLayer(after, after.activeLayerId);
    expect(layer?.transform).toEqual(translationMatrix(40, 50));
  });

  it('ignores a request from another document identity', () => {
    const before = createImageDocument('Fixture', 100, 80, 'pixels');
    expect(createPointTextDocument(before, {
      documentId: 'other' as typeof before.id,
      origin: { x: 0, y: 0 },
      text: 'Stale'
    }, createEditorSession().text, font, '#000000')).toBe(before);
  });

  it('forms one reversible document-history command', () => {
    let current = createImageDocument('Fixture', 100, 80, 'pixels');
    const before = current;
    const entries: Array<{ undo(): void; redo(): void }> = [];
    const after = createPointTextDocument(before, {
      documentId: before.id,
      origin: { x: 8, y: 13 },
      text: 'Undo me'
    }, createEditorSession().text, font, '#000000');
    const history = createDocumentMutationController(() => ({
      getDocument: () => current,
      applySnapshot: (document) => { current = document; },
      pushHistoryEntry: (entry) => entries.push(entry)
    }));
    current = after;
    expect(history.record(before, after)).toBe(true);
    expect(entries).toHaveLength(1);
    entries[0]!.undo();
    expect(current).toBe(before);
    entries[0]!.redo();
    expect(current).toBe(after);
  });

  it('round-trips authored point text and its exact font asset', async () => {
    const fontBytes = new Uint8Array([1, 2, 3, 4]);
    const persistedFont = {
      ...font,
      fingerprintSha256: await fingerprintFontBytes(fontBytes),
      byteLength: fontBytes.byteLength
    };
    const before = createImageDocument('Fixture', 100, 80, 'pixels');
    const authored = createPointTextDocument(before, {
      documentId: before.id,
      origin: { x: 18, y: 23 },
      text: 'Reopen me'
    }, createEditorSession().text, persistedFont, '#224466');
    const file = buildLayeredDocumentFile(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      authored,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      [{
        layerId: before.layers[0]!.id,
        pixels: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
        mask: null
      }, {
        fingerprintSha256: persistedFont.fingerprintSha256,
        source: new Blob([fontBytes], { type: 'font/woff2' })
      }],
      'point-text.png'
    );
    const reopened = await parseLayeredDocumentFile(file);
    expect(reopened?.document.assets.fonts).toEqual([persistedFont]);
    expect(reopened?.fontAssets[0]?.fingerprintSha256)
      .toBe(persistedFont.fingerprintSha256);
    const layer = reopened
      ? findDocumentLayer(reopened.document, reopened.document.activeLayerId)
      : null;
    expect(layer?.type).toBe('text');
    expect(layer?.transform).toEqual(translationMatrix(18, 23));
    if (layer?.type === 'text' && layer.text.source.kind === 'flow') {
      expect(layer.text.source.text).toBe('Reopen me');
      expect(layer.text.source.styleRuns[0]?.requestedFont.preferredAsset)
        .toMatchObject({ fingerprintSha256: persistedFont.fingerprintSha256 });
    }
  });
});

describe('createParagraphTextDocument', () => {
  it('creates a canonical paragraph frame from either drag direction', () => {
    const before = createImageDocument('Fixture', 500, 400, 'pixels');
    const after = createParagraphTextDocument(before, {
      documentId: before.id,
      pointerId: null,
      aboveLayerId: before.activeLayerId,
      start: { x: 260, y: 180 },
      end: { x: 60, y: 40 },
      text: 'Wrapped paragraph text'
    }, createEditorSession().text, font, '#3366cc');
    const layer = findDocumentLayer(after, after.activeLayerId);
    expect(layer?.type).toBe('text');
    expect(layer?.transform).toEqual(translationMatrix(60, 40));
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
    expect(layer.text.source.layout).toEqual({
      mode: 'paragraph',
      frame: { x: 0, y: 0, width: 200, height: 140 },
      overflow: 'indicator',
      writingMode: 'horizontal-tb'
    });
    expect(layer.text.source.styleRuns[0]?.requestedFont.preferredAsset)
      .toMatchObject({ assetId: font.assetId });
    expect(after.assets.fonts).toEqual([font]);
  });

  it('rejects stale and degenerate paragraph requests', () => {
    const before = createImageDocument('Fixture', 500, 400, 'pixels');
    const request = {
      documentId: before.id,
      pointerId: null,
      aboveLayerId: before.activeLayerId,
      start: { x: 10, y: 10 },
      end: { x: 10, y: 10 },
      text: 'Text'
    };
    expect(createParagraphTextDocument(
      before, request, createEditorSession().text, font, '#000000'
    )).toBe(before);
    expect(createParagraphTextDocument(before, {
      ...request, documentId: 'other' as typeof before.id, end: { x: 20, y: 20 }
    }, createEditorSession().text, font, '#000000')).toBe(before);
  });
});

describe('path text creation', () => {
  const pathDocument = () => {
    const document = createImageDocument('Fixture', 500, 400, 'pixels');
    const path = createVectorPath('curve', 'Curve', [
      createSubpath('contour', [
        createAnchor('a', { x: 20, y: 40 }),
        createAnchor('b', { x: 300, y: 80 })
      ])
    ]);
    const vector = createVectorLayer([path], 'Path');
    return { document: { ...document, layers: [...document.layers, vector] }, vector, path };
  };

  it('resolves one explicitly selected native path and its sole contour', () => {
    const { document, vector, path } = pathDocument();
    expect(resolvePathTextCreationTarget(document, {
      elements: [{ layerId: vector.id, elementId: path.id }],
      paths: [], anchors: [], active: null
    })).toEqual({
      kind: 'resolved',
      target: {
        pathLayerId: vector.id,
        pathElementId: path.id,
        pathSubpathId: 'contour'
      }
    });
  });

  it('rejects absent and ambiguous path selections instead of guessing', () => {
    const { document, vector, path } = pathDocument();
    expect(resolvePathTextCreationTarget(document, {
      elements: [], paths: [], anchors: [], active: null
    })).toEqual({ kind: 'none' });
    expect(resolvePathTextCreationTarget(document, {
      elements: [{ layerId: vector.id, elementId: path.id }],
      paths: [{ layerId: vector.id, pathId: 'another' }],
      anchors: [], active: null
    })).toEqual({ kind: 'ambiguous' });
  });

  it('creates editable flow text with exact stable path references', () => {
    const { document, vector, path } = pathDocument();
    const after = createPathTextDocument(document, {
      documentId: document.id,
      origin: { x: 200, y: 100 },
      text: 'Along the curve'
    }, {
      pathLayerId: vector.id,
      pathElementId: path.id,
      pathSubpathId: 'contour'
    }, createEditorSession().text, font, '#3366cc');
    const layer = findDocumentLayer(after, after.activeLayerId);
    expect(layer?.type).toBe('text');
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
    expect(layer.text.source.text).toBe('Along the curve');
    expect(layer.text.source.layout).toEqual({
      mode: 'path',
      pathLayerId: vector.id,
      pathElementId: path.id,
      pathSubpathId: 'contour',
      startOffset: 0,
      side: 'left',
      upright: true,
      direction: 'forward'
    });
    expect(after.assets.fonts).toEqual([font]);
  });

  it('rejects a stale target deleted before the creation dialog commits', () => {
    const { document, vector, path } = pathDocument();
    const stale = { ...document, layers: document.layers.filter(({ id }) => id !== vector.id) };
    expect(createPathTextDocument(stale, {
      documentId: stale.id,
      origin: { x: 0, y: 0 },
      text: 'Stale'
    }, {
      pathLayerId: vector.id,
      pathElementId: path.id,
      pathSubpathId: 'contour'
    }, createEditorSession().text, font, '#000000')).toBe(stale);
  });
});
