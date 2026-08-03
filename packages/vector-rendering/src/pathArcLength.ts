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

export interface NearestPathArcLengthPoint {
  readonly point: Vec2;
  /** Geometric forward distance from the canonical subpath start. */
  readonly offset: number;
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

interface ArcSegment {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly startOffset: number;
  readonly length: number;
}

interface ArcSpatialIndex {
  readonly cellSize: number;
  readonly cells: ReadonlyMap<string, readonly number[]>;
  readonly segments: readonly ArcSegment[];
  readonly minimumCellX: number;
  readonly maximumCellX: number;
  readonly minimumCellY: number;
  readonly maximumCellY: number;
}

const arcSpatialIndexes = new WeakMap<PathArcLengthTable, ArcSpatialIndex>();
const arcCellKey = (x: number, y: number) => `${x}:${y}`;

const arcSpatialIndex = (table: PathArcLengthTable): ArcSpatialIndex => {
  const cached = arcSpatialIndexes.get(table);
  if (cached) return cached;
  const segments: ArcSegment[] = [];
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < table.cumulativeLengths.length; index += 1) {
    const start = pointAt(table.points, index - 1);
    const end = pointAt(table.points, index);
    const length = table.cumulativeLengths[index]! - table.cumulativeLengths[index - 1]!;
    if (!(length > 0)) continue;
    segments.push({ start, end, startOffset: table.cumulativeLengths[index - 1]!, length });
    minimumX = Math.min(minimumX, start.x, end.x);
    maximumX = Math.max(maximumX, start.x, end.x);
    minimumY = Math.min(minimumY, start.y, end.y);
    maximumY = Math.max(maximumY, start.y, end.y);
  }
  const diagonal = Number.isFinite(minimumX)
    ? Math.hypot(maximumX - minimumX, maximumY - minimumY) : 0;
  const cellSize = Math.max(8, diagonal / 128 || 8);
  const cells = new Map<string, number[]>();
  segments.forEach((segment, segmentIndex) => {
    const left = Math.floor(Math.min(segment.start.x, segment.end.x) / cellSize);
    const right = Math.floor(Math.max(segment.start.x, segment.end.x) / cellSize);
    const top = Math.floor(Math.min(segment.start.y, segment.end.y) / cellSize);
    const bottom = Math.floor(Math.max(segment.start.y, segment.end.y) / cellSize);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const key = arcCellKey(x, y);
        const cell = cells.get(key) ?? [];
        cell.push(segmentIndex);
        cells.set(key, cell);
      }
    }
  });
  const created = {
    cellSize,
    cells,
    segments,
    minimumCellX: Number.isFinite(minimumX) ? Math.floor(minimumX / cellSize) : 0,
    maximumCellX: Number.isFinite(maximumX) ? Math.floor(maximumX / cellSize) : 0,
    minimumCellY: Number.isFinite(minimumY) ? Math.floor(minimumY / cellSize) : 0,
    maximumCellY: Number.isFinite(maximumY) ? Math.floor(maximumY / cellSize) : 0
  };
  arcSpatialIndexes.set(table, created);
  return created;
};

const nearestOnSegment = (segment: ArcSegment, point: Vec2): NearestPathArcLengthPoint => {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const amount = Math.min(1, Math.max(0,
    ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy)
      / (segment.length * segment.length)
  ));
  const nearest = {
    x: segment.start.x + dx * amount,
    y: segment.start.y + dy * amount
  };
  return {
    point: nearest,
    offset: segment.startOffset + segment.length * amount,
    distance: Math.hypot(point.x - nearest.x, point.y - nearest.y)
  };
};

/** Retained spatial lookup shared by path-text hit-testing and handle drags. */
export const nearestPathArcLength = (
  table: PathArcLengthTable,
  point: Vec2
): NearestPathArcLengthPoint => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Path hit-test point must be finite.');
  }
  const index = arcSpatialIndex(table);
  if (index.segments.length === 0) {
    const only = table.points.length >= 2 ? pointAt(table.points, 0) : { x: 0, y: 0 };
    return { point: only, offset: 0, distance: Math.hypot(point.x - only.x, point.y - only.y) };
  }
  const rawX = Math.floor(point.x / index.cellSize);
  const rawY = Math.floor(point.y / index.cellSize);
  const centerX = Math.min(index.maximumCellX, Math.max(index.minimumCellX, rawX));
  const centerY = Math.min(index.maximumCellY, Math.max(index.minimumCellY, rawY));
  const maximumRadius = Math.max(
    centerX - index.minimumCellX,
    index.maximumCellX - centerX,
    centerY - index.minimumCellY,
    index.maximumCellY - centerY
  );
  const inspected = new Set<number>();
  const nearestState: { value: NearestPathArcLengthPoint | null } = { value: null };
  const inspect = (x: number, y: number) => {
    for (const segmentIndex of index.cells.get(arcCellKey(x, y)) ?? []) {
      if (inspected.has(segmentIndex)) continue;
      inspected.add(segmentIndex);
      const candidate = nearestOnSegment(index.segments[segmentIndex]!, point);
      if (!nearestState.value || candidate.distance < nearestState.value.distance) {
        nearestState.value = candidate;
      }
    }
  };
  for (let radius = 0; radius <= maximumRadius; radius += 1) {
    if (radius === 0) inspect(centerX, centerY);
    else {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        inspect(x, centerY - radius);
        inspect(x, centerY + radius);
      }
      for (let y = centerY - radius + 1; y < centerY + radius; y += 1) {
        inspect(centerX - radius, y);
        inspect(centerX + radius, y);
      }
    }
    if (nearestState.value) {
      const left = (centerX - radius) * index.cellSize;
      const right = (centerX + radius + 1) * index.cellSize;
      const top = (centerY - radius) * index.cellSize;
      const bottom = (centerY + radius + 1) * index.cellSize;
      const distanceToOutside = Math.min(
        point.x - left, right - point.x, point.y - top, bottom - point.y
      );
      if (distanceToOutside >= 0 && nearestState.value.distance <= distanceToOutside) {
        return nearestState.value;
      }
    }
  }
  // Bounding-cell clamping keeps the ring bounded. A sparse diagonal can leave
  // cells unvisited, so inspect any remaining segments once as a correctness fallback.
  index.segments.forEach((segment, segmentIndex) => {
    if (inspected.has(segmentIndex)) return;
    const candidate = nearestOnSegment(segment, point);
    if (!nearestState.value || candidate.distance < nearestState.value.distance) {
      nearestState.value = candidate;
    }
  });
  return nearestState.value!;
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
