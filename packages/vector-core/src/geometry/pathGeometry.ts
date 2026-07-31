import type { Rect, Vec2 } from '../math/vector';
import { unionRects } from '../math/vector';
import type { FillRule, VectorPath, VectorSubpath } from '../model/types';
import { segmentAt, segmentCount, segmentsOf } from '../model/segments';
import { cubicBounds, nearestPointOnCubic } from './bezier';
import { flattenCubic } from './flatten';

export interface PathHit {
  subpathId: string;
  segmentIndex: number;
  point: Vec2;
  t: number;
  distanceSquared: number;
}

export const subpathBounds = (subpath: VectorSubpath): Rect | null => {
  let result: Rect | null = null;
  for (const segment of segmentsOf(subpath)) result = unionRects(result, cubicBounds(segment));
  if (!result && subpath.anchors.length === 1) {
    const { x, y } = subpath.anchors[0].position;
    return { x, y, width: 0, height: 0 };
  }
  return result;
};

export const pathBounds = (path: VectorPath): Rect | null => {
  let result: Rect | null = null;
  for (const subpath of path.subpaths) result = unionRects(result, subpathBounds(subpath));
  return result;
};

export const nearestPointOnPath = (path: VectorPath, point: Vec2): PathHit | null => {
  let result: PathHit | null = null;
  for (const subpath of path.subpaths) {
    for (let index = 0; index < segmentCount(subpath); index += 1) {
      const nearest = nearestPointOnCubic(segmentAt(subpath, index), point);
      if (!result || nearest.distanceSquared < result.distanceSquared) {
        result = { subpathId: subpath.id, segmentIndex: index, ...nearest };
      }
    }
  }
  return result;
};

const flattenedSubpath = (subpath: VectorSubpath, tolerance: number): Vec2[] => {
  const result: Vec2[] = [];
  for (let index = 0; index < segmentCount(subpath); index += 1) {
    const points = flattenCubic(segmentAt(subpath, index), { tolerance });
    result.push(...(index === 0 ? points : points.slice(1)));
  }
  return result;
};

const windingContribution = (a: Vec2, b: Vec2, point: Vec2) => {
  if (a.y <= point.y) {
    if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) return 1;
  } else if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) {
    return -1;
  }
  return 0;
};

export const pointInPath = (
  path: VectorPath,
  point: Vec2,
  tolerance = 0.25,
  fillRule: FillRule = path.fillRule
) => {
  let winding = 0;
  for (const subpath of path.subpaths) {
    if (!subpath.closed || subpath.anchors.length < 3) continue;
    const polygon = flattenedSubpath(subpath, tolerance);
    for (let index = 0; index < polygon.length; index += 1) {
      winding += windingContribution(polygon[index], polygon[(index + 1) % polygon.length], point);
    }
  }
  return fillRule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
};
