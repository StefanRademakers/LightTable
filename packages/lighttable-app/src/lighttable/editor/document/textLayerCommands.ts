import {
  bumpTextLayerRevision,
  cloneTextLayerData,
  type FlowTextSource,
  type FlowTextLayout,
  type ParagraphStyleRun,
  type PositionedTextRun,
  type TextLayerData,
  type TextRevisionDomain,
  type TextStyleRun
} from '@lighttable/text-core';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type TextLayer
} from './documentTypes';
import { findDocumentLayer, updateLayerNode } from './layerTree';
import type { AffineMatrix } from '../geometry/affine';
import { setLayerTransform } from './documentCommands';

const sameValue = (left: unknown, right: unknown) => (
  left === right || JSON.stringify(left) === JSON.stringify(right)
);

const flowFontSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => runs.map((run) => ({
  ...(includeRanges ? { start: run.start, end: run.end } : {}),
  requestedFont: run.requestedFont,
  fontSize: run.fontSize,
  fontWeight: run.fontWeight,
  fontStyle: run.fontStyle,
  fontStretch: run.fontStretch,
  kerning: run.kerning,
  language: run.language,
  scriptOverride: run.scriptOverride,
  directionOverride: run.directionOverride,
  openTypeFeatures: run.openTypeFeatures,
  variableAxes: run.variableAxes,
  syntheticBold: run.syntheticBold,
  syntheticItalic: run.syntheticItalic
}));

const flowLayoutSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => runs.map((run) => ({
  ...(includeRanges ? { start: run.start, end: run.end } : {}),
  tracking: run.tracking,
  baselineShift: run.baselineShift,
  horizontalScale: run.horizontalScale,
  verticalScale: run.verticalScale
}));

const flowPaintSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => runs.map((run) => ({
  ...(includeRanges ? { start: run.start, end: run.end } : {}),
  fill: run.fill,
  stroke: run.stroke
}));

const paragraphSignature = (runs: readonly ParagraphStyleRun[], includeRanges: boolean) => runs.map((run) => ({
  ...(includeRanges ? { start: run.start, end: run.end } : {}),
  alignment: run.alignment,
  direction: run.direction,
  lineHeight: run.lineHeight,
  firstLineIndent: run.firstLineIndent,
  startIndent: run.startIndent,
  endIndent: run.endIndent,
  spaceBefore: run.spaceBefore,
  spaceAfter: run.spaceAfter,
  hyphenation: run.hyphenation
}));

const positionedContentSignature = (runs: readonly PositionedTextRun[]) => runs.map((run) => ({
  sourceEncoding: run.sourceEncoding,
  glyphs: run.glyphs.map((glyph) => ({
    glyphId: glyph.glyphId,
    cluster: glyph.cluster,
    unicode: glyph.unicode,
    sourceCharacterCode: glyph.sourceCharacterCode
  }))
}));

const positionedFontSignature = (runs: readonly PositionedTextRun[]) => runs.map((run) => run.font);

const positionedPaintSignature = (runs: readonly PositionedTextRun[]) => runs.map((run) => ({
  paint: run.paint,
  renderingMode: run.renderingMode
}));

const positionedGeometrySignature = (runs: readonly PositionedTextRun[]) => runs.map((run) => ({
  textMatrix: run.textMatrix,
  glyphs: run.glyphs.map((glyph) => ({
    x: glyph.x,
    y: glyph.y,
    advanceX: glyph.advanceX,
    advanceY: glyph.advanceY,
    localTransform: glyph.localTransform
  }))
}));

const bumpRevisions = (
  data: TextLayerData,
  domains: readonly TextRevisionDomain[]
): TextLayerData => {
  const revisions = domains.reduce(
    (current, domain) => bumpTextLayerRevision(current, domain),
    data.revisions
  );
  return { ...data, revisions };
};

const updateTextLayer = (
  document: ImageDocument,
  layerId: LayerId,
  change: (layer: TextLayer) => TextLayerData,
  lock: 'pixels' | 'position' = 'pixels'
): ImageDocument => {
  const current = findDocumentLayer(document, layerId);
  if (current?.type !== 'text' || layerIsLocked(current, lock)) return document;
  const text = cloneTextLayerData(change(current));
  if (sameValue(current.text, text)) return document;
  const now = Date.now();
  return {
    ...document,
    layers: updateLayerNode(document.layers, layerId, (layer) => layer.type === 'text'
      ? { ...layer, text, revision: layer.revision + 1, modifiedAt: now }
      : layer),
    revision: document.revision + 1,
    modifiedAt: now
  };
};

