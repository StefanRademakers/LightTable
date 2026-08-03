import {
  createDefaultFlowTextSource,
  createDefaultTextLayerData
} from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import {
  documentNeedsFlowFontFallback,
  resolveFlowFontSelections
} from './flowFontSelection';
import {
  createImageDocument,
  createTextLayerNode
} from '../../editor/document/documentTypes';

const asset = (assetId: string, family: string, weight = 400): DocumentFontAsset => ({
  assetId,
  familyNames: [family],
  styleName: weight === 400 ? 'Regular' : 'Bold',
  weight,
  stretch: 100,
  italic: false,
  faceIndex: 0,
  fingerprintSha256: (assetId === 'fallback' ? 'b' : 'a').repeat(64),
  byteLength: 1024,
  source: 'bundled',
  container: 'woff2',
  outline: 'truetype',
  postScriptName: `${family.replaceAll(' ', '')}-${weight}`,
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
});

describe('resolveFlowFontSelections', () => {
  it('keeps exact requested provenance', () => {
    const source = createDefaultFlowTextSource('Exact');
    const exact = asset('exact', 'Inter');
    const result = resolveFlowFontSelections(source, [exact]);
    expect(result.missingSourceRunIndices).toEqual([]);
    expect(result.selections[0]).toMatchObject({
      sourceRunIndex: 0,
      font: { assetId: 'exact' },
      familyName: 'Inter',
      resolution: { kind: 'flow-exact', sourceRunIndex: 0 }
    });
  });

  it('uses only an explicitly ordered substitute and reports provenance', () => {
    const source = createDefaultFlowTextSource('Substitute');
    const run = source.styleRuns[0]!;
    const missingSource = {
      ...source,
      styleRuns: [{
        ...run,
        requestedFont: { families: ['Unavailable'], postScriptName: 'Unavailable-Regular' }
      }]
    };
    const fallback = asset('fallback', 'Fallback');
    const result = resolveFlowFontSelections(missingSource, [fallback], ['Fallback']);
    expect(result.missingSourceRunIndices).toEqual([]);
    expect(result.selections[0]).toMatchObject({
      font: { assetId: 'fallback' },
      familyName: 'Fallback',
      resolution: {
        kind: 'flow-substituted',
        reason: 'asset-missing',
        requested: { families: ['Unavailable'], postScriptName: 'Unavailable-Regular' }
      }
    });
  });

  it('does not silently choose an available face outside policy', () => {
    const source = createDefaultFlowTextSource('Missing');
    const run = source.styleRuns[0]!;
    const result = resolveFlowFontSelections({
      ...source,
      styleRuns: [{ ...run, requestedFont: { families: ['Unavailable'] } }]
    }, [asset('exact', 'Unrelated')], ['Fallback']);
    expect(result.selections).toEqual([]);
    expect(result.missingSourceRunIndices).toEqual([0]);
  });

  it('materializes fallback only for visible unresolved flow text', () => {
    const document = createImageDocument('Lazy fallback', 32, 24, 'source');
    const source = createDefaultFlowTextSource('Visible');
    const run = source.styleRuns[0]!;
    document.layers = [createTextLayerNode({
      ...createDefaultTextLayerData(),
      source: {
        ...source,
        styleRuns: [{ ...run, requestedFont: { families: ['Unavailable'] } }]
      }
    }, 'Text')];

    expect(documentNeedsFlowFontFallback(document, [])).toBe(true);
    expect(documentNeedsFlowFontFallback(document, [asset('fallback', 'Inter')])).toBe(false);
    document.layers = [{ ...document.layers[0]!, visible: false }];
    expect(documentNeedsFlowFontFallback(document, [])).toBe(false);
  });
});
