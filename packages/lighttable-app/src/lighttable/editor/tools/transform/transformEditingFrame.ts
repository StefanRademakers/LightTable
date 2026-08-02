import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import { multiplyMatrices, rectCorners, transformPoint, type TransformPoint } from './affine';
import type { TransformSessionState } from './transformTypes';

const midpoint = (first: TransformPoint, second: TransformPoint): TransformPoint => ({
  x: (first.x + second.x) * 0.5,
  y: (first.y + second.y) * 0.5
});

const finite = (value: number) => Number.isFinite(value) ? value.toFixed(5) : 'invalid';

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
      { start: northWest, end: southEast },
      { start: northEast, end: southWest },
      { start: north, end: rotation }
    ],
    handles: [
      { kind: 'north-west', point: northWest, markerSizePx: 9 },
      { kind: 'north', point: north, markerSizePx: 8 },
      { kind: 'north-east', point: northEast, markerSizePx: 9 },
      { kind: 'east', point: east, markerSizePx: 8 },
      { kind: 'south-east', point: southEast, markerSizePx: 9 },
      { kind: 'south', point: south, markerSizePx: 8 },
      { kind: 'south-west', point: southWest, markerSizePx: 9 },
      { kind: 'west', point: west, markerSizePx: 8 },
      { kind: 'rotate', point: rotation, markerSizePx: 10 }
    ]
  };
};
