import type { CaretStop, PathTextLayout, RealizedTextLayout } from '@lighttable/text-core';
import type { AffineMatrix } from '../../editor/geometry/affine';
import { nearestPathArcLength, type PathArcLengthTable } from '@lighttable/vector-rendering';
import type { RigidPathGlyphProjection } from '../../text/rendering/rigidPathGlyphProjection';
import { pathTextLocalPoint } from '../../text/rendering/pathTextEditingOverlay';
import { unwarpTextPoint } from '@lighttable/text-rendering';

export interface TextEditingLayoutHitTarget {
  readonly layout: RealizedTextLayout;
  readonly localToDocument: AffineMatrix;
  readonly path?: Readonly<{
    readonly pathLayout: PathTextLayout;
    readonly table: PathArcLengthTable;
    readonly projection: RigidPathGlyphProjection;
  }>;
}

const inversePoint = (matrix: AffineMatrix, point: { readonly x: number; readonly y: number }) => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12) return null;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant
  };
};

export interface TextEditingHit {
  readonly offset: number;
  readonly affinity: CaretStop['affinity'];
  readonly distance: number;
}

interface CaretSpatialIndex {
  readonly cellSize: number;
  readonly cells: ReadonlyMap<string, readonly CaretStop[]>;
  readonly minimumCellX: number;
  readonly maximumCellX: number;
  readonly minimumCellY: number;
  readonly maximumCellY: number;
}

const caretSpatialIndexes = new WeakMap<RealizedTextLayout, CaretSpatialIndex>();
const cellKey = (x: number, y: number) => `${x}:${y}`;

const caretSpatialIndex = (layout: RealizedTextLayout): CaretSpatialIndex => {
  const existing = caretSpatialIndexes.get(layout);
  if (existing) return existing;
  const sampleHeight = layout.caretStops.find(({ height }) => height > 0)?.height ?? 16;
  const cellSize = Math.max(4, Math.min(256, sampleHeight));
  const cells = new Map<string, CaretStop[]>();
  let minimumCellX = 0;
  let maximumCellX = 0;
  let minimumCellY = 0;
  let maximumCellY = 0;
  layout.caretStops.forEach((stop, index) => {
    const x = Math.floor(stop.x / cellSize);
    const y = Math.floor(stop.y / cellSize);
    const key = cellKey(x, y);
    const cell = cells.get(key) ?? [];
    cell.push(stop);
    cells.set(key, cell);
    if (index === 0) {
      minimumCellX = maximumCellX = x;
      minimumCellY = maximumCellY = y;
    } else {
      minimumCellX = Math.min(minimumCellX, x);
      maximumCellX = Math.max(maximumCellX, x);
      minimumCellY = Math.min(minimumCellY, y);
      maximumCellY = Math.max(maximumCellY, y);
    }
  });
  const index = { cellSize, cells, minimumCellX, maximumCellX, minimumCellY, maximumCellY };
  caretSpatialIndexes.set(layout, index);
  return index;
};

const nearestCaret = (
  layout: RealizedTextLayout,
  point: { readonly x: number; readonly y: number }
): TextEditingHit | null => {
  if (layout.caretStops.length === 0) return null;
  const index = caretSpatialIndex(layout);
  const centerX = Math.floor(point.x / index.cellSize);
  const centerY = Math.floor(point.y / index.cellSize);
  const maximumRadius = Math.max(
    Math.abs(centerX - index.minimumCellX),
    Math.abs(centerX - index.maximumCellX),
    Math.abs(centerY - index.minimumCellY),
    Math.abs(centerY - index.maximumCellY)
  );
  let nearest: TextEditingHit | null = null;
  const inspect = (x: number, y: number): TextEditingHit | null => {
    let cellNearest: TextEditingHit | null = null;
    for (const stop of index.cells.get(cellKey(x, y)) ?? []) {
      const distance = Math.hypot(stop.x - point.x, stop.y - point.y);
      if (!cellNearest || distance < cellNearest.distance) {
        cellNearest = { offset: stop.textOffset, affinity: stop.affinity, distance };
      }
    }
    return cellNearest;
  };
  const closer = (current: TextEditingHit | null, candidate: TextEditingHit | null) => (
    candidate && (!current || candidate.distance < current.distance) ? candidate : current
  );
  for (let radius = 0; radius <= maximumRadius; radius += 1) {
    if (radius === 0) {
      nearest = closer(nearest, inspect(centerX, centerY));
    } else {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        nearest = closer(nearest, inspect(x, centerY - radius));
        nearest = closer(nearest, inspect(x, centerY + radius));
      }
      for (let y = centerY - radius + 1; y < centerY + radius; y += 1) {
        nearest = closer(nearest, inspect(centerX - radius, y));
        nearest = closer(nearest, inspect(centerX + radius, y));
      }
    }
    if (nearest) {
      const left = (centerX - radius) * index.cellSize;
      const right = (centerX + radius + 1) * index.cellSize;
      const top = (centerY - radius) * index.cellSize;
      const bottom = (centerY + radius + 1) * index.cellSize;
      const distanceToOutside = Math.min(
        point.x - left, right - point.x, point.y - top, bottom - point.y
      );
      if (nearest.distance <= distanceToOutside) return nearest;
    }
  }
  return nearest;
};

