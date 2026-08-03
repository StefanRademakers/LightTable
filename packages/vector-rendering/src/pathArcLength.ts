import {
  multiplyMatrices,
  transformPoint,
  type AffineMatrix,
  type Vec2,
  type VectorPath
} from '@lighttable/vector-core';
import { quantizeDocumentTolerance, realizeVectorPath } from './realizePath';
import { RevisionedResourceCache, type ResourceCacheMetrics } from './RevisionedResourceCache';

export type PathTraversalDirection = 'forward' | 'reverse';
export type PathTextAlignment = 'start' | 'center' | 'end';

export interface PathArcLengthTable {
  readonly key: string;
  readonly pathId: string;
  readonly subpathId: string;
  readonly geometryRevision: number;
  readonly transformRevision: number;
  readonly toleranceBucket: number;
  readonly closed: boolean;
  /** Interleaved document-space x/y coordinates. */
  readonly points: Float64Array;
  /** Cumulative distance at each point; the first value is always zero. */
  readonly cumulativeLengths: Float64Array;
  readonly length: number;
  readonly estimatedBytes: number;
}

export interface PathArcLengthSample {
  readonly point: Vec2;
  /** Unit tangent in the requested traversal direction. */
  readonly tangent: Vec2;
  readonly distance: number;
}

export interface PathTextRangeOptions {
  readonly startOffset: number;
  readonly endOffset?: number;
  readonly direction?: PathTraversalDirection;
  readonly alignment?: PathTextAlignment;
  readonly contentAdvance: number;
}

export interface ResolvedPathTextRange {
  /** Distances are measured in traversal space, not viewport space. */
  readonly start: number;
  readonly end: number;
  readonly origin: number;
  readonly available: number;
  readonly overflow: number;
  readonly direction: PathTraversalDirection;
}

const matrixKey = (matrix: AffineMatrix) =>
  [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .map((value) => Object.is(value, -0) ? '0' : value.toString())
    .join(',');

export const pathArcLengthKey = (
  path: VectorPath,
  subpathId: string,
  layerTransform: AffineMatrix,
  requestedTolerance: number
) => {
  const tolerance = quantizeDocumentTolerance(requestedTolerance);
  return [
    path.id, subpathId, path.geometryRevision, path.transformRevision,
    tolerance, matrixKey(layerTransform), matrixKey(path.transform)
  ].join(':');
};

const samePoint = (left: Vec2, right: Vec2) =>
  left.x === right.x && left.y === right.y;

/**
 * Builds a path metric in document space. Scaling and skew therefore affect
 * advances correctly, while viewport pan/zoom never enter the cache identity.
 */
export const realizePathArcLength = (
  path: VectorPath,
  subpathId: string,
  layerTransform: AffineMatrix,
  requestedTolerance: number
): PathArcLengthTable => {
  const realized = realizeVectorPath(path, requestedTolerance);
  const subpath = realized.subpaths.find(({ id }) => id === subpathId);
  if (!subpath) throw new Error(`Vector path ${path.id} has no subpath ${subpathId}.`);

  const localToDocument = multiplyMatrices(layerTransform, path.transform);
  const documentPoints = subpath.points.map((point) => transformPoint(localToDocument, point));
  if (subpath.closed && documentPoints.length > 1
      && !samePoint(documentPoints[0]!, documentPoints[documentPoints.length - 1]!)) {
    documentPoints.push({ ...documentPoints[0]! });
  }

  const points = new Float64Array(documentPoints.length * 2);
  const cumulativeLengths = new Float64Array(documentPoints.length);
  let length = 0;
  for (let index = 0; index < documentPoints.length; index += 1) {
    const point = documentPoints[index]!;
    points[index * 2] = point.x;
    points[index * 2 + 1] = point.y;
    if (index > 0) {
      const previous = documentPoints[index - 1]!;
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    cumulativeLengths[index] = length;
  }

  return {
    key: pathArcLengthKey(path, subpathId, layerTransform, requestedTolerance),
    pathId: path.id,
    subpathId,
    geometryRevision: path.geometryRevision,
    transformRevision: path.transformRevision,
    toleranceBucket: realized.key.toleranceBucket,
    closed: subpath.closed,
    points,
    cumulativeLengths,
    length,
    estimatedBytes: points.byteLength + cumulativeLengths.byteLength + 128
  };
};

const normalizedDistance = (table: PathArcLengthTable, distance: number) => {
  if (!(table.length > 0)) return 0;
  if (!table.closed) return Math.min(table.length, Math.max(0, distance));
  const wrapped = distance % table.length;
  return wrapped < 0 ? wrapped + table.length : wrapped;
};

const pointAt = (points: Float64Array, index: number): Vec2 => ({
  x: points[index * 2]!, y: points[index * 2 + 1]!
});

/** Samples in logarithmic time and skips zero-length segments for a stable tangent. */
export const samplePathArcLength = (
  table: PathArcLengthTable,
  offset: number,
  direction: PathTraversalDirection = 'forward'
): PathArcLengthSample => {
  if (!Number.isFinite(offset)) throw new RangeError('Path offset must be finite.');
  const pointCount = table.cumulativeLengths.length;
  if (pointCount === 0) {
    return { point: { x: 0, y: 0 }, tangent: { x: direction === 'forward' ? 1 : -1, y: 0 }, distance: 0 };
  }
  if (pointCount === 1 || !(table.length > 0)) {
    return {
      point: pointAt(table.points, 0),
      tangent: { x: direction === 'forward' ? 1 : -1, y: 0 },
      distance: 0
    };
  }

  const traversalDistance = normalizedDistance(table, offset);
  const distance = direction === 'forward'
    ? traversalDistance
    : normalizedDistance(table, table.length - traversalDistance);
  let low = 1;
  let high = pointCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table.cumulativeLengths[middle]! < distance) low = middle + 1;
    else high = middle;
  }

  let endIndex = low;
  while (endIndex < pointCount && table.cumulativeLengths[endIndex] === table.cumulativeLengths[endIndex - 1]) {
    endIndex += 1;
  }
  if (endIndex >= pointCount) {
    endIndex = pointCount - 1;
    while (endIndex > 0 && table.cumulativeLengths[endIndex] === table.cumulativeLengths[endIndex - 1]) {
      endIndex -= 1;
    }
  }
  const startIndex = Math.max(0, endIndex - 1);
  const start = pointAt(table.points, startIndex);
  const end = pointAt(table.points, endIndex);
  const segmentStart = table.cumulativeLengths[startIndex]!;
  const segmentLength = table.cumulativeLengths[endIndex]! - segmentStart;
  const amount = segmentLength > 0 ? Math.min(1, Math.max(0, (distance - segmentStart) / segmentLength)) : 0;
  const tangentScale = (direction === 'forward' ? 1 : -1) / Math.max(segmentLength, Number.EPSILON);

  return {
    point: {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount
    },
    tangent: {
      x: (end.x - start.x) * tangentScale || 0,
      y: (end.y - start.y) * tangentScale || 0
    },
    distance: traversalDistance
  };
};

