import { describe, expect, it } from 'vitest';
import {
  planPdfTextExport,
  type PdfExportFontAssetInput,
  type PdfExportTextLayerInput
} from './exportTextPlan';

const font = (change: Partial<PdfExportFontAssetInput> = {}): PdfExportFontAssetInput => ({
  assetId: 'font:inter', fingerprintSha256: 'a'.repeat(64), postScriptName: 'Inter-Regular',
  source: 'document', container: 'sfnt', outline: 'truetype', embeddingLevel: 'editable',
  noSubsetting: false, bitmapOnly: false, bytesAvailable: true,
  outlineExtractionAvailable: true, ...change
});

const layer = (change: Partial<PdfExportTextLayerInput> = {}): PdfExportTextLayerInput => ({
  layerId: 'layer:headline', name: 'Headline', sourceKind: 'flow', effectsSupport: 'pdf-native',
  runs: [{
    runId: 'run:headline', fontAssetId: 'font:inter', glyphIds: [43, 72, 79, 79, 82],
    semanticSpans: [
      { glyphStart: 0, glyphEnd: 1, unicode: 'H', confidence: 1 },
      { glyphStart: 1, glyphEnd: 2, unicode: 'e', confidence: 1 },
      { glyphStart: 2, glyphEnd: 3, unicode: 'l', confidence: 1 },
      { glyphStart: 3, glyphEnd: 4, unicode: 'l', confidence: 1 },
      { glyphStart: 4, glyphEnd: 5, unicode: 'o', confidence: 1 }
    ],
    logicalOrderConfidence: 1, variableAxes: {}, syntheticBold: false, syntheticItalic: false,
    paintSupport: 'pdf-text', geometrySupport: 'pdf-text'
  }],
  ...change
});

