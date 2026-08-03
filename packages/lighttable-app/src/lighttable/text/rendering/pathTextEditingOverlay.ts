import type { PathTextLayout, RealizedTextLayout, Rect } from '@lighttable/text-core';
import type {
  TextEditingAffine,
  TextEditingOverlay,
  TextOverlayLine,
  TextOverlayMarker,
  TextOverlayPoint,
  TextOverlayQuad
} from '@lighttable/text-rendering';
import type { PathArcLengthTable } from '@lighttable/vector-rendering';
import {
  rigidPathPlacementAt,
  type RigidPathGlyphProjection
} from './rigidPathGlyphProjection';

export interface BuildPathTextEditingOverlayOptions {
  readonly layerId: string;
  readonly layout: RealizedTextLayout;
  readonly pathLayout: PathTextLayout;
  readonly table: PathArcLengthTable;
  readonly projection: RigidPathGlyphProjection;
  readonly localToDocument: TextEditingAffine;
  readonly anchor: number;
  readonly focus: number;
  readonly caretAffinity?: 'upstream' | 'downstream';
  readonly composition?: { readonly start: number; readonly end: number } | null;
}

const transformPoint = (matrix: TextEditingAffine, point: TextOverlayPoint) => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty
});

const affineKey = (matrix: TextEditingAffine) => [
  matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty
].join(',');

const selectedGeometry = (layout: RealizedTextLayout, start: number, end: number) => {
  if (start >= end) return [];
  let low = 0;
  let high = layout.selectionGeometry.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (layout.selectionGeometry[middle]!.end <= start) low = middle + 1;
    else high = middle;
  }
  const selected: RealizedTextLayout['selectionGeometry'][number][] = [];
  for (let index = low; index < layout.selectionGeometry.length; index += 1) {
    const entry = layout.selectionGeometry[index]!;
    if (entry.start >= end) break;
    if (entry.end > start) selected.push(entry);
  }
  return selected;
};

interface CaretIndex {
  readonly exact: ReadonlyMap<string, RealizedTextLayout['caretStops'][number]>;
  readonly first: ReadonlyMap<number, RealizedTextLayout['caretStops'][number]>;
  readonly sorted: readonly RealizedTextLayout['caretStops'][number][];
}

const caretIndexes = new WeakMap<RealizedTextLayout, CaretIndex>();

const caretIndex = (layout: RealizedTextLayout) => {
  const cached = caretIndexes.get(layout);
  if (cached) return cached;
  const exact = new Map<string, RealizedTextLayout['caretStops'][number]>();
  const first = new Map<number, RealizedTextLayout['caretStops'][number]>();
  layout.caretStops.forEach((stop) => {
    exact.set(`${stop.textOffset}:${stop.affinity}`, stop);
    if (!first.has(stop.textOffset)) first.set(stop.textOffset, stop);
  });
  const created = {
    exact,
    first,
    sorted: [...first.values()].sort((left, right) => left.textOffset - right.textOffset)
  };
  caretIndexes.set(layout, created);
  return created;
};

const caretFor = (
  layout: RealizedTextLayout,
  offset: number,
  affinity: 'upstream' | 'downstream'
) => {
  const index = caretIndex(layout);
  const exact = index.exact.get(`${offset}:${affinity}`) ?? index.first.get(offset);
  if (exact || index.sorted.length === 0) return exact;
  let low = 0;
  let high = index.sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.sorted[middle]!.textOffset < offset) low = middle + 1;
    else high = middle;
  }
  const after = index.sorted[low];
  const before = low > 0 ? index.sorted[low - 1] : undefined;
  if (!before) return after;
  if (!after) return before;
  return offset - before.textOffset <= after.textOffset - offset ? before : after;
};

export const pathTextLocalPoint = (
  x: number,
  y: number,
  pathLayout: PathTextLayout,
  table: PathArcLengthTable,
  projection: RigidPathGlyphProjection
) => {
  const offset = projection.range.origin + (x - projection.linearOrigin);
  const placement = rigidPathPlacementAt(table, offset, projection.range.direction, pathLayout);
  return {
    x: placement.point.x - placement.sine * y,
    y: placement.point.y + placement.cosine * y
  };
};

const pathRect = (
  bounds: Rect,
  pathLayout: PathTextLayout,
  table: PathArcLengthTable,
  projection: RigidPathGlyphProjection,
  localToDocument: TextEditingAffine
) => [
  pathTextLocalPoint(bounds.x, bounds.y, pathLayout, table, projection),
  pathTextLocalPoint(bounds.x + bounds.width, bounds.y, pathLayout, table, projection),
  pathTextLocalPoint(bounds.x + bounds.width, bounds.y + bounds.height, pathLayout, table, projection),
  pathTextLocalPoint(bounds.x, bounds.y + bounds.height, pathLayout, table, projection)
].map((point) => transformPoint(localToDocument, point)) as [
  TextOverlayPoint, TextOverlayPoint, TextOverlayPoint, TextOverlayPoint
];

