import {
  CONTRACT_FIXTURE_FONT_ASSET,
  createDefaultTextLayerData,
  createPositionedTextFixture
} from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayer } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  documentTextFontDiagnostics,
  summarizeTextFontDiagnostics,
  textLayerFontStatus
} from './textLayerFontStatus';

const asset = (
  familyNames: readonly string[],
  overrides: Partial<DocumentFontAsset> = {}
): DocumentFontAsset => ({
  assetId: 'font-fixture',
  faceIndex: 0,
  fingerprintSha256: 'a'.repeat(64),
  source: 'document',
  container: 'sfnt',
  outline: 'truetype',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
  familyNames,
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 4,
  ...overrides
});

const textLayer = (positioned = false) => {
  const document = createTextLayer(
    createImageDocument('Status', 32, 24, 'source'),
    positioned ? createPositionedTextFixture() : createDefaultTextLayerData()
  );
  const layer = findDocumentLayer(document, document.activeLayerId);
  if (layer?.type !== 'text') throw new Error('Expected text fixture.');
  return layer;
};

describe('textLayerFontStatus', () => {
  it('aggregates exact, explicit substitution and missing flow fonts', () => {
    const layer = textLayer();
    const inter = asset(['Inter']);

    expect(textLayerFontStatus(layer, [inter]).kind).toBe('exact');
    expect(textLayerFontStatus(layer, [asset(['Fallback'])], ['Fallback']))
      .toMatchObject({ kind: 'substituted', label: 'Substituted' });
    expect(textLayerFontStatus(layer, []))
      .toMatchObject({ kind: 'missing', label: 'Missing font' });
  });

  it('matches positioned runs by fingerprint and face index', () => {
    const layer = textLayer(true);
    const exact = asset(['Contract Fixture'], {
      ...CONTRACT_FIXTURE_FONT_ASSET,
      byteLength: 4
    });

    expect(textLayerFontStatus(layer, [exact]).kind).toBe('exact');
    expect(textLayerFontStatus(layer, []).detail).toContain('ContractFixtureFont');
  });

  it('projects only unavailable layers into a persistent document summary', () => {
    const document = createTextLayer(
      createImageDocument('Status', 32, 24, 'source'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const diagnostics = documentTextFontDiagnostics(document, []);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ layerName: 'Headline', status: { kind: 'missing' } });
    expect(summarizeTextFontDiagnostics(diagnostics)).toBe('1 text layer has a missing font');
    expect(documentTextFontDiagnostics(document, [asset(['Inter'])])).toEqual([]);
  });

  it('projects realized .notdef warnings into document compatibility diagnostics', () => {
    const document = createTextLayer(
      createImageDocument('Glyph status', 32, 24, 'source'),
      createDefaultTextLayerData(),
      'Symbols'
    );
    const diagnostics = documentTextFontDiagnostics(
      document,
      [asset(['Inter'])],
      [],
      () => ({
        warnings: [{
          code: 'missing-glyph',
          message: 'The selected font emitted .notdef.',
          runIndex: 0
        }]
      } as never)
    );

    expect(diagnostics).toEqual([expect.objectContaining({
      issue: 'missing-glyph',
      layerName: 'Symbols',
      status: expect.objectContaining({ label: 'Missing glyph' })
    })]);
    expect(summarizeTextFontDiagnostics(diagnostics))
      .toBe('1 text layer has missing glyphs');
  });
});
