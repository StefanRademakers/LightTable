import {
  planPdfTextExport,
  type PdfExportFontAssetInput,
  type PdfExportSemanticSpan,
  type PdfExportTextLayerInput,
  type PdfExportTextRunInput,
  type PdfTextExportPlan,
  type PdfTextExportPolicy
} from '@lighttable/pdf-core';
import type {
  FontAssetRef,
  Matrix3,
  RealizedGlyphRun,
  RealizedTextLayout,
  TextPaint,
  TextRunPaint
} from '@lighttable/text-core';
import type {
  DocumentFontAsset,
  ImageDocument,
  LayerId,
  LayerNode,
  TextLayer
} from '../../editor/document/documentTypes';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';

export interface PdfTextExportPreflightDependencies {
  readonly document: ImageDocument;
  readonly availableFonts: readonly DocumentFontAsset[];
  readonly fontBytesAvailable: ReadonlySet<string>;
  readonly realizedLayout: (layerId: LayerId) => RealizedTextLayout | null;
  readonly outlineExtractionAvailable?: (assetId: string) => boolean;
  readonly policy?: Partial<PdfTextExportPolicy>;
}

const affineMatrix = (matrix: Matrix3) => (
  matrix.every(Number.isFinite)
  && Math.abs(matrix[6]) <= 1e-6
  && Math.abs(matrix[7]) <= 1e-6
  && Math.abs(matrix[8] - 1) <= 1e-6
);

const paintNeedsOutlines = (paint: TextPaint | undefined) => Boolean(
  paint && (paint.kind === 'linear-gradient' || paint.color.colorSpace !== 'srgb')
);
const paintSupport = (paint: TextRunPaint): PdfExportTextRunInput['paintSupport'] => (
  paint.stroke !== undefined
  || paintNeedsOutlines(paint.fill)
    ? 'outline-required'
    : 'pdf-text'
);

interface VisibleTextLayer {
  readonly layer: TextLayer;
  readonly ancestorEffectsRequireRaster: boolean;
}

const compositingRequiresRaster = (node: LayerNode) => (
  node.clipping
  || node.opacity !== 1
  || node.fillOpacity !== 1
  || node.blendMode !== 'normal'
  || node.mask !== null
  || (node.type === 'group' && node.compositing === 'isolated')
);

const visibleTextLayers = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true,
  ancestorEffectsRequireRaster = false
): readonly VisibleTextLayer[] => nodes.flatMap(node => {
  const visible = ancestorsVisible && node.visible;
  const effectsRequireRaster = ancestorEffectsRequireRaster
    || layerStyleStackIsActive(node.styleStack)
    || compositingRequiresRaster(node);
  if (node.type === 'group') {
    return visibleTextLayers(node.children, visible, effectsRequireRaster);
  }
  return node.type === 'text' && visible
    ? [{ layer: node, ancestorEffectsRequireRaster: effectsRequireRaster }]
    : [];
});

const flowSemanticSpans = (
  text: string,
  layout: RealizedTextLayout,
  run: RealizedGlyphRun,
  glyphBase: number
): readonly PdfExportSemanticSpan[] => {
  const matching = layout.clusterMap
    .filter(entry => entry.glyphStart >= glyphBase && entry.glyphEnd <= glyphBase + run.glyphIds.length)
    .sort((left, right) => left.glyphStart - right.glyphStart);
  if (run.direction === 'rtl' && matching.length > 0) {
    const textStart = Math.min(...matching.map(entry => entry.textStart));
    const textEnd = Math.max(...matching.map(entry => entry.textEnd));
    return [{
      glyphStart: 0,
      glyphEnd: run.glyphIds.length,
      unicode: text.slice(textStart, textEnd),
      confidence: 1
    }];
  }
  return matching.map(entry => ({
    glyphStart: entry.glyphStart - glyphBase,
    glyphEnd: entry.glyphEnd - glyphBase,
    unicode: text.slice(entry.textStart, entry.textEnd),
    confidence: 1
  }));
};

const positionedSemanticSpans = (
  run: Extract<TextLayer['text']['source'], { kind: 'positioned' }>['runs'][number],
  confidence: number
): readonly PdfExportSemanticSpan[] => run.glyphs.flatMap((glyph, glyphIndex) => (
  glyph.unicode && glyph.unicode.length > 0
    ? [{ glyphStart: glyphIndex, glyphEnd: glyphIndex + 1, unicode: glyph.unicode, confidence }]
    : []
));

const matrixArrayIsAffine = (transforms: Float32Array | undefined) => {
  if (!transforms) return true;
  if (transforms.length % 9 !== 0) return false;
  for (let offset = 0; offset < transforms.length; offset += 9) {
    for (let index = 0; index < 9; index += 1) {
      if (!Number.isFinite(transforms[offset + index])) return false;
    }
    if (Math.abs(transforms[offset + 6]!) > 1e-6
      || Math.abs(transforms[offset + 7]!) > 1e-6
      || Math.abs(transforms[offset + 8]! - 1) > 1e-6) return false;
  }
  return true;
};

const fontInput = (
  font: FontAssetRef,
  available: ReadonlyMap<string, DocumentFontAsset>,
  bytes: ReadonlySet<string>,
  outlineAvailable: ((assetId: string) => boolean) | undefined
): PdfExportFontAssetInput => {
  const registered = available.get(font.assetId);
  const bytesAvailable = bytes.has(font.assetId);
  return {
    assetId: font.assetId,
    fingerprintSha256: font.fingerprintSha256,
    postScriptName: font.postScriptName ?? null,
    source: font.source,
    container: font.container,
    outline: font.outline,
    embeddingLevel: font.embedding.level,
    noSubsetting: font.embedding.noSubsetting,
    bitmapOnly: font.embedding.bitmapOnly,
    bytesAvailable,
    outlineExtractionAvailable: outlineAvailable
      ? outlineAvailable(font.assetId)
      : bytesAvailable && registered !== undefined
        && ['truetype', 'cff', 'cff2'].includes(font.outline)
  };
};