const baselineLines = (
  table: PathArcLengthTable,
  localToDocument: TextEditingAffine
): TextOverlayLine[] => {
  const lines: TextOverlayLine[] = [];
  for (let index = 1; index < table.cumulativeLengths.length; index += 1) {
    lines.push({
      role: 'path-baseline',
      start: transformPoint(localToDocument, {
        x: table.points[(index - 1) * 2]!, y: table.points[(index - 1) * 2 + 1]!
      }),
      end: transformPoint(localToDocument, {
        x: table.points[index * 2]!, y: table.points[index * 2 + 1]!
      }),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.58]
    });
  }
  return lines;
};

export const buildPathTextEditingOverlay = ({
  layerId,
  layout,
  pathLayout,
  table,
  projection,
  localToDocument,
  anchor,
  focus,
  caretAffinity = 'downstream',
  composition = null
}: BuildPathTextEditingOverlayOptions): TextEditingOverlay => {
  const selectionStart = Math.min(anchor, focus);
  const selectionEnd = Math.max(anchor, focus);
  const caret = caretFor(layout, focus, caretAffinity) ?? {
    textOffset: 0, x: projection.linearOrigin, y: -16, height: 16, affinity: 'downstream' as const
  };
  const quads: TextOverlayQuad[] = selectedGeometry(layout, selectionStart, selectionEnd)
    .map(({ bounds }) => ({
      role: 'selection',
      points: pathRect(bounds, pathLayout, table, projection, localToDocument),
      color: [0.16, 0.48, 0.94, 0.34]
    }));
  const caretStart = transformPoint(localToDocument,
    pathTextLocalPoint(caret.x, caret.y, pathLayout, table, projection));
  const caretEnd = transformPoint(localToDocument,
    pathTextLocalPoint(caret.x, caret.y + caret.height, pathLayout, table, projection));
  const staticLines = baselineLines(table, localToDocument);
  const lines: TextOverlayLine[] = [];
  lines.push({
    role: 'caret', start: caretStart, end: caretEnd, widthPx: 1.5,
    color: [0.96, 0.98, 1, 1]
  });
  lines.push({
    role: 'insertion',
    start: transformPoint(localToDocument,
      pathTextLocalPoint(caret.x - 2, caret.y + caret.height + 1, pathLayout, table, projection)),
    end: transformPoint(localToDocument,
      pathTextLocalPoint(caret.x + 2, caret.y + caret.height + 1, pathLayout, table, projection)),
    widthPx: 1,
    color: [0.24, 0.66, 1, 0.95]
  });
  if (composition && composition.start !== composition.end) {
    for (const { bounds } of selectedGeometry(layout, composition.start, composition.end)) {
      const points = pathRect(bounds, pathLayout, table, projection, localToDocument);
      lines.push({
        role: 'composition', start: points[3], end: points[2], widthPx: 1.5,
        color: [0.96, 0.98, 1, 0.94]
      });
    }
  }
  const startPlacement = rigidPathPlacementAt(
    table, projection.range.start, projection.range.direction, pathLayout
  );
  const endPlacement = rigidPathPlacementAt(
    table, projection.range.end, projection.range.direction, pathLayout
  );
  const directionPlacement = rigidPathPlacementAt(
    table,
    Math.min(projection.range.end, projection.range.start + Math.max(12, Math.min(32, table.length * 0.1))),
    projection.range.direction,
    pathLayout
  );
  const startPoint = transformPoint(localToDocument, startPlacement.point);
  const endPoint = transformPoint(localToDocument, endPlacement.point);
  const directionPoint = transformPoint(localToDocument, directionPlacement.point);
  staticLines.push({
    role: 'path-direction', start: startPoint, end: directionPoint, widthPx: 1.5,
    color: [0.24, 0.66, 1, 0.95]
  });
  const markers: TextOverlayMarker[] = [
    { role: 'path-start-handle', point: startPoint, sizePx: 10 },
    { role: 'path-end-handle', point: endPoint, sizePx: 10 },
    { role: 'path-direction-handle', point: directionPoint, sizePx: 8 }
  ];
  const staticKey = [
    layerId, layout.key, table.key, projection.range.start, projection.range.end,
    projection.range.origin, projection.range.direction, pathLayout.side,
    pathLayout.upright ? 1 : 0, affineKey(localToDocument)
  ].join(':');
  const selectionKey = `${staticKey}:selection:${selectionStart}-${selectionEnd}`;
  const caretKey = `${staticKey}:caret:${focus}:${caretAffinity}`;
  const lineKey = `${caretKey}:composition:${composition
    ? `${composition.start}-${composition.end}` : '-'}`;
  return Object.freeze({
    layerId,
    resourceKey: [
      layerId, layout.key, table.key, projection.range.start, projection.range.end,
      projection.range.origin, projection.range.direction, pathLayout.side,
      pathLayout.upright ? 1 : 0, anchor, focus, caretAffinity,
      composition ? `${composition.start}-${composition.end}` : '-',
      affineKey(localToDocument)
    ].join(':'),
    quads: Object.freeze(quads),
    staticLines: Object.freeze(staticLines),
    lines: Object.freeze(lines),
    markers: Object.freeze(markers),
    geometryKeys: Object.freeze({
      quads: selectionKey,
      caret: caretKey,
      lines: lineKey,
      staticLines: staticKey,
      markers: staticKey
    })
  });
};
