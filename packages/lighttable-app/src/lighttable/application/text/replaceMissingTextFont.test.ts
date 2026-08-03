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
import { replaceMissingTextFont } from './replaceMissingTextFont';

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
          preferredAsset: expect.objectContaining({ assetId: 'replacement' })
        })
      })
    ]);
    expect(result.text.revisions.font).toBeGreaterThan(layer.text.revisions.font);
    expect(layerDerivedPreviewIsCurrent(result)).toBe(false);
  });

  it('leaves non-text targets unchanged', () => {
    const document = createImageDocument('No text', 32, 32, 'source');
    expect(replaceMissingTextFont(document, 'missing' as never, replacement)).toBe(document);
  });
});
