import type { Rect, Vec2 } from '@lighttable/vector-core';

export type VectorSelectionHandleKind =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west';

export interface VectorSelectionFrameHandle {
  kind: VectorSelectionHandleKind;
  point: Vec2;
  /** Marker diameter is interpreted in screen pixels by the backend. */
  markerSizePx: number;
}

export interface VectorSelectionFrameEdge {
  start: Vec2;
  end: Vec2;
}

/**
 * Renderer-neutral whole-element selection frame in document space.
 *
 * The frame is deliberately independent from path geometry. Live shapes stay
 * parametric, multiple elements share one frame, and viewport changes only
 * affect the backend's tiny transform uniform.
 */
export interface VectorSelectionFrame {
  resourceKey: string;
  bounds: Rect;
  pivot: Vec2;
  edges: readonly VectorSelectionFrameEdge[];
  handles: readonly VectorSelectionFrameHandle[];
}

export interface BuildVectorSelectionFrameOptions {
  resourceKey: string;
  handleSizePx?: number;
}

export const hitTestVectorSelectionFrameHandle = (
  frame: VectorSelectionFrame,
  point: Vec2,
  radius: number
): VectorSelectionFrameHandle | null => {
  if (!(radius >= 0) || !Number.isFinite(radius)) return null;
  let closest: VectorSelectionFrameHandle | null = null;
  let closestDistanceSquared = radius * radius;
  for (const handle of frame.handles) {
    const dx = point.x - handle.point.x;
    const dy = point.y - handle.point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= closestDistanceSquared) {
      closest = handle;
      closestDistanceSquared = distanceSquared;
    }
  }
  return closest;
};

export const buildVectorSelectionFrame = (
  bounds: Rect,
  options: BuildVectorSelectionFrameOptions
): VectorSelectionFrame => {
  const markerSizePx = options.handleSizePx ?? 8;
  if (!(markerSizePx > 0) || !Number.isFinite(markerSizePx)) {
    throw new RangeError('Vector selection handle size must be finite and greater than zero.');
  }
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    throw new RangeError('Vector selection bounds must be finite.');
  }
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const top = Math.min(bounds.y, bounds.y + bounds.height);
  const bottom = Math.max(bounds.y, bounds.y + bounds.height);
  const centerX = (left + right) * 0.5;
  const centerY = (top + bottom) * 0.5;
  const normalized = { x: left, y: top, width: right - left, height: bottom - top };
  const northWest = { x: left, y: top };
  const northEast = { x: right, y: top };
  const southEast = { x: right, y: bottom };
  const southWest = { x: left, y: bottom };

  return {
    resourceKey: options.resourceKey,
    bounds: normalized,
    pivot: { x: centerX, y: centerY },
    edges: [
      { start: northWest, end: northEast },
      { start: northEast, end: southEast },
      { start: southEast, end: southWest },
      { start: southWest, end: northWest }
    ],
    handles: [
      { kind: 'north-west', point: northWest, markerSizePx },
      { kind: 'north', point: { x: centerX, y: top }, markerSizePx },
      { kind: 'north-east', point: northEast, markerSizePx },
      { kind: 'east', point: { x: right, y: centerY }, markerSizePx },
      { kind: 'south-east', point: southEast, markerSizePx },
      { kind: 'south', point: { x: centerX, y: bottom }, markerSizePx },
      { kind: 'south-west', point: southWest, markerSizePx },
      { kind: 'west', point: { x: left, y: centerY }, markerSizePx }
    ]
  };
};
