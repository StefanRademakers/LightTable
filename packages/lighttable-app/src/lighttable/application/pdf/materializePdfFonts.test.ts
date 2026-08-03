import type { PdfExportFontPlan, PdfTextExportPlan } from '@lighttable/pdf-core';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import { materializePdfFonts } from './materializePdfFonts';

const fingerprint = '4'.repeat(64);
const asset: DocumentFontAsset = {
  assetId: 'font-1', faceIndex: 2, fingerprintSha256: fingerprint,
  source: 'document', container: 'sfnt', outline: 'truetype',
  postScriptName: 'Fixture-Regular', familyNames: ['Fixture'], styleName: 'Regular',
  weight: 400, stretch: 1, italic: false, byteLength: 8,
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
};

const fontPlan = (
  overrides: Partial<PdfExportFontPlan> = {}
): PdfExportFontPlan => ({
  instanceId: 'font-1', assetId: 'font-1', variableAxes: {},
  disposition: 'subset', glyphIds: [0, 5], subsetter: 'harfbuzz',
  retainGlyphIds: true, requiresSfntDecode: false,
  requiresConfirmation: false, reasons: [], ...overrides
});

const plan = (fonts: readonly PdfExportFontPlan[]): PdfTextExportPlan => ({
  fonts, layers: [], canExport: true, requiresConfirmation: false,
  summary: {
    subset: fonts.filter(font => font.disposition === 'subset').length,
    'embed-existing': fonts.filter(font => font.disposition === 'embed-existing').length,
    'embed-full': fonts.filter(font => font.disposition === 'embed-full').length,
    outline: fonts.filter(font => font.disposition === 'outline').length,
    raster: fonts.filter(font => font.disposition === 'raster').length,
    blocked: fonts.filter(font => font.disposition === 'blocked').length
  }
});

describe('PDF font materialization', () => {
  it('loads shared source bytes once and materializes stable retained-GID subsets', async () => {
    const source = new Uint8Array(8).fill(7);
    const loadFontBytes = vi.fn(async () => source);
    const subsetSfnt = vi.fn(({ glyphIds, variableAxes }) => new Uint8Array([
      glyphIds.at(-1)!, Object.keys(variableAxes).length
    ]));
    const result = await materializePdfFonts(plan([
      fontPlan(),
      fontPlan({ instanceId: 'font-1[wght=700]', variableAxes: { wght: 700 }, glyphIds: [0, 9] })
    ]), { fonts: [asset], loadFontBytes, subsetSfnt });

    expect(loadFontBytes).toHaveBeenCalledTimes(1);
    expect(subsetSfnt).toHaveBeenNthCalledWith(1, {
      fontBytes: source, faceIndex: 2, glyphIds: [0, 5],
      variableAxes: {}, downgradeCff2: false
    });
    expect(result.embedded.map(font => [...font.bytes])).toEqual([[5, 0], [9, 1]]);
    expect(result.embedded.every(font => font.retainGlyphIds)).toBe(true);
    expect(result.totalEmbeddedBytes).toBe(4);
  });

  it('preserves full/existing bytes and leaves explicit fallbacks for the writer', async () => {
    const source = new Uint8Array(8).fill(3);
    const result = await materializePdfFonts(plan([
      fontPlan({ disposition: 'embed-full', subsetter: null, retainGlyphIds: false }),
      fontPlan({ instanceId: 'outline', disposition: 'outline', subsetter: null, retainGlyphIds: false })
    ]), {
      fonts: [asset], loadFontBytes: async () => source,
      subsetSfnt: () => { throw new Error('must not subset'); }
    });

    expect(result.embedded).toHaveLength(1);
    expect(result.embedded[0]?.bytes).toEqual(source);
    expect(result.embedded[0]?.bytes).not.toBe(source);
    expect(result.fallback.map(font => font.disposition)).toEqual(['outline']);
  });

  it('requires explicit SFNT decoding and enforces byte budgets before writing', async () => {
    const source = new Uint8Array(8).fill(1);
    await expect(materializePdfFonts(plan([
      fontPlan({ requiresSfntDecode: true })
    ]), {
      fonts: [{ ...asset, container: 'woff2' }],
      loadFontBytes: async () => source,
      subsetSfnt: () => new Uint8Array([1])
    })).rejects.toThrow('requires an SFNT decoder');

    await expect(materializePdfFonts(plan([fontPlan()]), {
      fonts: [asset], loadFontBytes: async () => source,
      subsetSfnt: () => new Uint8Array([1, 2, 3]),
      limits: { maximumTotalOutputBytes: 2 }
    })).rejects.toThrow('output exceeds 2 bytes');
  });
});