/** Import/recovery seam. The supplied v1 payload is validated and deep-cloned. */
export const replaceTextLayerData = (
  document: ImageDocument,
  layerId: LayerId,
  data: TextLayerData
) => updateTextLayer(document, layerId, () => data);

/**
 * Replaces one complete authored text input group.
 *
 * Runs are supplied atomically because retaining stale UTF-16 ranges after an
 * insertion or deletion would corrupt canonical text. The application text
 * session coalesces repeated calls inside one explicit history transaction.
 */
export const setFlowTextContent = (
  document: ImageDocument,
  layerId: LayerId,
  text: string,
  styleRuns: readonly TextStyleRun[],
  paragraphRuns: readonly ParagraphStyleRun[],
  insertionState?: Pick<FlowTextSource, 'insertionStyle' | 'insertionParagraph'>
) => updateTextLayer(document, layerId, (layer) => {
  if (layer.text.source.kind !== 'flow') return layer.text;
  const contentChanged = layer.text.source.text !== text;
  const includeRanges = !contentChanged;
  const fontChanged = !sameValue(
    flowFontSignature(layer.text.source.styleRuns, includeRanges),
    flowFontSignature(styleRuns, includeRanges)
  );
  const inlineLayoutChanged = !sameValue(
    flowLayoutSignature(layer.text.source.styleRuns, includeRanges),
    flowLayoutSignature(styleRuns, includeRanges)
  );
  const paintChanged = !sameValue(
    flowPaintSignature(layer.text.source.styleRuns, includeRanges),
    flowPaintSignature(styleRuns, includeRanges)
  );
  const paragraphsChanged = !sameValue(
    paragraphSignature(layer.text.source.paragraphRuns, includeRanges),
    paragraphSignature(paragraphRuns, includeRanges)
  );
  const insertionStateChanged = insertionState !== undefined && (
    !sameValue(layer.text.source.insertionStyle, insertionState.insertionStyle)
    || !sameValue(layer.text.source.insertionParagraph, insertionState.insertionParagraph)
  );
  if (
    !contentChanged
    && !fontChanged
    && !inlineLayoutChanged
    && !paintChanged
    && !paragraphsChanged
    && !insertionStateChanged
  ) return layer.text;
  return bumpRevisions({
    ...layer.text,
    source: {
      ...layer.text.source,
      text,
      styleRuns: structuredClone(styleRuns),
      paragraphRuns: structuredClone(paragraphRuns),
      ...(insertionState === undefined ? {} : {
        ...(insertionState.insertionStyle === undefined
          ? {} : { insertionStyle: structuredClone(insertionState.insertionStyle) }),
        ...(insertionState.insertionParagraph === undefined
          ? {} : { insertionParagraph: structuredClone(insertionState.insertionParagraph) })
      })
    }
  }, [
    ...(contentChanged ? ['content' as const] : []),
    ...(fontChanged ? ['font' as const] : []),
    ...(inlineLayoutChanged || paragraphsChanged ? ['layout' as const] : []),
    ...(paintChanged ? ['paint' as const] : [])
  ]);
});

export const setFlowTextRuns = (
  document: ImageDocument,
  layerId: LayerId,
  styleRuns: readonly TextStyleRun[],
  paragraphRuns: readonly ParagraphStyleRun[]
) => updateTextLayer(document, layerId, (layer) => {
  if (layer.text.source.kind !== 'flow') return layer.text;
  const fontChanged = !sameValue(flowFontSignature(layer.text.source.styleRuns, true), flowFontSignature(styleRuns, true));
  const inlineLayoutChanged = !sameValue(flowLayoutSignature(layer.text.source.styleRuns, true), flowLayoutSignature(styleRuns, true));
  const paintChanged = !sameValue(flowPaintSignature(layer.text.source.styleRuns, true), flowPaintSignature(styleRuns, true));
  const paragraphsChanged = !sameValue(paragraphSignature(layer.text.source.paragraphRuns, true), paragraphSignature(paragraphRuns, true));
  if (!fontChanged && !inlineLayoutChanged && !paintChanged && !paragraphsChanged) return layer.text;
  return bumpRevisions({
    ...layer.text,
    source: {
      ...layer.text.source,
      styleRuns: structuredClone(styleRuns),
      paragraphRuns: structuredClone(paragraphRuns)
    }
  }, [
    ...(fontChanged ? ['font' as const] : []),
    ...(inlineLayoutChanged || paragraphsChanged ? ['layout' as const] : []),
    ...(paintChanged ? ['paint' as const] : [])
  ]);
});

