import { describe, expect, it, vi } from 'vitest';
import { createEditorSession } from '../../editor/session/editorSession';
import {
  createGroupLayer,
  createImageDocument,
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
  PointTextCreationController,
  createPointTextDocument,
  defaultTextStyleForFamily,
  resolveTextToolFont
} from './pointTextCreation';

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
      fontSize: 16,
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
