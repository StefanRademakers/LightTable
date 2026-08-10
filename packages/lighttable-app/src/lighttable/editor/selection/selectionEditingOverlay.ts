import type { VectorEditingOverlay, VectorOverlayCubic } from '@lighttable/vector-rendering';
import type { SelectionOperation, SelectionShape } from './selectionTypes';

const KAPPA = 0.5522847498307936;

const line = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  segmentIndex: number
): VectorOverlayCubic => ({
  subpathId: 'selection',
  segmentIndex,
  p0: start,
  p1: start,
  p2: end,
  p3: end
});

const shapeCubics = (shape: SelectionShape, closed: boolean): VectorOverlayCubic[] => {
  const points = shape.points;
  if (points.length < 2) return [];
  if (shape.kind === 'rectangle') {
    const left = Math.min(points[0]!.x, points[1]!.x);
    const right = Math.max(points[0]!.x, points[1]!.x);
    const top = Math.min(points[0]!.y, points[1]!.y);
    const bottom = Math.max(points[0]!.y, points[1]!.y);
    const corners = [
      { x: left, y: top }, { x: right, y: top },
      { x: right, y: bottom }, { x: left, y: bottom }
    ];
    return corners.map((point, index) => line(point, corners[(index + 1) % 4]!, index));
  }
  if (shape.kind === 'ellipse') {
    const left = Math.min(points[0]!.x, points[1]!.x);
    const right = Math.max(points[0]!.x, points[1]!.x);
    const top = Math.min(points[0]!.y, points[1]!.y);
    const bottom = Math.max(points[0]!.y, points[1]!.y);
    const cx = (left + right) * 0.5;
    const cy = (top + bottom) * 0.5;
    const rx = (right - left) * 0.5;
    const ry = (bottom - top) * 0.5;
    const ox = rx * KAPPA;
    const oy = ry * KAPPA;
    return [
      { p0: { x: cx + rx, y: cy }, p1: { x: cx + rx, y: cy + oy }, p2: { x: cx + ox, y: cy + ry }, p3: { x: cx, y: cy + ry } },
      { p0: { x: cx, y: cy + ry }, p1: { x: cx - ox, y: cy + ry }, p2: { x: cx - rx, y: cy + oy }, p3: { x: cx - rx, y: cy } },
      { p0: { x: cx - rx, y: cy }, p1: { x: cx - rx, y: cy - oy }, p2: { x: cx - ox, y: cy - ry }, p3: { x: cx, y: cy - ry } },
      { p0: { x: cx, y: cy - ry }, p1: { x: cx + ox, y: cy - ry }, p2: { x: cx + rx, y: cy - oy }, p3: { x: cx + rx, y: cy } }
    ].map((cubic, segmentIndex) => ({
      ...cubic,
      subpathId: 'selection',
      segmentIndex
    }));
  }
  const count = closed && points.length > 2 ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, index) => line(
    points[index]!,
    points[(index + 1) % points.length]!,
    index
  ));
};

const geometryKey = (shape: SelectionShape, closed: boolean) => [
  shape.kind,
  closed ? 'closed' : 'open',
  ...shape.points.flatMap(({ x, y }) => [x.toFixed(3), y.toFixed(3)])
].join(':');

export const buildSelectionEditingOverlay = (
  shape: SelectionShape,
  kind: 'committed' | 'draft'
): VectorEditingOverlay => {
  const closed = kind === 'committed';
  const key = geometryKey(shape, closed);
  return {
    pathId: `selection-${kind}`,
    resourceKey: `selection-${kind}:${key}`,
    geometryRevision: 0,
    transformRevision: 0,
    cubics: shapeCubics(shape, closed),
    anchors: [],
    handles: []
  };
};

export const directSelectionShape = (
  operations: readonly SelectionOperation[]
): SelectionShape | null => (
  operations.length === 1
  && operations[0]!.mode === 'replace'
  && !operations[0]!.source
    ? operations[0]!.shape
    : null
);

export const buildBrushCursorEditingOverlay = (
  center: { x: number; y: number },
  diameter: number
): VectorEditingOverlay => {
  const radius = Math.max(1e-3, diameter * 0.5);
  const shape: SelectionShape = {
    kind: 'ellipse',
    points: [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius }
    ]
  };
  const key = geometryKey(shape, true);
  return {
    pathId: 'brush-cursor',
    resourceKey: `brush-cursor:${key}`,
    geometryRevision: 0,
    transformRevision: 0,
    cubics: shapeCubics(shape, true),
    anchors: [],
    handles: []
  };
};

export const buildSampledBrushSourceEditingOverlay = (
  center: { x: number; y: number },
  diameter: number,
  markerSize: number
): VectorEditingOverlay => {
  const radius = Math.max(1e-3, diameter * 0.5);
  const halfMarker = Math.max(1, markerSize * 0.5);
  const shape: SelectionShape = {
    kind: 'ellipse',
    points: [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius }
    ]
  };
  const circle = shapeCubics(shape, true).map((cubic) => ({
    ...cubic,
    subpathId: 'sample-source-ring'
  }));
  const cross = [
    line(
      { x: center.x - halfMarker, y: center.y },
      { x: center.x + halfMarker, y: center.y },
      0
    ),
    line(
      { x: center.x, y: center.y - halfMarker },
      { x: center.x, y: center.y + halfMarker },
      0
    )
  ].map((cubic, index) => ({ ...cubic, subpathId: `sample-source-cross-${index}` }));
  const key = [geometryKey(shape, true), markerSize.toFixed(3)].join(':');
  return {
    pathId: 'sampled-brush-source',
    resourceKey: `sampled-brush-source:${key}`,
    geometryRevision: 0,
    transformRevision: 0,
    cubics: [...circle, ...cross],
    anchors: [],
    handles: []
  };
};