export const setPositionedTextRuns = (
  document: ImageDocument,
  layerId: LayerId,
  runs: readonly PositionedTextRun[]
) => updateTextLayer(document, layerId, (layer) => {
  if (layer.text.source.kind !== 'positioned') return layer.text;
  if (sameValue(layer.text.source.runs, runs)) return layer.text;
  const currentRuns = layer.text.source.runs;
  return bumpRevisions({
    ...layer.text,
    source: { ...layer.text.source, runs: structuredClone(runs) }
  }, [
    ...(!sameValue(positionedContentSignature(currentRuns), positionedContentSignature(runs)) ? ['content' as const] : []),
    ...(!sameValue(positionedFontSignature(currentRuns), positionedFontSignature(runs)) ? ['font' as const] : []),
    ...(!sameValue(positionedPaintSignature(currentRuns), positionedPaintSignature(runs)) ? ['paint' as const] : []),
    ...(!sameValue(positionedGeometrySignature(currentRuns), positionedGeometrySignature(runs)) ? ['geometry' as const] : [])
  ]);
});

export const setFlowTextLayout = (
  document: ImageDocument,
  layerId: LayerId,
  layout: FlowTextLayout
) => updateTextLayer(document, layerId, (layer) => {
  if (layer.text.source.kind !== 'flow') return layer.text;
  if (sameValue(layer.text.source.layout, layout)) return layer.text;
  const domains: TextRevisionDomain[] = ['layout', 'geometry'];
  if (layer.text.source.layout.mode === 'path' || layout.mode === 'path') domains.push('path');
  return bumpRevisions({
    ...layer.text,
    source: { ...layer.text.source, layout: structuredClone(layout) }
  }, domains);
}, 'position');

export const setTextLayerTransform = (
  document: ImageDocument,
  layerId: LayerId,
  transform: AffineMatrix
) => {
  const layer = findDocumentLayer(document, layerId);
  return layer?.type === 'text' && !layerIsLocked(layer, 'position')
    ? setLayerTransform(document, layerId, transform)
    : document;
};

/**
 * Applies an authored edit-session payload through the semantic commands.
 * Callers cannot smuggle revisions, interchange metadata or source-kind
 * conversion through a typing transaction, and mixed-domain edits are atomic
 * with respect to pixel/position locks.
 */
export const applyTextLayerDataMutation = (
  document: ImageDocument,
  layerId: LayerId,
  nextData: TextLayerData
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text') return document;
  const next = cloneTextLayerData(nextData);
  const current = layer.text;
  if (
    next.schemaVersion !== current.schemaVersion
    || next.source.kind !== current.source.kind
    || !sameValue(next.interchange, current.interchange)
  ) {
    throw new Error('A text edit transaction may only change authored text and layout.');
  }

  if (current.source.kind === 'flow' && next.source.kind === 'flow') {
    const contentOrRunsChanged = current.source.text !== next.source.text
      || !sameValue(current.source.styleRuns, next.source.styleRuns)
      || !sameValue(current.source.paragraphRuns, next.source.paragraphRuns)
      || !sameValue(current.source.insertionStyle, next.source.insertionStyle)
      || !sameValue(current.source.insertionParagraph, next.source.insertionParagraph);
    const layoutChanged = !sameValue(current.source.layout, next.source.layout);
    if (
      (contentOrRunsChanged && layerIsLocked(layer, 'pixels'))
      || (layoutChanged && layerIsLocked(layer, 'position'))
    ) return document;
    let changed = document;
    if (contentOrRunsChanged) {
      changed = setFlowTextContent(
        changed,
        layerId,
        next.source.text,
        next.source.styleRuns,
        next.source.paragraphRuns,
        next.source
      );
    }
    return layoutChanged
      ? setFlowTextLayout(changed, layerId, next.source.layout)
      : changed;
  }

  if (current.source.kind === 'positioned' && next.source.kind === 'positioned') {
    if (
      next.source.extractedText !== current.source.extractedText
      || next.source.logicalOrderConfidence !== current.source.logicalOrderConfidence
      || next.source.editability !== current.source.editability
    ) {
      throw new Error('A positioned text edit transaction may only change authored runs.');
    }
    return setPositionedTextRuns(document, layerId, next.source.runs);
  }
  return document;
};