const flowLayerInput = (
  layer: TextLayer,
  layout: RealizedTextLayout | null,
  ancestorEffectsRequireRaster: boolean
): PdfExportTextLayerInput | null => {
  const source = layer.text.source;
  if (source.kind !== 'flow' || source.text.length === 0) return null;
  const effectsSupport = ancestorEffectsRequireRaster || layerStyleStackIsActive(layer.styleStack)
    ? 'raster-required' as const
    : 'pdf-native' as const;
  if (!layout) return {
    layerId: layer.id,
    name: layer.name,
    sourceKind: 'flow',
    effectsSupport,
    unavailableReason: 'text-layout-unavailable',
    runs: []
  };
  let glyphBase = 0;
  const uncertainOrder = layout.warnings.some(warning => warning.code === 'logical-order-uncertain');
  const runs = layout.glyphRuns.map((run, runIndex): PdfExportTextRunInput => {
    const semantics = flowSemanticSpans(source.text, layout, run, glyphBase);
    glyphBase += run.glyphIds.length;
    const vertical = run.direction === 'ttb' || run.direction === 'btt';
    const missingGlyph = run.glyphIds.includes(0);
    return {
      runId: `${layer.id}:flow:${runIndex}`,
      fontAssetId: run.font.font.assetId,
      glyphIds: [...run.glyphIds],
      semanticSpans: semantics,
      logicalOrderConfidence: uncertainOrder ? 0.5 : 1,
      variableAxes: run.font.variableAxes,
      syntheticBold: run.font.syntheticBold,
      syntheticItalic: run.font.syntheticItalic,
      paintSupport: paintSupport(run.paint),
      geometrySupport: vertical || !matrixArrayIsAffine(run.transforms)
        ? 'outline-required'
        : missingGlyph ? 'raster-required' : 'pdf-text'
    };
  }).filter(run => run.glyphIds.length > 0);
  return runs.length > 0 ? {
    layerId: layer.id,
    name: layer.name,
    sourceKind: 'flow',
    effectsSupport,
    runs
  } : {
    layerId: layer.id,
    name: layer.name,
    sourceKind: 'flow',
    effectsSupport,
    unavailableReason: 'text-layout-unavailable',
    runs: []
  };
};

const positionedLayerInput = (
  layer: TextLayer,
  ancestorEffectsRequireRaster: boolean
): PdfExportTextLayerInput | null => {
  const source = layer.text.source;
  if (source.kind !== 'positioned') return null;
  const confidence = source.logicalOrderConfidence ?? 0.5;
  const runs = source.runs.map((run, runIndex): PdfExportTextRunInput => ({
    runId: `${layer.id}:positioned:${runIndex}`,
    fontAssetId: run.font.font.assetId,
    glyphIds: run.glyphs.map(glyph => glyph.glyphId),
    semanticSpans: positionedSemanticSpans(run, confidence),
    logicalOrderConfidence: confidence,
    variableAxes: run.font.variableAxes,
    syntheticBold: run.font.syntheticBold,
    syntheticItalic: run.font.syntheticItalic,
    paintSupport: paintSupport(run.paint),
    geometrySupport: affineMatrix(run.textMatrix)
      && run.glyphs.every(glyph => glyph.localTransform === undefined || affineMatrix(glyph.localTransform))
      ? 'pdf-text' : 'raster-required'
  })).filter(run => run.glyphIds.length > 0);
  return runs.length > 0 ? {
    layerId: layer.id,
    name: layer.name,
    sourceKind: 'positioned',
    effectsSupport: ancestorEffectsRequireRaster || layerStyleStackIsActive(layer.styleStack)
      ? 'raster-required'
      : 'pdf-native',
    runs
  } : null;
};

/** Maps canonical TextLayers and exact realized glyphs into the writer-neutral PDF preflight. */
export const buildPdfTextExportPreflight = ({
  document,
  availableFonts,
  fontBytesAvailable,
  realizedLayout,
  outlineExtractionAvailable,
  policy
}: PdfTextExportPreflightDependencies): PdfTextExportPlan => {
  const available = new Map(availableFonts.map(font => [font.assetId, font]));
  const visible = visibleTextLayers(document.layers);
  const realizedLayouts = new Map<LayerId, RealizedTextLayout | null>();
  visible.forEach(({ layer }) => {
    if (layer.text.source.kind === 'flow') {
      realizedLayouts.set(layer.id, realizedLayout(layer.id));
    }
  });
  const layers = visible.flatMap(({ layer, ancestorEffectsRequireRaster }) => {
    const input = layer.text.source.kind === 'flow'
      ? flowLayerInput(layer, realizedLayouts.get(layer.id) ?? null, ancestorEffectsRequireRaster)
      : positionedLayerInput(layer, ancestorEffectsRequireRaster);
    return input ? [input] : [];
  });
  const fontRefs = new Map<string, FontAssetRef>();
  visible.forEach(({ layer }) => {
    if (layer.text.source.kind === 'positioned') {
      layer.text.source.runs.forEach(run => fontRefs.set(run.font.font.assetId, run.font.font));
      return;
    }
    realizedLayouts.get(layer.id)?.glyphRuns.forEach(run => fontRefs.set(run.font.font.assetId, run.font.font));
  });
  const fonts = [...fontRefs.values()].map(font => fontInput(
    font, available, fontBytesAvailable, outlineExtractionAvailable
  ));
  return planPdfTextExport({ fonts, layers }, policy);
};