describe('PDF text export planning', () => {
  it('plans searchable Identity-H text and one retained-GID HarfBuzz subset', () => {
    const plan = planPdfTextExport({ fonts: [font()], layers: [layer()] });

    expect(plan.canExport).toBe(true);
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.fonts).toEqual([expect.objectContaining({
      instanceId: 'font:inter', disposition: 'subset', subsetter: 'harfbuzz',
      retainGlyphIds: true, glyphIds: [0, 43, 72, 79, 82]
    })]);
    expect(plan.layers[0]).toMatchObject({ disposition: 'text', searchable: true });
    expect(plan.layers[0]?.runs[0]?.encoding.map(entry => entry.code)).toEqual([1, 2, 3, 3, 4]);
    expect(plan.layers[0]?.runs[0]?.encodingId).toBe('encoding:run:headline');
    expect(plan.layers[0]?.runs[0]?.encoding.map(entry => entry.unicode)).toEqual(['H', 'e', 'l', 'l', 'o']);
  });

  it('separates variable instances and requests static HarfBuzz subsets', () => {
    const first = layer();
    const second = layer({
      layerId: 'layer:heavy', name: 'Heavy',
      runs: [{ ...layer().runs[0]!, runId: 'run:heavy', variableAxes: { wght: 800 } }]
    });
    const plan = planPdfTextExport({ fonts: [font({ outline: 'cff2' })], layers: [first, second] });

    expect(plan.fonts.map(entry => entry.instanceId)).toEqual(['font:inter', 'font:inter[wght=800]']);
    expect(plan.fonts[1]).toMatchObject({
      disposition: 'subset', reasons: [{ code: 'harfbuzz-static-instance-subset' }]
    });
  });

  it('uses ActualText for multi-glyph semantic clusters', () => {
    const clustered = layer({ runs: [{
      ...layer().runs[0]!, glyphIds: [100, 101],
      semanticSpans: [{ glyphStart: 0, glyphEnd: 2, unicode: 'क्ष', confidence: 1 }]
    }] });
    const plan = planPdfTextExport({ fonts: [font()], layers: [clustered] });
    const run = plan.layers[0]!.runs[0]!;

    expect(run.disposition).toBe('text');
    expect(run.encoding).toEqual([
      { code: 1, glyphId: 100, unicode: null },
      { code: 2, glyphId: 101, unicode: null }
    ]);
    expect(run.actualText).toEqual([{ glyphStart: 0, glyphEnd: 2, unicode: 'क्ष' }]);
  });

  it('requires explicit outline fallback for incomplete or low-confidence semantics', () => {
    const incomplete = layer({ runs: [{
      ...layer().runs[0]!, semanticSpans: [
        { glyphStart: 0, glyphEnd: 1, unicode: 'H', confidence: 1 }
      ]
    }] });
    const plan = planPdfTextExport({ fonts: [font()], layers: [incomplete] });
    expect(plan).toMatchObject({
      canExport: true, requiresConfirmation: true,
      layers: [{ disposition: 'outline', searchable: false, runs: [{
        reasons: [{ code: 'semantic-mapping-incomplete' }]
      }] }]
    });
    expect(plan.fonts).toEqual([expect.objectContaining({ disposition: 'outline' })]);
    expect(plan.summary.outline).toBe(1);

    const blocked = planPdfTextExport(
      { fonts: [font()], layers: [incomplete] },
      { allowOutlineFallback: false }
    );
    expect(blocked.canExport).toBe(false);
    expect(blocked.layers[0]?.disposition).toBe('blocked');
  });

  it('never embeds restricted or unknown-rights fonts silently', () => {
    const restricted = planPdfTextExport({
      fonts: [font({ embeddingLevel: 'restricted' })], layers: [layer()]
    });
    expect(restricted).toMatchObject({
      canExport: false,
      fonts: [{ disposition: 'blocked', reasons: [{ code: 'font-embedding-restricted' }] }]
    });

    const confirmedOutline = planPdfTextExport(
      { fonts: [font({ embeddingLevel: 'restricted' })], layers: [layer()] },
      { allowRestrictedFontOutlineFallback: true }
    );
    expect(confirmedOutline).toMatchObject({
      canExport: true, requiresConfirmation: true,
      fonts: [{ disposition: 'outline' }],
      layers: [{ disposition: 'outline' }]
    });

    const unknown = planPdfTextExport({
      fonts: [font({ embeddingLevel: 'unknown' })], layers: [layer()]
    });
    expect(unknown.fonts[0]?.disposition).toBe('outline');
  });

  it('preserves imported PDF subsets and honors no-subsetting rights', () => {
    const existing = planPdfTextExport({
      fonts: [font({ source: 'pdf-subset' })], layers: [layer()]
    });
    expect(existing.fonts[0]).toMatchObject({ disposition: 'embed-existing', subsetter: null });

    const full = planPdfTextExport({
      fonts: [font({ noSubsetting: true, container: 'woff2' })], layers: [layer()]
    });
    expect(full.fonts[0]).toMatchObject({
      disposition: 'embed-full', requiresSfntDecode: true,
      reasons: [{ code: 'full-font-required' }]
    });
  });

  it('chooses raster for bitmap fonts and visual effects, while mixed layers remain explicit', () => {
    const mixed = layer({ runs: [
      layer().runs[0]!,
      { ...layer().runs[0]!, runId: 'run:effect', paintSupport: 'outline-required' }
    ] });
    const plan = planPdfTextExport({ fonts: [font()], layers: [mixed] });
    expect(plan.layers[0]).toMatchObject({ disposition: 'mixed', requiresConfirmation: true });
    expect(plan.layers[0]?.runs.map(run => run.disposition)).toEqual(['text', 'outline']);

    const bitmap = planPdfTextExport({
      fonts: [font({ outline: 'bitmap', bitmapOnly: true })], layers: [layer()]
    });
    expect(bitmap.fonts[0]?.disposition).toBe('raster');
    expect(bitmap.layers[0]?.disposition).toBe('raster');
  });

  it('rejects missing references, malformed spans and hostile resource counts before planning', () => {
    expect(() => planPdfTextExport({ fonts: [], layers: [layer()] })).toThrow('missing font');
    expect(() => planPdfTextExport({ fonts: [font()], layers: [layer()] }, {}, {
      maximumGlyphCount: 2
    })).toThrow('glyph limit');
    expect(() => planPdfTextExport({ fonts: [font()], layers: [layer()] }, {}, {
      maximumUniqueGlyphsPerFontInstance: 2
    })).toThrow('unique-glyph limit');
    expect(() => planPdfTextExport({ fonts: [font()], layers: [layer()] }, {}, {
      maximumEncodingEntriesPerRun: 2
    })).toThrow('encoding-entry limit');
  });

  it('keeps unavailable layout work explicitly blocked instead of silently rasterizing it', () => {
    const plan = planPdfTextExport({ fonts: [], layers: [{
      layerId: 'layer:pending', name: 'Pending text', sourceKind: 'flow',
      effectsSupport: 'pdf-native', unavailableReason: 'text-layout-unavailable', runs: []
    }] });
    expect(plan).toMatchObject({
      canExport: false,
      layers: [{
        disposition: 'blocked',
        reasons: [{ code: 'text-realization-unavailable' }]
      }]
    });
  });
});
