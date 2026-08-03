import type { PathTextLayout } from '@lighttable/text-core';
import type { TextEditingAffine, TextOverlayPoint } from '@lighttable/text-rendering';
import type { PathArcLengthTable } from '@lighttable/vector-rendering';
import { rigidPathPlacementAt, type RigidPathGlyphProjection } from './rigidPathGlyphProjection';

export type PathTextHandleKind = 'start' | 'end' | 'direction';

export interface PathTextHandlePresentation {
  readonly start: TextOverlayPoint;
  readonly end: TextOverlayPoint;
  readonly direction: TextOverlayPoint;
}

export const transformPathTextPoint = (
  matrix: TextEditingAffine,
  point: TextOverlayPoint
): TextOverlayPoint => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty
});

/** One geometry authority shared by the GPU overlay and pointer controller. */
export const pathTextHandlePresentation = (
  pathLayout: PathTextLayout,
  table: PathArcLengthTable,
  projection: RigidPathGlyphProjection
): PathTextHandlePresentation => {
  const directionOffset = Math.min(
    projection.range.end,
    projection.range.start + Math.max(12, Math.min(32, table.length * 0.1))
  );
  return Object.freeze({
    start: rigidPathPlacementAt(
      table, projection.range.start, projection.range.direction, pathLayout
    ).point,
    end: rigidPathPlacementAt(
      table, projection.range.end, projection.range.direction, pathLayout
    ).point,
    direction: rigidPathPlacementAt(
      table, directionOffset, projection.range.direction, pathLayout
    ).point
  });
};

export const hitTestPathTextHandle = (
  handles: PathTextHandlePresentation,
  localToDocument: TextEditingAffine,
  documentPoint: TextOverlayPoint,
  radius: number
): PathTextHandleKind | null => {
  if (!(Number.isFinite(radius) && radius >= 0)) return null;
  const candidates: readonly PathTextHandleKind[] = ['direction', 'start', 'end'];
  let nearest: { readonly kind: PathTextHandleKind; readonly distance: number } | null = null;
  for (const kind of candidates) {
    const point = transformPathTextPoint(localToDocument, handles[kind]);
    const distance = Math.hypot(documentPoint.x - point.x, documentPoint.y - point.y);
    if (distance <= radius && (!nearest || distance < nearest.distance)) {
      nearest = { kind, distance };
    }
  }
  return nearest?.kind ?? null;
};
