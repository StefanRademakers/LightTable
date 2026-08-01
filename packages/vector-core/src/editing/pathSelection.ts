import type { AffineMatrix } from '../math/affine';
import { invertMatrix, transformPoint } from '../math/affine';
import { distanceSquared } from '../math/vector';
import type { Vec2 } from '../math/vector';
import type { VectorPath } from '../model/types';
import { nearestPointOnPath, pointInPath } from '../geometry/pathGeometry';

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

  for (const subpath of path.subpaths) {
    for (const anchor of subpath.anchors) {
      if (distanceSquared(anchor.position, point) <= radiusSquared) {
        return { kind: 'anchor', subpathId: subpath.id, anchorId: anchor.id };
      }
    }
  }

  if (options.includeHandles ?? true) {
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
