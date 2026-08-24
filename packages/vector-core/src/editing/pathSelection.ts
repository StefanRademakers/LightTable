import type { AffineMatrix } from '../math/affine';
import { invertMatrix, transformPoint } from '../math/affine';
import { distanceSquared, unionRects } from '../math/vector';
import type { Vec2 } from '../math/vector';
import type { VectorPath } from '../model/types';
import { nearestPointOnPath, pathBounds, pointInPath } from '../geometry/pathGeometry';

export type PathSelectionTarget =
  | { kind: 'anchor'; subpathId: string; anchorId: string }
  | { kind: 'handle-in' | 'handle-out'; subpathId: string; anchorId: string }
  | { kind: 'segment'; subpathId: string; segmentIndex: number; t: number; point: Vec2 }
  | { kind: 'fill'; pathId: string };

export interface PathHitTestOptions {
  /** Pointer position in document coordinates. */
  documentPoint: Vec2;
  /** Hit radius in document pixels. */
  radius: number;
  includeHandles?: boolean;
  includeFill?: boolean;
}

const pathLocalRadiusSquared = (inverse: AffineMatrix, radius: number) => {
  const origin = transformPoint(inverse, { x: 0, y: 0 });
  const x = transformPoint(inverse, { x: radius, y: 0 });
  const y = transformPoint(inverse, { x: 0, y: radius });
  return Math.max(distanceSquared(origin, x), distanceSquared(origin, y));
};

const pointInExpandedBounds = (
  point: Vec2,
  bounds: { x: number; y: number; width: number; height: number } | null,
  padding: number
) => Boolean(bounds
  && point.x >= bounds.x - padding
  && point.y >= bounds.y - padding
  && point.x <= bounds.x + bounds.width + padding
  && point.y <= bounds.y + bounds.height + padding);

const pathSelectionBounds = (path: VectorPath, includeHandles: boolean) => {
  let bounds = pathBounds(path);
  if (!includeHandles) return bounds;
  for (const subpath of path.subpaths) for (const anchor of subpath.anchors) {
    for (const point of [anchor.handleIn, anchor.handleOut]) if (point) {
      bounds = unionRects(bounds, { x: point.x, y: point.y, width: 0, height: 0 });
    }
  }
  return bounds;
};

export const hitTestVectorPath = (
  path: VectorPath,
  options: PathHitTestOptions
): PathSelectionTarget | null => {
  if (!(options.radius >= 0) || !Number.isFinite(options.radius)) {
    throw new RangeError('Path hit radius must be finite and non-negative.');
  }
  const inverse = invertMatrix(path.transform);
  if (!inverse) return null;
  const point = transformPoint(inverse, options.documentPoint);
  const radiusSquared = pathLocalRadiusSquared(inverse, options.radius);
  const includeHandles = options.includeHandles ?? true;

  // Broad phase only: an outside point is certainly a miss; an inside point
  // still runs exact anchor, handle, nearest-curve and fill-rule evaluation.
  // Keeping that one-way contract here makes every vector tool benefit and
  // prevents callers from accidentally treating an AABB as painted geometry.
  if (!pointInExpandedBounds(
    point,
    pathSelectionBounds(path, includeHandles),
    Math.sqrt(radiusSquared)
  )) return null;

  for (const subpath of path.subpaths) {
    for (const anchor of subpath.anchors) {
      if (distanceSquared(anchor.position, point) <= radiusSquared) {
        return { kind: 'anchor', subpathId: subpath.id, anchorId: anchor.id };
      }
    }
  }

  if (includeHandles) {
    for (const subpath of path.subpaths) {
      for (const anchor of subpath.anchors) {
        if (anchor.handleIn && distanceSquared(anchor.handleIn, point) <= radiusSquared) {
          return { kind: 'handle-in', subpathId: subpath.id, anchorId: anchor.id };
        }
        if (anchor.handleOut && distanceSquared(anchor.handleOut, point) <= radiusSquared) {
          return { kind: 'handle-out', subpathId: subpath.id, anchorId: anchor.id };
        }
      }
    }
  }

  const nearest = nearestPointOnPath(path, point);
  if (nearest && nearest.distanceSquared <= radiusSquared) {
    return {
      kind: 'segment',
      subpathId: nearest.subpathId,
      segmentIndex: nearest.segmentIndex,
      t: nearest.t,
      point: nearest.point
    };
  }
  if ((options.includeFill ?? true) && pointInPath(path, point)) {
    return { kind: 'fill', pathId: path.id };
  }
  return null;
};
