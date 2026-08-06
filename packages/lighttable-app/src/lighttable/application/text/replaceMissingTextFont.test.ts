import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import {
  createImageDocument,
  layerDerivedPreviewIsCurrent,
  semanticLayerDependencyKey
} from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  replaceMissingTextFont,
  replaceMissingTextFonts
} from './replaceMissingTextFont';

const replacement: DocumentFontAsset = {
  assetId: 'replacement',
  faceIndex: 0,
  fingerprintSha256: 'a'.repeat(64),
  source: 'bundled',
  container: 'woff2',
  outline: 'truetype',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Source Serif 4'],
  postScriptName: 'SourceSerif4-Regular',
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 1024
};

describe('replaceMissingTextFont', () => {
  it('replaces all runs atomically and invalidates a retained import preview', () => {
    const created = createTextLayer(
      createImageDocument('Font recovery', 400, 200, 'source'),
      createDefaultTextLayerData(),
      'Missing face'
    );
    const layer = findDocumentLayer(created, created.activeLayerId!)!;
    if (layer.type !== 'text') throw new Error('Expected a text layer.');
    const withPreview = {
      ...created,
      layers: created.layers.map((candidate) => candidate.id === layer.id
        ? {
            ...candidate,
            derivedPreview: {
              width: 100,
              height: 20,
              transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
              dependencyKey: semanticLayerDependencyKey(candidate)!,
              source: 'photoshop-layer-preview' as const
            }
          }
        : candidate)
    };

    const replaced = replaceMissingTextFont(withPreview, layer.id, replacement);
    const result = findDocumentLayer(replaced, layer.id)!;

    expect(result.type).toBe('text');
    if (result.type !== 'text' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.styleRuns).toEqual([
      expect.objectContaining({
        requestedFont: expect.objectContaining({
          families: ['Source Serif 4'],
          preferredAsset: expect.objectContaining({ assetId: 'replacement' }),
          replacement: expect.objectContaining({
            original: expect.objectContaining({ families: expect.arrayContaining(['Inter']) }),
            originalStyle: { weight: 400, stretch: 100, fontStyle: 'normal' },
            replacementAsset: expect.objectContaining({ assetId: 'replacement' })
          })
        })
      })
    ]);
    expect(result.text.revisions.font).toBeGreaterThan(layer.text.revisions.font);
    expect(layerDerivedPreviewIsCurrent(result)).toBe(false);
    expect(replaced.assets.fonts).toContainEqual(replacement);
  });

  it('leaves non-text targets unchanged', () => {
    const document = createImageDocument('No text', 32, 32, 'source');
    expect(replaceMissingTextFont(document, 'missing' as never, replacement)).toBe(document);
  });

  it('replaces one unavailable font across multiple editable layers in one snapshot', () => {
    const first = createTextLayer(
      createImageDocument('Font manager', 320, 200, 'source'),
      createDefaultTextLayerData(),
      'First'
    );
    const firstId = first.activeLayerId!;
    const second = createTextLayer(first, createDefaultTextLayerData(), 'Second');
    const secondId = second.activeLayerId!;

    const replaced = replaceMissingTextFonts(second, [firstId, secondId], replacement);
    [firstId, secondId].forEach((layerId) => {
      const layer = findDocumentLayer(replaced, layerId)!;
      expect(layer.type).toBe('text');
      if (layer.type === 'text' && layer.text.source.kind === 'flow') {
        expect(layer.text.source.styleRuns[0]?.requestedFont.preferredAsset?.assetId)
          .toBe('replacement');
      }
    });
  });

  it('preserves available runs when replacing one requested font in mixed text', () => {
    const text = createDefaultTextLayerData();
    if (text.source.kind !== 'flow') throw new Error('Expected flow text.');
    const run = text.source.styleRuns[0]!;
    const mixed = {
      ...text,
      source: {
        ...text.source,
        styleRuns: [
          { ...run, start: 0, end: 2, requestedFont: { families: ['Missing Face'] } },
          { ...run, start: 2, end: 4, requestedFont: { families: ['Inter'] } }
        ]
      }
    };
    const document = createTextLayer(
      createImageDocument('Mixed fonts', 320, 200, 'source'),
      mixed,
      'Mixed'
    );
    const layerId = document.activeLayerId!;
    const replaced = replaceMissingTextFont(document, layerId, replacement, 'Missing Face');
    const layer = findDocumentLayer(replaced, layerId)!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') {
      throw new Error('Expected flow text.');
    }
    expect(layer.text.source.styleRuns[0]?.requestedFont.preferredAsset?.assetId)
      .toBe('replacement');
    expect(layer.text.source.styleRuns[1]?.requestedFont).toEqual({ families: ['Inter'] });
    expect(replaced.assets.fonts).toContainEqual(replacement);
  });

  it('keeps the first authored request when a replacement is replaced again', () => {
    const document = createTextLayer(
      createImageDocument('Replacement provenance', 320, 200, 'source'),
      createDefaultTextLayerData(), 'Text'
    );
    const layerId = document.activeLayerId!;
    const first = replaceMissingTextFont(document, layerId, replacement);
    const alternative = {
      ...replacement, assetId: 'alternative', fingerprintSha256: 'b'.repeat(64),
      familyNames: ['Alternative Sans'], postScriptName: 'AlternativeSans-Bold',
      styleName: 'Bold', weight: 700
    };
    const second = replaceMissingTextFont(first, layerId, alternative);
    const layer = findDocumentLayer(second, layerId)!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') throw new Error('Expected flow text.');
    expect(layer.text.source.styleRuns[0]?.requestedFont.replacement).toMatchObject({
      original: { families: expect.arrayContaining(['Inter']) },
      originalStyle: { weight: 400, stretch: 100, fontStyle: 'normal' },
      replacementAsset: { assetId: 'alternative' }
    });
  });
});
