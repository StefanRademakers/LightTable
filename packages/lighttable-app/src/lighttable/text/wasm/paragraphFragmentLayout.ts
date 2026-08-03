import {
  TEXT_LAYOUT_SCHEMA_VERSION,
  realizeParagraphFrame,
  type FlowTextSource,
  type FontAssetRef,
  type RealizedTextLayout,
  type Rect
} from '@lighttable/text-core';
import type { FlowParagraphSegment } from './incrementalParagraphLayout';
import type { UniformParagraphLayout } from './uniformParagraphLayout';

export interface PackedParagraphFragment {
  readonly runMeta: Uint32Array;
  readonly glyphIds: Uint32Array;
  readonly clusters: Uint32Array;
  readonly geometry: Float32Array;
  readonly lineMeta: Uint32Array;
  readonly lineGeometry: Float32Array;
  readonly caretMeta: Uint32Array;
  readonly caretGeometry: Float32Array;
  readonly selectionMeta: Uint32Array;
  readonly selectionGeometry: Float32Array;
  readonly clusterMap: Uint32Array;
  readonly bounds: Float32Array;
}

export interface ParagraphFragmentPlacement {
  readonly segment: FlowParagraphSegment;
  readonly fragment: PackedParagraphFragment;
  readonly paragraph: UniformParagraphLayout;
}

export const estimatePackedParagraphBytes = (fragment: PackedParagraphFragment): number => (
  256
  + fragment.runMeta.byteLength
  + fragment.glyphIds.byteLength
  + fragment.clusters.byteLength
  + fragment.geometry.byteLength
  + fragment.lineMeta.byteLength
  + fragment.lineGeometry.byteLength
  + fragment.caretMeta.byteLength
  + fragment.caretGeometry.byteLength
  + fragment.selectionMeta.byteLength
  + fragment.selectionGeometry.byteLength
  + fragment.clusterMap.byteLength
  + fragment.bounds.byteLength
);

const translatedRect = (values: Float32Array, offset: number, dx: number, dy: number): Rect => ({
  x: values[offset] + dx,
  y: values[offset + 1] + dy,
  width: values[offset + 2],
  height: values[offset + 3]
});

const unionRect = (left: Rect | null, right: Rect): Rect => {
  if (!left) return right;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
};

const retainedLineCount = (
  placement: ParagraphFragmentPlacement,
  finalParagraph: boolean
): number => {
  const count = placement.fragment.lineMeta.length / 2;
  if (finalParagraph || count === 0) return count;
  const last = (count - 1) * 2;
  const localEnd = placement.segment.text.length;
  return placement.fragment.lineMeta[last] === localEnd
    && placement.fragment.lineMeta[last + 1] === localEnd
    ? count - 1
    : count;
};

const retainedContentHeight = (
  fragment: PackedParagraphFragment,
  lineCount: number
): number => {
  const completeLineCount = fragment.lineMeta.length / 2;
  if (lineCount < completeLineCount) {
    // A standalone paragraph ending in a separator has one synthetic empty
    // terminal line. Remove precisely its baseline advance from Parley's
    // logical height; visual line bounds include ascent/descent and half-
    // leading, so their height is intentionally not the stacking advance.
    const terminalBaseline = fragment.lineGeometry[lineCount * 7];
    const previousBaseline = fragment.lineGeometry[(lineCount - 1) * 7];
    return Math.max(0, fragment.bounds[7] - (terminalBaseline - previousBaseline));
  }
  return Math.max(0, fragment.bounds[7]);
};

export interface AssembleParagraphLayoutInput {
  readonly key: string;
  readonly source: FlowTextSource & { readonly layout: Extract<FlowTextSource['layout'], { readonly mode: 'paragraph' }> };
  readonly selectedFonts: readonly FontAssetRef[];
  readonly placements: readonly ParagraphFragmentPlacement[];
  readonly maxGlyphCount: number;
}

/**
 * Rebuilds one transferable whole-flow result from retained paragraph-local
 * fragments. No returned typed array aliases a cached fragment.
 */
