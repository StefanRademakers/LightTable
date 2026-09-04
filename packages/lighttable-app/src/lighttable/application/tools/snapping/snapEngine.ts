export const SNAP_TOLERANCE_SCREEN_PX = 8;
export const SNAP_RELEASE_TOLERANCE_SCREEN_PX = 12;

export type SnapAxis = 'x' | 'y';
export type SnapRole = 'min' | 'center' | 'max' | 'line';
export type SnapSource = 'layer' | 'canvas' | 'guide' | 'grid' | 'selection';

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapFeature {
  axis: SnapAxis;
  position: number;
  source: SnapSource;
  sourceId?: string;
  role: SnapRole;
}

export interface SnapMatch {
  axis: SnapAxis;
  moving: SnapFeature;
  target: SnapFeature;
  deltaDocument: number;
  deltaScreen: number;
}

export interface SnapRequest {
  movingBounds: SnapRect;
  targets: readonly SnapFeature[];
  zoom: number;
  enabled?: boolean;
  bypass?: boolean;
  toleranceScreenPx?: number;
  retainedMatches?: readonly SnapMatch[];
  releaseToleranceScreenPx?: number;
}

export interface SnapResult {
  offsetX: number;
  offsetY: number;
  snappedX: boolean;
  snappedY: boolean;
  matches: SnapMatch[];
}

const axisFeatures = (
  bounds: SnapRect,
  axis: SnapAxis,
  source: SnapSource,
  sourceId?: string
): SnapFeature[] => {
  const start = axis === 'x' ? bounds.x : bounds.y;
  const length = axis === 'x' ? bounds.width : bounds.height;
  return [
    { axis, position: start, source, sourceId, role: 'min' },
    { axis, position: start + length / 2, source, sourceId, role: 'center' },
    { axis, position: start + length, source, sourceId, role: 'max' }
  ];
};

const retainedAxisMatch = (
  axis: SnapAxis,
  movingBounds: SnapRect,
  targets: readonly SnapFeature[],
  retainedMatches: readonly SnapMatch[],
  zoom: number,
  releaseToleranceScreenPx: number
): SnapMatch | null => {
  const retained = retainedMatches.find((match) => match.axis === axis);
  if (!retained) return null;
  const moving = axisFeatures(movingBounds, axis, 'selection', 'moving')
    .find((feature) => feature.role === retained.moving.role);
  const target = targets.find((feature) => (
    feature.axis === retained.target.axis
    && feature.source === retained.target.source
    && feature.role === retained.target.role
    && feature.sourceId === retained.target.sourceId
    && (feature.sourceId !== undefined || feature.position === retained.target.position)
  ));
  if (!moving || !target) return null;
  const deltaDocument = target.position - moving.position;
  const deltaScreen = deltaDocument * zoom;
  return Math.abs(deltaScreen) <= releaseToleranceScreenPx
    ? { axis, moving, target, deltaDocument, deltaScreen }
    : null;
};

export const snapFeaturesForRect = (
  bounds: SnapRect,
  source: SnapSource,
  sourceId?: string,
  includeCenter = true
): SnapFeature[] => ['x', 'y'].flatMap((axis) => axisFeatures(
  bounds,
  axis as SnapAxis,
  source,
  sourceId
)).filter((feature) => includeCenter || feature.role !== 'center');

export const snapFeaturesForCanvas = (
  width: number,
  height: number,
  includeCenter = false
): SnapFeature[] => snapFeaturesForRect(
  { x: 0, y: 0, width, height },
  'canvas',
  'document',
  includeCenter
);

export const snapLineFeature = (
  axis: SnapAxis,
  position: number,
  source: Extract<SnapSource, 'guide' | 'grid'>,
  sourceId?: string
): SnapFeature => ({ axis, position, source, sourceId, role: 'line' });

const chooseAxisMatch = (
  axis: SnapAxis,
  movingBounds: SnapRect,
  targets: readonly SnapFeature[],
  zoom: number,
  toleranceScreenPx: number
): SnapMatch | null => {
  const moving = axisFeatures(movingBounds, axis, 'selection', 'moving');
  let best: SnapMatch | null = null;
  for (const movingFeature of moving) {
    for (const target of targets) {
      if (target.axis !== axis || !Number.isFinite(target.position)) continue;
      const deltaDocument = target.position - movingFeature.position;
      const deltaScreen = deltaDocument * zoom;
      if (Math.abs(deltaScreen) > toleranceScreenPx) continue;
      const candidate = { axis, moving: movingFeature, target, deltaDocument, deltaScreen };
      if (!best || Math.abs(deltaScreen) < Math.abs(best.deltaScreen)) best = candidate;
    }
  }
  return best;
};

export const solveSnap = (request: SnapRequest): SnapResult => {
  if (request.enabled === false || request.bypass) {
    return { offsetX: 0, offsetY: 0, snappedX: false, snappedY: false, matches: [] };
  }
  const zoom = Math.max(1e-6, Math.abs(request.zoom));
  const tolerance = Math.max(0, request.toleranceScreenPx ?? SNAP_TOLERANCE_SCREEN_PX);
  const releaseTolerance = Math.max(
    tolerance,
    request.releaseToleranceScreenPx ?? SNAP_RELEASE_TOLERANCE_SCREEN_PX
  );
  const retained = request.retainedMatches ?? [];
  const x = retainedAxisMatch(
    'x', request.movingBounds, request.targets, retained, zoom, releaseTolerance
  ) ?? chooseAxisMatch('x', request.movingBounds, request.targets, zoom, tolerance);
  const y = retainedAxisMatch(
    'y', request.movingBounds, request.targets, retained, zoom, releaseTolerance
  ) ?? chooseAxisMatch('y', request.movingBounds, request.targets, zoom, tolerance);
  return {
    offsetX: x?.deltaDocument ?? 0,
    offsetY: y?.deltaDocument ?? 0,
    snappedX: x !== null,
    snappedY: y !== null,
    matches: [x, y].filter((match): match is SnapMatch => match !== null)
  };
};

export const translateSnapRect = (bounds: SnapRect, x: number, y: number): SnapRect => ({
  ...bounds,
  x: bounds.x + x,
  y: bounds.y + y
});

export const unionSnapRects = (bounds: readonly SnapRect[]): SnapRect | null => {
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((rect) => rect.x));
  const top = Math.min(...bounds.map((rect) => rect.y));
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};
