import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_ASSET,
  TEXT_LAYOUT_SCHEMA_VERSION,
  createDefaultTextLayerData,
  type FontAssetRef,
  type RealizedTextLayout
} from '@lighttable/text-core';
import { createTextLayer } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type DocumentFontAsset,
  type ImageDocument,
  type TextLayer
} from '../../editor/document/documentTypes';
import { updateLayerNode } from '../../editor/document/layerTree';
import { buildPdfTextExportPreflight } from './pdfTextExportPreflight';
import { buildPdfNativeTextPage } from './buildPdfNativeTextPage';

const font: FontAssetRef = {
  ...CONTRACT_FIXTURE_FONT_ASSET,
  source: 'document',
  outline: 'truetype',
  embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false }
};

const documentFont: DocumentFontAsset = {
  ...font,
  familyNames: ['Contract Fixture'],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 4_096
};

const realized = (glyphId = 77): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key: 'native-pdf-page',
  glyphRuns: [{
    font: { font, variableAxes: {}, syntheticBold: false, syntheticItalic: false },
    fontSize: 20,
    fontResolution: {
      kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Contract Fixture'] }
    },
    paint: {
      fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0.25, g: 0.5, b: 0.75, a: 0.8 } }
    },
    renderingMode: 'fill',
    direction: 'ltr',
    glyphIds: Uint32Array.of(glyphId),
    clusters: Uint32Array.of(0),
    geometry: Float32Array.of(5, 30, 12, 0)
  }],
  lines: [{
    start: 0, end: 2, baseline: 30, ascent: 16, descent: 4,
    bounds: { x: 5, y: 14, width: 12, height: 20 }
  }],
  caretStops: [],
  selectionGeometry: [],
  clusterMap: [{ textStart: 0, textEnd: 2, glyphStart: 0, glyphEnd: 1 }],
  inkBounds: { x: 5, y: 14, width: 12, height: 16 },
  logicalBounds: { x: 5, y: 10, width: 12, height: 20 },
  warnings: []
});

const flowDocument = (): ImageDocument => {
  const data = createDefaultTextLayerData();
  if (data.source.kind !== 'flow') throw new Error('Expected flow text.');
  const document = createTextLayer(createImageDocument('Native PDF', 320, 200, 'asset'), {
    ...data,
    source: {
      ...data.source,
      text: 'fi',
      styleRuns: data.source.styleRuns.map(run => ({ ...run, start: 0, end: 2 })),
      paragraphRuns: data.source.paragraphRuns.map(run => ({ ...run, start: 0, end: 2 }))
    }
  }, 'Flow');
  return {
    ...document,
    layers: updateLayerNode(document.layers, document.activeLayerId!, layer => ({
      ...layer,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 }
    }))
  };
};

const planFor = (document: ImageDocument, layout: RealizedTextLayout) => buildPdfTextExportPreflight({
  document,
  availableFonts: [documentFont],
  fontBytesAvailable: new Set([font.assetId]),
  realizedLayout: () => layout
});

describe('buildPdfNativeTextPage', () => {
  it('freezes exact shaped glyphs into PDF page space without reshaping', () => {
    const document = flowDocument();
    const layout = realized();
    const page = buildPdfNativeTextPage({
      document,
      plan: planFor(document, layout),
      realizedLayout: () => layout,
      pixelsPerInch: 72
    });

    expect(page).toMatchObject({ widthPoints: 320, heightPoints: 200, pixelsPerInch: 72 });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({
      fontSize: 20,
      renderingMode: 0,
      paint: {
        fill: { kind: 'device-rgb', r: 0.25, g: 0.5, b: 0.75 },
        fillAlpha: 0.8
      },
      actualText: []
    });
    expect(page.runs[0]?.glyphs[0]).toEqual({
      code: 1,
      glyphId: 77,
      unicode: 'fi',
      origin: { x: 5, y: 30 },
      advance: { x: 12, y: 0 },
      textMatrix: [1, 0, 0, 1, 15, 150]
    });
    expect(Object.isFrozen(page.runs[0]?.glyphs)).toBe(true);
  });

  it('fails closed when a realized glyph no longer matches preflight', () => {
    const document = flowDocument();
    const initial = realized(77);
    const changed = realized(78);
    expect(() => buildPdfNativeTextPage({
      document,
      plan: planFor(document, initial),
      realizedLayout: () => changed
    })).toThrow('no longer matches its preflight encoding');
  });

  it('keeps Display-P3 text out of the direct DeviceRGB writer path', () => {
    const document = flowDocument();
    const layout = realized();
    const p3: RealizedTextLayout = {
      ...layout,
      glyphRuns: layout.glyphRuns.map(run => ({
        ...run,
        paint: {
          fill: { kind: 'solid', color: { colorSpace: 'display-p3', r: 1, g: 0, b: 0, a: 1 } }
        }
      }))
    };
    expect(planFor(document, p3).layers[0]?.runs[0]?.disposition).toBe('outline');
  });

  it('composes preserved positioned text matrices with layer and page transforms', () => {
    const data = createDefaultTextLayerData();
    const positioned: TextLayer['text'] = {
      ...data,
      source: {
        kind: 'positioned',
        runs: [{
          font: { font, variableAxes: {}, syntheticBold: false, syntheticItalic: false },
          glyphs: [{ glyphId: 36, unicode: 'A', x: 2, y: 3, advanceX: 8, advanceY: 0 }],
          textMatrix: [2, 0, 4, 0, 2, 5, 0, 0, 1],
          paint: {
            fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } }
          },
          renderingMode: 'fill'
        }],
        extractedText: 'A',
        logicalOrderConfidence: 1,
        editability: 'exact-positioned'
      }
    };
    const document = createTextLayer(
      createImageDocument('Positioned', 100, 100, 'asset'),
      positioned,
      'Positioned'
    );
    const plan = buildPdfTextExportPreflight({
      document,
      availableFonts: [documentFont],
      fontBytesAvailable: new Set([font.assetId]),
      realizedLayout: () => null
    });
    const page = buildPdfNativeTextPage({
      document, plan, realizedLayout: () => null, pixelsPerInch: 72
    });
    expect(page.runs[0]?.fontSize).toBe(1);
    expect(page.runs[0]?.glyphs[0]?.textMatrix).toEqual([2, 0, 0, 2, 8, 89]);
  });
});
