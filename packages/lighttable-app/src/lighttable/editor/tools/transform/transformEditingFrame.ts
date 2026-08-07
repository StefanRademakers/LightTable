import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import { multiplyMatrices, rectCorners, transformPoint, type TransformPoint } from './affine';
import type { TransformSessionState } from './transformTypes';

const midpoint = (first: TransformPoint, second: TransformPoint): TransformPoint => ({
  x: (first.x + second.x) * 0.5,
  y: (first.y + second.y) * 0.5
});

const finite = (value: number) => Number.isFinite(value) ? value.toFixed(5) : 'invalid';

/** Places 24 px rotation targets beyond each corner, independent of zoom. */
export const transformCornerRotationTargets = (
  corners: readonly TransformPoint[],
  center: TransformPoint,
  viewportScale: number,
  offsetPx = 20
): TransformPoint[] => corners.map((corner) => {
  const dx = corner.x - center.x;
  const dy = corner.y - center.y;
  const length = Math.hypot(dx, dy);
  const distance = offsetPx / Math.max(viewportScale, 1e-6);
  return length > 1e-6
    ? { x: corner.x + dx / length * distance, y: corner.y + dy / length * distance }
    : { ...corner };
});

/**
 * Builds the renderer-neutral transform cage in document coordinates.
 * React remains responsible only for hit testing; every visible affordance is
 * rendered by the shared WebGPU vector-overlay backend.
 */
export const buildTransformEditingFrame = (
  state: TransformSessionState,
  viewportScale: number
): VectorSelectionFrame => {
  const sourceToDocument = multiplyMatrices(state.matrix, state.sourceMatrix);
  const corners = state.projectiveQuad ?? rectCorners(state.sourceContentBounds)
    .map((point) => transformPoint(sourceToDocument, point));
  const [northWest, northEast, southEast, southWest] = corners;
  const north = midpoint(northWest, northEast);
  const east = midpoint(northEast, southEast);
  const south = midpoint(southEast, southWest);
  const west = midpoint(southWest, northWest);
  const pivot = midpoint(northWest, southEast);
  const northLength = Math.hypot(northEast.x - northWest.x, northEast.y - northWest.y);
  const normal = northLength > 1e-6
    ? {
        x: (northEast.y - northWest.y) / northLength,
        y: -(northEast.x - northWest.x) / northLength
      }
    : { x: 0, y: -1 };
  const rotation = {
    x: north.x + normal.x * 28 / Math.max(viewportScale, 1e-6),
    y: north.y + normal.y * 28 / Math.max(viewportScale, 1e-6)
  };
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);

  return {
    resourceKey: [
      'transform-frame',
      state.layerId,
      ...Object.values(state.matrix).map(finite),
      ...(state.projectiveQuad ?? []).flatMap((point) => [finite(point.x), finite(point.y)]),
      finite(state.sourceContentBounds.x),
      finite(state.sourceContentBounds.y),
      finite(state.sourceContentBounds.width),
      finite(state.sourceContentBounds.height),
      finite(viewportScale)
    ].join(':'),
    bounds: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    },
    pivot,
    edges: [
      { start: northWest, end: northEast },
      { start: northEast, end: southEast },
      { start: southEast, end: southWest },
      { start: southWest, end: northWest },
      { start: north, end: rotation }
    ],
    handles: [
      { kind: 'north-west', point: northWest, markerSizePx: 13 },
      { kind: 'north', point: north, markerSizePx: 12 },
      { kind: 'north-east', point: northEast, markerSizePx: 13 },
      { kind: 'east', point: east, markerSizePx: 12 },
      { kind: 'south-east', point: southEast, markerSizePx: 13 },
      { kind: 'south', point: south, markerSizePx: 12 },
      { kind: 'south-west', point: southWest, markerSizePx: 13 },
      { kind: 'west', point: west, markerSizePx: 12 },
      { kind: 'rotate', point: rotation, markerSizePx: 13 }
    ]
  };
};
