import { describe, expect, it } from 'vitest';
import {
  createDefaultTextLayerData,
  type FlowTextLayout,
  type TextLayerData
} from '@lighttable/text-core';
import {
  createImageDocument,
  layerDerivedPreviewIsCurrent,
  semanticLayerDependencyKey,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { translationMatrix } from '../../editor/tools/transform/affine';
import {
  buildLayeredDocumentFile,
  parseLayeredDocumentFile
} from '../../editor/persistence/layeredDocumentFormat';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { textLayerFontStatus } from '../../text/fonts/textLayerFontStatus';
import { replaceMissingTextFont } from './replaceMissingTextFont';

const missing: DocumentFontAsset = {
  assetId: `system:${'c'.repeat(64)}:0`, faceIndex: 0,
  fingerprintSha256: 'c'.repeat(64), source: 'system', container: 'sfnt',
  outline: 'truetype', postScriptName: 'TemporarilyAvailable-Regular',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Temporarily Available'], styleName: 'Regular', weight: 400,
  stretch: 100, italic: false, byteLength: 4096
};

const replacement: DocumentFontAsset = {
  ...missing,
  assetId: 'bundled-replacement', fingerprintSha256: 'd'.repeat(64),
  source: 'bundled', container: 'woff2', familyNames: ['Replacement Sans'],
  postScriptName: 'ReplacementSans-Regular', byteLength: 2048
};

const layouts: readonly FlowTextLayout[] = [
  { mode: 'point', origin: { x: 17, y: -4 }, writingMode: 'horizontal-tb' },
  {
    mode: 'paragraph', frame: { x: 3, y: 7, width: 240, height: 96 },
    overflow: 'indicator', writingMode: 'horizontal-tb'
  },
  {
    mode: 'path', pathLayerId: 'vector-path-layer', pathElementId: 'path-element',
    pathSubpathId: 'path-subpath', startOffset: 12, endOffset: 180,
    direction: 'reverse', side: 'right', upright: false
  }
];

const missingText = (layout: FlowTextLayout): TextLayerData => {
  const text = createDefaultTextLayerData();
  if (text.source.kind !== 'flow') throw new Error('Expected flow fixture.');
  const run = text.source.styleRuns[0]!;
  return {
    ...text,
    source: {
      ...text.source,
      text: 'ABCD',
      layout,
      styleRuns: [
        {
          ...run, start: 0, end: 2,
          requestedFont: {
            families: missing.familyNames,
            postScriptName: missing.postScriptName,
            preferredAsset: missing
          }
        },
        { ...run, start: 2, end: 4, requestedFont: { families: ['Inter'] } }
      ],
      paragraphRuns: [{ ...text.source.paragraphRuns[0]!, start: 0, end: 4 }]
    }
  };
};

describe('native missing-font recovery round trip', () => {
  it.each(layouts)('retains preview, mixed runs, layout and affine transform for $mode text', async (layout) => {
    const created = createTextLayer(
      createImageDocument(`Missing ${layout.mode}`, 400, 240, 'source'),
      missingText(layout),
      `Missing ${layout.mode}`
    );
    const layer = findDocumentLayer(created, created.activeLayerId!);
    if (layer?.type !== 'text') throw new Error('Expected text layer.');
    const transformed = {
      ...layer,
      transform: { a: 0, b: 1, c: -1, d: 0, tx: 211, ty: 43 }
    };
    const cached = {
      ...transformed,
      derivedPreview: {
        width: 128, height: 48, transform: translationMatrix(-5, 9),
        dependencyKey: semanticLayerDependencyKey(transformed)!,
        source: 'imported-semantic-preview' as const
      }
    };
    const document = {
      ...created,
      layers: [cached],
      assets: { ...created.assets, fonts: [missing] }
    };
    const file = buildLayeredDocumentFile(
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      document,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      [{ layerId: cached.id, pixels: new Blob([new Uint8Array([2, 3, 4])], { type: 'image/png' }), mask: null }],
      'missing-font.png'
    );

    const parsed = await parseLayeredDocumentFile(file);
    if (!parsed) throw new Error('Native fixture did not reopen.');
    const reopened = findDocumentLayer(parsed.document, cached.id);
    if (reopened?.type !== 'text' || reopened.text.source.kind !== 'flow') {
      throw new Error('Expected reopened flow text.');
    }
    expect(parsed.fontAssets).toEqual([]);
    expect(textLayerFontStatus(reopened, [])).toMatchObject({ kind: 'missing' });
    expect(layerDerivedPreviewIsCurrent(reopened)).toBe(true);
    expect(reopened.transform).toEqual(cached.transform);
    expect(reopened.text.source.layout).toEqual(layout);
    expect(reopened.text.source.styleRuns).toHaveLength(2);

    const replacedDocument = replaceMissingTextFont(
      parsed.document, reopened.id, replacement, missing.postScriptName
    );
    const replaced = findDocumentLayer(replacedDocument, reopened.id);
    if (replaced?.type !== 'text' || replaced.text.source.kind !== 'flow') {
      throw new Error('Expected replaced flow text.');
    }
    expect(replaced.text.source.layout).toEqual(layout);
    expect(replaced.transform).toEqual(cached.transform);
    expect(replaced.text.source.styleRuns[0]?.requestedFont.preferredAsset?.assetId)
      .toBe(replacement.assetId);
    expect(replaced.text.source.styleRuns[1]?.requestedFont).toEqual({ families: ['Inter'] });
    expect(replaced.derivedPreview).toEqual(reopened.derivedPreview);
    expect(layerDerivedPreviewIsCurrent(replaced)).toBe(false);
    expect(replacedDocument.assets.fonts).toContainEqual(replacement);
  });

  it('persists replacement provenance and a retained fallback for reopen without replacement bytes', async () => {
    const created = createTextLayer(
      createImageDocument('Offline replacement', 400, 240, 'source'),
      missingText(layouts[0]!), 'Offline replacement'
    );
    const layer = findDocumentLayer(created, created.activeLayerId!);
    if (layer?.type !== 'text') throw new Error('Expected text layer.');
    layer.derivedPreview = {
      width: 128, height: 48, transform: translationMatrix(4, 6),
      dependencyKey: semanticLayerDependencyKey(layer)!, source: 'photoshop-layer-preview'
    };
    const systemReplacement: DocumentFontAsset = { ...replacement, source: 'system' };
    const replaced = replaceMissingTextFont(
      created, layer.id, systemReplacement, missing.postScriptName
    );
    const file = buildLayeredDocumentFile(
      new Blob([new Uint8Array([1])], { type: 'image/png' }), replaced,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      [
        { layerId: created.layers[0]!.id, pixels: new Blob([new Uint8Array([5])], { type: 'image/png' }), mask: null },
        { layerId: layer.id, pixels: new Blob([new Uint8Array([2, 3, 4])], { type: 'image/png' }), mask: null }
      ],
      'offline-replacement.png'
    );

    const reopened = await parseLayeredDocumentFile(file);
    const reopenedLayer = reopened ? findDocumentLayer(reopened.document, layer.id) : null;
    if (reopenedLayer?.type !== 'text' || reopenedLayer.text.source.kind !== 'flow') {
      throw new Error('Expected reopened flow text.');
    }
    expect(reopened?.fontAssets).toEqual([]);
    expect(reopenedLayer.derivedPreview).toBeDefined();
    expect(reopenedLayer.text.source.styleRuns[0]?.requestedFont.replacement).toMatchObject({
      original: { postScriptName: missing.postScriptName },
      replacementAsset: { assetId: replacement.assetId }
    });
    expect(textLayerFontStatus(reopenedLayer, [])).toMatchObject({ kind: 'missing' });
  });
});