export const assembleParagraphLayout = ({
  key,
  source,
  selectedFonts,
  placements,
  maxGlyphCount
}: AssembleParagraphLayoutInput): RealizedTextLayout => {
  const glyphRuns: RealizedTextLayout['glyphRuns'][number][] = [];
  const lines: RealizedTextLayout['lines'][number][] = [];
  const caretStops: RealizedTextLayout['caretStops'][number][] = [];
  const selectionGeometry: RealizedTextLayout['selectionGeometry'][number][] = [];
  const clusterMap: RealizedTextLayout['clusterMap'][number][] = [];
  const warnings: RealizedTextLayout['warnings'][number][] = [];
  let glyphBase = 0;
  let cursorY = source.layout.frame.y;
  let inkBounds: Rect | null = null;
  let logicalHorizontal: Rect | null = null;

  for (const [paragraphIndex, placement] of placements.entries()) {
    const { fragment, paragraph, segment } = placement;
    const lineCount = retainedLineCount(placement, paragraphIndex === placements.length - 1);
    const contentHeight = retainedContentHeight(fragment, lineCount);
    const finalLineOffset = (lineCount > 0
      && paragraphIndex === placements.length - 1
      && fragment.lineMeta[(lineCount - 1) * 2] === segment.text.length
      && fragment.lineMeta[(lineCount - 1) * 2 + 1] === segment.text.length)
      ? paragraph.spaceBefore + paragraph.spaceAfter
      : 0;
    const dx = source.layout.frame.x;
    const paragraphY = cursorY + paragraph.spaceBefore;
    const dy = paragraphY - fragment.bounds[5];

    for (let runIndex = 0; runIndex < fragment.runMeta.length / 5; runIndex += 1) {
      const meta = runIndex * 5;
      const localStyleSlot = fragment.runMeta[meta];
      const styleSlice = segment.textStyles[localStyleSlot];
      if (!styleSlice) throw new Error('Cached paragraph refers to an invalid local style slot.');
      const sourceRunIndex = styleSlice.sourceRunIndex;
      const style = source.styleRuns[sourceRunIndex];
      const font = selectedFonts[sourceRunIndex];
      if (!style || !font) throw new Error('Cached paragraph style provenance is unavailable.');
      if (fragment.runMeta[meta + 2] !== 1) {
        throw new Error('Parley selected a fallback font; exact paragraph provenance is required.');
      }
      const start = fragment.runMeta[meta + 3];
      const end = fragment.runMeta[meta + 4];
      const geometry = fragment.geometry.slice(start * 4, end * 4);
      for (let index = 0; index < geometry.length; index += 4) {
        geometry[index] += dx;
        geometry[index + 1] += dy;
      }
      const clusters = fragment.clusters.slice(start, end);
      for (let index = 0; index < clusters.length; index += 1) clusters[index] += segment.start;
      const glyphIds = fragment.glyphIds.slice(start, end);
      glyphRuns.push({
        font: {
          font,
          variableAxes: style.variableAxes,
          syntheticBold: style.syntheticBold,
          syntheticItalic: style.syntheticItalic
        },
        fontSize: style.fontSize,
        fontResolution: { kind: 'flow-exact', sourceRunIndex, requested: style.requestedFont },
        paint: { fill: style.fill, ...(style.stroke ? { stroke: style.stroke } : {}) },
        renderingMode: style.stroke ? 'fill-stroke' : 'fill',
        direction: fragment.runMeta[meta + 1] === 1 ? 'rtl' : 'ltr',
        ...(style.language ? { language: style.language } : {}),
        glyphIds,
        clusters,
        geometry
      });
      if (glyphIds.includes(0)) {
        warnings.push({
          code: 'missing-glyph',
          message: 'The selected font emitted .notdef.',
          runIndex: glyphRuns.length - 1
        });
      }
    }

    for (let index = 0; index < lineCount; index += 1) {
      const meta = index * 2;
      const geometry = index * 7;
      const terminalOffset = index === lineCount - 1 ? finalLineOffset : 0;
      lines.push({
        start: fragment.lineMeta[meta] + segment.start,
        end: fragment.lineMeta[meta + 1] + segment.start,
        baseline: fragment.lineGeometry[geometry] + dy + terminalOffset,
        ascent: fragment.lineGeometry[geometry + 1],
        descent: fragment.lineGeometry[geometry + 2],
        bounds: translatedRect(fragment.lineGeometry, geometry + 3, dx, dy + terminalOffset)
      });
    }
    for (let index = 0; index < fragment.caretMeta.length / 2; index += 1) {
      const meta = index * 2;
      const geometry = index * 3;
      caretStops.push({
        textOffset: fragment.caretMeta[meta] + segment.start,
        affinity: fragment.caretMeta[meta + 1] === 1 ? 'downstream' : 'upstream',
        x: fragment.caretGeometry[geometry] + dx,
        y: fragment.caretGeometry[geometry + 1] + dy,
        height: fragment.caretGeometry[geometry + 2]
      });
    }
    for (let index = 0; index < fragment.selectionMeta.length / 2; index += 1) {
      const meta = index * 2;
      selectionGeometry.push({
        start: fragment.selectionMeta[meta] + segment.start,
        end: fragment.selectionMeta[meta + 1] + segment.start,
        bounds: translatedRect(fragment.selectionGeometry, index * 4, dx, dy)
      });
    }
    for (let index = 0; index < fragment.clusterMap.length / 4; index += 1) {
      const offset = index * 4;
      clusterMap.push({
        textStart: fragment.clusterMap[offset] + segment.start,
        textEnd: fragment.clusterMap[offset + 1] + segment.start,
        glyphStart: fragment.clusterMap[offset + 2] + glyphBase,
        glyphEnd: fragment.clusterMap[offset + 3] + glyphBase
      });
    }

    if (fragment.glyphIds.length > 0) {
      inkBounds = unionRect(inkBounds, translatedRect(fragment.bounds, 0, dx, dy));
    }
    logicalHorizontal = unionRect(logicalHorizontal, {
      x: fragment.bounds[4] + dx,
      y: paragraphY,
      width: fragment.bounds[6],
      height: contentHeight
    });
    glyphBase += fragment.glyphIds.length;
    if (glyphBase > maxGlyphCount) throw new Error('Layout exceeds maxGlyphCount.');
    cursorY = paragraphY + contentHeight + paragraph.spaceAfter + finalLineOffset;
  }

  caretStops.sort((left, right) => left.textOffset - right.textOffset
    || left.affinity.localeCompare(right.affinity));
  for (let index = caretStops.length - 1; index > 0; index -= 1) {
    const left = caretStops[index - 1];
    const right = caretStops[index];
    if (left.textOffset === right.textOffset && left.affinity === right.affinity) {
      caretStops.splice(index, 1);
    }
  }
  const logicalBounds: Rect = {
    x: logicalHorizontal?.x ?? source.layout.frame.x,
    y: source.layout.frame.y,
    width: logicalHorizontal?.width ?? 0,
    height: Math.max(0, cursorY - source.layout.frame.y)
  };
  const layout: RealizedTextLayout = {
    schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
    key,
    glyphRuns,
    lines,
    caretStops,
    selectionGeometry,
    clusterMap,
    inkBounds: inkBounds ?? { x: source.layout.frame.x, y: source.layout.frame.y, width: 0, height: 0 },
    logicalBounds,
    paragraphFrame: realizeParagraphFrame(source.layout, lines),
    warnings
  };
  return layout;
};
