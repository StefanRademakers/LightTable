import { describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_ASSET,
  createDefaultTextLayerData,
  createPositionedTextFixture,
  TEXT_LAYOUT_SCHEMA_VERSION,
  type FontAssetRef,
  type RealizedTextLayout
} from '@lighttable/text-core';
import { createTextLayer, groupLayers } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type DocumentFontAsset,
  type ImageDocument,
  type LayerId,
  type TextLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer, updateLayerNode } from '../../editor/document/layerTree';
import { createDefaultLayerStyle } from '../../editor/styles/layerStyleDefaults';
import { buildPdfTextExportPreflight } from './pdfTextExportPreflight';

const exportFont: FontAssetRef = {
  ...CONTRACT_FIXTURE_FONT_ASSET,
  source: 'document',
  outline: 'truetype',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false }
};

const documentFont: DocumentFontAsset = {
  ...exportFont,
  familyNames: ['Contract Fixture'], styleName: 'Regular', weight: 400,
  stretch: 100, italic: false, byteLength: 4096
};

const flowDocument = (text = 'fi') => {
  const data = createDefaultTextLayerData();
  if (data.source.kind !== 'flow') throw new Error('Expected flow fixture.');
  return createTextLayer(createImageDocument('PDF export', 320, 200, 'asset'), {
    ...data,
    source: {
      ...data.source,
      text,
      styleRuns: data.source.styleRuns.map(run => ({ ...run, start: 0, end: text.length })),
      paragraphRuns: data.source.paragraphRuns.map(run => ({ ...run, start: 0, end: text.length }))
    }
  }, 'Flow text');
};

const layout = (
  text: string,
  direction: 'ltr' | 'rtl' = 'ltr',
  glyphIds: readonly number[] = [77]
): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key: 'pdf-export-layout',
  glyphRuns: [{
    font: { font: exportFont, variableAxes: {}, syntheticBold: false, syntheticItalic: false },
    fontSize: 20,
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Contract Fixture'] } },
    paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
    renderingMode: 'fill', direction,
    glyphIds: Uint32Array.from(glyphIds),
    clusters: Uint32Array.from(glyphIds.map(() => 0)),
    geometry: Float32Array.from(glyphIds.flatMap((_, index) => [index * 10, 20, 10, 0]))
  }],
  lines: [{ start: 0, end: text.length, baseline: 20, ascent: 16, descent: 4, bounds: { x: 0, y: 4, width: 10, height: 20 } }],
  caretStops: [], selectionGeometry: [],
  clusterMap: [{ textStart: 0, textEnd: text.length, glyphStart: 0, glyphEnd: glyphIds.length }],
  inkBounds: { x: 0, y: 4, width: 10, height: 16 },
  logicalBounds: { x: 0, y: 0, width: 10, height: 20 },
  warnings: []
});

const preflight = (
  document: ImageDocument,
  realized: RealizedTextLayout | null,
  change: Partial<Parameters<typeof buildPdfTextExportPreflight>[0]> = {}
) => buildPdfTextExportPreflight({
  document,
  availableFonts: [documentFont],
  fontBytesAvailable: new Set([exportFont.assetId]),
  realizedLayout: () => realized,
  ...change
});