export const resolvePathTextRange = (
  table: PathArcLengthTable,
  options: PathTextRangeOptions
): ResolvedPathTextRange => {
  const { contentAdvance } = options;
  if (![options.startOffset, options.endOffset ?? table.length, contentAdvance].every(Number.isFinite)) {
    throw new RangeError('Path text offsets and content advance must be finite.');
  }
  if (contentAdvance < 0) throw new RangeError('Path text content advance must be non-negative.');
  const start = normalizedDistance(table, options.startOffset);
  let end = normalizedDistance(table, options.endOffset ?? table.length);
  if (table.closed && end <= start) end += table.length;
  if (!table.closed) end = Math.max(start, end);
  const available = Math.max(0, end - start);
  const remaining = Math.max(0, available - contentAdvance);
  const alignment = options.alignment ?? 'start';
  const origin = start + (alignment === 'center' ? remaining / 2 : alignment === 'end' ? remaining : 0);
  return {
    start,
    end,
    origin,
    available,
    overflow: Math.max(0, contentAdvance - available),
    direction: options.direction ?? 'forward'
  };
};

/** Byte-bounded ownership for derived path metrics shared by dependent text layers. */
export class PathArcLengthCache {
  private readonly cache: RevisionedResourceCache<PathArcLengthTable>;

  constructor(maxBytes: number) {
    this.cache = new RevisionedResourceCache(maxBytes);
  }

  realize(
    path: VectorPath,
    subpathId: string,
    layerTransform: AffineMatrix,
    requestedTolerance: number
  ) {
    const key = pathArcLengthKey(path, subpathId, layerTransform, requestedTolerance);
    const existing = this.cache.get(key);
    if (existing) return existing;
    const realized = realizePathArcLength(path, subpathId, layerTransform, requestedTolerance);
    return this.cache.set(key, realized, realized.estimatedBytes);
  }

  clear() {
    this.cache.clear();
  }

  metrics(): ResourceCacheMetrics {
    return this.cache.metrics();
  }
}