interface PathCaretEntry {
  readonly stop: CaretStop;
  readonly traversalOffset: number;
}

const pathCaretIndexes = new WeakMap<RigidPathGlyphProjection, readonly PathCaretEntry[]>();

const pathCaretIndex = (
  layout: RealizedTextLayout,
  projection: RigidPathGlyphProjection
) => {
  const cached = pathCaretIndexes.get(projection);
  if (cached) return cached;
  const created = layout.caretStops.map((stop) => ({
    stop,
    traversalOffset: projection.range.origin + (stop.x - projection.linearOrigin)
  })).sort((left, right) => left.traversalOffset - right.traversalOffset);
  pathCaretIndexes.set(projection, created);
  return created;
};

const pointSegmentDistance = (
  point: { readonly x: number; readonly y: number },
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number }
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0 ? Math.min(1, Math.max(0,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  )) : 0;
  return Math.hypot(point.x - start.x - dx * amount, point.y - start.y - dy * amount);
};

const nearestPathCaret = (
  target: TextEditingLayoutHitTarget & { readonly path: NonNullable<TextEditingLayoutHitTarget['path']> },
  point: { readonly x: number; readonly y: number }
): TextEditingHit | null => {
  const entries = pathCaretIndex(target.layout, target.path.projection);
  if (entries.length === 0) return null;
  const nearestArc = nearestPathArcLength(target.path.table, point);
  let traversalOffset = target.path.projection.range.direction === 'forward'
    ? nearestArc.offset : target.path.table.length - nearestArc.offset;
  if (target.path.table.closed && target.path.table.length > 0) {
    const center = (target.path.projection.range.start + target.path.projection.range.end) * 0.5;
    traversalOffset += Math.round((center - traversalOffset) / target.path.table.length)
      * target.path.table.length;
  }
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]!.traversalOffset < traversalOffset) low = middle + 1;
    else high = middle;
  }
  let result: TextEditingHit | null = null;
  for (let index = Math.max(0, low - 2); index < Math.min(entries.length, low + 3); index += 1) {
    const entry = entries[index]!;
    const start = pathTextLocalPoint(
      entry.stop.x, entry.stop.y,
      target.path.pathLayout, target.path.table, target.path.projection
    );
    const end = pathTextLocalPoint(
      entry.stop.x, entry.stop.y + entry.stop.height,
      target.path.pathLayout, target.path.table, target.path.projection
    );
    const distance = pointSegmentDistance(point, start, end);
    if (!result || distance < result.distance) {
      result = { offset: entry.stop.textOffset, affinity: entry.stop.affinity, distance };
    }
  }
  return result;
};

export const hitTestTextEditingLayout = (
  target: TextEditingLayoutHitTarget,
  documentPoint: { readonly x: number; readonly y: number },
  tolerance = 4
): TextEditingHit | null => {
  const transformedPoint = inversePoint(target.localToDocument, documentPoint);
  if (!transformedPoint) return null;
  const point = target.layout.warp
    ? unwarpTextPoint(transformedPoint, target.layout.warp, target.layout.logicalBounds)
    : transformedPoint;
  if (!point) return null;
  if (target.path) {
    const nearest = nearestPathCaret(
      target as TextEditingLayoutHitTarget & { path: NonNullable<TextEditingLayoutHitTarget['path']> },
      transformedPoint
    );
    return nearest && nearest.distance <= tolerance ? nearest : null;
  }
  const bounds = target.layout.paragraphFrame?.bounds ?? target.layout.logicalBounds;
  if (
    point.x < bounds.x - tolerance || point.x > bounds.x + bounds.width + tolerance
    || point.y < bounds.y - tolerance || point.y > bounds.y + bounds.height + tolerance
  ) return null;
  const nearest = nearestCaret(target.layout, point);
  return nearest ?? (target.layout.paragraphFrame ? {
    offset: 0,
    affinity: 'downstream',
    distance: Math.hypot(point.x - bounds.x, point.y - bounds.y)
  } : null);
};
