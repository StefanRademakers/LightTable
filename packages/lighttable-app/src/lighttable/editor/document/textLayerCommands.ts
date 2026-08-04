import {
  analyzePositionedTextRecovery,
  bumpTextLayerRevision,
  cloneTextLayerData,
  type FlowTextSource,
  type FlowTextLayout,
  type ParagraphStyleRun,
  type PositionedTextRun,
  type TextLayerData,
  type TextWarp,
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
import {
  isIdentityAffineMatrix,
  multiplyMatrices,
  type AffineMatrix
} from '../geometry/affine';
import { setLayerTransform } from './documentCommands';

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
};

const sameValue = (left: unknown, right: unknown) => (
  left === right || JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))
);

const normalizedRunSignature = <Run extends { readonly start: number; readonly end: number }>(
  runs: readonly Run[],
  includeRanges: boolean,
  project: (run: Run) => unknown
) => runs.reduce<Array<{ start: number; end: number; value: unknown }>>((result, run) => {
  const value = project(run);
  const previous = result.at(-1);
  if (previous && previous.end === run.start && sameValue(previous.value, value)) {
    previous.end = run.end;
  } else {
    result.push({ start: run.start, end: run.end, value });
  }
  return result;
}, []).map(({ start, end, value }) => includeRanges ? { start, end, value } : value);

const flowFontSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => normalizedRunSignature(runs, includeRanges, (run) => ({
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

const flowLayoutSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => normalizedRunSignature(runs, includeRanges, (run) => ({
  tracking: run.tracking,
  baselineShift: run.baselineShift,
  horizontalScale: run.horizontalScale,
  verticalScale: run.verticalScale
}));

const flowPaintSignature = (runs: readonly TextStyleRun[], includeRanges: boolean) => normalizedRunSignature(runs, includeRanges, (run) => ({
  fill: run.fill,
  stroke: run.stroke
}));

const paragraphSignature = (runs: readonly ParagraphStyleRun[], includeRanges: boolean) => normalizedRunSignature(runs, includeRanges, (run) => ({
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

const affineFromTextMatrix = (matrix: readonly number[]): AffineMatrix => ({
  a: matrix[0]!, b: matrix[3]!, c: matrix[1]!, d: matrix[4]!,
  tx: matrix[2]!, ty: matrix[5]!
});

/**
 * Explicit source-kind conversion seam for imported positioned text.
 *
 * Analysis is recomputed from the current immutable source so callers cannot
 * apply a stale or forged preview. Application history retains the untouched
 * positioned layer as the undo snapshot; ordinary typing transactions remain
 * unable to cross the source-kind boundary.
 */
export const recoverPositionedTextAsFlow = (
  document: ImageDocument,
  layerId: LayerId
): ImageDocument => {
  const current = findDocumentLayer(document, layerId);
  if (
    current?.type !== 'text'
    || current.text.source.kind !== 'positioned'
    || layerIsLocked(current, 'pixels')
  ) return document;
  const analysis = analyzePositionedTextRecovery(current.text.source);
  if (!analysis.preview || analysis.status === 'blocked') return document;
  const transformDelta = affineFromTextMatrix(analysis.preview.layerTransformDelta);
  if (!isIdentityAffineMatrix(transformDelta) && layerIsLocked(current, 'position')) return document;
  const nextText = cloneTextLayerData(bumpRevisions({
    ...current.text,
    source: analysis.preview.source
  }, ['content', 'font', 'layout', 'paint', 'geometry']));
  const transform = multiplyMatrices(current.transform, transformDelta);
  const now = Date.now();
  return {
    ...document,
    layers: updateLayerNode(document.layers, layerId, layer => layer.type === 'text'
      ? {
        ...layer,
        text: nextText,
        transform,
        revision: layer.revision + 1,
        geometryRevision: layer.geometryRevision + 1,
        modifiedAt: now
      }
      : layer),
    revision: document.revision + 1,
    modifiedAt: now
  };
};

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
  const {
    insertionStyle: _oldInsertionStyle,
    insertionParagraph: _oldInsertionParagraph,
    ...sourceWithoutInsertionState
  } = layer.text.source;
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
      ...(insertionState === undefined ? layer.text.source : sourceWithoutInsertionState),
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

export const setTextWarp = (
  document: ImageDocument,
  layerId: LayerId,
  warp: TextWarp | null
) => updateTextLayer(document, layerId, (layer) => {
  const next = warp ? structuredClone(warp) : undefined;
  if (sameValue(layer.text.warp, next)) return layer.text;
  return bumpRevisions({ ...layer.text, warp: next }, ['geometry']);
}, 'position');

export interface ParagraphFrameConversionOptions {
  readonly width: number;
  readonly height: number;
  readonly overflow?: 'visible' | 'clip' | 'indicator';
  /** Realized distance from the frame top to the first baseline. */
  readonly firstBaselineOffset?: number;
}

export interface PointTextConversionOptions {
  /** Realized distance from the paragraph frame top to the first baseline. */
  readonly firstBaselineOffset?: number;
}

const assertParagraphFrameSize = (
  options: ParagraphFrameConversionOptions
) => {
  if (
    !Number.isFinite(options.width)
    || !Number.isFinite(options.height)
    || options.width <= 0
    || options.height <= 0
  ) {
    throw new RangeError('Paragraph frame width and height must be finite positive values.');
  }
};

/**
 * Converts authored point text to a local paragraph frame without touching the
 * common layer transform. The point baseline is translated to a frame top by
 * the realized first-baseline offset, so transformed layers do not jump.
 */
export const convertPointTextToParagraph = (
  document: ImageDocument,
  layerId: LayerId,
  options: ParagraphFrameConversionOptions
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
  const layout = layer.text.source.layout;
  if (layout.mode !== 'point') return document;
  assertParagraphFrameSize(options);
  const firstBaselineOffset = Number.isFinite(options.firstBaselineOffset)
    ? options.firstBaselineOffset!
    : 0;
  return setFlowTextLayout(document, layerId, {
    mode: 'paragraph',
    frame: {
      x: layout.origin.x,
      y: layout.origin.y - firstBaselineOffset,
      width: options.width,
      height: options.height
    },
    overflow: options.overflow ?? 'indicator',
    writingMode: layout.writingMode
  });
};

/**
 * Converts a paragraph frame back to point text at its first baseline.
 * Authored text and explicit line breaks remain untouched; only layout mode
 * changes and the common layer transform stays authoritative for placement.
 */
export const convertParagraphTextToPoint = (
  document: ImageDocument,
  layerId: LayerId,
  options: PointTextConversionOptions = {}
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
  const layout = layer.text.source.layout;
  if (layout.mode !== 'paragraph') return document;
  const firstBaselineOffset = Number.isFinite(options.firstBaselineOffset)
    ? options.firstBaselineOffset!
    : 0;
  return setFlowTextLayout(document, layerId, {
    mode: 'point',
    origin: { x: layout.frame.x, y: layout.frame.y + firstBaselineOffset },
    writingMode: layout.writingMode
  });
};

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
    const warpChanged = !sameValue(current.warp, next.warp);
    if (
      (contentOrRunsChanged && layerIsLocked(layer, 'pixels'))
      || ((layoutChanged || warpChanged) && layerIsLocked(layer, 'position'))
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
    if (layoutChanged) changed = setFlowTextLayout(changed, layerId, next.source.layout);
    return warpChanged ? setTextWarp(changed, layerId, next.warp ?? null) : changed;
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
