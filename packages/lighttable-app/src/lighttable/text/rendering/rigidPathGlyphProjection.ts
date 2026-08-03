import type {
  PathTextLayout,
  RealizedGlyphRun,
  RealizedTextLayout
} from '@lighttable/text-core';
import {
  resolvePathTextRange,
  samplePathArcLength,
  type PathArcLengthTable,
  type PathTextAlignment,
  type ResolvedPathTextRange
} from '@lighttable/vector-rendering';

export interface RigidPathGlyphProjection {
  readonly glyphRuns: readonly RealizedGlyphRun[];
  readonly range: ResolvedPathTextRange;
  readonly linearOrigin: number;
  readonly contentAdvance: number;
}

export interface RigidPathPlacement {
  readonly point: { readonly x: number; readonly y: number };
  readonly cosine: number;
  readonly sine: number;
}

const horizontalExtent = (layout: RealizedTextLayout) => {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const run of layout.glyphRuns) {
    for (let index = 0; index < run.glyphIds.length; index += 1) {
      const x = run.geometry[index * 4]!;
      const advance = run.geometry[index * 4 + 2]!;
      minimum = Math.min(minimum, x, x + advance);
      maximum = Math.max(maximum, x, x + advance);
    }
  }
  return Number.isFinite(minimum)
    ? { minimum, maximum, advance: Math.max(0, maximum - minimum) }
    : { minimum: 0, maximum: 0, advance: 0 };
};

const normalizedUprightAngle = (angle: number) => {
  let result = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (result > Math.PI / 2) result -= Math.PI;
  else if (result < -Math.PI / 2) result += Math.PI;
  return result;
};

export const rigidPathPlacementAt = (
  table: PathArcLengthTable,
  offset: number,
  direction: ResolvedPathTextRange['direction'],
  pathLayout: PathTextLayout
): RigidPathPlacement => {
  const sample = samplePathArcLength(table, offset, direction);
  let angle = Math.atan2(sample.tangent.y, sample.tangent.x);
  if (pathLayout.side === 'right') angle += Math.PI;
  if (pathLayout.upright) angle = normalizedUprightAngle(angle);
  return {
    point: sample.point,
    cosine: Math.cos(angle) || 0,
    sine: Math.sin(angle) || 0
  };
};

/**
 * Projects already-shaped horizontal glyphs onto a path without deforming
 * their outlines. The returned transforms are consumed by the existing
 * scale-independent outline renderer; this function owns no UI or GPU state.
 */
export const projectRigidGlyphRunsToPath = (
  layout: RealizedTextLayout,
  pathLayout: PathTextLayout,
  table: PathArcLengthTable,
  alignment: PathTextAlignment
): RigidPathGlyphProjection => {
  const extent = horizontalExtent(layout);
  const range = resolvePathTextRange(table, {
    startOffset: pathLayout.startOffset,
    ...(pathLayout.endOffset === undefined ? {} : { endOffset: pathLayout.endOffset }),
    direction: pathLayout.direction ?? 'forward',
    alignment,
    contentAdvance: extent.advance
  });
  const glyphRuns = layout.glyphRuns.map<RealizedGlyphRun>((run) => {
    const transforms = new Float32Array(run.glyphIds.length * 9);
    for (let index = 0; index < run.glyphIds.length; index += 1) {
      const x = run.geometry[index * 4]!;
      const y = run.geometry[index * 4 + 1]!;
      const traversalOffset = range.origin + (x - extent.minimum);
      const placement = rigidPathPlacementAt(table, traversalOffset, range.direction, pathLayout);
      const { cosine, sine } = placement;
      transforms.set([
        cosine, -sine || 0, placement.point.x - x || 0,
        sine, cosine, placement.point.y - y || 0,
        0, 0, 1
      ], index * 9);
    }
    return { ...run, transforms };
  });
  return Object.freeze({
    glyphRuns: Object.freeze(glyphRuns),
    range,
    linearOrigin: extent.minimum,
    contentAdvance: extent.advance
  });
};