describe('LightTable PDF text export preflight adapter', () => {
  it('maps a shaped flow ligature to searchable text and a subset font', () => {
    const document = flowDocument('fi');
    const plan = preflight(document, layout('fi'));

    expect(plan).toMatchObject({
      canExport: true,
      fonts: [{ assetId: exportFont.assetId, disposition: 'subset', glyphIds: [0, 77] }],
      layers: [{ disposition: 'text', searchable: true, sourceKind: 'flow' }]
    });
    expect(plan.layers[0]?.runs[0]?.encoding).toEqual([{ code: 1, glyphId: 77, unicode: 'fi' }]);
  });

  it('uses whole-run ActualText for RTL visual glyph order', () => {
    const document = flowDocument('שלום');
    const rtlLayout = layout('שלום', 'rtl', [10, 11, 12, 13]);
    const plan = preflight(document, rtlLayout);
    expect(plan.layers[0]?.runs[0]?.actualText).toEqual([
      { glyphStart: 0, glyphEnd: 4, unicode: 'שלום' }
    ]);
  });

  it('blocks non-empty flow text until an exact realized layout exists', () => {
    const plan = preflight(flowDocument('Pending'), null);
    expect(plan).toMatchObject({
      canExport: false,
      layers: [{ disposition: 'blocked', reasons: [{ code: 'text-realization-unavailable' }] }]
    });
  });

  it('maps exact positioned PDF glyphs without requiring flow realization', () => {
    const fixture = createPositionedTextFixture();
    if (fixture.source.kind !== 'positioned') throw new Error('Expected positioned fixture.');
    const pdfFont: FontAssetRef = {
      ...exportFont,
      source: 'pdf-subset'
    };
    const document = createTextLayer(createImageDocument('Positioned', 100, 100, 'asset'), {
      ...fixture,
      source: {
        ...fixture.source,
        runs: fixture.source.runs.map(run => ({
          ...run,
          font: { ...run.font, font: pdfFont }
        }))
      }
    }, 'Imported PDF text');
    const pdfDocumentFont: DocumentFontAsset = { ...documentFont, ...pdfFont };
    const plan = preflight(document, null, {
      availableFonts: [pdfDocumentFont],
      fontBytesAvailable: new Set([pdfFont.assetId])
    });

    expect(plan).toMatchObject({
      canExport: true,
      fonts: [{ disposition: 'embed-existing' }],
      layers: [{ disposition: 'text', searchable: true, sourceKind: 'positioned' }]
    });
  });

  it('requires raster fallback for active layer effects and missing glyphs', () => {
    const document = flowDocument('A');
    const layerId = document.activeLayerId!;
    const styled: ImageDocument = {
      ...document,
      layers: updateLayerNode(document.layers, layerId, layer => {
        if (layer.type !== 'text') return layer;
        const effect = createDefaultLayerStyle('drop-shadow');
        return {
          ...layer,
          styleStack: { ...layer.styleStack, effects: [effect] }
        } satisfies TextLayer;
      })
    };
    expect(preflight(styled, layout('A')).layers[0]?.disposition).toBe('raster');
    expect(preflight(document, layout('A', 'ltr', [0])).layers[0]?.disposition).toBe('raster');
  });

  it('does not claim native text while layer compositing is not represented by the writer', () => {
    const document = flowDocument('A');
    const layerId = document.activeLayerId!;
    const translucent: ImageDocument = {
      ...document,
      layers: updateLayerNode(document.layers, layerId, layer => ({
        ...layer,
        opacity: 0.5
      }))
    };
    const clipped: ImageDocument = {
      ...document,
      layers: updateLayerNode(document.layers, layerId, layer => ({
        ...layer,
        clipping: true
      }))
    };
    expect(preflight(translucent, layout('A')).layers[0]?.disposition).toBe('raster');
    expect(preflight(clipped, layout('A')).layers[0]?.disposition).toBe('raster');
  });

  it('snapshots each realized layout once and inherits group effects', () => {
    const document = flowDocument('A');
    const textLayerId = document.activeLayerId!;
    const grouped = groupLayers(document, [textLayerId], 'Styled group');
    const groupId = grouped.activeLayerId!;
    const styled: ImageDocument = {
      ...grouped,
      layers: updateLayerNode(grouped.layers, groupId, layer => {
        if (layer.type !== 'group') return layer;
        return {
          ...layer,
          styleStack: {
            ...layer.styleStack,
            effects: [createDefaultLayerStyle('drop-shadow')]
          }
        };
      })
    };
    const realizedLayout = vi.fn(() => layout('A'));
    const plan = preflight(styled, null, { realizedLayout });
    expect(realizedLayout).toHaveBeenCalledTimes(1);
    expect(plan.layers[0]?.disposition).toBe('raster');
  });

  it('ignores hidden text and reports unavailable font bytes as an explicit outline fallback', () => {
    const document = flowDocument('A');
    const layerId = document.activeLayerId!;
    const hidden: ImageDocument = {
      ...document,
      layers: updateLayerNode(document.layers, layerId, layer => ({ ...layer, visible: false }))
    };
    expect(preflight(hidden, layout('A')).layers).toEqual([]);

    const outlined = preflight(document, layout('A'), {
      fontBytesAvailable: new Set(),
      outlineExtractionAvailable: () => true
    });
    expect(outlined).toMatchObject({
      canExport: true, requiresConfirmation: true,
      fonts: [{ disposition: 'outline', reasons: [{ code: 'font-bytes-unavailable' }] }]
    });
    expect(findDocumentLayer(document, layerId)?.type).toBe('text');
  });
});
