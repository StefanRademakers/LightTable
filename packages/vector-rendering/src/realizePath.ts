import {
  flattenCubic,
  pathBounds,
  segmentAt,
  segmentCount,
  transformedBounds,
  type Rect,
  type Vec2,
  type VectorPath
} from '@lighttable/vector-core';
import type { VectorGeometryKey } from './contracts';
import { vectorGeometryKey } from './contracts';

export interface RealizedSubpath {
  id: string;
  closed: boolean;
  /** Consecutive local-space points; closing edge is implicit. */
  points: readonly Vec2[];
}

export interface RealizedVectorGeometry {
  key: VectorGeometryKey;
  localBounds: Rect | null;
  documentBounds: Rect | null;
  subpaths: readonly RealizedSubpath[];
  estimatedBytes: number;
}

/**
 * Stable tolerance buckets prevent tiny zoom changes from churning geometry.
 * The returned value is in document pixels and is deliberately independent of
 * viewport translation.
 */
export const quantizeDocumentTolerance = (tolerance: number) => {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
    throw new RangeError('Vector realization tolerance must be finite and greater than zero.');
  }
  const exponent = Math.round(Math.log2(tolerance) * 4) / 4;
  return 2 ** exponent;
};

export const realizeVectorPath = (
  path: VectorPath,
  requestedTolerance: number
): RealizedVectorGeometry => {
  const toleranceBucket = quantizeDocumentTolerance(requestedTolerance);
  const subpaths: RealizedSubpath[] = [];
  let pointCount = 0;

  for (const subpath of path.subpaths) {
    const points: Vec2[] = [];
    for (let index = 0; index < segmentCount(subpath); index += 1) {
      const segmentPoints = flattenCubic(segmentAt(subpath, index), {
        tolerance: toleranceBucket
      });
      points.push(...(index === 0 ? segmentPoints : segmentPoints.slice(1)));
    }
    if (subpath.anchors.length === 1) points.push({ ...subpath.anchors[0].position });
    pointCount += points.length;
    subpaths.push({ id: subpath.id, closed: subpath.closed, points });
  }

  const localBounds = pathBounds(path);
  return {
    key: vectorGeometryKey(path.id, path.geometryRevision, toleranceBucket),
    localBounds,
    documentBounds: localBounds ? transformedBounds(path.transform, localBounds) : null,
    subpaths,
    // Two f64 coordinates per point plus a conservative per-subpath overhead.
    estimatedBytes: pointCount * 16 + subpaths.length * 32
  };
};
